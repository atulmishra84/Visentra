/**
 * Visentra → Attest.
 * Agents are upserted on the same host, then each stored runtime action is
 * POSTed to /api/decisions. Prompts and raw payloads are not sent.
 */
import http from "http";
import https from "https";
import { encryptJson, decryptJson, maskSecret } from "../utils/crypto.js";
import { assertAllowedUrl } from "../utils/http.js";
import { projectAssuranceFacts } from "../assurance/projectDiscovery.js";

const PROVIDER = "attest";
export const DEFAULT_DECISIONS_URL = "http://127.0.0.1:3000/api/decisions";
const DECISION_LIMIT = 100;

function text(value, max = 240) {
  const raw = String(value ?? "").trim();
  return raw ? raw.slice(0, max) : "";
}

function isLoopback(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function attestPolicy(targetUrl) {
  const parsed = new URL(targetUrl);
  const host = parsed.hostname.toLowerCase();
  const loopback = isLoopback(host);
  return {
    allowHosts: [host],
    allowPrivate: loopback || process.env.ATTEST_ALLOW_PRIVATE === "true",
    allowHttp: loopback || process.env.ATTEST_ALLOW_HTTP === "true",
    timeoutMs: Number(process.env.ATTEST_TIMEOUT_MS || 15_000)
  };
}

export function attestSyncUrl(decisionsUrl) {
  const url = new URL(decisionsUrl);
  url.pathname = "/api/integration/agentradar/sync";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function providerOf(row) {
  const raw = String(row.cloud_provider || row.provider || "").toLowerCase();
  if (raw.includes("aws")) return "aws";
  if (raw.includes("gcp") || raw.includes("google")) return "gcp";
  if (raw.includes("azure") || raw.includes("entra")) return "azure";
  return "custom";
}

function scopesFrom(permissions) {
  const list = Array.isArray(permissions) ? permissions : [];
  return list
    .slice(0, 40)
    .map((permission) => {
      if (typeof permission === "string") {
        const name = text(permission, 200);
        return name ? { name, effect: "ALLOW" } : null;
      }
      if (!permission || typeof permission !== "object") return null;
      const name = text(permission.resource || permission.name || permission.scope, 200);
      if (!name) return null;
      return { name, effect: permission.allowed === false ? "DENY" : "ALLOW" };
    })
    .filter(Boolean);
}

export function attestAgent(row) {
  const principal = text(row.identity_used || row.name, 160) || "agent";
  return {
    id: row.id,
    name: text(row.name, 200) || "Agent",
    source: "visentra",
    status: row.running_status === "disabled" ? "Paused" : "Active",
    owner: text(row.owner, 160) || null,
    identity: {
      provider: providerOf(row),
      payload: {
        credential: principal,
        principal,
        scopes: scopesFrom(row.permissions)
      }
    }
  };
}

export function decisionRequest(agentId, event) {
  const operation = text(event.operation || event.action, 80);
  const resource = text(event.resource, 240);
  if (!operation && !resource) return null;
  const request = {
    agent_id: agentId,
    operation,
    resource
  };
  const tool = text(event.tool || (event.kind === "tool" ? event.resource : ""), 160);
  if (tool) request.tool = tool;
  return request;
}

export function attestReachable(status, body) {
  return status === 400 && /agent_id/i.test(String(body || ""));
}

function publicRow(row) {
  if (!row) return null;
  let hasApiKey = false;
  try {
    const secrets = row.secrets_enc ? decryptJson(row.secrets_enc) : {};
    hasApiKey = Boolean(secrets?.apiKey);
  } catch {
    hasApiKey = Boolean(row.secrets_enc);
  }
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    enabled: row.enabled,
    autoPush: row.auto_push,
    webhookUrl: row.webhook_url,
    hasApiKey,
    apiKeyMasked: hasApiKey ? maskSecret("********") : null,
    lastSyncAt: row.last_sync_at,
    lastSyncStatus: row.last_sync_status,
    lastSyncError: row.last_sync_error,
    lastSyncCount: row.last_sync_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function loadRow(pool, tenantId) {
  const res = await pool.query(`SELECT * FROM outbound_integrations WHERE tenant_id=$1 AND provider=$2`, [
    tenantId,
    PROVIDER
  ]);
  return res.rows[0] || null;
}

function apiKeyFrom(row) {
  const fromEnv = text(process.env.ATTEST_API_KEY, 200);
  if (!row?.secrets_enc) return fromEnv || "";
  try {
    const secrets = decryptJson(row.secrets_enc);
    return text(secrets?.apiKey, 200) || fromEnv || "";
  } catch {
    return fromEnv || "";
  }
}

export async function getAttestIntegration(pool, tenantId) {
  return publicRow(await loadRow(pool, tenantId));
}

export async function upsertAttestIntegration(pool, tenantId, body = {}) {
  const prev = await loadRow(pool, tenantId);
  const name = text(body.name || prev?.name || "Attest decisions", 80) || "Attest decisions";
  const enabled = body.enabled != null ? Boolean(body.enabled) : prev ? prev.enabled : false;
  const autoPush = body.autoPush != null ? Boolean(body.autoPush) : prev ? prev.auto_push : true;
  let webhookUrl = body.webhookUrl != null ? text(body.webhookUrl, 400) : prev?.webhook_url || "";
  if (!webhookUrl) webhookUrl = DEFAULT_DECISIONS_URL;
  assertAllowedUrl(webhookUrl, attestPolicy(webhookUrl));
  attestSyncUrl(webhookUrl);

  let secretsEnc = prev?.secrets_enc || null;
  if (body.apiKey != null && text(body.apiKey, 200)) {
    secretsEnc = encryptJson({ apiKey: text(body.apiKey, 200) });
  } else if (body.clearApiKey) {
    secretsEnc = null;
  }

  if (prev) {
    const updated = await pool.query(
      `UPDATE outbound_integrations SET
         name=$3, enabled=$4, auto_push=$5, webhook_url=$6, secrets_enc=$7, updated_at=NOW()
       WHERE tenant_id=$1 AND provider=$2
       RETURNING *`,
      [tenantId, PROVIDER, name, enabled, autoPush, webhookUrl, secretsEnc]
    );
    return publicRow(updated.rows[0]);
  }

  const created = await pool.query(
    `INSERT INTO outbound_integrations (tenant_id, provider, name, enabled, auto_push, webhook_url, secrets_enc)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [tenantId, PROVIDER, name, enabled, autoPush, webhookUrl, secretsEnc]
  );
  return publicRow(created.rows[0]);
}

export async function buildAttestFeed(pool, tenantId, { since = null } = {}) {
  const agents = await pool.query(
    `SELECT id, name, owner, running_status, identity_used, provider, cloud_provider, permissions
     FROM agents WHERE tenant_id=$1
     ORDER BY last_seen DESC NULLS LAST
     LIMIT 500`,
    [tenantId]
  );
  const params = [tenantId];
  let sinceClause = "";
  if (since) {
    params.push(since);
    sinceClause = ` AND occurred_at > $${params.length}`;
  }
  const events = await pool.query(
    `SELECT agent_id, operation, action, resource, kind
     FROM runtime_events
     WHERE tenant_id=$1${sinceClause}
     ORDER BY occurred_at DESC
     LIMIT 200`,
    params
  );
  const requests = [];
  const covered = new Set();
  for (const event of events.rows) {
    const request = decisionRequest(event.agent_id, event);
    if (!request) continue;
    requests.push(request);
    covered.add(event.agent_id);
  }
  if (requests.length < DECISION_LIMIT) {
    const observations = await pool.query(
      `SELECT agent_id, collector_id, payload, observed_at
       FROM agent_observations
       WHERE tenant_id=$1
       ORDER BY observed_at DESC
       LIMIT 200`,
      [tenantId]
    );
    const byAgent = new Map();
    for (const row of observations.rows) {
      if (covered.has(row.agent_id)) continue;
      const list = byAgent.get(row.agent_id) || [];
      list.push(row);
      byAgent.set(row.agent_id, list);
    }
    for (const [agentId, rows] of byAgent) {
      const facts = projectAssuranceFacts({ metadata: {} }, rows);
      for (const event of facts.events) {
        const request = decisionRequest(agentId, event);
        if (request) requests.push(request);
      }
    }
  }
  return {
    agents: agents.rows.map(attestAgent),
    requests: requests.slice(0, DECISION_LIMIT)
  };
}

function postJson(targetUrl, apiKey, body, timeoutMs) {
  const policy = attestPolicy(targetUrl);
  assertAllowedUrl(targetUrl, policy);
  const payload = Buffer.from(JSON.stringify(body));
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
    "content-length": String(payload.length),
    "user-agent": "Visentra-Attest-Feed/1.0"
  };
  if (apiKey) headers["x-api-key"] = apiKey;
  const url = new URL(targetUrl);
  const transport = url.protocol === "http:" ? http : https;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      { method: "POST", headers, timeout: timeoutMs },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode || 0,
            ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
            body: Buffer.concat(chunks).toString("utf8").slice(0, 2000)
          });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error(`Attest request timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function parsedDecision(body) {
  try {
    const json = JSON.parse(body);
    return {
      decision: text(json.decision, 40) || null,
      reason: text(json.reason || json.error, 240) || null
    };
  } catch {
    return { decision: null, reason: text(body, 240) || null };
  }
}

export async function deliverAttestFeed({ decisionsUrl, apiKey, agents, requests, post = postJson }) {
  const timeoutMs = attestPolicy(decisionsUrl).timeoutMs;
  if (!agents.length && !requests.length) {
    return { ok: true, agentCount: 0, decisionCount: 0, decisions: [], message: "No agents or runtime actions to send" };
  }
  if (!apiKey) {
    const err = new Error("Attest API key is required (X-API-Key)");
    err.status = 400;
    throw err;
  }
  const synced = await post(attestSyncUrl(decisionsUrl), apiKey, { agents }, timeoutMs);
  if (!synced.ok) {
    const detail = parsedDecision(synced.body);
    const err = new Error(detail.reason || `Attest agent sync returned HTTP ${synced.status}`);
    err.status = synced.status || 502;
    throw err;
  }
  const decisions = [];
  for (const request of requests) {
    const result = await post(decisionsUrl, apiKey, request, timeoutMs);
    const parsed = parsedDecision(result.body);
    decisions.push({
      agent_id: request.agent_id,
      operation: request.operation,
      resource: request.resource,
      status: result.status,
      decision: parsed.decision,
      reason: parsed.reason
    });
    if (!result.ok) break;
  }
  const failed = decisions.find((row) => row.status < 200 || row.status >= 300);
  return {
    ok: !failed,
    agentCount: agents.length,
    decisionCount: decisions.filter((row) => row.status >= 200 && row.status < 300).length,
    decisions,
    message: failed ? failed.reason || `Attest decisions returned HTTP ${failed.status}` : null
  };
}

async function markSync(pool, tenantId, { status, error = null, count = null }) {
  await pool.query(
    `UPDATE outbound_integrations SET
       last_sync_at=NOW(), last_sync_status=$3, last_sync_error=$4, last_sync_count=$5, updated_at=NOW()
     WHERE tenant_id=$1 AND provider=$2`,
    [tenantId, PROVIDER, status, error, count]
  );
}

export async function pushFeedToAttest(pool, tenantId, deps = {}) {
  const row = await loadRow(pool, tenantId);
  if (!row?.enabled) {
    const err = new Error("Attest integration is not enabled");
    err.status = 400;
    throw err;
  }
  const decisionsUrl = row.webhook_url || DEFAULT_DECISIONS_URL;
  const since = row.last_sync_status === "ok" ? row.last_sync_at : null;
  const feed = await buildAttestFeed(pool, tenantId, { since });
  try {
    const result = await deliverAttestFeed({
      decisionsUrl,
      apiKey: apiKeyFrom(row),
      agents: feed.agents,
      requests: feed.requests,
      post: deps.post
    });
    await markSync(pool, tenantId, {
      status: result.ok ? "ok" : "error",
      error: result.message,
      count: result.decisionCount
    });
    await pool.query(
      `INSERT INTO discovery_events (tenant_id, event_type, severity, message, payload)
       VALUES ($1,'attest.decisions',$2,$3,$4::jsonb)`,
      [
        tenantId,
        result.ok ? "info" : "warn",
        result.message || `Sent ${result.agentCount} agents and ${result.decisionCount} decisions to Attest`,
        JSON.stringify({
          agent_count: result.agentCount,
          decision_count: result.decisionCount,
          decisions: result.decisions
        })
      ]
    );
    return result;
  } catch (err) {
    await markSync(pool, tenantId, { status: "error", error: err.message, count: 0 });
    throw err;
  }
}

export async function testAttestConnection(pool, tenantId, deps = {}) {
  const row = await loadRow(pool, tenantId);
  const decisionsUrl = row?.webhook_url || DEFAULT_DECISIONS_URL;
  const apiKey = apiKeyFrom(row);
  if (!apiKey) {
    const err = new Error("Attest API key is required (X-API-Key)");
    err.status = 400;
    throw err;
  }
  const post = deps.post || postJson;
  const result = await post(decisionsUrl, apiKey, {}, attestPolicy(decisionsUrl).timeoutMs);
  const ok = attestReachable(result.status, result.body);
  return {
    ok,
    status: result.status,
    message: ok ? "Attest accepted the API key" : parsedDecision(result.body).reason || `HTTP ${result.status}`
  };
}

export function scheduleAttestAutoPush(pool, tenantId) {
  setImmediate(() => {
    pool
      .query(
        `SELECT enabled, auto_push, webhook_url FROM outbound_integrations WHERE tenant_id=$1 AND provider=$2`,
        [tenantId, PROVIDER]
      )
      .then((res) => {
        const row = res.rows[0];
        if (!row?.enabled || !row.auto_push || !row.webhook_url) return null;
        return pushFeedToAttest(pool, tenantId);
      })
      .catch((err) => {
        console.warn("Attest decisions push failed:", err.message);
      });
  });
}
