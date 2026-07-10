import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import pg from "pg";
import neo4j from "neo4j-driver";
import { migrate } from "./migrate.js";
import { claimDiscoveryJob, executeDiscoveryJob } from "./discovery/pipeline.js";
import {
  DEFAULT_COLLECTORS,
  PRODUCTION_COLLECTORS,
  ALL_COLLECTOR_IDS
} from "./discovery/collectors.js";
import {
  PROVIDER_FIELDS,
  listConnectors,
  getConnector,
  createConnector,
  updateConnector,
  deleteConnector,
  testConnector
} from "./services/connectors.js";
import { classifyShadowAi, summarizeShadowFindings } from "./services/shadowAi.js";
import { writeAudit, listAuditEvents } from "./services/audit.js";
import { buildCoverageMap } from "./services/coverage.js";
import {
  entraEnabled,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  decodeIdToken,
  mapEntraRole,
  newOidcState
} from "./auth/entra.js";
import { migrateConnectorEncryption } from "./utils/crypto.js";
import { publicErrorMessage } from "./utils/http.js";
import {
  IS_PROD,
  assertProductionConfig,
  resolveJwtSecret,
  resolveCorsOrigin,
  sanitizeCollectors,
  createRateLimiter
} from "./config.js";

assertProductionConfig();

const PORT = Number(process.env.PORT || 8080);
const JWT_SECRET = resolveJwtSecret();
const CORS_ORIGIN = resolveCorsOrigin();
const JWT_TTL = process.env.JWT_TTL || (IS_PROD ? "8h" : "12h");
const COLLECTOR_IDS = IS_PROD ? PRODUCTION_COLLECTORS : DEFAULT_COLLECTORS;

const pool = new pg.Pool({ connectionString: process.env.POSTGRES_URL });
let neo4jDriver = null;
try {
  if (process.env.NEO4J_URI) {
    if (IS_PROD && !process.env.NEO4J_PASSWORD) {
      throw new Error("NEO4J_PASSWORD is required in production when NEO4J_URI is set");
    }
    neo4jDriver = neo4j.driver(
      process.env.NEO4J_URI,
      neo4j.auth.basic(process.env.NEO4J_USER || "neo4j", process.env.NEO4J_PASSWORD || "agentradar")
    );
  }
} catch (err) {
  console.warn("Neo4j driver init failed:", err.message);
  if (IS_PROD) throw err;
}

/** @type {Map<string, Set<import('express').Response>>} */
const sseClients = new Map();

function broadcast(tenantId, event) {
  const set = sseClients.get(tenantId);
  if (!set) return;
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {
      /* ignore */
    }
  }
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, tid: user.tenant_id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_TTL }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
  // EventSource cannot set Authorization headers. Allow ?token= only for the graph SSE route.
  const isGraphStream = req.path === "/api/graph/stream" || req.path === "/graph/stream";
  const queryToken =
    typeof req.query.token === "string" && isGraphStream ? req.query.token : null;
  const raw = bearer || queryToken;
  if (!raw) return res.status(401).json({ error: { message: "Unauthorized" } });
  try {
    req.user = jwt.verify(String(raw), JWT_SECRET);
    req.tenantId = req.user.tid;
    next();
  } catch {
    return res.status(401).json({ error: { message: "Invalid token" } });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role) && req.user.role !== "platform_admin") {
      return res.status(403).json({ error: { message: "Forbidden" } });
    }
    next();
  };
}

async function initNeo4jConstraints() {
  if (!neo4jDriver) return;
  const session = neo4jDriver.session();
  try {
    const statements = [
      "CREATE CONSTRAINT agent_tenant_id IF NOT EXISTS FOR (a:Agent) REQUIRE (a.tenantId, a.id) IS UNIQUE",
      "CREATE CONSTRAINT developer_tenant_id IF NOT EXISTS FOR (d:Developer) REQUIRE (d.tenantId, d.id) IS UNIQUE",
      "CREATE INDEX agent_name IF NOT EXISTS FOR (a:Agent) ON (a.tenantId, a.name)"
    ];
    for (const s of statements) {
      try {
        await session.run(s);
      } catch (err) {
        console.warn("Neo4j constraint:", err.message);
      }
    }
  } finally {
    await session.close();
  }
}

