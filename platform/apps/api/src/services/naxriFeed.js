/**
 * Visentra → NAXRI (AI Security Posture Management) discovered-agent feed.
 *
 * Push: POST inventory snapshot to a configured NAXRI webhook (manual or after discovery).
 * Pull: NAXRI can poll GET /api/integrations/naxri/feed with a Visentra JWT.
 */
import { encryptJson, decryptJson, maskSecret } from "../utils/crypto.js";
import { assertAllowedUrl, safeFetch } from "../utils/http.js";

const PROVIDER = "naxri";
const FEED_SPEC = "visentra.naxri.agent_feed/1.0";

function naxriPolicy(webhookUrl) {
  const host = new URL(webhookUrl).hostname.toLowerCase();
  const privateHost =
    /^(localhost|.*\.localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|::1)$/i.test(host);
  const extraHosts = String(process.env.NAXRI_ALLOW_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return {
    allowHosts: [host, ...extraHosts],
    allowPrivate: privateHost || process.env.NAXRI_ALLOW_PRIVATE === "true",
    allowHttp: privateHost || process.env.NAXRI_ALLOW_HTTP === "true",
    timeoutMs: Number(process.env.NAXRI_TIMEOUT_MS || 30_000)
  };
}

function mapAgent(row) {
  const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return {
    agent_id: row.id,
    fingerprint: row.fingerprint,
    name: row.name,
    category: row.category,
    framework: row.framework,
    model: row.model,
    provider: row.provider,
    cloud_provider: row.cloud_provider,
    owner: row.owner,
    hostname: row.hostname,
    confidence: row.confidence_score != null ? Number(row.confidence_score) : null,
    running_status: row.running_status || null,
    evidence_class: meta.evidenceClass || null,
    agent_plane: meta.agentPlane || null,
    environment_lane: meta.environmentLane || null,
    first_seen_at: row.first_discovered,
    last_seen_at: row.last_seen,
    source_collectors: row.source_collectors || [],
    tools: row.tools || [],
    mcp_connections: row.mcp_connections || [],
    risk_indicators: row.risk_indicators || [],
    metadata: meta
  };
}

export async function buildAgentFeed(pool, tenantId, { jobId = null, limit = 5000, since = null } = {}) {
  const params = [tenantId];
  let sinceClause = "";
  if (since) {
    params.push(since);
    sinceClause = ` AND last_seen >= $${params.length}`;
  }
  params.push(Math.min(Number(limit) || 5000, 10000));
  const result = await pool.query(
    `SELECT * FROM agents
     WHERE tenant_id=$1${sinceClause}
     ORDER BY last_seen DESC NULLS LAST
     LIMIT $${params.length}`,
    params
  );
  const agents = result.rows.map(mapAgent);
  return {
    spec_version: FEED_SPEC,
    source: "visentra",
    target: "naxri",
    event_type: since ? "inventory.delta" : "inventory.snapshot",
    tenant_id: tenantId,
    job_id: jobId,
    generated_at: new Date().toISOString(),
    agent_count: agents.length,
    agents
  };
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
    config: row.config || {},
    lastSyncAt: row.last_sync_at,
    lastSyncStatus: row.last_sync_status,
    lastSyncError: row.last_sync_error,
    lastSyncCount: row.last_sync_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function getNaxriIntegration(pool, tenantId) {
  const res = await pool.query(
    `SELECT * FROM outbound_integrations WHERE tenant_id=$1 AND provider=$2`,
    [tenantId, PROVIDER]
  );
  return publicRow(res.rows[0]);
}

export async function upsertNaxriIntegration(pool, tenantId, body = {}) {
  const existing = await pool.query(
    `SELECT * FROM outbound_integrations WHERE tenant_id=$1 AND provider=$2`,
    [tenantId, PROVIDER]
  );
  const prev = existing.rows[0];
  const name = String(body.name || prev?.name || "NAXRI ASPM").trim() || "NAXRI ASPM";
  const enabled = body.enabled != null ? Boolean(body.enabled) : prev ? prev.enabled : false;
  const autoPush = body.autoPush != null ? Boolean(body.autoPush) : prev ? prev.auto_push : true;
  const webhookUrl =
    body.webhookUrl != null ? String(body.webhookUrl || "").trim() : prev?.webhook_url || "";
  if (webhookUrl) {
    assertAllowedUrl(webhookUrl, naxriPolicy(webhookUrl));
  }

  let secretsEnc = prev?.secrets_enc || null;
  if (body.apiKey != null && String(body.apiKey).trim()) {
    secretsEnc = encryptJson({ apiKey: String(body.apiKey).trim() });
  } else if (body.clearApiKey) {
    secretsEnc = null;
  }

  const config = {
    ...(prev?.config || {}),
    ...(body.config && typeof body.config === "object" ? body.config : {})
  };

  if (prev) {
    const updated = await pool.query(
      `UPDATE outbound_integrations SET
         name=$3, enabled=$4, auto_push=$5, webhook_url=$6,
         config=$7::jsonb, secrets_enc=$8, updated_at=NOW()
       WHERE tenant_id=$1 AND provider=$2
       RETURNING *`,
      [tenantId, PROVIDER, name, enabled, autoPush, webhookUrl || null, JSON.stringify(config), secretsEnc]
    );
    return publicRow(updated.rows[0]);
  }

  const created = await pool.query(
    `INSERT INTO outbound_integrations (
       tenant_id, provider, name, enabled, auto_push, webhook_url, config, secrets_enc
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
     RETURNING *`,
    [tenantId, PROVIDER, name, enabled, autoPush, webhookUrl || null, JSON.stringify(config), secretsEnc]
  );
  return publicRow(created.rows[0]);
}

async function postFeed(webhookUrl, apiKey, feed) {
  const policy = naxriPolicy(webhookUrl);
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
    "user-agent": "Visentra-NAXRI-Feed/1.0",
    "x-visentra-feed-spec": FEED_SPEC
  };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  if (policy.allowHttp && String(webhookUrl).toLowerCase().startsWith("http://")) {
    assertAllowedUrl(webhookUrl, policy);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(feed),
        signal: controller.signal,
        redirect: "error"
      });
      const text = await res.text();
      return { status: res.status, ok: res.ok, body: text.slice(0, 2000) };
    } finally {
      clearTimeout(timer);
    }
  }

  const res = await safeFetch(
    webhookUrl,
    { method: "POST", headers, body: JSON.stringify(feed), timeoutMs: policy.timeoutMs },
    policy
  );
  const text = await res.text();
  return { status: res.status, ok: res.ok, body: text.slice(0, 2000) };
}

