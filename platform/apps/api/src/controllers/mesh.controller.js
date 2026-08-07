import { pool } from "../db/postgres.js";
import { computeBlastRadius, computeAgentMesh } from "../services/agentDepth.js";
import { publicErrorMessage } from "../utils/http.js";

export async function riskPaths(req, res) {
  try {
    const payload = await computeBlastRadius(pool, req.tenantId, {
      agentId: req.query.agentId || null,
      limit: Number(req.query.limit) || 25
    });
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: { message: publicErrorMessage(err, "Risk path query failed") } });
  }
}

export async function mesh(req, res) {
  try {
    const shadowOnly = req.query.shadow === "true" || req.query.shadowOnly === "true";
    const payload = await computeAgentMesh(pool, req.tenantId, { shadowOnly });
    res.json({ mesh: payload, ...payload });
  } catch (err) {
    res.status(500).json({ error: { message: publicErrorMessage(err, "Agent mesh query failed") } });
  }
}
