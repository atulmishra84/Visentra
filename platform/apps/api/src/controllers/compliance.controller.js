import { pool } from "../db/postgres.js";
import { publicErrorMessage } from "../utils/http.js";
import { listFrameworks, listControls, getControl } from "../services/complianceCatalog.js";
import { buildComplianceReport, assessAgent, loadTenantAgents } from "../services/complianceAssess.js";

export function getCatalog(req, res) {
  const framework = req.query.framework ? String(req.query.framework) : null;
  res.json({
    frameworks: listFrameworks(),
    controls: listControls(framework),
    control: req.query.controlId ? getControl(String(req.query.controlId)) : undefined
  });
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
    const assessment = assessAgent(agents[0], {
      frameworks: framework ? [framework] : null
    });
    res.json({
      assessment,
      frameworks: listFrameworks(),
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
