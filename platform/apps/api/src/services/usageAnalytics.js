/**
 * Usage Analytics — inventory distribution, evidence mix, discovery trends,
 * and best-effort provider token/cost usage from connected SaaS/cloud keys.
 */

import { listActiveConnectorsByProviders, listActiveCloudConnectors } from "./connectors.js";

const DIMENSION_COLUMNS = {
  models: "model",
  frameworks: "framework",
  cloud: "cloud_provider",
  ide: "ide",
  category: "category"
};

const DIMENSION_LABELS = {
  models: "model",
  frameworks: "framework",
  cloud: "cloud provider",
  ide: "IDE",
  category: "category"
};

const INVENTORY_QUERY_KEY = {
  models: "model",
  frameworks: "framework",
  cloud: "cloud",
  ide: "ide",
  category: "category"
};

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const s = String(value).toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return fallback;
}

function isUnknownName(name) {
  const n = String(name || "")
    .trim()
    .toLowerCase();
  return !n || n === "unknown" || n === "n/a" || n === "none" || n === "-";
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} tenantId
 * @param {string} dimension - models|frameworks|cloud|ide|category
 * @param {{ hideUnknown?: boolean|string, confirmedOnly?: boolean|string, limit?: number }} [opts]
 */
export async function usageBreakdown(pool, tenantId, dimension, opts = {}) {
  const column = DIMENSION_COLUMNS[dimension] || DIMENSION_COLUMNS.models;
  const hideUnknown = parseBool(opts.hideUnknown, true);
  const confirmedOnly = parseBool(opts.confirmedOnly, false);
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || 50));

  const params = [tenantId];
  let where = "tenant_id=$1";
  if (confirmedOnly) {
    where += ` AND metadata->>'agentStatus' = 'confirmed'`;
  }

  const res = await pool.query(
    `SELECT COALESCE(NULLIF(btrim(${column}), ''), 'unknown') AS name, COUNT(*)::int AS count
     FROM agents
     WHERE ${where}
     GROUP BY 1
     ORDER BY count DESC
     LIMIT $${params.length + 1}`,
    [...params, limit]
  );

  let rows = res.rows.map((r) => ({
    name: r.name,
    count: r.count,
    inventoryQuery: { [INVENTORY_QUERY_KEY[dimension] || "q"]: r.name }
  }));

  const unknownRow = rows.find((r) => isUnknownName(r.name));
  const unknownCount = unknownRow?.count || 0;

  if (hideUnknown) {
    rows = rows.filter((r) => !isUnknownName(r.name));
  }

  const totalAgents = await pool.query(
    `SELECT COUNT(*)::int AS c FROM agents WHERE ${where}`,
    params
  );
  const labeled = rows.reduce((sum, r) => sum + r.count, 0);

  return {
    dimension,
    column,
    items: rows,
    totalAgents: totalAgents.rows[0].c,
    labeledAgents: labeled,
    unknownCount: hideUnknown ? unknownCount : unknownRow?.count || 0,
    hideUnknown,
    confirmedOnly
  };
}

/**
 * Evidence class + agent status mix for the tenant.
 */
export async function evidenceMix(pool, tenantId, opts = {}) {
  const confirmedOnly = parseBool(opts.confirmedOnly, false);
  const where = confirmedOnly
    ? `tenant_id=$1 AND metadata->>'agentStatus' = 'confirmed'`
    : `tenant_id=$1`;

  const byClass = await pool.query(
    `SELECT COALESCE(metadata->>'evidenceClass', 'unclassified') AS name, COUNT(*)::int AS count
     FROM agents WHERE ${where}
     GROUP BY 1 ORDER BY count DESC`,
    [tenantId]
  );
  const byStatus = await pool.query(
    `SELECT COALESCE(metadata->>'agentStatus', 'unclassified') AS name, COUNT(*)::int AS count
     FROM agents WHERE ${where}
     GROUP BY 1 ORDER BY count DESC`,
    [tenantId]
  );

  return {
    byEvidenceClass: byClass.rows.map((r) => ({
      name: r.name,
      count: r.count,
      inventoryQuery: { evidenceClass: r.name === "unclassified" ? undefined : r.name }
    })),
    byAgentStatus: byStatus.rows.map((r) => ({
      name: r.name,
      count: r.count,
      inventoryQuery: { agentStatus: r.name === "unclassified" ? undefined : r.name }
    }))
  };
}

/**
 * Weekly discovery trend (agents first_discovered buckets).
 */
