/**
 * Core discovery depth — configuration, access/permissions, blast-radius,
 * and drift/change intelligence (visibility only; no runtime activity V2).
 */

import crypto from "crypto";

const ACCESS_KEYS = [
  "internet",
  "filesystem",
  "database",
  "github",
  "slack",
  "email",
  "calendar",
  "browser",
  "secrets",
  "identity",
  "sharepoint",
  "crm",
  "vectorStore",
  "mcp",
  "cloudAdmin"
];

function asList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [String(value)];
}

function uniq(list) {
  return [...new Set(list.filter(Boolean))];
}

/**
 * Normalize agentConfig from observation fields + metadata.
 */
export function buildAgentConfig(obs = {}) {
  const meta = obs.metadata && typeof obs.metadata === "object" ? obs.metadata : {};
  const existing = meta.agentConfig && typeof meta.agentConfig === "object" ? meta.agentConfig : {};

  const tools = uniq([...asList(obs.tools), ...asList(existing.tools), ...asList(meta.tools)]);
  const mcpServers = uniq([
    ...asList(obs.mcp_connections),
    ...asList(existing.mcpServers),
    ...asList(meta.mcpConnections),
    ...asList(meta.mcpNames)
  ]);
  const knowledgeSources = uniq([
    ...asList(existing.knowledgeSources),
    ...asList(meta.knowledgeSources),
    ...asList(meta.knowledge),
    ...asList(meta.dataSources)
  ]);
  const triggers = uniq([...asList(existing.triggers), ...asList(meta.triggers), ...asList(meta.automations)]);
  const memoryStores = uniq(
    [obs.memory_store, meta.memoryStore, existing.memoryStore, ...(asList(existing.memoryStores) || [])].filter(Boolean)
  );
  const vectorStores = uniq(
    [obs.vector_database, meta.vectorDatabase, existing.vectorStore, ...(asList(existing.vectorStores) || [])].filter(
      Boolean
    )
  );
  const models = uniq([obs.model, meta.model, ...(asList(existing.models) || [])].filter(Boolean));
  const instructionsPresent =
    existing.instructionsPresent === true ||
    Boolean(meta.hasInstructions) ||
    Boolean(meta.instructions) ||
    asList(obs.prompt_templates).length > 0 ||
    asList(existing.promptTemplates).length > 0;

  const instructionSource =
    existing.instructionSource ||
    meta.instructionSource ||
    (asList(obs.prompt_templates).length ? "prompt_templates" : instructionsPresent ? "platform_config" : null);

  let instructionsHash = existing.instructionsHash || meta.instructionsHash || null;
  if (!instructionsHash && (meta.instructions || asList(obs.prompt_templates).length)) {
    const raw = String(meta.instructions || JSON.stringify(obs.prompt_templates));
    instructionsHash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
  }

  const howConfigured =
    existing.howConfigured ||
    meta.howConfigured ||
    meta.howIdentified ||
    meta.discoveryMode ||
    null;

  return {
    tools,
    mcpServers,
    knowledgeSources,
    triggers,
    memoryStores,
    vectorStores,
    models,
    instructionsPresent,
    instructionsHash,
    instructionSource,
    howConfigured,
    framework: obs.framework || existing.framework || null,
    version: obs.version || existing.version || meta.version || null
  };
}

/**
 * Normalize agentAccess / permissions map from observation booleans + metadata.
 */