function agentFilters(query, startIdx = 2) {
  const clauses = [];
  const params = [];
  let i = startIdx;
  const map = {
    owner: "owner",
    model: "model",
    framework: "framework",
    cloud: "cloud_provider",
    category: "category",
    department: "department",
    hostname: "hostname",
    language: "programming_language",
    repository: "repository",
    ide: "ide"
  };
  for (const [q, col] of Object.entries(map)) {
    if (query[q]) {
      clauses.push(`AND ${col} ILIKE $${i}`);
      params.push(`%${query[q]}%`);
      i += 1;
    }
  }
  if (query.q) {
    clauses.push(
      `AND (name ILIKE $${i} OR owner ILIKE $${i} OR hostname ILIKE $${i} OR model ILIKE $${i} OR framework ILIKE $${i} OR repository ILIKE $${i} OR category ILIKE $${i} OR provider ILIKE $${i} OR cloud_provider ILIKE $${i} OR device ILIKE $${i})`
    );
    params.push(`%${query.q}%`);
    i += 1;
  }
  if (query.risk) {
    clauses.push(`AND risk_indicators::text ILIKE $${i}`);
    params.push(`%${query.risk}%`);
    i += 1;
  }
  if (query.bu || query.business_unit) {
    clauses.push(`AND business_unit ILIKE $${i}`);
    params.push(`%${query.bu || query.business_unit}%`);
    i += 1;
  }
  if (query.tool) {
    clauses.push(`AND tools::text ILIKE $${i}`);
    params.push(`%${query.tool}%`);
    i += 1;
  }
  if (query.prompt) {
    clauses.push(`AND prompt_templates::text ILIKE $${i}`);
    params.push(`%${query.prompt}%`);
    i += 1;
  }
  if (query.shadow === "true" || query.shadow === true || query.shadowAi === "true") {
    clauses.push(
      `AND (
         risk_indicators::text ILIKE '%shadow%'
         OR risk_indicators::text ILIKE '%unmanaged%'
         OR metadata->>'shadowAi' = 'true'
         OR (owner IS NULL AND (
           category IN ('ide','local_llm','browser','saas','mcp','framework','autonomous')
           OR (category = 'cloud' AND (metadata->>'aiRelevant')::text = 'true')
         ))
       )`
    );
  }
  if (query.project) {
    clauses.push(`AND (repository ILIKE $${i} OR metadata::text ILIKE $${i})`);
    params.push(`%${query.project}%`);
    i += 1;
  }
  if (query.evidenceClass || query.evidence) {
    clauses.push(`AND metadata->>'evidenceClass' = $${i}`);
    params.push(String(query.evidenceClass || query.evidence));
    i += 1;
  }
  if (query.agentStatus || query.status) {
    clauses.push(`AND metadata->>'agentStatus' = $${i}`);
    params.push(String(query.agentStatus || query.status));
    i += 1;
  }
  return { clauses: clauses.join(" "), params, nextIdx: i };
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

async function resolveSeedAgents(tenantId, seed) {
  const q = String(seed || "").trim();
  if (!q) return [];

  if (isUuid(q)) {
    const byId = await pool.query(`SELECT * FROM agents WHERE tenant_id=$1 AND id=$2`, [tenantId, q]);
    if (byId.rows.length) return byId.rows;
  }

  const byKey = await pool.query(
    `SELECT * FROM agents
     WHERE tenant_id=$1
       AND (fingerprint = $2 OR lower(name) = lower($2))
     ORDER BY last_seen DESC
     LIMIT 5`,
    [tenantId, q]
  );
  if (byKey.rows.length) return byKey.rows;

  const fuzzy = await pool.query(
    `SELECT * FROM agents
     WHERE tenant_id=$1
       AND (name ILIKE $2 OR fingerprint ILIKE $2 OR framework ILIKE $2 OR category ILIKE $2)
     ORDER BY last_seen DESC
     LIMIT 12`,
    [tenantId, `%${q}%`]
  );
  return fuzzy.rows;
}

async function graphFromSql(tenantId, { agentId, depth = 2, limit = 60 } = {}) {
  const nodes = new Map();
  const edges = [];
  const maxNodes = Math.min(Math.max(Number(limit) || 60, 10), 200);
  const hopDepth = Math.min(Math.max(Number(depth) || 2, 1), 3);

  let agents;
  let seedMode = Boolean(agentId);

  if (agentId) {
    agents = { rows: await resolveSeedAgents(tenantId, agentId) };
    if (!agents.rows.length) {
      return {
        nodes: [],
        edges: [],
        meta: {
          seed: agentId,
          matched: 0,
          message: `No inventory match for "${agentId}". Try an agent UUID, fingerprint, or name from Inventory.`
        }
      };
    }
  } else {
    // Prefer agents that already have relationships so the explorer is never empty/sparse
    agents = await pool.query(
      `SELECT a.*
       FROM agents a
       WHERE a.tenant_id=$1
         AND EXISTS (
           SELECT 1 FROM relationships r
           WHERE r.tenant_id=a.tenant_id AND r.from_id=a.id
         )
       ORDER BY a.last_seen DESC
       LIMIT $2`,
      [tenantId, maxNodes]
    );
    if (!agents.rows.length) {
      agents = await pool.query(
        `SELECT * FROM agents WHERE tenant_id=$1 ORDER BY last_seen DESC LIMIT $2`,
        [tenantId, maxNodes]
      );
    }
  }

  for (const a of agents.rows) {
    nodes.set(a.id, {
      id: a.id,
      type: "Agent",
      label: a.name,
      name: a.name,
      category: a.category,
      framework: a.framework,
      model: a.model,
      provider: a.provider || a.cloud_provider
    });

    // Attribute edges so Topology Map is useful even when SQL relationships are sparse
    const attrs = [
      ["Model", a.model, "INVOKES_MODEL"],
      ["Framework", a.framework, "USES_FRAMEWORK"],
      ["Cloud", a.cloud_provider || (a.provider === "azure" || a.provider === "aws" || a.provider === "gcp" ? a.provider : null), "DEPLOYED_IN"],
      ["IDE", a.ide, "RUNS_IN"],
      ["Provider", a.provider && a.provider !== a.cloud_provider ? a.provider : null, "PROVIDED_BY"]
    ];
    for (const [type, value, rel] of attrs) {
      if (!value) continue;
      const key = `${String(type).toLowerCase()}:${String(value).toLowerCase()}`;
      if (!nodes.has(key) && nodes.size < maxNodes * 2) {
        nodes.set(key, {
          id: key,
          type,
          label: String(value),
          name: String(value),
          category: String(type).toLowerCase()
        });
      }
      if (nodes.has(key)) {
        edges.push({
          id: `${a.id}:${rel}:${key}`,
          source: a.id,
          target: key,
          from: a.id,
          to: key,
          type: rel,
          label: rel
        });
      }
    }
  }

  const agentIds = agents.rows.map((a) => a.id);
  if (!agentIds.length) {
    return { nodes: [], edges: [], meta: { matched: 0, message: "No inventory assets yet. Run discovery first." } };
  }

  const rels = await pool.query(
    `SELECT r.*, a.name AS from_name, s.name AS to_name, s.asset_type
     FROM relationships r
     JOIN agents a ON a.id = r.from_id
     JOIN assets s ON s.id = r.to_id
     WHERE r.tenant_id=$1 AND r.from_id = ANY($2::uuid[])
     ORDER BY r.last_seen DESC
     LIMIT 500`,
    [tenantId, agentIds]
  );

  for (const r of rels.rows) {
    if (nodes.size >= maxNodes * 2 && !nodes.has(r.to_id)) continue;
    nodes.set(r.to_id, {
      id: r.to_id,
      type: r.to_type || r.asset_type || "Asset",
      label: r.to_name,
      name: r.to_name,
      category: r.asset_type || r.to_type
    });
    edges.push({
      id: r.id,
      source: r.from_id,
      target: r.to_id,
      from: r.from_id,
      to: r.to_id,
      type: r.rel_type,
      label: r.rel_type,
      confidence: r.confidence
    });
  }

  // Optional Neo4j enrichment (SQL graph is primary for MVP)
  if (neo4jDriver && seedMode && hopDepth > 1 && agentIds.length === 1) {
    const session = neo4jDriver.session();
    try {
      await session.run(
        `MATCH (a:Agent {tenantId: $tenantId, id: $agentId})-[*1..2]-(n)
         WHERE n.tenantId = $tenantId
         RETURN count(n) AS c`,
        { tenantId, agentId: agentIds[0] }
      );
    } catch (err) {
      console.warn("Neo4j graph query:", err.message);
    } finally {
      await session.close();
    }
  }

  // Deduplicate edges by source|target|type
  const seen = new Set();
  const uniqueEdges = [];
  for (const edge of edges) {
    const key = `${edge.source}|${edge.target}|${edge.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueEdges.push(edge);
  }

  return {
    nodes: [...nodes.values()],
    edges: uniqueEdges,
    meta: {
      seed: agentId || null,
      matched: agents.rows.length,
      nodeCount: nodes.size,
      edgeCount: uniqueEdges.length,
      depth: hopDepth,
      message: seedMode
        ? `Neighborhood for ${agents.rows.length} seed agent(s)`
        : `Overview of ${agents.rows.length} connected agents`
    }
  };
}


async function usageBreakdown(tenantId, column) {
  const res = await pool.query(
    `SELECT COALESCE(${column}, 'unknown') AS name, COUNT(*)::int AS count
     FROM agents WHERE tenant_id=$1
     GROUP BY 1 ORDER BY count DESC LIMIT 50`,
    [tenantId]
  );
  return res.rows;
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use((req, res, next) => {
  req.requestId = req.headers["x-request-id"] || crypto.randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

const loginRateLimit = createRateLimiter({ windowMs: 60_000, max: IS_PROD ? 10 : 60 });

app.get("/health", async (_req, res) => {
  res.json({
    status: "ok",
    service: "agentradar-api",
    env: IS_PROD ? "production" : "development",
    neo4j: Boolean(neo4jDriver)
  });
});

app.get("/ready", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    if (neo4jDriver) {
      const session = neo4jDriver.session();
      try {
        await session.run("RETURN 1 AS ok");
      } finally {
        await session.close();
      }
    }
    res.json({ status: "ready", postgres: true, neo4j: Boolean(neo4jDriver) });
  } catch (err) {
    res.status(503).json({ status: "not_ready", error: IS_PROD ? "dependency check failed" : err.message });
  }
});

app.post("/api/auth/login", loginRateLimit, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: { message: "email and password required" } });
  const result = await pool.query(
    `SELECT u.*, t.name AS tenant_name, t.slug AS tenant_slug
     FROM users u JOIN tenants t ON t.id = u.tenant_id
     WHERE lower(u.email)=lower($1) LIMIT 1`,
    [email]
  );
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: { message: "Invalid credentials" } });
  }
  await pool.query(`UPDATE users SET last_login=NOW() WHERE id=$1`, [user.id]);
  await writeAudit(pool, {
    tenantId: user.tenant_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "auth.login",
    resourceType: "user",
    resourceId: user.id,
    ip: req.ip
  });
  const token = signToken(user);
  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      roles: [user.role],
      tenant: user.tenant_slug,
      tenantId: user.tenant_id,
      authProvider: user.auth_provider || "local"
    }
  });
});

app.get("/api/auth/sso/status", (_req, res) => {
  res.json({
    entraEnabled: entraEnabled(),
    providers: entraEnabled() ? ["entra"] : []
  });
});

app.get("/api/auth/sso/entra/start", loginRateLimit, (req, res) => {
  if (!entraEnabled()) {
    return res.status(404).json({ error: { message: "Entra SSO is not configured" } });
  }
  try {
    const state = newOidcState();
    const nonce = newOidcState();
    // Short-lived cookies for OIDC CSRF/nonce (SameSite=Lax for top-level redirect)
    res.cookie?.("ar_oidc_state", state, { httpOnly: true, sameSite: "lax", maxAge: 600_000, secure: IS_PROD });
    // Express may not have cookie-parser — also return state for SPA to echo back
    const url = buildAuthorizeUrl({ state, nonce });
    res.json({ authorizeUrl: url, state, nonce });
  } catch (err) {
    res.status(500).json({ error: { message: publicErrorMessage(err, "Unable to start Entra SSO") } });
  }
});

app.post("/api/auth/sso/entra/callback", loginRateLimit, async (req, res) => {
  if (!entraEnabled()) {
    return res.status(404).json({ error: { message: "Entra SSO is not configured" } });
  }
  const { code, state } = req.body || {};
  if (!code) return res.status(400).json({ error: { message: "code is required" } });
  try {
    const tokens = await exchangeCodeForTokens(code);
    const claims = decodeIdToken(tokens.id_token);
    if (state && claims.nonce && req.body?.nonce && claims.nonce !== req.body.nonce) {
      return res.status(401).json({ error: { message: "Invalid OIDC nonce" } });
    }
    const email = claims.preferred_username || claims.email || claims.upn;
    if (!email) return res.status(401).json({ error: { message: "Entra token missing email claim" } });
    const name = claims.name || email;
    const role = mapEntraRole(claims);

    // Bind SSO users to the bootstrap tenant (single-tenant BYOC)
    const tenant = await pool.query(`SELECT id, slug FROM tenants ORDER BY created_at ASC LIMIT 1`);
    const tenantId = tenant.rows[0]?.id;
    if (!tenantId) return res.status(500).json({ error: { message: "No tenant provisioned" } });

    const unusable = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
    const upsert = await pool.query(
      `INSERT INTO users (tenant_id, email, name, role, password_hash, auth_provider)
       VALUES ($1,$2,$3,$4,$5,'entra')
       ON CONFLICT (tenant_id, email) DO UPDATE SET
         name = EXCLUDED.name,
         auth_provider = 'entra',
         last_login = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [tenantId, String(email).toLowerCase(), name, role, unusable]
    );
    const user = upsert.rows[0];
    user.tenant_slug = tenant.rows[0].slug;
    await writeAudit(pool, {
      tenantId,
      actorId: user.id,
      actorEmail: user.email,
      action: "auth.sso.entra",
      resourceType: "user",
      resourceId: user.id,
      details: { oid: claims.oid || null },
      ip: req.ip
    });
    const token = signToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        roles: [user.role],
        tenant: user.tenant_slug,
        tenantId: user.tenant_id,
        authProvider: "entra"
      }
    });
  } catch (err) {
    res.status(401).json({ error: { message: publicErrorMessage(err, "Entra SSO failed") } });
  }
});

