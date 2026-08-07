import { pool } from "../db/postgres.js";
import { writeAudit } from "../services/audit.js";
import { publicErrorMessage } from "../utils/http.js";
import {
  buildAiBom,
  getEnrichment,
  upsertEnrichment,
  completeEnrichments,
  listAiBomSnapshots,
  createAiBomSnapshot,
  getAiBomSnapshot,
  aiBomToCycloneDx,
  AI_BOM_FIELD_CATALOG
} from "../services/aiBom.js";

export async function getBom(req, res) {
  try {
    const bom = await buildAiBom(pool, req.tenantId, {
      limit: req.query.limit,
      agentId: req.query.agentId || null
    });
    res.json(bom);
  } catch (err) {
    console.error("ai-bom failed:", err);
    res.status(500).json({ error: { message: publicErrorMessage(err, "AI BOM build failed") } });
  }
}

export function getCatalog(req, res) {
  res.json({ fields: AI_BOM_FIELD_CATALOG, spec: { bomFormat: "Visentra-AIBOM", specVersion: "1.0.0" } });
}

export async function getAgentBom(req, res) {
  try {
    const bom = await buildAiBom(pool, req.tenantId, { agentId: req.params.id });
    if (!bom.systems.length) {
      return res.status(404).json({ error: { message: "Agent not found in AI BOM" } });
    }
    res.json({ system: bom.systems[0], bom });
  } catch (err) {
    console.error("ai-bom agent failed:", err);
    res.status(500).json({ error: { message: publicErrorMessage(err, "AI BOM agent build failed") } });
  }
}

export async function getEnrichmentData(req, res) {
  try {
    const enrichment = await getEnrichment(pool, req.tenantId, req.params.agentId);
    res.json({ enrichment: enrichment || null });
  } catch (err) {
    res.status(500).json({ error: { message: publicErrorMessage(err, "Enrichment load failed") } });
  }
}

export async function upsertEnrichmentData(req, res) {
  try {
    const fields = req.body?.fields && typeof req.body.fields === "object" ? req.body.fields : req.body;
    const result = await upsertEnrichment(
      pool,
      req.tenantId,
      req.params.agentId,
      fields,
      req.user?.email || "api"
    );
    await writeAudit(pool, {
      tenantId: req.tenantId,
      actorId: req.user?.sub || req.user?.id || null,
      actorEmail: req.user?.email,
      action: "ai_bom.enrichment.upsert",
      resourceType: "agent",
      resourceId: req.params.agentId,
      details: { completeness: result.score.pct },
      ip: req.ip
    });
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    if (status === 404) return res.status(404).json({ error: { message: "Agent not found" } });
    console.error("ai-bom enrichment failed:", err);
    res.status(500).json({ error: { message: publicErrorMessage(err, "Enrichment save failed") } });
  }
}

export async function completeEnrichmentsBatch(req, res) {
  try {
    const agentId = req.body?.agentId || req.query.agentId || null;
    const result = await completeEnrichments(pool, req.tenantId, req.user?.email || "gap_fill", { agentId });
    await writeAudit(pool, {
      tenantId: req.tenantId,
      actorId: req.user?.sub || req.user?.id || null,
      actorEmail: req.user?.email,
      action: "ai_bom.enrichment.complete",
      resourceType: "ai_bom",
      resourceId: agentId || "estate",
      details: { updated: result.updated, completenessPct: result.completenessPct },
      ip: req.ip
    });
    res.json(result);
  } catch (err) {
    console.error("ai-bom complete enrichments failed:", err);
    res.status(500).json({ error: { message: publicErrorMessage(err, "Complete enrichments failed") } });
  }
}

export async function listSnapshots(req, res) {
  try {
    const snapshots = await listAiBomSnapshots(pool, req.tenantId, { limit: req.query.limit });
    res.json({ snapshots, items: snapshots });
  } catch (err) {
    res.status(500).json({ error: { message: publicErrorMessage(err, "Snapshot list failed") } });
  }
}

export async function createSnapshot(req, res) {
  try {
    const format = String(req.body?.format || "visentra").toLowerCase();
    const result = await createAiBomSnapshot(pool, req.tenantId, {
      format,
      label: req.body?.label || null,
      createdBy: req.user?.email || "api",
      limit: req.body?.limit
    });
    await writeAudit(pool, {
      tenantId: req.tenantId,
      actorId: req.user?.sub || req.user?.id || null,
      actorEmail: req.user?.email,
      action: "ai_bom.snapshot.create",
      resourceType: "ai_bom_snapshot",
      resourceId: result.snapshot.id,
      details: { format: result.snapshot.format, serialNumber: result.snapshot.serial_number },
      ip: req.ip
    });
    res.status(201).json(result);
  } catch (err) {
    console.error("ai-bom snapshot failed:", err);
    res.status(500).json({ error: { message: publicErrorMessage(err, "Snapshot create failed") } });
  }
}

export async function getSnapshot(req, res) {
  try {
    const snapshot = await getAiBomSnapshot(pool, req.tenantId, req.params.id);
    if (!snapshot) return res.status(404).json({ error: { message: "Snapshot not found" } });
    res.json({ snapshot });
  } catch (err) {
    res.status(500).json({ error: { message: publicErrorMessage(err, "Snapshot load failed") } });
  }
}

export async function exportBom(req, res) {
  try {
    const bom = await buildAiBom(pool, req.tenantId, {
      limit: req.query.limit,
      agentId: req.query.agentId || null
    });
    const format = String(req.query.format || "json").toLowerCase();
    if (format === "cyclonedx" || format === "cdx") {
      const doc = aiBomToCycloneDx(bom);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", "attachment; filename=visentra-ai-bom.cdx.json");
      return res.send(JSON.stringify(doc, null, 2));
    }
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", "attachment; filename=visentra-ai-bom.json");
    return res.send(JSON.stringify(bom, null, 2));
  } catch (err) {
    console.error("ai-bom export failed:", err);
    res.status(500).json({ error: { message: publicErrorMessage(err, "AI BOM export failed") } });
  }
}