export async function discoveryTrends(pool, tenantId, opts = {}) {
  const weeks = Math.min(52, Math.max(4, Number(opts.weeks) || 12));
  const confirmedOnly = parseBool(opts.confirmedOnly, false);
  const where = confirmedOnly
    ? `tenant_id=$1 AND metadata->>'agentStatus' = 'confirmed'`
    : `tenant_id=$1`;

  const res = await pool.query(
    `SELECT date_trunc('week', COALESCE(first_discovered, last_seen, NOW()))::date AS week,
            COUNT(*)::int AS count
     FROM agents
     WHERE ${where}
       AND COALESCE(first_discovered, last_seen) >= (NOW() - ($2::int * INTERVAL '1 week'))
     GROUP BY 1
     ORDER BY 1 ASC`,
    [tenantId, weeks]
  );

  return {
    weeks,
    series: res.rows.map((r) => ({
      week: r.week instanceof Date ? r.week.toISOString().slice(0, 10) : String(r.week).slice(0, 10),
      count: r.count
    }))
  };
}

function buildInsight(dimension, breakdown, evidence, trends) {
  const label = DIMENSION_LABELS[dimension] || dimension;
  const top = breakdown.items[0];
  const total = breakdown.totalAgents;
  const parts = [];

  if (!total) {
    return `No agents in inventory yet. Run discovery to populate ${label} usage.`;
  }

  if (top) {
    const pct = Math.round((top.count / Math.max(1, breakdown.labeledAgents || total)) * 100);
    parts.push(`Top ${label}: ${top.name} (${top.count}, ${pct}% of labeled).`);
  } else if (breakdown.unknownCount) {
    parts.push(
      `${breakdown.unknownCount} of ${total} agents lack a ${label} value — tighten discovery connectors to enrich inventory.`
    );
  }

  const confirmed = evidence.byAgentStatus.find((r) => r.name === "confirmed");
  const candidates = evidence.byAgentStatus.find((r) => r.name === "candidate");
  if (confirmed || candidates) {
    parts.push(
      `Evidence mix: ${confirmed?.count || 0} confirmed, ${candidates?.count || 0} candidates.`
    );
  }

  if (breakdown.unknownCount && breakdown.hideUnknown) {
    parts.push(`${breakdown.unknownCount} unlabeled (hidden).`);
  }

  const recent = (trends.series || []).slice(-4).reduce((s, p) => s + p.count, 0);
  if (recent > 0) {
    parts.push(`${recent} agents first seen in the last ~4 weeks.`);
  }

  return parts.join(" ") || `Showing ${label} distribution across ${total} agents.`;
}

/**
 * Full usage dashboard payload for a dimension.
 */
export async function buildUsageDashboard(pool, tenantId, dimension, query = {}) {
  const opts = {
    hideUnknown: query.hideUnknown,
    confirmedOnly: query.confirmedOnly,
    limit: query.limit,
    weeks: query.weeks
  };

  const [breakdown, evidence, trends, providerUsage] = await Promise.all([
    usageBreakdown(pool, tenantId, dimension, opts),
    evidenceMix(pool, tenantId, opts),
    discoveryTrends(pool, tenantId, opts),
    dimension === "models" || dimension === "cloud"
      ? fetchProviderUsage(pool, tenantId).catch((err) => ({
          providers: [],
          error: err.message || "Provider usage unavailable"
        }))
      : Promise.resolve({ providers: [], skipped: true })
  ]);

  const insight = buildInsight(dimension, breakdown, evidence, trends);

  return {
    dimension,
    insight,
    items: breakdown.items,
    [dimension]: breakdown.items,
    usage: breakdown.items,
    totalAgents: breakdown.totalAgents,
    labeledAgents: breakdown.labeledAgents,
    unknownCount: breakdown.unknownCount,
    hideUnknown: breakdown.hideUnknown,
    confirmedOnly: breakdown.confirmedOnly,
    evidence,
    trends,
    providerUsage,
    inventoryFacet: INVENTORY_QUERY_KEY[dimension] || dimension
  };
}

/**
 * CSV export for a usage dimension breakdown.
 */