app.get("/api/auth/me", auth, async (req, res) => {
  const result = await pool.query(
    `SELECT u.id, u.email, u.name, u.role, u.tenant_id, t.slug AS tenant
     FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.id=$1`,
    [req.user.sub]
  );
  const user = result.rows[0];
  if (!user) return res.status(404).json({ error: { message: "User not found" } });
  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      roles: [user.role],
      tenant: user.tenant,
      tenantId: user.tenant_id
    }
  });
});

app.get("/api/agents", auth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Number(req.query.offset) || 0;
  const { clauses, params } = agentFilters(req.query);
  const result = await pool.query(
    `SELECT * FROM agents WHERE tenant_id=$1 ${clauses}
     ORDER BY last_seen DESC LIMIT $${params.length + 2} OFFSET $${params.length + 3}`,
    [req.tenantId, ...params, limit, offset]
  );
  const count = await pool.query(
    `SELECT COUNT(*)::int AS total FROM agents WHERE tenant_id=$1 ${clauses}`,
    [req.tenantId, ...params]
  );
  res.json({ agents: result.rows, items: result.rows, total: count.rows[0].total, limit, offset });
});

app.get("/api/agents/:id", auth, async (req, res) => {
  const agent = await pool.query(`SELECT * FROM agents WHERE tenant_id=$1 AND id=$2`, [
    req.tenantId,
    req.params.id
  ]);
  if (!agent.rows[0]) return res.status(404).json({ error: { message: "Agent not found" } });
  const rels = await pool.query(
    `SELECT r.*, s.name AS to_name, s.asset_type, s.attributes
     FROM relationships r JOIN assets s ON s.id=r.to_id
     WHERE r.tenant_id=$1 AND r.from_id=$2`,
    [req.tenantId, req.params.id]
  );
  const observations = await pool.query(
    `SELECT id, collector_id, observed_at, fingerprint_hint FROM agent_observations
     WHERE tenant_id=$1 AND agent_id=$2 ORDER BY observed_at DESC LIMIT 20`,
    [req.tenantId, req.params.id]
  );
  const row = agent.rows[0];
  const shadow = classifyShadowAi(row);
  res.json({
    agent: {
      ...row,
      shadowAi: shadow.isShadow,
      shadowAiScore: shadow.score,
      shadowAiReasons: shadow.reasons,
      shadowAiTags: shadow.tags
    },
    relationships: rels.rows,
    observations: observations.rows
  });
});

