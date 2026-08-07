import { pool } from "../db/postgres.js";
import { summarizeShadowFindings } from "../services/shadowAi.js";
import { usageBreakdown as usageBreakdownService, buildUsageDashboard, buildExecutiveInsights } from "../services/usageAnalytics.js";
import { computeDiscoveryChanges, computeBlastRadius } from "../services/agentDepth.js";
import { DEFAULT_COLLECTORS, PRODUCTION_COLLECTORS } from "../discovery/collectors.js";
import { IS_PROD } from "../config.js";

const COLLECTOR_IDS = IS_PROD ? PRODUCTION_COLLECTORS : DEFAULT_COLLECTORS;

async function usageBreakdown(tenantId, column) {
  const dimension =
    column === "model"
      ? "models"
      : column === "framework"
        ? "frameworks"
        : column === "cloud_provider"
          ? "cloud"
          : column === "ide"
            ? "ide"
            : column === "category"
              ? "category"
              : "models";
  const result = await usageBreakdownService(pool, tenantId, dimension, {
    hideUnknown: false,
    confirmedOnly: false
  });
  return result.items.map((row) => ({ name: row.name, count: row.count }));
}

export async function getDashboard(req, res) {
  const name = req.params.name;
  const total = await pool.query(`SELECT COUNT(*)::int AS c FROM agents WHERE tenant_id=$1`, [req.tenantId]);
  const running = await pool.query(
    `SELECT COUNT(*)::int AS c FROM agents WHERE tenant_id=$1 AND running_status='running'`,
    [req.tenantId]
  );
  const owners = await pool.query(
    `SELECT COUNT(DISTINCT owner)::int AS c FROM agents WHERE tenant_id=$1 AND owner IS NOT NULL`,
    [req.tenantId]
  );
  const avgConf = await pool.query(
    `SELECT COALESCE(AVG(confidence_score),0)::float AS c FROM agents WHERE tenant_id=$1`,
    [req.tenantId]
  );
  const ownerless = await pool.query(
    `SELECT COUNT(*)::int AS c FROM agents
     WHERE tenant_id=$1 AND (owner IS NULL OR btrim(owner)='')`,
    [req.tenantId]
  );
  const lowConfidence = await pool.query(
    `SELECT COUNT(*)::int AS c FROM agents WHERE tenant_id=$1 AND confidence_score < 0.55`,
    [req.tenantId]
  );
  const shadowCandidates = await pool.query(
    `SELECT * FROM agents
     WHERE tenant_id=$1
       AND (
         category IN ('ide','local_llm','browser','saas','mcp','framework','autonomous')
         OR model IS NOT NULL OR framework IS NOT NULL OR ide IS NOT NULL
         OR risk_indicators::text ILIKE '%shadow%'
         OR metadata->>'shadowAi' = 'true'
         OR (category='cloud' AND metadata->>'aiRelevant'='true')
       )
     ORDER BY last_seen DESC LIMIT 300`,
    [req.tenantId]
  );
  const shadowSummary = summarizeShadowFindings(shadowCandidates.rows);

  const categories = await usageBreakdown(req.tenantId, "category");
  const models = await usageBreakdown(req.tenantId, "model");
  const frameworks = await usageBreakdown(req.tenantId, "framework");
  const cloud = await usageBreakdown(req.tenantId, "cloud_provider");
  const ide = await usageBreakdown(req.tenantId, "ide");
  const events = await pool.query(
    `SELECT * FROM discovery_events WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`,
    [req.tenantId]
  );
  const jobs = await pool.query(
    `SELECT * FROM discovery_jobs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10`,
    [req.tenantId]
  );

  const base = {
    totalAgents: total.rows[0].c,
    runningAgents: running.rows[0].c,
    uniqueOwners: owners.rows[0].c,
    ownerlessAgents: ownerless.rows[0].c,
    ownerless: ownerless.rows[0].c,
    lowConfidence: lowConfidence.rows[0].c,
    lowConfidenceAgents: lowConfidence.rows[0].c,
    shadowAiAgents: shadowSummary.total,
    shadowAi: shadowSummary.total,
    shadowAiByTag: shadowSummary.byTag,
    avgConfidence: Number(avgConf.rows[0].c.toFixed?.(3) ?? avgConf.rows[0].c),
    categories,
    agentsByCategory: categories,
    models,
    modelUsage: models,
    frameworks,
    cloud,
    ide,
    recentChanges: events.rows,
    events: events.rows,
    jobs: jobs.rows
  };

  if (name === "executive") {
    const insights = await buildExecutiveInsights(pool, req.tenantId);
    const dashboard = {
      ...base,
      ...insights,
      shadowAiAgents: base.shadowAiAgents,
      shadowAi: base.shadowAi,
      shadowAiByTag: base.shadowAiByTag,
      models: insights.models.length ? insights.models : models,
      modelUsage: insights.models.length ? insights.models : models,
      categories: insights.categories.length ? insights.categories : categories,
      agentsByCategory: insights.categories.length ? insights.categories : categories,
      frameworks: insights.frameworks.length ? insights.frameworks : frameworks,
      cloud: insights.cloud.length ? insights.cloud : cloud
    };
    return res.json({ dashboard, ...dashboard });
  }
  if (name === "operations") {
    const queue = shadowSummary.findings.slice(0, 50).map((f) => ({
      ...f,
      queue: "shadow_ai",
      type: "shadow_ai",
      title: f.name
    }));
    let changes = { summary: {}, newlyDiscovered: [], configDrift: [], changedRelationships: 0 };
    let blast = { items: [] };
    try {
      changes = await computeDiscoveryChanges(pool, req.tenantId, { sinceHours: 168, limit: 50 });
    } catch {}
    try {
      blast = await computeBlastRadius(pool, req.tenantId, { limit: 15 });
    } catch {}
    const driftQueue = (changes.configDrift || []).slice(0, 20).map((d) => ({
      id: d.agentId,
      name: d.name,
      owner: d.owner,
      category: d.category,
      queue: "config_drift",
      type: "config_drift",
      title: d.name,
      summary: (d.changes || []).map((c) => `${c.op} ${c.field}:${c.value}`).join(", "),
      confidence_score: 0.7,
      last_seen: d.changedAt
    }));
    const blastQueue = (blast.items || [])
      .filter((b) => b.score >= 45)
      .slice(0, 15)
      .map((b) => ({
        id: b.agentId,
        name: b.name,
        owner: b.owner,
        category: b.category,
        queue: "blast_radius",
        type: "blast_radius",
        title: b.name,
        summary: `${b.tier} · score ${b.score} · ${(b.reasons || []).join(", ")}`,
        confidence_score: Math.min(1, b.score / 100),
        last_seen: null
      }));
    const disappearedQueue = (changes.disappeared || []).slice(0, 15).map((d) => ({
      id: d.id || d.agentId,
      name: d.name,
      owner: d.owner,
      category: d.category,
      queue: "disappeared",
      type: "disappeared",
      title: d.name,
      summary: d.summary || "Not re-observed in window",
      confidence_score: 0.6,
      last_seen: d.lastSeen
    }));
    const ownerQueue = (changes.ownerChanges || []).slice(0, 15).map((d) => ({
      id: d.id || d.agentId,
      name: d.name,
      owner: d.owner,
      category: d.category,
      queue: "owner_changed",
      type: "owner_changed",
      title: d.name,
      summary: d.summary || "Owner changed",
      confidence_score: 0.75,
      last_seen: d.changedAt
    }));
    const dataClassQueue = (changes.dataClassEscalations || []).slice(0, 15).map((d) => ({
      id: d.id || d.agentId,
      name: d.name,
      owner: d.owner,
      category: d.category,
      queue: "data_class_escalated",
      type: "data_class_escalated",
      title: d.name,
      summary: d.summary || "Sensitive data class escalated",
      confidence_score: 0.8,
      last_seen: d.changedAt
    }));
    const mergedQueue = [
      ...driftQueue,
      ...blastQueue,
      ...disappearedQueue,
      ...ownerQueue,
      ...dataClassQueue,
      ...queue
    ].slice(0, 100);
    return res.json({
      dashboard: {
        ...base,
        queue: mergedQueue,
        items: mergedQueue,
        newDiscoveries: (changes.newlyDiscovered || []).length,
        changedRelationships: changes.changedRelationships || 0,
        configDrift: (changes.configDrift || []).length,
        highBlastRadius: blastQueue.length,
        disappearedAgents: (changes.disappeared || []).length,
        ownerChanges: (changes.ownerChanges || []).length,
        dataClassEscalations: (changes.dataClassEscalations || []).length,
        discoveryChanges: changes,
        blastRadius: blast,
        collectorHealth: COLLECTOR_IDS.map((id) => {
          const last = jobs.rows.find((j) => (j.collector_ids || []).includes(id));
          return {
            name: id,
            status: last?.status === "error" ? "error" : last ? "ready" : "idle",
            lastJobAt: last?.finished_at || last?.started_at || null,
            lastJobStatus: last?.status || null
          };
        }),
        openJobs: jobs.rows.filter((j) => j.status === "running").length
      }
    });
  }
  if (name === "discovery") {
    return res.json({ dashboard: { jobs: jobs.rows, events: events.rows, collectors: COLLECTOR_IDS } });
  }
  if (name === "models") {
    const dashboard = await buildUsageDashboard(pool, req.tenantId, "models", req.query);
    return res.json({ dashboard, ...dashboard });
  }
  if (name === "frameworks") {
    const dashboard = await buildUsageDashboard(pool, req.tenantId, "frameworks", req.query);
    return res.json({ dashboard, ...dashboard });
  }
  if (name === "cloud") {
    const dashboard = await buildUsageDashboard(pool, req.tenantId, "cloud", req.query);
    return res.json({ dashboard, ...dashboard });
  }
  if (name === "ide") {
    const dashboard = await buildUsageDashboard(pool, req.tenantId, "ide", req.query);
    return res.json({ dashboard, ...dashboard });
  }
  if (name === "timeline") {
    const timeline = await pool.query(
      `SELECT id, name, first_discovered, last_seen, category, owner, framework, model
       FROM agents WHERE tenant_id=$1 ORDER BY first_discovered DESC LIMIT 100`,
      [req.tenantId]
    );
    return res.json({
      dashboard: { items: timeline.rows, events: timeline.rows, timeline: timeline.rows }
    });
  }
  return res.status(404).json({ error: { message: `Unknown dashboard ${name}` } });
}