async function markSync(pool, tenantId, { status, error = null, count = null }) {
  await pool.query(
    `UPDATE outbound_integrations SET
       last_sync_at=NOW(),
       last_sync_status=$3,
       last_sync_error=$4,
       last_sync_count=$5,
       updated_at=NOW()
     WHERE tenant_id=$1 AND provider=$2`,
    [tenantId, PROVIDER, status, error, count]
  );
}

async function logDiscoveryEvent(pool, tenantId, eventType, severity, message, payload) {
  await pool.query(
    `INSERT INTO discovery_events (tenant_id, event_type, severity, message, payload)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [tenantId, eventType, severity, message, JSON.stringify(payload || {})]
  );
}

export async function pushAgentsToNaxri(pool, tenantId, { jobId = null, since = null } = {}) {
  const res = await pool.query(
    `SELECT * FROM outbound_integrations WHERE tenant_id=$1 AND provider=$2`,
    [tenantId, PROVIDER]
  );
  const row = res.rows[0];
  if (!row) {
    const err = new Error("NAXRI integration is not configured");
    err.status = 404;
    throw err;
  }
  if (!row.enabled) {
    const err = new Error("NAXRI integration is disabled");
    err.status = 400;
    throw err;
  }
  if (!row.webhook_url) {
    const err = new Error("NAXRI webhook URL is required");
    err.status = 400;
    throw err;
  }

  let apiKey = null;
  try {
    apiKey = row.secrets_enc ? decryptJson(row.secrets_enc)?.apiKey : null;
  } catch {
    apiKey = null;
  }

  const feed = await buildAgentFeed(pool, tenantId, { jobId, since });
  try {
    const result = await postFeed(row.webhook_url, apiKey, feed);
    if (!result.ok) {
      const message = `NAXRI returned HTTP ${result.status}: ${result.body || "no body"}`;
      await markSync(pool, tenantId, { status: "error", error: message, count: feed.agent_count });
      await logDiscoveryEvent(pool, tenantId, "integration.naxri.push.error", "error", message, {
        jobId,
        status: result.status,
        agentCount: feed.agent_count
      });
      const err = new Error(message);
      err.status = 502;
      throw err;
    }
    await markSync(pool, tenantId, { status: "ok", error: null, count: feed.agent_count });
    await logDiscoveryEvent(
      pool,
      tenantId,
      "integration.naxri.push.completed",
      "info",
      `Pushed ${feed.agent_count} agents to NAXRI`,
      {
        jobId,
        agentCount: feed.agent_count,
        webhookHost: new URL(row.webhook_url).host
      }
    );
    return { ok: true, agentCount: feed.agent_count, status: result.status, feed };
  } catch (err) {
    if (err.status === 502) throw err;
    const message = err.message || "NAXRI push failed";
    await markSync(pool, tenantId, { status: "error", error: message, count: null });
    await logDiscoveryEvent(pool, tenantId, "integration.naxri.push.error", "error", message, { jobId });
    throw err;
  }
}

export async function testNaxriConnection(pool, tenantId) {
  const res = await pool.query(
    `SELECT * FROM outbound_integrations WHERE tenant_id=$1 AND provider=$2`,
    [tenantId, PROVIDER]
  );
  const row = res.rows[0];
  if (!row?.webhook_url) {
    const err = new Error("Configure a NAXRI webhook URL first");
    err.status = 400;
    throw err;
  }
  let apiKey = null;
  try {
    apiKey = row.secrets_enc ? decryptJson(row.secrets_enc)?.apiKey : null;
  } catch {
    apiKey = null;
  }
  const probe = {
    spec_version: FEED_SPEC,
    source: "visentra",
    target: "naxri",
    event_type: "connection.test",
    tenant_id: tenantId,
    generated_at: new Date().toISOString(),
    agent_count: 0,
    agents: []
  };
  const result = await postFeed(row.webhook_url, apiKey, probe);
  return {
    ok: result.ok || result.status === 202 || result.status === 204,
    status: result.status,
    body: result.body
  };
}

/** Fire-and-forget after discovery; never fails the discovery job. */
export function scheduleNaxriAutoPush(pool, tenantId, { jobId = null } = {}) {
  setImmediate(() => {
    pool
      .query(
        `SELECT enabled, auto_push, webhook_url FROM outbound_integrations
         WHERE tenant_id=$1 AND provider=$2`,
        [tenantId, PROVIDER]
      )
      .then((res) => {
        const row = res.rows[0];
        if (!row?.enabled || !row.auto_push || !row.webhook_url) return null;
        return pushAgentsToNaxri(pool, tenantId, { jobId });
      })
      .catch((err) => {
        console.warn("NAXRI auto-push failed:", err.message);
      });
  });
}