app.get("/api/assets", auth, async (req, res) => {
  const params = [req.tenantId];
  let sql = `SELECT * FROM assets WHERE tenant_id=$1`;
  if (req.query.type) {
    params.push(req.query.type);
    sql += ` AND asset_type=$${params.length}`;
  }
  sql += ` ORDER BY last_seen DESC LIMIT 200`;
  const result = await pool.query(sql, params);
  res.json({ assets: result.rows, items: result.rows });
});

app.get("/api/graph", auth, async (req, res) => {
  try {
    const depth = Number(req.query.depth) || 2;
    const limit = Number(req.query.limit) || 60;
    const graph = await graphFromSql(req.tenantId, {
      agentId: req.query.agentId || req.query.q || req.query.seed,
      depth,
      limit
    });
    res.json(graph);
  } catch (err) {
    console.error("graph query failed:", err);
    res.status(500).json({
      error: { message: publicErrorMessage(err, "Graph query failed") },
      nodes: [],
      edges: []
    });
  }
});

app.get("/api/graph/seeds", auth, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const params = [req.tenantId];
    let sql = `
      SELECT a.id, a.name, a.category, a.framework, a.fingerprint, a.cloud_provider, a.provider,
             (SELECT COUNT(*)::int FROM relationships r WHERE r.from_id=a.id) AS edge_count
      FROM agents a
      WHERE a.tenant_id=$1`;
    if (q) {
      params.push(`%${q}%`);
      sql += ` AND (a.name ILIKE $2 OR a.fingerprint ILIKE $2 OR a.category ILIKE $2 OR a.framework ILIKE $2)`;
    }
    sql += ` ORDER BY edge_count DESC, a.last_seen DESC LIMIT 40`;
    const result = await pool.query(sql, params);
    res.json({ seeds: result.rows });
  } catch (err) {
    console.error("graph seeds failed:", err);
    res.status(500).json({
      error: { message: publicErrorMessage(err, "Failed to load graph seeds") },
      seeds: []
    });
  }
});

