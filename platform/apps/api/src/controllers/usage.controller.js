import { pool } from "../db/postgres.js";
import { exportUsageCsv, fetchProviderUsage, evidenceMix, discoveryTrends } from "../services/usageAnalytics.js";
import { buildCoverageMap } from "../services/coverage.js";
import { publicErrorMessage } from "../utils/http.js";
import { ALL_COLLECTOR_IDS } from "../discovery/collectors.js";

export async function exportCsv(req, res) {
  try {
    const dimension = String(req.query.dimension || req.query.kind || "models").toLowerCase();
    const allowed = ["models", "frameworks", "cloud", "ide", "category"];
    if (!allowed.includes(dimension)) {
      return res.status(400).json({ error: { message: `dimension must be one of ${allowed.join(", ")}` } });
    }
    const csv = await exportUsageCsv(pool, req.tenantId, dimension, req.query);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=visentra-usage-${dimension}.csv`);
    return res.send(csv);
  } catch (err) {
    res.status(500).json({ error: { message: publicErrorMessage(err, "Usage export failed") } });
  }
}

export async function providers(req, res) {
  try {
    const payload = await fetchProviderUsage(pool, req.tenantId);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: { message: publicErrorMessage(err, "Provider usage failed") } });
  }
}

export async function evidence(req, res) {
  try {
    const payload = await evidenceMix(pool, req.tenantId, req.query);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: { message: publicErrorMessage(err, "Evidence mix failed") } });
  }
}

export async function trends(req, res) {
  try {
    const payload = await discoveryTrends(pool, req.tenantId, req.query);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: { message: publicErrorMessage(err, "Usage trends failed") } });
  }
}

export async function coverage(req, res) {
  try {
    const map = await buildCoverageMap(pool, req.tenantId, ALL_COLLECTOR_IDS);
    res.json(map);
  } catch (err) {
    res.status(500).json({ error: { message: publicErrorMessage(err, "Coverage map failed") } });
  }
}
