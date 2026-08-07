import { pool } from "../db/postgres.js";
import { listAuditEvents } from "../services/audit.js";
import { publicErrorMessage } from "../utils/http.js";

export async function getAuditEvents(req, res) {
  try {
    const events = await listAuditEvents(pool, req.tenantId, { limit: req.query.limit });
    res.json({ events, items: events });
  } catch (err) {
    res.status(500).json({ error: { message: publicErrorMessage(err, "Audit query failed") } });
  }
}
