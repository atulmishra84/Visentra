/**
 * Visentra Full AI BOM module
 *
 * Builds a complete AI Bill of Materials across 7 categories:
 *   1 models | 2 data | 3 software_infra | 4 tools_integrations
 *   5 identity_access | 6 governance | 7 behavioral
 *
 * Discovery fills observed fields; enrichment table supplies the rest.
 * Unobserved fields stay explicitly unknown — never invented.
 */

import { randomUUID } from "crypto";
import { classifyShadowAi } from "./shadowAi.js";

export const BOM_SPEC = {
  bomFormat: "Visentra-AIBOM",
  specVersion: "1.0.0",
  scope: "full_ai_bom_v1"
};

/** Canonical field catalog for completeness scoring + UI. */
export const AI_BOM_FIELD_CATALOG = [
  // 1. Model
  { id: "model.name", category: "models", label: "Model name", source: "discovery", path: "model.name" },
  { id: "model.version", category: "models", label: "Model version", source: "either", path: "model.version" },
  { id: "model.provider", category: "models", label: "Provider", source: "discovery", path: "model.provider" },
  { id: "model.checksum", category: "models", label: "Checksum / hash", source: "enrichment", path: "model.checksum" },
  { id: "model.modelCardId", category: "models", label: "Model card ID", source: "enrichment", path: "model.modelCardId" },
  { id: "model.provenance", category: "models", label: "Provenance", source: "enrichment", path: "model.provenance" },
  { id: "model.baseModel", category: "models", label: "Base model lineage", source: "enrichment", path: "model.baseModel" },
  { id: "model.registry", category: "models", label: "Model registry / source", source: "enrichment", path: "model.registry" },
  { id: "model.trainingDataSource", category: "models", label: "Training data source", source: "enrichment", path: "model.trainingDataSource" },
  { id: "model.license", category: "models", label: "License", source: "enrichment", path: "model.license" },
  { id: "model.modelType", category: "models", label: "Model type", source: "enrichment", path: "model.modelType" },
  { id: "model.quantization", category: "models", label: "Quantization / optimization", source: "enrichment", path: "model.quantization" },
  { id: "model.knownCves", category: "models", label: "Known CVEs / advisories", source: "enrichment", path: "model.knownCves" },
  // 2. Data
  { id: "data.trainingDatasets", category: "data", label: "Training / fine-tune datasets", source: "enrichment", path: "data.trainingDatasets" },
  { id: "data.vectorDatabase", category: "data", label: "Vector database", source: "either", path: "data.vectorDatabase" },
  { id: "data.ragSources", category: "data", label: "RAG knowledge sources", source: "enrichment", path: "data.ragSources" },
  { id: "data.promptTemplates", category: "data", label: "Prompt templates", source: "either", path: "data.promptTemplates" },
  { id: "data.promptHash", category: "data", label: "Instructions / prompt hash", source: "enrichment", path: "data.promptHash" },
  { id: "data.memoryStore", category: "data", label: "Memory store", source: "either", path: "data.memoryStore" },
  { id: "data.hasPii", category: "data", label: "PII flag", source: "enrichment", path: "data.hasPii" },
  { id: "data.hasPhi", category: "data", label: "PHI flag", source: "enrichment", path: "data.hasPhi" },
  { id: "data.dataClasses", category: "data", label: "Data classification", source: "enrichment", path: "data.dataClasses" },
  // 3. Software & infra
  { id: "software.framework", category: "software_infra", label: "Framework", source: "discovery", path: "software.framework" },
  { id: "software.frameworkVersion", category: "software_infra", label: "Framework version", source: "either", path: "software.frameworkVersion" },
  { id: "software.packageSbom", category: "software_infra", label: "Underlying SBOM / packages", source: "enrichment", path: "software.packageSbom" },
  { id: "software.containerImage", category: "software_infra", label: "Container / base image", source: "either", path: "software.containerImage" },
  { id: "software.containerDigest", category: "software_infra", label: "Image digest", source: "enrichment", path: "software.containerDigest" },
  { id: "software.imageCves", category: "software_infra", label: "Image CVEs", source: "enrichment", path: "software.imageCves" },
  { id: "software.orchestration", category: "software_infra", label: "Orchestration platform", source: "either", path: "software.orchestration" },
  { id: "software.servingLayer", category: "software_infra", label: "Serving layer", source: "enrichment", path: "software.servingLayer" },
  // 4. Tools & integrations
  { id: "tools.list", category: "tools_integrations", label: "Tools / functions", source: "discovery", path: "tools.list" },
  { id: "tools.schemas", category: "tools_integrations", label: "Tool I/O schemas", source: "enrichment", path: "tools.schemas" },
  { id: "tools.mcpServers", category: "tools_integrations", label: "MCP servers", source: "discovery", path: "tools.mcpServers" },
  { id: "tools.connectedApps", category: "tools_integrations", label: "Connected applications", source: "discovery", path: "tools.connectedApps" },
  { id: "tools.agentLinks", category: "tools_integrations", label: "Agent-to-agent links", source: "discovery", path: "tools.agentLinks" },
  { id: "tools.plugins", category: "tools_integrations", label: "Plugins / extensions", source: "enrichment", path: "tools.plugins" },
  // 5. Identity
  { id: "identity.principal", category: "identity_access", label: "Identity / service principal", source: "either", path: "identity.principal" },
  { id: "identity.permissions", category: "identity_access", label: "Permissions / scopes", source: "either", path: "identity.permissions" },
  { id: "identity.authMode", category: "identity_access", label: "Auth mode", source: "enrichment", path: "identity.authMode" },
  { id: "identity.secretsRefs", category: "identity_access", label: "Secrets referenced", source: "enrichment", path: "identity.secretsRefs" },
  { id: "identity.secretsDetected", category: "identity_access", label: "Hardcoded secrets flagged", source: "discovery", path: "identity.secretsDetected" },
  // 6. Governance
  { id: "governance.owner", category: "governance", label: "Owner / team", source: "discovery", path: "governance.owner" },
  { id: "governance.approvalStatus", category: "governance", label: "Approval status", source: "either", path: "governance.approvalStatus" },
  { id: "governance.environment", category: "governance", label: "Environment", source: "either", path: "governance.environment" },
  { id: "governance.timestamps", category: "governance", label: "Lifecycle timestamps", source: "discovery", path: "governance.timestamps" },
  { id: "governance.compliance", category: "governance", label: "Compliance mappings", source: "enrichment", path: "governance.compliance" },
  // 7. Behavioral
  { id: "behavioral.knownRisks", category: "behavioral", label: "Known model risks", source: "enrichment", path: "behavioral.knownRisks" },
  { id: "behavioral.evalResults", category: "behavioral", label: "Red-team / eval results", source: "enrichment", path: "behavioral.evalResults" },
  { id: "behavioral.guardrails", category: "behavioral", label: "Guardrails applied", source: "enrichment", path: "behavioral.guardrails" },
  { id: "behavioral.riskIndicators", category: "behavioral", label: "Discovery risk indicators", source: "discovery", path: "behavioral.riskIndicators" }
];

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