app.get("/api/graph/stream", auth, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  if (!sseClients.has(req.tenantId)) sseClients.set(req.tenantId, new Set());
  sseClients.get(req.tenantId).add(res);

  const heartbeat = setInterval(() => {
    res.write(`: ping\n\n`);
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.get(req.tenantId)?.delete(res);
  });
});

app.get("/api/search", auth, async (req, res) => {
  const q = String(req.query.q || "").trim();
  const { clauses, params } = agentFilters({ ...req.query, q });
  const result = await pool.query(
    `SELECT * FROM agents WHERE tenant_id=$1 ${clauses} ORDER BY confidence_score DESC, last_seen DESC LIMIT 100`,
    [req.tenantId, ...params]
  );

  const facetSql = async (col) => {
    const r = await pool.query(
      `SELECT COALESCE(${col}, 'unknown') AS value, COUNT(*)::int AS count
       FROM agents WHERE tenant_id=$1 ${clauses}
       GROUP BY 1 ORDER BY count DESC LIMIT 20`,
      [req.tenantId, ...params]
    );
    return r.rows;
  };

  const facets = {
    owner: await facetSql("owner"),
    model: await facetSql("model"),
    framework: await facetSql("framework"),
    cloud: await facetSql("cloud_provider"),
    category: await facetSql("category"),
    department: await facetSql("department"),
    ide: await facetSql("ide"),
    language: await facetSql("programming_language")
  };

  res.json({ results: result.rows, items: result.rows, agents: result.rows, facets, q });
});

app.get("/api/discovery/jobs", auth, async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM discovery_jobs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50`,
    [req.tenantId]
  );
  res.json({ jobs: result.rows, items: result.rows, collectors: COLLECTOR_IDS });
});

app.post("/api/discovery/jobs", auth, requireRole("platform_admin", "operator"), async (req, res) => {
  const collectors = sanitizeCollectors(req.body?.collectors, ALL_COLLECTOR_IDS);
  let job;
  try {
    job = await claimDiscoveryJob(pool, {
      tenantId: req.tenantId,
      collectorIds: collectors,
      triggeredBy: req.user.email
    });
  } catch (err) {
    if (err.status === 409) {
      return res.status(409).json({
        error: { message: err.message },
        jobId: err.jobId
      });
    }
    return res.status(500).json({
      error: { message: publicErrorMessage(err, "Failed to start discovery job") }
    });
  }
  res.status(202).json({
    accepted: true,
    message: "Discovery job started",
    jobId: job.id,
    collectors: job.collector_ids || collectors
  });
  writeAudit(pool, {
    tenantId: req.tenantId,
    actorId: req.user.sub,
    actorEmail: req.user.email,
    action: "discovery.job.start",
    resourceType: "discovery_job",
    resourceId: job.id,
    details: { collectors: job.collector_ids || collectors },
    ip: req.ip
  }).catch(() => {});
  executeDiscoveryJob(pool, neo4jDriver, job, {
    tenantId: req.tenantId,
    triggeredBy: req.user.email,
    broadcast
  }).catch((err) => console.error("Discovery job failed:", err));
});

app.get("/api/discovery/events", auth, async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM discovery_events WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100`,
    [req.tenantId]
  );
  res.json({ events: result.rows, items: result.rows });
});

app.get("/api/shadow-ai", auth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    // Prefer AI-ish inventory; classifier decides Shadow vs not
    const result = await pool.query(
      `SELECT * FROM agents
       WHERE tenant_id=$1
         AND (
           category IN ('ide','local','local_llm','framework','mcp','browser','autonomous','saas','container')
           OR model IS NOT NULL
           OR framework IS NOT NULL
           OR ide IS NOT NULL
           OR (category = 'cloud' AND (
             metadata->>'aiRelevant' = 'true'
             OR model = 'ai-relevant'
             OR name ILIKE '%(AI)%'
             OR name ILIKE '%ai%'
             OR name ILIKE '%openai%'
             OR name ILIKE '%copilot%'
           ))
           OR risk_indicators::text ILIKE '%shadow%'
           OR risk_indicators::text ILIKE '%unmanaged%'
           OR metadata->>'shadowAi' = 'true'
         )
       ORDER BY last_seen DESC
       LIMIT $2`,
      [req.tenantId, limit]
    );

    const summary = summarizeShadowFindings(result.rows);
    res.json({
      total: summary.total,
      byTag: summary.byTag,
      findings: summary.findings,
      items: summary.findings,
      agents: summary.findings,
      definition:
        "Shadow AI = AI agents/tools discovered without clear ownership or outside managed/sanctioned posture (visibility only)."
    });
  } catch (err) {
    console.error("shadow-ai query failed:", err);
    res.status(500).json({
      error: { message: publicErrorMessage(err, "Shadow AI query failed") },
      findings: [],
      total: 0
    });
  }
});