export function buildAgentAccess(obs = {}) {
  const meta = obs.metadata && typeof obs.metadata === "object" ? obs.metadata : {};
  const existing = meta.agentAccess && typeof meta.agentAccess === "object" ? meta.agentAccess : {};
  const scopes = {};

  const set = (key, value) => {
    if (value === true || value === "true") scopes[key] = true;
    else if (value === false || value === "false") scopes[key] = false;
  };

  set("internet", obs.internet_access ?? existing.scopes?.internet ?? meta.internetAccess);
  set("filesystem", obs.filesystem_access ?? existing.scopes?.filesystem ?? meta.filesystemAccess);
  set("database", obs.database_access ?? existing.scopes?.database ?? meta.databaseAccess);
  set("github", obs.github_access ?? existing.scopes?.github ?? meta.githubAccess);
  set("slack", obs.slack_access ?? existing.scopes?.slack ?? meta.slackAccess);
  set("email", obs.email_access ?? existing.scopes?.email ?? meta.emailAccess);
  set("calendar", obs.calendar_access ?? existing.scopes?.calendar ?? meta.calendarAccess);
  set("browser", obs.browser_access ?? existing.scopes?.browser ?? meta.browserAccess);
  set("secrets", obs.secrets_detected || obs.api_keys_detected || existing.scopes?.secrets);
  set("identity", Boolean(obs.identity_used || meta.identityUsed || existing.scopes?.identity));
  set("mcp", asList(obs.mcp_connections).length > 0 || existing.scopes?.mcp);
  set("vectorStore", Boolean(obs.vector_database || existing.scopes?.vectorStore));
  set("sharepoint", existing.scopes?.sharepoint ?? meta.sharepointAccess);
  set("crm", existing.scopes?.crm ?? meta.crmAccess);
  set("cloudAdmin", existing.scopes?.cloudAdmin ?? meta.cloudAdmin);

  // Merge any explicit scopes from collectors
  const explicitScopes = {
    ...(meta.scopes && typeof meta.scopes === "object" ? meta.scopes : {}),
    ...(existing.scopes && typeof existing.scopes === "object" ? existing.scopes : {})
  };
  for (const [k, v] of Object.entries(explicitScopes)) {
    if (ACCESS_KEYS.includes(k) || typeof v === "boolean") set(k, v);
  }

  const granted = Object.entries(scopes)
    .filter(([, v]) => v === true)
    .map(([k]) => k);

  const identities = uniq([
    obs.identity_used,
    meta.identityUsed,
    ...(asList(existing.identities) || []),
    ...(asList(meta.identities) || [])
  ]);

  const dataStores = uniq([
    obs.vector_database,
    obs.memory_store,
    ...(asList(existing.dataStores) || []),
    ...(asList(meta.dataStores) || [])
  ]);

  const connectedApps = uniq([
    ...asList(obs.connected_applications),
    ...asList(existing.connectedApps),
    ...asList(meta.connectedApps)
  ]);

  const permissions = uniq([...asList(obs.permissions), ...asList(existing.permissions), ...asList(meta.permissions)]);

  const sensitivity =
    existing.sensitivity ||
    (granted.includes("secrets") || granted.includes("cloudAdmin")
      ? "high"
      : granted.includes("database") || granted.includes("crm") || granted.includes("sharepoint")
        ? "medium"
        : granted.length
          ? "low"
          : "unknown");

  return {
    scopes,
    granted,
    grantCount: granted.length,
    identities,
    dataStores,
    connectedApps,
    permissions,
    sensitivity,
    overPermissioned:
      existing.overPermissioned === true ||
      (granted.length >= 5 && (!obs.owner || String(obs.owner).trim() === "")) ||
      (granted.includes("secrets") && granted.includes("internet"))
  };
}

/**
 * Enrich observation with normalized agentConfig + agentAccess before ingest.
 */
export function enrichObservationWithDepth(obs) {
  const agentConfig = buildAgentConfig(obs);
  const agentAccess = buildAgentAccess(obs);
  const howIdentified =
    (obs.metadata && obs.metadata.howIdentified) ||
    agentConfig.howConfigured ||
    `${obs.collector_id || "collector"}:${(obs.metadata && obs.metadata.evidenceClass) || "unknown"}`;

  return {
    ...obs,
    metadata: {
      ...(obs.metadata || {}),
      agentConfig,
      agentAccess,
      howIdentified,
      accessGrantCount: agentAccess.grantCount,
      accessSensitivity: agentAccess.sensitivity,
      configToolCount: agentConfig.tools.length,
      configMcpCount: agentConfig.mcpServers.length,
      hasInstructions: agentConfig.instructionsPresent,
      overPermissioned: agentAccess.overPermissioned
    }
  };
}