function metaOf(agent) {
  return agent?.metadata && typeof agent.metadata === "object" ? agent.metadata : {};
}

function getPath(obj, path) {
  return String(path)
    .split(".")
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function isFilled(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "" && value !== "unknown";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") {
    if (value.status === "unknown") return false;
    return Object.keys(value).length > 0;
  }
  if (typeof value === "boolean") return true;
  return true;
}

function unknown(reason = "not_observed") {
  return { status: "unknown", reason };
}

function deepMerge(base, overlay) {
  if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) return overlay ?? base;
  const out = { ...(base && typeof base === "object" ? base : {}) };
  for (const [k, v] of Object.entries(overlay)) {
    if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

/** Observed composition record for one agent (before enrichment merge). */
export function observeAgentComposition(agent, relationshipHints = []) {
  const meta = metaOf(agent);
  const shadow = classifyShadowAi(agent);
  const tools = asArray(agent.tools);
  const mcp = asArray(agent.mcp_connections);
  const apps = asArray(agent.connected_applications);
  const prompts = asArray(agent.prompt_templates);
  const agentLinks = relationshipHints.filter((r) => /agent/i.test(String(r.to_type || "")));

  return {
    agentId: agent.id,
    fingerprint: agent.fingerprint,
    name: agent.name,
    category: agent.category || "unknown",
    model: {
      name: agent.model || null,
      version: agent.version || null,
      provider: agent.provider || null,
      checksum: null,
      modelCardId: null,
      provenance: null,
      baseModel: null,
      registry: null,
      trainingDataSource: null,
      license: null,
      modelType: null,
      quantization: null,
      knownCves: null
    },
    data: {
      trainingDatasets: null,
      vectorDatabase: agent.vector_database || null,
      ragSources: null,
      promptTemplates: prompts,
      promptHash: null,
      memoryStore: agent.memory_store || null,
      hasPii: null,
      hasPhi: null,
      dataClasses: null
    },
    software: {
      framework: agent.framework || null,
      frameworkVersion: agent.version || null,
      packageSbom: null,
      containerImage: agent.container || null,
      containerDigest: null,
      imageCves: null,
      orchestration: agent.cloud_provider || agent.deployment_type || null,
      region: agent.region || null,
      endpoint: agent.endpoint || null,
      servingLayer: null,
      repository: agent.repository || null,
      ide: agent.ide || null,
      language: agent.programming_language || null
    },
    tools: {
      list: tools,
      schemas: null,
      mcpServers: mcp,
      connectedApps: apps,
      agentLinks: agentLinks.map((r) => ({
        relType: r.rel_type,
        to: r.to_name || r.external_key || r.to_id
      })),
      plugins: null,
      accessFlags: {
        internet: Boolean(agent.internet_access),
        filesystem: Boolean(agent.filesystem_access),
        database: Boolean(agent.database_access),
        github: Boolean(agent.github_access),
        slack: Boolean(agent.slack_access),
        email: Boolean(agent.email_access),
        calendar: Boolean(agent.calendar_access),
        browser: Boolean(agent.browser_access)
      }
    },
    identity: {
      principal: agent.identity_used || null,
      permissions: asArray(agent.permissions),
      authMode: null,
      secretsRefs: null,
      secretsDetected: Boolean(agent.secrets_detected || agent.api_keys_detected),
      apiKeysDetected: Boolean(agent.api_keys_detected),
      executionCapability: agent.execution_capability || null
    },
    governance: {
      owner: agent.owner || null,
      department: agent.department || null,
      businessUnit: agent.business_unit || null,
      approvalStatus: shadow.isShadow ? "shadow_candidate" : agent.owner ? "owned" : "unassigned",
      environment: meta.environment || null,
      timestamps: {
        firstDiscovered: agent.first_discovered || null,
        lastSeen: agent.last_seen || null,
        lastModified: agent.last_modified || null,
        creationTime: agent.creation_time || null
      },
      compliance: null,
      evidenceClass: meta.evidenceClass || null,
      agentStatus: meta.agentStatus || null,
      confidenceScore: agent.confidence_score ?? null,
      sourceCollectors: agent.source_collectors || [],
      shadowAi: Boolean(shadow.isShadow),
      shadowAiScore: shadow.score ?? 0,
      shadowAiReasons: shadow.reasons || []
    },
    behavioral: {
      knownRisks: null,
      evalResults: null,
      guardrails: null,
      riskIndicators: asArray(agent.risk_indicators)
    }
  };
}

export function scoreComposition(composition) {
  const fields = AI_BOM_FIELD_CATALOG.map((field) => {
    const value = getPath(composition, field.path);
    const filled = isFilled(value);
    return {
      id: field.id,
      category: field.category,
      label: field.label,
      source: field.source,
      filled,
      value: filled ? value : null
    };
  });
  const filledCount = fields.filter((f) => f.filled).length;
  const total = fields.length;
  const byCategory = {};
  for (const field of fields) {
    if (!byCategory[field.category]) byCategory[field.category] = { filled: 0, total: 0 };
    byCategory[field.category].total += 1;
    if (field.filled) byCategory[field.category].filled += 1;
  }
  for (const key of Object.keys(byCategory)) {
    const row = byCategory[key];
    row.pct = row.total ? Math.round((row.filled / row.total) * 100) : 0;
  }
  return {
    filled: filledCount,
    total,
    pct: total ? Math.round((filledCount / total) * 100) : 0,
    byCategory,
    fields,
    gaps: fields.filter((f) => !f.filled)
  };
}

export function mergeEnrichment(observed, enrichmentFields = {}) {
  return deepMerge(observed, enrichmentFields);
}

export async function listEnrichments(pool, tenantId) {
  const result = await pool.query(
    `SELECT agent_id, fields, completeness, updated_by, updated_at
     FROM ai_bom_enrichments WHERE tenant_id=$1`,
    [tenantId]
  );
  return new Map(result.rows.map((r) => [r.agent_id, r]));
}

export async function getEnrichment(pool, tenantId, agentId) {
  const result = await pool.query(
    `SELECT * FROM ai_bom_enrichments WHERE tenant_id=$1 AND agent_id=$2`,
    [tenantId, agentId]
  );
  return result.rows[0] || null;
}

export async function upsertEnrichment(pool, tenantId, agentId, fields, updatedBy) {
  const observedRow = await pool.query(`SELECT * FROM agents WHERE tenant_id=$1 AND id=$2`, [
    tenantId,
    agentId
  ]);
  if (!observedRow.rows[0]) {
    const err = new Error("Agent not found");
    err.status = 404;
    throw err;
  }
  const observed = observeAgentComposition(observedRow.rows[0]);
  const merged = mergeEnrichment(observed, fields || {});
  const score = scoreComposition(merged);
  const result = await pool.query(
    `INSERT INTO ai_bom_enrichments (tenant_id, agent_id, fields, completeness, updated_by)
     VALUES ($1,$2,$3::jsonb,$4,$5)
     ON CONFLICT (tenant_id, agent_id) DO UPDATE SET
       fields = EXCLUDED.fields,
       completeness = EXCLUDED.completeness,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING *`,
    [tenantId, agentId, JSON.stringify(fields || {}), score.pct, updatedBy || null]
  );
  return { enrichment: result.rows[0], composition: merged, score };
}

export async function buildSystemRecord(pool, tenantId, agent, enrichmentMap, relsForAgent) {
  const enrichment = enrichmentMap.get(agent.id);
  const observed = observeAgentComposition(agent, relsForAgent);
  const merged = mergeEnrichment(observed, enrichment?.fields || {});
  const score = scoreComposition(merged);
  return {
    bomRef: `agent:${agent.id}`,
    type: "ai-system",
    agentId: agent.id,
    name: agent.name,
    fingerprint: agent.fingerprint,
    composition: merged,
    score,
    enrichment: enrichment
      ? {
          updatedAt: enrichment.updated_at,
          updatedBy: enrichment.updated_by,
          completeness: Number(enrichment.completeness)
        }
      : null
  };
}

export async function buildAiBom(pool, tenantId, { limit = 2000, agentId = null } = {}) {
  const max = Math.min(Math.max(Number(limit) || 2000, 1), 5000);
  let agents;
  if (agentId) {
    agents = await pool.query(`SELECT * FROM agents WHERE tenant_id=$1 AND id=$2`, [tenantId, agentId]);
  } else {
    agents = await pool.query(
      `SELECT * FROM agents WHERE tenant_id=$1 ORDER BY last_seen DESC LIMIT $2`,
      [tenantId, max]
    );
  }

  const enrichmentMap = await listEnrichments(pool, tenantId);
  const ids = agents.rows.map((a) => a.id);
  let relRows = [];
  if (ids.length) {
    const rels = await pool.query(
      `SELECT r.from_id, r.rel_type, r.to_type, r.to_id, a.name AS to_name, a.asset_type, a.external_key
       FROM relationships r
       LEFT JOIN assets a ON a.id = r.to_id AND a.tenant_id = r.tenant_id
       WHERE r.tenant_id=$1 AND r.from_id = ANY($2::uuid[])
       LIMIT 20000`,
      [tenantId, ids]
    );
    relRows = rels.rows;
  }
  const relsByAgent = new Map();
  for (const rel of relRows) {
    const list = relsByAgent.get(rel.from_id) || [];
    list.push(rel);
    relsByAgent.set(rel.from_id, list);
  }

  const systems = [];
  for (const agent of agents.rows) {
    systems.push(
      await buildSystemRecord(pool, tenantId, agent, enrichmentMap, relsByAgent.get(agent.id) || [])
    );
  }

  // Aggregate unique components across systems for estate-level BOM
  const componentBuckets = {
    models: new Map(),
    data: new Map(),
    software_infra: new Map(),
    tools_integrations: new Map(),
    identity_access: new Map(),
    governance: new Map(),
    behavioral: new Map()
  };

  const dependencies = [];

  for (const system of systems) {
    const c = system.composition;
    const agentRef = system.bomRef;

    const add = (bucket, key, component, relType) => {
      if (!key) return;
      const map = componentBuckets[bucket];
      const existing = map.get(key);
      if (existing) {
        existing.usedBy = Array.from(new Set([...(existing.usedBy || []), system.name]));
        existing.agentIds = Array.from(new Set([...(existing.agentIds || []), system.agentId]));
        existing.occurrenceCount = (existing.occurrenceCount || 1) + 1;
      } else {
        map.set(key, {
          ...component,
          bomRef: key,
          occurrenceCount: 1,
          usedBy: [system.name],
          agentIds: [system.agentId]
        });
      }
      dependencies.push({ from: agentRef, to: key, relType });
    };

    if (c.model?.name) {
      add(
        "models",
        `model:${String(c.model.name).toLowerCase()}:${String(c.model.provider || "").toLowerCase()}`,
        {
          category: "models",
          type: "ml-model",
          name: c.model.name,
          version: c.model.version,
          provider: c.model.provider,
          properties: { ...c.model }
        },
        "INVOKES_MODEL"
      );
    }
    if (c.software?.framework) {
      add(
        "software_infra",
        `framework:${String(c.software.framework).toLowerCase()}`,
        {
          category: "software_infra",
          type: "framework",
          name: c.software.framework,
          version: c.software.frameworkVersion,
          properties: { ...c.software }
        },
        "USES_FRAMEWORK"
      );
    }
    if (c.software?.orchestration) {
      add(
        "software_infra",
        `orch:${String(c.software.orchestration).toLowerCase()}`,
        {
          category: "software_infra",
          type: "orchestration",
          name: String(c.software.orchestration),
          properties: {
            region: c.software.region,
            servingLayer: c.software.servingLayer,
            containerImage: c.software.containerImage,
            containerDigest: c.software.containerDigest,
            imageCves: c.software.imageCves,
            packageSbom: c.software.packageSbom
          }
        },
        "DEPLOYED_IN"
      );
    }
    if (c.data?.vectorDatabase) {
      add(
        "data",
        `vector:${String(c.data.vectorDatabase).toLowerCase()}`,
        {
          category: "data",
          type: "vector-database",
          name: c.data.vectorDatabase,
          properties: {
            ragSources: c.data.ragSources,
            hasPii: c.data.hasPii,
            hasPhi: c.data.hasPhi,
            dataClasses: c.data.dataClasses
          }
        },
        "USES_VECTOR_STORE"
      );
    }
    if (c.data?.memoryStore) {
      add(
        "data",
        `memory:${String(c.data.memoryStore).toLowerCase()}`,
        { category: "data", type: "memory-store", name: c.data.memoryStore, properties: {} },
        "USES_MEMORY"
      );
    }
    for (const tool of asArray(c.tools?.list)) {
      const name = typeof tool === "string" ? tool : tool?.name;
      if (!name) continue;
      add(
        "tools_integrations",
        `tool:${String(name).toLowerCase()}`,
        { category: "tools_integrations", type: "tool", name, properties: { raw: tool, schemas: c.tools.schemas } },
        "USES_TOOL"
      );
    }
    for (const mcp of asArray(c.tools?.mcpServers)) {
      const name = typeof mcp === "string" ? mcp : mcp?.name || mcp?.id;
      if (!name) continue;
      add(
        "tools_integrations",
        `mcp:${String(name).toLowerCase()}`,
        { category: "tools_integrations", type: "mcp-server", name, properties: { raw: mcp } },
        "CONNECTS_MCP"
      );
    }
    for (const app of asArray(c.tools?.connectedApps)) {
      const name = typeof app === "string" ? app : app?.name;
      if (!name) continue;
      add(
        "tools_integrations",
        `app:${String(name).toLowerCase()}`,
        { category: "tools_integrations", type: "connected-application", name, properties: {} },
        "ACCESSES"
      );
    }
    if (c.identity?.principal || c.identity?.secretsDetected || asArray(c.identity?.permissions).length) {
      add(
        "identity_access",
        `identity:${String(c.identity.principal || system.agentId).toLowerCase()}`,
        {
          category: "identity_access",
          type: "identity",
          name: c.identity.principal || `identity:${system.name}`,
          properties: { ...c.identity }
        },
        "USES_IDENTITY"
      );
    }
    add(
      "governance",
      `gov:${system.agentId}`,
      {
        category: "governance",
        type: "governance-record",
        name: `governance:${system.name}`,
        properties: { ...c.governance }
      },
      "HAS_GOVERNANCE"
    );
    add(
      "behavioral",
      `behavior:${system.agentId}`,
      {
        category: "behavioral",
        type: "behavioral-record",
        name: `behavioral:${system.name}`,
        properties: { ...c.behavioral }
      },
      "HAS_BEHAVIORAL_PROFILE"
    );
  }

  const categories = {};
  let componentTotal = systems.length;
  for (const [key, map] of Object.entries(componentBuckets)) {
    categories[key] = Array.from(map.values()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    componentTotal += categories[key].length;
  }

  const fieldRollup = {
    filled: 0,
    total: 0,
    byCategory: {}
  };
  for (const system of systems) {
    fieldRollup.filled += system.score.filled;
    fieldRollup.total += system.score.total;
    for (const [cat, stats] of Object.entries(system.score.byCategory)) {
      if (!fieldRollup.byCategory[cat]) fieldRollup.byCategory[cat] = { filled: 0, total: 0 };
      fieldRollup.byCategory[cat].filled += stats.filled;
      fieldRollup.byCategory[cat].total += stats.total;
    }
  }
  for (const cat of Object.keys(fieldRollup.byCategory)) {
    const row = fieldRollup.byCategory[cat];
    row.pct = row.total ? Math.round((row.filled / row.total) * 100) : 0;
  }
  fieldRollup.pct = fieldRollup.total ? Math.round((fieldRollup.filled / fieldRollup.total) * 100) : 0;

  const ownershipCoveragePct = systems.length
    ? Math.round((systems.filter((s) => s.composition.governance?.owner).length / systems.length) * 100)
    : 0;
  const modelNamedPct = systems.length
    ? Math.round((systems.filter((s) => s.composition.model?.name).length / systems.length) * 100)
    : 0;
  const enrichedPct = systems.length
    ? Math.round((systems.filter((s) => s.enrichment).length / systems.length) * 100)
    : 0;
  const shadowCandidates = systems.filter((s) => s.composition.governance?.shadowAi).length;

  const edgeKeys = new Set();
  const deps = [];
  for (const edge of dependencies) {
    const key = `${edge.from}->${edge.to}:${edge.relType}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    deps.push(edge);
  }

  const generatedAt = new Date().toISOString();
  return {
    ...BOM_SPEC,
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      generatedAt,
      tenantId,
      tool: "Visentra AI BOM",
      note: "Full AI BOM: discovery-observed fields plus optional enrichment. Unknowns are explicit."
    },
    catalog: AI_BOM_FIELD_CATALOG,
    summary: {
      systems: systems.length,
      models: categories.models.length,
      data: categories.data.length,
      software_infra: categories.software_infra.length,
      tools_integrations: categories.tools_integrations.length,
      identity_access: categories.identity_access.length,
      governance: categories.governance.length,
      behavioral: categories.behavioral.length,
      componentTotal,
      ownershipCoveragePct,
      modelNamedPct,
      enrichedPct,
      shadowCandidates,
      completenessPct: fieldRollup.pct,
      fieldRollup,
      gaps: AI_BOM_FIELD_CATALOG.filter((f) => f.source === "enrichment").map(
        (f) => `${f.label} typically requires enrichment`
      )
    },
    systems,
    categories,
    components: [
      ...systems.map((s) => ({
        bomRef: s.bomRef,
        category: "systems",
        type: "ai-system",
        name: s.name,
        agentIds: [s.agentId],
        occurrenceCount: 1,
        properties: s.composition,
        score: s.score
      })),
      ...Object.values(categories).flat()
    ],
    dependencies: deps
  };
}

export function aiBomToCycloneDx(bom) {
  const components = [];
  const seen = new Set();

  for (const system of bom.systems || []) {
    const c = system.composition;
    if (seen.has(system.bomRef)) continue;
    seen.add(system.bomRef);
    components.push({
      type: "application",
      "bom-ref": system.bomRef,
      name: system.name,
      version: c.software?.frameworkVersion || undefined,
      properties: [
        { name: "visentra:category", value: "ai-system" },
        { name: "visentra:fingerprint", value: String(system.fingerprint || "") },
        { name: "visentra:completeness", value: String(system.score?.pct ?? 0) },
        { name: "visentra:owner", value: String(c.governance?.owner || "") },
        { name: "visentra:approvalStatus", value: String(c.governance?.approvalStatus || "") }
      ]
    });
  }

  for (const comp of bom.components || []) {
    if (comp.category === "systems" || comp.type === "governance-record" || comp.type === "behavioral-record") {
      continue;
    }
    if (seen.has(comp.bomRef)) continue;
    seen.add(comp.bomRef);

    const modelCard =
      comp.type === "ml-model"
        ? {
            modelParameters: {
              approach: { type: comp.properties?.modelType || "unknown" },
              architectureFamily: comp.properties?.baseModel || undefined
            },
            considerations: {
              technicalLimitations: comp.properties?.knownCves || undefined
            }
          }
        : undefined;

    components.push({
      type: comp.type === "ml-model" ? "machine-learning-model" : "library",
      "bom-ref": comp.bomRef,
      name: comp.name,
      version: comp.version || comp.properties?.version || undefined,
      publisher: comp.provider || comp.properties?.provider || undefined,
      licenses: comp.properties?.license ? [{ license: { name: String(comp.properties.license) } }] : undefined,
      modelCard,
      properties: [
        { name: "visentra:category", value: comp.category || "" },
        { name: "visentra:type", value: comp.type || "" }
      ]
    });
  }

  const byFrom = new Map();
  for (const edge of bom.dependencies || []) {
    if (!byFrom.has(edge.from)) byFrom.set(edge.from, new Set());
    byFrom.get(edge.from).add(edge.to);
  }

  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: bom.serialNumber,
    version: bom.version,
    metadata: {
      timestamp: bom.metadata.generatedAt,
      tools: {
        components: [{ type: "application", name: "Visentra AI BOM", version: BOM_SPEC.specVersion }]
      },
      component: {
        type: "application",
        name: "Visentra AI estate",
        "bom-ref": "visentra-ai-estate"
      },
      properties: [
        { name: "visentra:scope", value: BOM_SPEC.scope },
        { name: "visentra:completenessPct", value: String(bom.summary?.completenessPct ?? 0) }
      ]
    },
    components,
    dependencies: Array.from(byFrom.entries()).map(([ref, deps]) => ({
      ref,
      dependsOn: Array.from(deps)
    }))
  };
}

/** Backward-compatible alias */
export function aiBomToCycloneDxLite(bom) {
  return aiBomToCycloneDx(bom);
}

export async function createAiBomSnapshot(pool, tenantId, { format = "visentra", label = null, createdBy = null, limit } = {}) {
  const bom = await buildAiBom(pool, tenantId, { limit });
  const document = format === "cyclonedx" ? aiBomToCycloneDx(bom) : bom;
  const result = await pool.query(
    `INSERT INTO ai_bom_snapshots (tenant_id, serial_number, format, label, document, summary, created_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)
     RETURNING id, serial_number, format, label, summary, created_by, created_at`,
    [
      tenantId,
      bom.serialNumber,
      format === "cyclonedx" ? "cyclonedx" : "visentra",
      label,
      JSON.stringify(document),
      JSON.stringify(bom.summary),
      createdBy
    ]
  );
  return { snapshot: result.rows[0], document };
}

export async function listAiBomSnapshots(pool, tenantId, { limit = 20 } = {}) {
  const result = await pool.query(
    `SELECT id, serial_number, format, label, summary, created_by, created_at
     FROM ai_bom_snapshots WHERE tenant_id=$1
     ORDER BY created_at DESC LIMIT $2`,
    [tenantId, Math.min(Number(limit) || 20, 100)]
  );
  return result.rows;
}

export async function getAiBomSnapshot(pool, tenantId, id) {
  const result = await pool.query(
    `SELECT * FROM ai_bom_snapshots WHERE tenant_id=$1 AND id=$2`,
    [tenantId, id]
  );
  return result.rows[0] || null;
}
