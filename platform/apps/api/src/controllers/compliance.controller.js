import { pool } from "../db/postgres.js";
import { publicErrorMessage } from "../utils/http.js";
import { writeAudit } from "../services/audit.js";
import {
  getControl,
  getTenantCatalog,
  createFramework,
  createControl,
  listFrameworksForTenant,
  listControlsForTenant
} from "../services/complianceCatalog.js";
import { buildComplianceReport, assessAgent, loadTenantAgents } from "../services/complianceAssess.js";

export async function getCatalog(req, res) {
  try {
    const framework = req.query.framework ? String(req.query.framework) : null;
    const catalog = await getTenantCatalog(pool, req.tenantId, framework);
    res.json({
      frameworks: catalog.frameworks,
      controls: catalog.controls,
      control: req.query.controlId ? getControl(String(req.query.controlId)) : undefined
    });
  } catch (err) {
    console.error("compliance catalog failed:", err);
    res.status(500).json({ error: { message: publicErrorMessage(err, "Unable to load control catalog") } });
  }
}

export async function createCatalogFramework(req, res) {
  try {
    const framework = await createFramework(pool, req.tenantId, req.body || {});
    await writeAudit(pool, {
      tenantId: req.tenantId,
      actorId: req.user?.sub || null,
      actorEmail: req.user?.email || null,
      action: "compliance.framework.create",
      resourceType: "compliance_framework",
      resourceId: framework.id,
      details: { name: framework.name },
      ip: req.ip
    });
    res.status(201).json({ framework });
  } catch (err) {
    console.error("compliance framework create failed:", err);
    res.status(err.status || 400).json({
      error: { message: publicErrorMessage(err, "Unable to create framework") }
    });
  }
}

export async function createCatalogControl(req, res) {
  try {
    const control = await createControl(pool, req.tenantId, req.body || {});
    await writeAudit(pool, {
      tenantId: req.tenantId,
      actorId: req.user?.sub || null,
      actorEmail: req.user?.email || null,
      action: "compliance.control.create",
      resourceType: "compliance_control",
      resourceId: control.id,
      details: { framework: control.framework, code: control.code },
      ip: req.ip
    });
    res.status(201).json({ control });
  } catch (err) {
    console.error("compliance control create failed:", err);
    res.status(err.status || 400).json({
      error: { message: publicErrorMessage(err, "Unable to create control") }
    });
  }
}

export async function listAssessments(req, res) {
  try {
    const report = await buildComplianceReport(pool, req.tenantId, {
      limit: req.query.limit,
      framework: req.query.framework || null
    });
    res.json(report);
  } catch (err) {
    console.error("compliance list failed:", err);
    res.status(500).json({ error: { message: publicErrorMessage(err, "Compliance assessment failed") } });
  }
}

export async function getAgentAssessment(req, res) {
  try {
    const agents = await loadTenantAgents(pool, req.tenantId, { agentId: req.params.id, limit: 1 });
    if (!agents.length) {
      return res.status(404).json({ error: { message: "Agent not found" } });
    }
    const framework = req.query.framework ? String(req.query.framework) : null;
    const [frameworkList, controls] = await Promise.all([
      listFrameworksForTenant(pool, req.tenantId),
      listControlsForTenant(pool, req.tenantId, framework)
    ]);
    const assessment = assessAgent(agents[0], {
      frameworks: framework ? [framework] : null,
      controls,
      frameworkList
    });
    res.json({
      assessment,
      frameworks: frameworkList,
      agent: {
        id: agents[0].id,
        name: agents[0].name,
        category: agents[0].category,
        cloud_provider: agents[0].cloud_provider,
        metadata: {
          evidenceClass: agents[0].metadata?.evidenceClass,
          agentStatus: agents[0].metadata?.agentStatus
        }
      }
    });
  } catch (err) {
    console.error("compliance agent failed:", err);
    res.status(500).json({ error: { message: publicErrorMessage(err, "Agent compliance assessment failed") } });
  }
}