export async function exportUsageCsv(pool, tenantId, dimension, query = {}) {
  const breakdown = await usageBreakdown(pool, tenantId, dimension, query);
  const evidence = await evidenceMix(pool, tenantId, query);
  const lines = ["section,name,count"];
  for (const row of breakdown.items) {
    lines.push(`distribution,${csvEscape(row.name)},${row.count}`);
  }
  lines.push(`meta,total_agents,${breakdown.totalAgents}`);
  lines.push(`meta,labeled_agents,${breakdown.labeledAgents}`);
  lines.push(`meta,unknown_count,${breakdown.unknownCount}`);
  for (const row of evidence.byEvidenceClass) {
    lines.push(`evidence_class,${csvEscape(row.name)},${row.count}`);
  }
  for (const row of evidence.byAgentStatus) {
    lines.push(`agent_status,${csvEscape(row.name)},${row.count}`);
  }
  return lines.join("\n");
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Best-effort provider token/cost usage from connectors + inventory proxies.
 */
export async function fetchProviderUsage(pool, tenantId) {
  const providers = [];

  // Inventory-derived proxies (always available)
  const modelByProvider = await pool.query(
    `SELECT
       CASE
         WHEN lower(COALESCE(cloud_provider, provider, '')) ~ 'azure' OR lower(COALESCE(model,'')) ~ 'azure|gpt-4o|gpt-35' THEN 'azure_openai'
         WHEN lower(COALESCE(cloud_provider, provider, '')) ~ 'aws|bedrock' OR lower(COALESCE(model,'')) ~ 'bedrock|anthropic\\.|amazon\\.' THEN 'bedrock'
         WHEN lower(COALESCE(cloud_provider, provider, model, '')) ~ 'openai|chatgpt|gpt-' THEN 'openai'
         WHEN lower(COALESCE(model,'')) ~ 'claude|anthropic' THEN 'anthropic'
         WHEN lower(COALESCE(model,'')) ~ 'gemini|vertex' THEN 'google'
         ELSE COALESCE(NULLIF(lower(cloud_provider), ''), NULLIF(lower(provider), ''), 'other')
       END AS provider_key,
       COUNT(*)::int AS agent_count,
       COUNT(DISTINCT model)::int AS distinct_models
     FROM agents
     WHERE tenant_id=$1
       AND (model IS NOT NULL OR cloud_provider IS NOT NULL OR provider IS NOT NULL)
     GROUP BY 1
     ORDER BY agent_count DESC
     LIMIT 20`,
    [tenantId]
  );

  for (const row of modelByProvider.rows) {
    providers.push({
      provider: row.provider_key,
      source: "inventory",
      agentCount: row.agent_count,
      distinctModels: row.distinct_models,
      tokens: null,
      costUsd: null,
      status: "inventory_proxy",
      message: "Derived from inventory model/cloud fields (not live token metering)."
    });
  }

  // Live OpenAI organization usage/costs when connector present
  try {
    const openaiConnectors = await listActiveConnectorsByProviders(pool, tenantId, ["openai"]);
    for (const conn of openaiConnectors.slice(0, 2)) {
      const live = await fetchOpenAiUsage(conn);
      providers.push({
        provider: "openai",
        connectorId: conn.id,
        connectorName: conn.name,
        source: "openai_api",
        ...live
      });
    }
  } catch (err) {
    providers.push({
      provider: "openai",
      source: "openai_api",
      status: "error",
      message: err.message || "OpenAI usage fetch failed"
    });
  }

  // Azure OpenAI — inventory + connector presence note
  try {
    const cloud = await listActiveCloudConnectors(pool, tenantId);
    const azure = cloud.filter((c) => c.provider === "azure");
    if (azure.length) {
      const aoai = await pool.query(
        `SELECT COUNT(*)::int AS c,
                COUNT(*) FILTER (WHERE model IS NOT NULL)::int AS with_model
         FROM agents
         WHERE tenant_id=$1
           AND (
             lower(COALESCE(cloud_provider,'')) LIKE '%azure%'
             OR lower(COALESCE(framework,'')) LIKE '%openai%'
             OR lower(COALESCE(model,'')) LIKE '%gpt%'
             OR metadata::text ILIKE '%openai%'
           )`,
        [tenantId]
      );
      providers.push({
        provider: "azure_openai",
        source: "azure_connector",
        connectorCount: azure.length,
        agentCount: aoai.rows[0].c,
        withModel: aoai.rows[0].with_model,
        tokens: null,
        costUsd: null,
        status: "connector_present",
        message:
          "Azure OpenAI token metrics require Azure Monitor Metrics Reader on the Cognitive Services account. Showing inventory-linked agents for now."
      });
    }
  } catch {
    /* ignore */
  }

  // Bedrock — inventory + AWS connector note
  try {
    const cloud = await listActiveCloudConnectors(pool, tenantId);
    const aws = cloud.filter((c) => c.provider === "aws");
    if (aws.length) {
      const bedrock = await pool.query(
        `SELECT COUNT(*)::int AS c
         FROM agents
         WHERE tenant_id=$1
           AND (
             lower(COALESCE(cloud_provider,'')) LIKE '%aws%'
             OR lower(COALESCE(framework,'')) LIKE '%bedrock%'
             OR lower(COALESCE(model,'')) LIKE '%bedrock%'
             OR metadata::text ILIKE '%bedrock%'
           )`,
        [tenantId]
      );
      providers.push({
        provider: "bedrock",
        source: "aws_connector",
        connectorCount: aws.length,
        agentCount: bedrock.rows[0].c,
        tokens: null,
        costUsd: null,
        status: "connector_present",
        message:
          "Bedrock token/cost metrics require CloudWatch GetMetricData (Invocations, InvocationModel). Showing inventory-linked agents for now."
      });
    }
  } catch {
    /* ignore */
  }

  return { providers, fetchedAt: new Date().toISOString() };
}

async function fetchOpenAiUsage(connector) {
  const apiKey = connector.secrets?.apiKey;
  if (!apiKey) {
    return { status: "missing_key", message: "OpenAI connector has no API key.", tokens: null, costUsd: null };
  }

  const end = Math.floor(Date.now() / 1000);
  const start = end - 7 * 24 * 3600;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };

  // Organization Completions Usage (admin keys). Falls back gracefully.
  const usageUrl = `https://api.openai.com/v1/organization/usage/completions?start_time=${start}&end_time=${end}&bucket_width=1d`;
  const costsUrl = `https://api.openai.com/v1/organization/costs?start_time=${start}&end_time=${end}&bucket_width=1d`;

  let tokens = null;
  let costUsd = null;
  let daily = [];
  let status = "ok";
  let message = "OpenAI organization usage for the last 7 days.";

  try {
    const usageRes = await fetch(usageUrl, { headers });
    if (usageRes.ok) {
      const body = await usageRes.json();
      daily = (body.data || []).map((b) => ({
        start: b.start_time,
        end: b.end_time,
        inputTokens: sumResultField(b, "input_tokens"),
        outputTokens: sumResultField(b, "output_tokens"),
        requests: sumResultField(b, "num_model_requests")
      }));
      tokens = daily.reduce((s, d) => s + (d.inputTokens || 0) + (d.outputTokens || 0), 0);
    } else {
      const errText = await usageRes.text().catch(() => "");
      status = "unavailable";
      message = `OpenAI usage API returned ${usageRes.status}. Org admin key with api.usage.read may be required. ${errText.slice(0, 180)}`;
    }
  } catch (err) {
    status = "error";
    message = err.message || "OpenAI usage request failed";
  }

  try {
    const costsRes = await fetch(costsUrl, { headers });
    if (costsRes.ok) {
      const body = await costsRes.json();
      costUsd = (body.data || []).reduce((sum, b) => {
        const results = b.results || [];
        return (
          sum +
          results.reduce((s, r) => s + Number(r.amount?.value || r.value || 0), 0)
        );
      }, 0);
      if (status === "unavailable") {
        status = "partial";
        message = "Costs available; completions usage requires api.usage.read.";
      }
    }
  } catch {
    /* costs optional */
  }

  // Legacy per-day usage as last resort
  if (tokens == null && status !== "ok") {
    try {
      const day = new Date().toISOString().slice(0, 10);
      const legacy = await fetch(`https://api.openai.com/v1/usage?date=${day}`, { headers });
      if (legacy.ok) {
        const body = await legacy.json();
        const data = body.data || [];
        tokens = data.reduce(
          (s, row) => s + Number(row.n_context_tokens_total || 0) + Number(row.n_generated_tokens_total || 0),
          0
        );
        status = "legacy";
        message = `Legacy /v1/usage for ${day} (organization endpoints unavailable).`;
      }
    } catch {
      /* ignore */
    }
  }

  return {
    status,
    message,
    tokens,
    costUsd,
    windowDays: 7,
    daily
  };
}