/**
 * Summaries for API detail responses.
 */
export function summarizeAgentDepth(agent) {
  const meta = agent.metadata && typeof agent.metadata === "object" ? agent.metadata : {};
  const agentConfig = meta.agentConfig || buildAgentConfig({ ...agent, metadata: meta });
  const agentAccess = meta.agentAccess || buildAgentAccess({ ...agent, metadata: meta });
  return {
    agentConfig,
    agentAccess,
    howIdentified: meta.howIdentified || null,
    evidenceClass: meta.evidenceClass || null,
    agentStatus: meta.agentStatus || null,
    evidenceReason: meta.evidenceReason || null
  };
}

/**
 * Blast-radius / attack-path scoring from SQL relationships + access metadata.
 */
export async function computeBlastRadius(pool, tenantId, { agentId = null, limit = 25 } = {}) {
  const params = [tenantId];
  let agentClause = "";
  if (agentId) {
    params.push(agentId);
    agentClause = ` AND a.id = $${params.length}`;
  }

  const agents = await pool.query(
    `SELECT a.*,
            (SELECT COUNT(*)::int FROM relationships r WHERE r.tenant_id=a.tenant_id AND r.from_id=a.id) AS edge_count
     FROM agents a
     WHERE a.tenant_id=$1 ${agentClause}
     ORDER BY a.last_seen DESC
     LIMIT ${agentId ? 1 : 500}`,
    params
  );

  const scored = [];
  for (const agent of agents.rows) {
    const depth = summarizeAgentDepth(agent);
    const rels = await pool.query(
      `SELECT r.rel_type, s.asset_type, s.name, s.external_key, s.attributes
       FROM relationships r
       JOIN assets s ON s.id = r.to_id
       WHERE r.tenant_id=$1 AND r.from_id=$2
       LIMIT 100`,
      [tenantId, agent.id]
    );

    const paths = rels.rows.map((r) => ({
      relType: r.rel_type,
      toType: r.asset_type,
      toName: r.name,
      toKey: r.external_key,
      riskHint: riskHintForTarget(r.asset_type, r.rel_type, depth.agentAccess)
    }));

    const accessScore = Math.min(40, (depth.agentAccess.grantCount || 0) * 6);
    const edgeScore = Math.min(25, (agent.edge_count || 0) * 3);
    const sensitivityScore =
      depth.agentAccess.sensitivity === "high" ? 20 : depth.agentAccess.sensitivity === "medium" ? 12 : 4;
    const shadowScore =
      (agent.metadata && agent.metadata.shadowAi === true) ||
      (Array.isArray(agent.risk_indicators) && agent.risk_indicators.some((x) => /shadow|unmanaged/i.test(String(x))))
        ? 15
        : 0;
    const ownerlessScore = !agent.owner || !String(agent.owner).trim() ? 10 : 0;
    const internetExternal =
      depth.agentAccess.scopes?.internet && paths.some((p) => /ExternalService|API|SaaS/i.test(p.toType)) ? 10 : 0;

    const score = Math.min(
      100,
      accessScore + edgeScore + sensitivityScore + shadowScore + ownerlessScore + internetExternal
    );

    const reasons = [];
    if (depth.agentAccess.grantCount) reasons.push(`${depth.agentAccess.grantCount} access scopes`);
    if (depth.agentAccess.sensitivity === "high") reasons.push("high-sensitivity access");
    if (ownerlessScore) reasons.push("ownerless");
    if (shadowScore) reasons.push("shadow/unmanaged");
    if (agent.edge_count) reasons.push(`${agent.edge_count} graph edges`);
    if (internetExternal) reasons.push("internet + external service path");

    scored.push({
      agentId: agent.id,
      name: agent.name,
      category: agent.category,
      owner: agent.owner,
      score,
      tier: score >= 70 ? "critical" : score >= 45 ? "elevated" : score >= 25 ? "moderate" : "low",
      reasons,
      paths,
      pathCount: paths.length,
      access: depth.agentAccess,
      config: {
        toolCount: depth.agentConfig.tools.length,
        mcpCount: depth.agentConfig.mcpServers.length,
        instructionsPresent: depth.agentConfig.instructionsPresent
      },
      href: `/agents/${agent.id}`
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return {
    items: scored.slice(0, limit),
    total: scored.length,
    generatedAt: new Date().toISOString()
  };
}

function riskHintForTarget(assetType, relType, access) {
  const t = String(assetType || "");
  if (/Database|Vector/i.test(t)) return "data_store";
  if (/ExternalService|API|SaaS/i.test(t)) return "external";
  if (/MCPServer|Tool/i.test(t)) return "tooling";
  if (/CloudResource|Container|Cluster/i.test(t)) return "infrastructure";
  if (/Repository/i.test(t)) return "source";
  if (/Identity|Developer/i.test(t)) return "identity";
  if (access?.scopes?.secrets) return "secrets_adjacent";
  return relType ? String(relType).toLowerCase() : "related";
}

/**
 * Drift / change intelligence from agent_observations + first_discovered window.
 */
export async function computeDiscoveryChanges(pool, tenantId, { sinceHours = 168, agentId = null, limit = 100 } = {}) {
  const hours = Math.min(720, Math.max(1, Number(sinceHours) || 168));
  const params = [tenantId, hours];
  let agentClause = "";
  if (agentId) {
    params.push(agentId);
    agentClause = ` AND a.id = $${params.length}`;
  }

  const newlyDiscovered = await pool.query(
    `SELECT a.id, a.name, a.category, a.owner, a.framework, a.model, a.first_discovered, a.confidence_score,
            a.metadata->>'evidenceClass' AS evidence_class,
            a.metadata->>'agentStatus' AS agent_status,
            a.metadata->>'howIdentified' AS how_identified
     FROM agents a
     WHERE a.tenant_id=$1
       AND a.first_discovered >= NOW() - ($2::int * INTERVAL '1 hour')
       ${agentClause}
     ORDER BY a.first_discovered DESC
     LIMIT ${Math.min(limit, 200)}`,
    params
  );

  const recentlyUpdated = await pool.query(
    `SELECT a.id, a.name, a.category, a.owner, a.updated_at, a.last_seen, a.first_discovered,
            a.metadata->>'evidenceClass' AS evidence_class,
            a.metadata->>'accessGrantCount' AS access_grant_count,
            a.metadata->>'configToolCount' AS config_tool_count
     FROM agents a
     WHERE a.tenant_id=$1
       AND a.updated_at >= NOW() - ($2::int * INTERVAL '1 hour')
       AND a.first_discovered < NOW() - ($2::int * INTERVAL '1 hour')
       ${agentClause}
     ORDER BY a.updated_at DESC
     LIMIT ${Math.min(limit, 200)}`,
    params
  );

  // Config/access drift: compare last two observation payloads when available
  const driftParams = [tenantId, hours];
  let driftAgent = "";
  if (agentId) {
    driftParams.push(agentId);
    driftAgent = ` AND o.agent_id = $${driftParams.length}`;
  }
  const observationPairs = await pool.query(
    `WITH ranked AS (
       SELECT o.agent_id, o.payload, o.observed_at, o.collector_id,
              ROW_NUMBER() OVER (PARTITION BY o.agent_id ORDER BY o.observed_at DESC) AS rn
       FROM agent_observations o
       WHERE o.tenant_id=$1
         AND o.observed_at >= NOW() - ($2::int * INTERVAL '1 hour')
         ${driftAgent}
     )
     SELECT a.id, a.name, a.category, a.owner,
            cur.payload AS current_payload,
            prev.payload AS previous_payload,
            cur.observed_at AS current_at,
            prev.observed_at AS previous_at
     FROM ranked cur
     JOIN ranked prev ON prev.agent_id = cur.agent_id AND prev.rn = 2
     JOIN agents a ON a.id = cur.agent_id
     WHERE cur.rn = 1
     LIMIT ${Math.min(limit, 100)}`,
    driftParams
  );

  const configDrift = [];
  for (const row of observationPairs.rows) {
    const cur = summarizeFromPayload(row.current_payload);
    const prev = summarizeFromPayload(row.previous_payload);
    const changes = diffDepth(prev, cur);
    if (!changes.length) continue;
    configDrift.push({
      agentId: row.id,
      name: row.name,
      category: row.category,
      owner: row.owner,
      changedAt: row.current_at,
      previousAt: row.previous_at,
      changes,
      href: `/agents/${row.id}`
    });
  }

  // Relationship edge churn in window
  const edgeChanges = await pool.query(
    `SELECT COUNT(*)::int AS c
     FROM relationships
     WHERE tenant_id=$1 AND last_seen >= NOW() - ($2::int * INTERVAL '1 hour')`,
    [tenantId, hours]
  );

  return {
    sinceHours: hours,
    newlyDiscovered: newlyDiscovered.rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      owner: r.owner,
      framework: r.framework,
      model: r.model,
      firstDiscovered: r.first_discovered,
      confidence: r.confidence_score,
      evidenceClass: r.evidence_class,
      agentStatus: r.agent_status,
      howIdentified: r.how_identified,
      changeType: "new",
      href: `/agents/${r.id}`
    })),
    recentlyUpdated: recentlyUpdated.rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      owner: r.owner,
      updatedAt: r.updated_at,
      lastSeen: r.last_seen,
      evidenceClass: r.evidence_class,
      accessGrantCount: Number(r.access_grant_count || 0),
      configToolCount: Number(r.config_tool_count || 0),
      changeType: "updated",
      href: `/agents/${r.id}`
    })),
    configDrift,
    changedRelationships: edgeChanges.rows[0]?.c || 0,
    summary: {
      newAgents: newlyDiscovered.rows.length,
      updatedAgents: recentlyUpdated.rows.length,
      configDrift: configDrift.length,
      changedRelationships: edgeChanges.rows[0]?.c || 0
    },
    generatedAt: new Date().toISOString()
  };
}

