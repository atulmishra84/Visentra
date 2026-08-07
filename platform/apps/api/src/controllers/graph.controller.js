import { pool } from "../db/postgres.js";
import { graphFromSql } from "../lib/graphBuilder.js";
import { sseClients } from "../lib/sseManager.js";
import { publicErrorMessage } from "../utils/http.js";

export async function graph(req, res) {
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
}

export async function seeds(req, res) {
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
}

export function stream(req, res) {
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
}