function sumResultField(bucket, field) {
  const results = bucket.results || [];
  return results.reduce((s, r) => s + Number(r[field] || 0), 0);
}

/**
 * Executive visibility funnel + supporting mixes for leadership dashboards.
 * Funnel stages narrow from discovered inventory toward owned, managed posture.
 */
export async function buildExecutiveInsights(pool, tenantId) {
  const [counts, evidence, trends, categories, models, frameworks, cloud] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*)::int AS discovered,
         COUNT(*) FILTER (WHERE metadata->>'evidenceClass' IS NOT NULL AND metadata->>'evidenceClass' <> '')::int AS classified,
         COUNT(*) FILTER (WHERE metadata->>'agentStatus' = 'confirmed')::int AS confirmed,
         COUNT(*) FILTER (WHERE owner IS NOT NULL AND btrim(owner) <> '')::int AS owned,
         COUNT(*) FILTER (
           WHERE owner IS NOT NULL AND btrim(owner) <> ''
             AND COALESCE(metadata->>'shadowAi', 'false') <> 'true'
             AND risk_indicators::text NOT ILIKE '%shadow%'
             AND risk_indicators::text NOT ILIKE '%unmanaged%'
         )::int AS managed,
         COUNT(*) FILTER (WHERE owner IS NULL OR btrim(owner)='')::int AS ownerless,
         COUNT(*) FILTER (WHERE confidence_score < 0.55)::int AS low_confidence,
         COUNT(*) FILTER (WHERE running_status='running')::int AS running,
         COUNT(DISTINCT owner) FILTER (WHERE owner IS NOT NULL AND btrim(owner) <> '')::int AS unique_owners,
         COALESCE(AVG(confidence_score),0)::float AS avg_confidence
       FROM agents WHERE tenant_id=$1`,
      [tenantId]
    ),
    evidenceMix(pool, tenantId),
    discoveryTrends(pool, tenantId, { weeks: 12 }),
    usageBreakdown(pool, tenantId, "category", { hideUnknown: true, limit: 12 }),
    usageBreakdown(pool, tenantId, "models", { hideUnknown: true, limit: 12 }),
    usageBreakdown(pool, tenantId, "frameworks", { hideUnknown: true, limit: 8 }),
    usageBreakdown(pool, tenantId, "cloud", { hideUnknown: true, limit: 8 })
  ]);

  const c = counts.rows[0];
  const discovered = c.discovered;
  const classified = c.classified;
  const confirmed = c.confirmed;
  const owned = c.owned;
  const managed = c.managed;

  const funnel = [
    {
      id: "discovered",
      label: "Discovered",
      description: "All AI agents in inventory",
      count: discovered,
      href: "/inventory"
    },
    {
      id: "classified",
      label: "Classified",
      description: "Evidence class assigned",
      count: classified,
      href: "/inventory"
    },
    {
      id: "confirmed",
      label: "Confirmed",
      description: "Strong agent evidence",
      count: confirmed,
      href: "/inventory?agentStatus=confirmed"
    },
    {
      id: "owned",
      label: "Owned",
      description: "Has an attributed owner",
      count: owned,
      href: "/inventory"
    },
    {
      id: "managed",
      label: "Managed",
      description: "Owned and not Shadow AI",
      count: managed,
      href: "/inventory"
    }
  ].map((stage, index, arr) => {
    const prev = index === 0 ? discovered : arr[index - 1].count;
    const conversion = prev > 0 ? Number(((stage.count / prev) * 100).toFixed(1)) : 0;
    const ofTotal = discovered > 0 ? Number(((stage.count / discovered) * 100).toFixed(1)) : 0;
    return { ...stage, conversionFromPrev: conversion, pctOfTotal: ofTotal };
  });

  const dropOffs = funnel.slice(1).map((stage, i) => ({
    from: funnel[i].id,
    to: stage.id,
    lost: Math.max(0, funnel[i].count - stage.count),
    label: `${funnel[i].label} → ${stage.label}`
  }));

  const insightParts = [];
  if (!discovered) {
    insightParts.push("No agents discovered yet. Run discovery to populate executive visibility.");
  } else {
    insightParts.push(
      `${discovered} agents discovered; ${confirmed} confirmed (${funnel[2].pctOfTotal}%); ${managed} managed (${funnel[4].pctOfTotal}%).`
    );
    if (c.ownerless > 0) {
      insightParts.push(`${c.ownerless} still ownerless.`);
    }
  }

  return {
    funnel,
    dropOffs,
    evidence,
    trends,
    categories: categories.items,
    models: models.items,
    frameworks: frameworks.items,
    cloud: cloud.items,
    insight: insightParts.join(" "),
    totalAgents: discovered,
    classifiedAgents: classified,
    confirmedAgents: confirmed,
    ownedAgents: owned,
    managedAgents: managed,
    ownerlessAgents: c.ownerless,
    ownerless: c.ownerless,
    lowConfidence: c.low_confidence,
    lowConfidenceAgents: c.low_confidence,
    runningAgents: c.running,
    uniqueOwners: c.unique_owners,
    avgConfidence: Number(Number(c.avg_confidence).toFixed(3))
  };
}

export { DIMENSION_COLUMNS, INVENTORY_QUERY_KEY, parseBool };