function summarizeFromPayload(payload) {
  const obs = payload && typeof payload === "object" ? payload : {};
  return {
    config: buildAgentConfig(obs),
    access: buildAgentAccess(obs)
  };
}

function diffDepth(prev, cur) {
  const changes = [];
  const prevTools = new Set(prev.config.tools || []);
  const curTools = new Set(cur.config.tools || []);
  for (const t of curTools) if (!prevTools.has(t)) changes.push({ field: "tools", op: "added", value: t });
  for (const t of prevTools) if (!curTools.has(t)) changes.push({ field: "tools", op: "removed", value: t });

  const prevMcp = new Set(prev.config.mcpServers || []);
  const curMcp = new Set(cur.config.mcpServers || []);
  for (const t of curMcp) if (!prevMcp.has(t)) changes.push({ field: "mcpServers", op: "added", value: t });
  for (const t of prevMcp) if (!curMcp.has(t)) changes.push({ field: "mcpServers", op: "removed", value: t });

  const prevGranted = new Set(prev.access.granted || []);
  const curGranted = new Set(cur.access.granted || []);
  for (const t of curGranted) if (!prevGranted.has(t)) changes.push({ field: "access", op: "granted", value: t });
  for (const t of prevGranted) if (!curGranted.has(t)) changes.push({ field: "access", op: "revoked", value: t });

  if (Boolean(prev.config.instructionsPresent) !== Boolean(cur.config.instructionsPresent)) {
    changes.push({
      field: "instructionsPresent",
      op: "changed",
      value: String(cur.config.instructionsPresent)
    });
  }
  if (
    prev.config.instructionsHash &&
    cur.config.instructionsHash &&
    prev.config.instructionsHash !== cur.config.instructionsHash
  ) {
    changes.push({ field: "instructionsHash", op: "changed", value: cur.config.instructionsHash });
  }
  return changes;
}

export { ACCESS_KEYS };