app.get("/api/dashboards/:name", auth, async (req, res) => {
  const name = req.params.name;
  const total = await pool.query(`SELECT COUNT(*)::int AS c FROM agents WHERE tenant_id=$1`, [req.tenantId]);
  const running = await pool.query(
    `SELECT COUNT(*)::int AS c FROM agents WHERE tenant_id=$1 AND running_status='running'`,
    [req.tenantId]
  );
  const owners = await pool.query(
    `SELECT COUNT(DISTINCT owner)::int AS c FROM agents WHERE tenant_id=$1 AND owner IS NOT NULL`,
    [req.tenantId]
  );
  const avgConf = await pool.query(
    `SELECT COALESCE(AVG(confidence_score),0)::float AS c FROM agents WHERE tenant_id=$1`,
    [req.tenantId]
  );
  const ownerless = await pool.query(
    `SELECT COUNT(*)::int AS c FROM agents
     WHERE tenant_id=$1 AND (owner IS NULL OR btrim(owner)='')`,
    [req.tenantId]
  );
  const lowConfidence = await pool.query(
    `SELECT COUNT(*)::int AS c FROM agents WHERE tenant_id=$1 AND confidence_score < 0.55`,
    [req.tenantId]
  );
  const shadowCandidates = await pool.query(
    `SELECT * FROM agents
     WHERE tenant_id=$1
       AND (
         category IN ('ide','local_llm','browser','saas','mcp','framework','autonomous')
         OR model IS NOT NULL OR framework IS NOT NULL OR ide IS NOT NULL
         OR risk_indicators::text ILIKE '%shadow%'
         OR metadata->>'shadowAi' = 'true'
         OR (category='cloud' AND metadata->>'aiRelevant'='true')
       )
     ORDER BY last_seen DESC LIMIT 300`,
    [req.tenantId]
  );
  const shadowSummary = summarizeShadowFindings(shadowCandidates.rows);

  const categories = await usageBreakdown(req.tenantId, "category");
  const models = await usageBreakdown(req.tenantId, "model");
  const frameworks = await usageBreakdown(req.tenantId, "framework");
  const cloud = await usageBreakdown(req.tenantId, "cloud_provider");
  const ide = await usageBreakdown(req.tenantId, "ide");
  const events = await pool.query(
    `SELECT * FROM discovery_events WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`,
    [req.tenantId]
  );
  const jobs = await pool.query(
    `SELECT * FROM discovery_jobs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10`,
    [req.tenantId]
  );

  const base = {
    totalAgents: total.rows[0].c,
    runningAgents: running.rows[0].c,
    uniqueOwners: owners.rows[0].c,
    ownerlessAgents: ownerless.rows[0].c,
    ownerless: ownerless.rows[0].c,
    lowConfidence: lowConfidence.rows[0].c,
    lowConfidenceAgents: lowConfidence.rows[0].c,
    shadowAiAgents: shadowSummary.total,
    shadowAi: shadowSummary.total,
    shadowAiByTag: shadowSummary.byTag,
    avgConfidence: Number(avgConf.rows[0].c.toFixed?.(3) ?? avgConf.rows[0].c),
    categories,
    agentsByCategory: categories,
    models,
    modelUsage: models,
    frameworks,
    cloud,
    ide,
    recentChanges: events.rows,
    events: events.rows,
    jobs: jobs.rows
  };

  if (name === "executive") {
    return res.json({
      dashboard: base,
      ...base
    });
  }
  if (name === "operations") {
    const queue = shadowSummary.findings.slice(0, 50).map((f) => ({
      ...f,
      queue: "shadow_ai",
      type: "shadow_ai",
      title: f.name
    }));
    return res.json({
      dashboard: {
        ...base,
        queue,
        items: queue,
        newDiscoveries: queue.length,
        collectorHealth: COLLECTOR_IDS.map((id) => {
          const last = jobs.rows.find((j) => (j.collector_ids || []).includes(id));
          return {
            name: id,
            status: last?.status === "error" ? "error" : last ? "ready" : "idle",
            lastJobAt: last?.finished_at || last?.started_at || null,
            lastJobStatus: last?.status || null
          };
        }),
        openJobs: jobs.rows.filter((j) => j.status === "running").length
      }
    });
  }
  if (name === "discovery") {
    return res.json({ dashboard: { jobs: jobs.rows, events: events.rows, collectors: COLLECTOR_IDS } });
  }
  if (name === "models") return res.json({ dashboard: { items: models, models, usage: models } });
  if (name === "frameworks")
    return res.json({ dashboard: { items: frameworks, frameworks, usage: frameworks } });
  if (name === "cloud") return res.json({ dashboard: { items: cloud, cloud, usage: cloud } });
  if (name === "ide") return res.json({ dashboard: { items: ide, ide, usage: ide } });
  if (name === "timeline") {
    const timeline = await pool.query(
      `SELECT id, name, first_discovered, last_seen, category, owner, framework, model
       FROM agents WHERE tenant_id=$1 ORDER BY first_discovered DESC LIMIT 100`,
      [req.tenantId]
    );
    return res.json({
      dashboard: { items: timeline.rows, events: timeline.rows, timeline: timeline.rows }
    });
  }
  return res.status(404).json({ error: { message: `Unknown dashboard ${name}` } });
});

app.get("/api/coverage", auth, async (req, res) => {
  try {
    const map = await buildCoverageMap(pool, req.tenantId, ALL_COLLECTOR_IDS);
    res.json(map);
  } catch (err) {
    res.status(500).json({ error: { message: publicErrorMessage(err, "Coverage map failed") } });
  }
});

app.get("/api/audit", auth, requireRole("platform_admin", "operator"), async (req, res) => {
  try {
    const events = await listAuditEvents(pool, req.tenantId, { limit: req.query.limit });
    res.json({ events, items: events });
  } catch (err) {
    res.status(500).json({ error: { message: publicErrorMessage(err, "Audit query failed") } });
  }
});

