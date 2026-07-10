import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pg from "pg";
import neo4j from "neo4j-driver";
import { migrate } from "./migrate.js";
import { runDiscoveryJob } from "./discovery/pipeline.js";
import { DEFAULT_COLLECTORS, DEFAULT_COLLECTORS as COLLECTOR_IDS } from "./discovery/collectors.js";

const PORT = Number(process.env.PORT || 8080);
const JWT_SECRET = process.env.JWT_SECRET || "agentradar-dev-secret-change-me";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const pool = new pg.Pool({ connectionString: process.env.POSTGRES_URL });
let neo4jDriver = null;
try {
  if (process.env.NEO4J_URI) {
    neo4jDriver = neo4j.driver(
      process.env.NEO4J_URI,
      neo4j.auth.basic(process.env.NEO4J_USER || "neo4j", process.env.NEO4J_PASSWORD || "agentradar")
    );
  }
} catch (err) {
  console.warn("Neo4j driver init failed:", err.message);
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
    { expiresIn: "12h" }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const queryToken = req.query.token;
  const raw = header.startsWith("Bearer ") ? header.slice(7) : queryToken;
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
      `AND (name ILIKE $${i} OR owner ILIKE $${i} OR hostname ILIKE $${i} OR model ILIKE $${i} OR framework ILIKE $${i} OR repository ILIKE $${i})`
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
  if (query.project) {
    clauses.push(`AND (repository ILIKE $${i} OR metadata::text ILIKE $${i})`);
    params.push(`%${query.project}%`);
    i += 1;
  }
  return { clauses: clauses.join(" "), params, nextIdx: i };
}

async function graphFromSql(tenantId, { agentId, depth = 2 } = {}) {
  const nodes = new Map();
  const edges = [];

  let agents;
  if (agentId) {
    agents = await pool.query(`SELECT * FROM agents WHERE tenant_id=$1 AND id=$2`, [tenantId, agentId]);
  } else {
    agents = await pool.query(
      `SELECT * FROM agents WHERE tenant_id=$1 ORDER BY last_seen DESC LIMIT 100`,
      [tenantId]
    );
  }

  for (const a of agents.rows) {
    nodes.set(a.id, {
      id: a.id,
      type: "Agent",
      label: a.name,
      name: a.name,
      category: a.category,
      framework: a.framework,
      model: a.model
    });
  }

  const agentIds = agents.rows.map((a) => a.id);
  if (!agentIds.length) return { nodes: [], edges: [] };

  const rels = await pool.query(
    `SELECT r.*, a.name AS from_name, s.name AS to_name, s.asset_type
     FROM relationships r
     JOIN agents a ON a.id = r.from_id
     JOIN assets s ON s.id = r.to_id
     WHERE r.tenant_id=$1 AND r.from_id = ANY($2::uuid[])`,
    [tenantId, agentIds]
  );

  for (const r of rels.rows) {
    nodes.set(r.to_id, {
      id: r.to_id,
      type: r.to_type || r.asset_type,
      label: r.to_name,
      name: r.to_name
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
  if (neo4jDriver && agentId && depth > 1) {
    const session = neo4jDriver.session();
    try {
      await session.run(
        `MATCH (a:Agent {tenantId: $tenantId, id: $agentId})-[*1..2]-(n)
         WHERE n.tenantId = $tenantId
         RETURN count(n) AS c`,
        { tenantId, agentId }
      );
    } catch (err) {
      console.warn("Neo4j graph query:", err.message);
    } finally {
      await session.close();
    }
  }

  return { nodes: [...nodes.values()], edges };
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
app.use(cors({ origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", neo4j: Boolean(neo4jDriver), service: "agentradar-api" });
  } catch (err) {
    res.status(503).json({ status: "error", error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
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
      tenantId: user.tenant_id
    }
  });
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
  res.json({ agent: agent.rows[0], relationships: rels.rows, observations: observations.rows });
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
  const depth = Number(req.query.depth) || 2;
  const graph = await graphFromSql(req.tenantId, { agentId: req.query.agentId, depth });
  res.json(graph);
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
  const collectors = req.body?.collectors || DEFAULT_COLLECTORS;
  res.status(202).json({ accepted: true, message: "Discovery job started" });
  runDiscoveryJob(pool, neo4jDriver, {
    tenantId: req.tenantId,
    collectorIds: collectors,
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
    return res.json({
      dashboard: {
        ...base,
        collectorHealth: COLLECTOR_IDS.map((id) => ({ name: id, status: "ready" })),
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

async function boot() {
  for (let i = 0; i < 30; i++) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const tenantId = await migrate(pool);
  await initNeo4jConstraints();

  const count = await pool.query(`SELECT COUNT(*)::int AS c FROM agents WHERE tenant_id=$1`, [tenantId]);
  if (count.rows[0].c === 0 || process.env.SEED_ON_START === "true") {
    console.log("Seeding discovery demo data...");
    await runDiscoveryJob(pool, neo4jDriver, {
      tenantId,
      collectorIds: ["demo", "ide_filesystem", "process", "mcp"],
      triggeredBy: "bootstrap",
      broadcast
    });
  }

  app.listen(PORT, () => {
    console.log(`AgentRadar API listening on :${PORT}`);
  });
}

boot().catch((err) => {
  console.error("Fatal boot error:", err);
  process.exit(1);
});
