import { pool } from "../db/postgres.js";
import { neo4jDriver } from "../db/neo4j.js";
import { agentFilters } from "../lib/agentFilters.js";
import { enrichAgentRow, summarizeAgentDepth, computeBlastRadius, computeAgentAnatomy } from "../services/agentDepth.js";
import { classifyShadowAi } from "../services/shadowAi.js";
import { publicErrorMessage } from "../utils/http.js";
import { purgeAllInventory } from "../lib/inventoryPurge.js";
import { writeAudit } from "../services/audit.js";

export async function list(req, res) {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Number(req.query.offset) || 0;
  const planeFilter = String(req.query.agentPlane || "").trim();
  const laneFilter = String(req.query.environmentLane || "").trim();
  const needsMeshFilter = Boolean(planeFilter || laneFilter);
  const { clauses, params } = agentFilters(req.query);

  if (needsMeshFilter) {
    const result = await pool.query(
      `SELECT * FROM agents WHERE tenant_id=$1 ${clauses} ORDER BY last_seen DESC`,
      [req.tenantId, ...params]
    );
    const filtered = result.rows.map(enrichAgentRow).filter((row) => {
      const meta = row.metadata || {};
      if (planeFilter && meta.agentPlane !== planeFilter) return false;
      if (laneFilter && meta.environmentLane !== laneFilter) return false;
      return true;
    });
    const agents = filtered.slice(offset, offset + limit);
    return res.json({ agents, items: agents, total: filtered.length, limit, offset });
  }

  const result = await pool.query(
    `SELECT * FROM agents WHERE tenant_id=$1 ${clauses}
     ORDER BY last_seen DESC LIMIT $${params.length + 2} OFFSET $${params.length + 3}`,
    [req.tenantId, ...params, limit, offset]
  );
  const count = await pool.query(
    `SELECT COUNT(*)::int AS total FROM agents WHERE tenant_id=$1 ${clauses}`,
    [req.tenantId, ...params]
  );
  const agents = result.rows.map(enrichAgentRow);
  res.json({ agents, items: agents, total: count.rows[0].total, limit, offset });
}

export async function getById(req, res) {
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
  const depth = summarizeAgentDepth(row);
  let blast = null;
  try {
    const radius = await computeBlastRadius(pool, req.tenantId, { agentId: row.id, limit: 1 });
    blast = radius.items[0] || null;
  } catch {
    blast = null;
  }
  res.json({
    agent: {
      ...row,
      shadowAi: shadow.isShadow,
      shadowAiScore: shadow.score,
      shadowAiReasons: shadow.reasons,
      shadowAiTags: shadow.tags,
      ...depth,
      blastRadius: blast
    },
    relationships: rels.rows,
    observations: observations.rows,
    agentConfig: depth.agentConfig,
    agentAccess: depth.agentAccess,
    ownership: depth.ownership,
    blastRadius: blast
  });
}

export async function anatomy(req, res) {
  try {
    const payload = await computeAgentAnatomy(pool, req.tenantId, req.params.id);
    if (!payload) return res.status(404).json({ error: { message: "Agent not found" } });
    res.json({ anatomy: payload, ...payload });
  } catch (err) {
    res.status(500).json({ error: { message: publicErrorMessage(err, "Agent anatomy query failed") } });
  }
}

/** Clear all discovered agents so inventory can be rebuilt from live connectors. */
export async function purgeInventory(req, res) {
  try {
    const result = await purgeAllInventory(pool, neo4jDriver, req.tenantId);
    await writeAudit(pool, {
      tenantId: req.tenantId,
      actorId: req.user?.sub || null,
      actorEmail: req.user?.email || null,
      action: "inventory.purge",
      resourceType: "agents",
      resourceId: null,
      details: { deleted: result.deleted },
      ip: req.ip
    }).catch(() => null);
    res.json({
      ok: true,
      deleted: result.deleted,
      message: `Removed ${result.deleted} agent(s). Add connectors, then run discovery for live inventory.`
    });
  } catch (err) {
    console.error("inventory purge failed:", err);
    res.status(500).json({ error: { message: publicErrorMessage(err, "Failed to purge inventory") } });
  }
}

export async function exportAgents(req, res) {
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
    res.setHeader("Content-Disposition", "attachment; filename=visentra-agents.csv");
    return res.send(lines.join("\n"));
  }
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", "attachment; filename=visentra-agents.json");
  res.send(JSON.stringify({ agents: result.rows }, null, 2));
}