app.get("/api/export/agents", auth, async (req, res) => {
  const { clauses, params } = agentFilters(req.query);
  const result = await pool.query(
    `SELECT * FROM agents WHERE tenant_id=$1 ${clauses} ORDER BY last_seen DESC LIMIT 5000`,
    [req.tenantId, ...params]
  );
  const format = String(req.query.format || "json").toLowerCase();
  if (format === "csv") {
    const rows = result.rows;
    const cols = [
      "id",
      "name",
      "owner",
      "category",
      "framework",
      "model",
      "provider",
      "cloud_provider",
      "hostname",
      "department",
      "confidence_score",
      "last_seen"
    ];
    const lines = [cols.join(",")];
    for (const r of rows) {
      lines.push(cols.map((c) => JSON.stringify(r[c] ?? "")).join(","));
    }
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=agentradar-agents.csv");
    return res.send(lines.join("\n"));
  }
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", "attachment; filename=agentradar-agents.json");
  res.send(JSON.stringify({ agents: result.rows }, null, 2));
});

app.get("/api/connectors/schema", auth, (_req, res) => {
  res.json({ providers: PROVIDER_FIELDS });
});

app.get("/api/connectors", auth, async (req, res) => {
  const items = await listConnectors(pool, req.tenantId);
  res.json({ connectors: items, items });
});

app.post("/api/connectors", auth, requireRole("platform_admin", "operator"), async (req, res) => {
  try {
    const connector = await createConnector(pool, req.tenantId, req.body || {}, req.user.email);
    await pool.query(
      `INSERT INTO discovery_events (tenant_id, event_type, severity, message, payload)
       VALUES ($1,'connector.created','info',$2,$3::jsonb)`,
      [
        req.tenantId,
        `Connector created: ${connector.name}`,
        JSON.stringify({ connectorId: connector.id, provider: connector.provider })
      ]
    );
    await writeAudit(pool, {
      tenantId: req.tenantId,
      actorId: req.user.sub,
      actorEmail: req.user.email,
      action: "connector.create",
      resourceType: "connector",
      resourceId: connector.id,
      details: { provider: connector.provider, name: connector.name },
      ip: req.ip
    });
    res.status(201).json({ connector });
  } catch (err) {
    res.status(err.status || 500).json({
      error: { message: publicErrorMessage(err, "Unable to create connector") }
    });
  }
});

app.get("/api/connectors/:id", auth, async (req, res) => {
  const connector = await getConnector(pool, req.tenantId, req.params.id);
  if (!connector) return res.status(404).json({ error: { message: "Connector not found" } });
  res.json({ connector });
});

app.put("/api/connectors/:id", auth, requireRole("platform_admin", "operator"), async (req, res) => {
  try {
    const connector = await updateConnector(pool, req.tenantId, req.params.id, req.body || {});
    if (!connector) return res.status(404).json({ error: { message: "Connector not found" } });
    await writeAudit(pool, {
      tenantId: req.tenantId,
      actorId: req.user.sub,
      actorEmail: req.user.email,
      action: "connector.update",
      resourceType: "connector",
      resourceId: connector.id,
      details: { provider: connector.provider, name: connector.name },
      ip: req.ip
    });
    res.json({ connector });
  } catch (err) {
    res.status(err.status || 500).json({
      error: { message: publicErrorMessage(err, "Unable to update connector") }
    });
  }
});

app.delete("/api/connectors/:id", auth, requireRole("platform_admin", "operator"), async (req, res) => {
  const existing = await getConnector(pool, req.tenantId, req.params.id);
  const ok = await deleteConnector(pool, req.tenantId, req.params.id);
  if (!ok) return res.status(404).json({ error: { message: "Connector not found" } });
  await writeAudit(pool, {
    tenantId: req.tenantId,
    actorId: req.user.sub,
    actorEmail: req.user.email,
    action: "connector.delete",
    resourceType: "connector",
    resourceId: req.params.id,
    details: { name: existing?.name, provider: existing?.provider },
    ip: req.ip
  });
  res.status(204).end();
});

app.post("/api/connectors/:id/test", auth, requireRole("platform_admin", "operator"), async (req, res) => {
  const result = await testConnector(pool, req.tenantId, req.params.id);
  if (!result) return res.status(404).json({ error: { message: "Connector not found" } });
  await writeAudit(pool, {
    tenantId: req.tenantId,
    actorId: req.user.sub,
    actorEmail: req.user.email,
    action: "connector.test",
    resourceType: "connector",
    resourceId: req.params.id,
    details: { ok: result.ok, message: result.message },
    ip: req.ip
  });
  res.json(result);
});

/**
 * Remove demo-seeded inventory and related graph nodes (idempotent).
 * Keeps connector-discovered / live collector data.
 */
async function purgeDemoInventory(pool, neo4jDriver, tenantId) {
  const demoAgents = await pool.query(
    `SELECT id FROM agents
     WHERE tenant_id=$1
       AND (
         'demo' = ANY(source_collectors)
         OR 'k8s_stub' = ANY(source_collectors)
         OR fingerprint LIKE 'cloud-stub:vertex:demo%'
         OR fingerprint LIKE 'saas:%:tenant-demo%'
         OR fingerprint LIKE 'k8s-manifest:%'
         OR metadata->>'discoveryMode' = 'credentialed-connector-pending-live-adapter'
       )`,
    [tenantId]
  );
  const ids = demoAgents.rows.map((r) => r.id);
  if (ids.length) {
    await pool.query(`DELETE FROM relationships WHERE tenant_id=$1 AND (from_id = ANY($2::uuid[]) OR to_id = ANY($2::uuid[]))`, [
      tenantId,
      ids
    ]);
    await pool.query(`DELETE FROM agent_observations WHERE tenant_id=$1 AND agent_id = ANY($2::uuid[])`, [tenantId, ids]);
    await pool.query(`DELETE FROM agents WHERE tenant_id=$1 AND id = ANY($2::uuid[])`, [tenantId, ids]);
    console.log(`Purged ${ids.length} demo/stub agent(s) from inventory`);
  }

  await pool.query(
    `DELETE FROM agent_observations
     WHERE tenant_id=$1 AND (collector_id IN ('demo','k8s_stub') OR fingerprint_hint LIKE 'cloud-stub:vertex:demo%')`,
    [tenantId]
  );
  await pool.query(
    `DELETE FROM discovery_events
     WHERE tenant_id=$1 AND (
       event_type LIKE 'demo.%'
       OR message ILIKE '%demo seed%'
       OR payload->>'collector' = 'demo'
     )`,
    [tenantId]
  );
  // Drop jobs that only ran the demo collector
  await pool.query(
    `DELETE FROM discovery_jobs
     WHERE tenant_id=$1 AND collector_ids = ARRAY['demo']::text[]`,
    [tenantId]
  );

  if (neo4jDriver && ids.length) {
    const session = neo4jDriver.session();
    try {
      await session.run(
        `MATCH (a:Agent {tenantId: $tenantId})
         WHERE a.id IN $ids
         DETACH DELETE a`,
        { tenantId, ids }
      );
    } catch (err) {
      console.warn("Neo4j demo purge:", err.message);
    } finally {
      await session.close();
    }
  }
}

/**
 * Remove non-AI inventory when DISCOVERY_AI_ONLY is enabled (default).
 * Drops bare cloud resources, bare EDR devices, and Azure rows that fail the
 * tightened AI-resource classifier.
 */
async function purgeNonAiInventory(pool, neo4jDriver, tenantId) {
  const { DISCOVERY_AI_ONLY, isAzureAiResource } = await import("./discovery/aiRelevance.js");
  if (!DISCOVERY_AI_ONLY) {
    console.log("DISCOVERY_AI_ONLY=false — skipping non-AI inventory purge");
    return;
  }

  const clearIds = new Set();

  const obvious = await pool.query(
    `SELECT id FROM agents
     WHERE tenant_id=$1
       AND (
         metadata->>'inventoryClass' = 'cloud_resource'
         OR metadata->>'inventoryClass' = 'endpoint_device'
         OR metadata->>'inventoryClass' = 'connector_scan'
         OR metadata->>'inventoryClass' IN (
           'edr_connector','saas_connector','kubernetes_connector','source_connector','identity_connector'
         )
         OR fingerprint LIKE '%-connector-scan:%'
         OR fingerprint LIKE '%-connector-error:%'
         OR fingerprint LIKE 'edr-connector:%'
         OR (category = 'cloud'
             AND metadata->>'inventoryClass' = 'ai_cloud_resource'
             AND metadata->>'aiRelevant' = 'false')
         OR (category = 'endpoint'
             AND metadata->>'aiRelevant' IS DISTINCT FROM 'true'
             AND metadata->>'inventoryClass' IS DISTINCT FROM 'endpoint_ai_agent')
         OR fingerprint LIKE 'edr:%:device:%'
       )`,
    [tenantId]
  );
  for (const row of obvious.rows) clearIds.add(row.id);

  // Re-evaluate previously ingested Azure "AI" rows against the tightened classifier
  const azureRows = await pool.query(
    `SELECT id, name, metadata FROM agents
     WHERE tenant_id=$1
       AND 'cloud_azure' = ANY(source_collectors)
       AND metadata->>'inventoryClass' = 'ai_cloud_resource'
       AND metadata->>'azureType' IS NOT NULL`,
    [tenantId]
  );
  for (const row of azureRows.rows) {
    const meta = row.metadata || {};
    const stillAi = isAzureAiResource({
      type: meta.azureType,
      name: String(row.name || "").replace(/\s*\(AI\)\s*$/i, ""),
      kind: meta.azureKind,
      tags: meta.tags || {}
    });
    if (!stillAi) clearIds.add(row.id);
  }

  const ids = [...clearIds];
  if (!ids.length) {
    console.log("Non-AI inventory purge: nothing to remove");
    return;
  }

  await pool.query(`DELETE FROM relationships WHERE tenant_id=$1 AND (from_id = ANY($2::uuid[]) OR to_id = ANY($2::uuid[]))`, [
    tenantId,
    ids
  ]);
  await pool.query(`DELETE FROM agent_observations WHERE tenant_id=$1 AND agent_id = ANY($2::uuid[])`, [tenantId, ids]);
  await pool.query(`DELETE FROM agents WHERE tenant_id=$1 AND id = ANY($2::uuid[])`, [tenantId, ids]);
  console.log(`Purged ${ids.length} non-AI agent(s) (AI-only discovery mode)`);

  if (neo4jDriver) {
    const session = neo4jDriver.session();
    try {
      await session.run(
        `MATCH (a:Agent {tenantId: $tenantId})
         WHERE a.id IN $ids
         DETACH DELETE a`,
        { tenantId, ids }
      );
    } catch (err) {
      console.warn("Neo4j non-AI purge:", err.message);
    } finally {
      await session.close();
    }
  }
}

async function boot() {
  let postgresReady = false;
  for (let i = 0; i < 30; i++) {
    try {
      await pool.query("SELECT 1");
      postgresReady = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  if (!postgresReady) {
    throw new Error("Postgres unavailable after 60s — refusing to start");
  }

  const tenantId = await migrate(pool);
  await migrateConnectorEncryption(pool);
  await initNeo4jConstraints();

  // Purge any leftover demo-seeded inventory (idempotent)
  await purgeDemoInventory(pool, neo4jDriver, tenantId);
  await purgeNonAiInventory(pool, neo4jDriver, tenantId);

  console.log("Boot complete. Inventory starts from connectors/discovery only (no demo seed).");

  app.listen(PORT, () => {
    console.log(`AgentRadar API listening on :${PORT} (${IS_PROD ? "production" : "development"})`);
  });
}

boot().catch((err) => {
  console.error("Fatal boot error:", err);
  process.exit(1);
});
