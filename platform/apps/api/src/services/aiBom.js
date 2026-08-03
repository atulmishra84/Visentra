/**
 * AI BOM (Bill of Materials) — composition layer separate from Inventory.
 *
 * V1 builds a structured, machine-readable composition document from discovered
 * agents + relationships. Fields Visentra cannot observe (model hash, license,
 * training datasets, evals) are explicitly marked unknown / not_observed.
 *
 * Categories aligned to enterprise AI BOM expectations:
 *   models | data | software_infra | tools_integrations | identity_access | governance
 */

import { classifyShadowAi } from "./shadowAi.js";
import { randomUUID } from "crypto";

const BOM_SPEC = {
  bomFormat: "Visentra-AIBOM",
  specVersion: "0.1.0",
  scope: "agent_composition_v1"
};

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

function uniqueKey(parts) {
  return parts
    .filter((p) => p != null && String(p).trim() !== "")
    .map((p) => String(p).trim().toLowerCase())
    .join("::");
}

function unknown(reason = "not_observed_by_discovery") {
  return { status: "unknown", reason };
}

function pushComponent(map, component) {
  const key = component.bomRef || uniqueKey([component.category, component.type, component.name, component.version]);
  const existing = map.get(key);
  if (existing) {
    existing.usedBy = Array.from(new Set([...(existing.usedBy || []), ...(component.usedBy || [])]));
    existing.agentIds = Array.from(new Set([...(existing.agentIds || []), ...(component.agentIds || [])]));
    existing.occurrenceCount = (existing.occurrenceCount || 1) + 1;
    return existing;
  }
  const entry = {
    ...component,
    bomRef: key,
    occurrenceCount: 1
  };
  map.set(key, entry);
  return entry;
}

function metaOf(agent) {
  return agent?.metadata && typeof agent.metadata === "object" ? agent.metadata : {};
}

function agentSystemComponent(agent, shadow) {
  const meta = metaOf(agent);
  return {
    category: "systems",
    type: "ai-agent",
    name: agent.name,
    bomRef: `agent:${agent.id}`,
    agentId: agent.id,
    fingerprint: agent.fingerprint,
    version: agent.version || null,
    provider: agent.provider || null,
    properties: {
      category: agent.category || "unknown",
      framework: agent.framework || null,
      model: agent.model || null,
      cloudProvider: agent.cloud_provider || null,
      region: agent.region || null,
      repository: agent.repository || null,
      ide: agent.ide || null,
      hostname: agent.hostname || null,
      deploymentType: agent.deployment_type || null,
      runningStatus: agent.running_status || null,
      evidenceClass: meta.evidenceClass || null,
      agentStatus: meta.agentStatus || null,
      confidenceScore: agent.confidence_score ?? null,
      owner: agent.owner || null,
      department: agent.department || null,
      businessUnit: agent.business_unit || null,
      shadowAi: Boolean(shadow?.isShadow),
      shadowAiScore: shadow?.score ?? 0,
      shadowAiReasons: shadow?.reasons || [],
      sourceCollectors: agent.source_collectors || [],
      firstDiscovered: agent.first_discovered || null,
      lastSeen: agent.last_seen || null,
      lastModified: agent.last_modified || null
    },
    coverage: {
      modelIdentity: agent.model ? "partial" : "missing",
      modelVersionHash: "missing",
      modelLicense: "missing",
      trainingData: "missing",
      packageSbom: "missing",
      toolSchemas: asArray(agent.tools).length ? "partial" : "missing",
      mcp: asArray(agent.mcp_connections).length ? "partial" : "missing",
      identity: agent.identity_used ? "partial" : "missing",
      ownership: agent.owner ? "observed" : "missing"
    }
  };
}

function collectFromAgent(agent, componentMap, dependencyEdges) {
  const shadow = classifyShadowAi(agent);
  const meta = metaOf(agent);
  const system = agentSystemComponent(agent, shadow);
  pushComponent(componentMap, {
    ...system,
    usedBy: [agent.name],
    agentIds: [agent.id]
  });

  const agentRef = system.bomRef;

  if (agent.model) {
    const modelRef = uniqueKey(["models", "model", agent.model, agent.provider, agent.version]);
    pushComponent(componentMap, {
      category: "models",
      type: "ml-model",
      name: agent.model,
      version: agent.version || null,
      provider: agent.provider || null,
      properties: {
        provenance: unknown("api_or_runtime_identity_only"),
        baseModelLineage: unknown(),
        registry: unknown(),
        trainingDataSource: unknown(),
        license: unknown(),
        modelType: unknown(),
        quantization: unknown(),
        checksum: unknown(),
        knownCves: unknown()
      },
      usedBy: [agent.name],
      agentIds: [agent.id]
    });
    dependencyEdges.push({ from: agentRef, to: modelRef, relType: "INVOKES_MODEL" });
  }

  if (agent.framework) {
    const fwRef = uniqueKey(["software_infra", "framework", agent.framework, agent.version]);
    pushComponent(componentMap, {
      category: "software_infra",
      type: "framework",
      name: agent.framework,
      version: agent.version || null,
      properties: {
        packageSbom: unknown(),
        language: agent.programming_language || null
      },
      usedBy: [agent.name],
      agentIds: [agent.id]
    });
    dependencyEdges.push({ from: agentRef, to: fwRef, relType: "USES_FRAMEWORK" });
  }

  const orchestration =
    agent.cloud_provider ||
    (agent.deployment_type && String(agent.deployment_type)) ||
    (agent.container ? "container" : null);
  if (orchestration) {
    const orchRef = uniqueKey(["software_infra", "orchestration", orchestration, agent.region]);
    pushComponent(componentMap, {
      category: "software_infra",
      type: "orchestration",
      name: String(orchestration),
      properties: {
        region: agent.region || null,
        container: agent.container || null,
        endpoint: agent.endpoint || null,
        deploymentType: agent.deployment_type || null,
        baseImageCves: unknown(),
        servingLayer: unknown()
      },
      usedBy: [agent.name],
      agentIds: [agent.id]
    });
    dependencyEdges.push({ from: agentRef, to: orchRef, relType: "DEPLOYED_IN" });
  }

  for (const tool of asArray(agent.tools)) {
    const toolName = typeof tool === "string" ? tool : tool?.name || JSON.stringify(tool);
    if (!toolName) continue;
    const toolRef = uniqueKey(["tools_integrations", "tool", toolName]);
    pushComponent(componentMap, {
      category: "tools_integrations",
      type: "tool",
      name: toolName,
      properties: {
        schema: typeof tool === "object" ? tool : unknown("name_only"),
        purpose: typeof tool === "object" ? tool.purpose || tool.description || null : null
      },
      usedBy: [agent.name],
      agentIds: [agent.id]
    });
    dependencyEdges.push({ from: agentRef, to: toolRef, relType: "USES_TOOL" });
  }

  for (const mcp of asArray(agent.mcp_connections)) {
    const mcpName = typeof mcp === "string" ? mcp : mcp?.name || mcp?.id || JSON.stringify(mcp);
    if (!mcpName) continue;
    const mcpRef = uniqueKey(["tools_integrations", "mcp", mcpName]);
    pushComponent(componentMap, {
      category: "tools_integrations",
      type: "mcp-server",
      name: mcpName,
      properties: {
        trustBoundary: "third_party_capability",
        commandOrUrl: typeof mcp === "object" ? mcp.command || mcp.url || null : null
      },
      usedBy: [agent.name],
      agentIds: [agent.id]
    });
    dependencyEdges.push({ from: agentRef, to: mcpRef, relType: "CONNECTS_MCP" });
  }

  for (const app of asArray(agent.connected_applications)) {
    const appName = typeof app === "string" ? app : app?.name || JSON.stringify(app);
    if (!appName) continue;
    const appRef = uniqueKey(["tools_integrations", "application", appName]);
    pushComponent(componentMap, {
      category: "tools_integrations",
      type: "connected-application",
      name: appName,
      properties: {
        permissionScope: unknown("flag_level_only")
      },
      usedBy: [agent.name],
      agentIds: [agent.id]
    });
    dependencyEdges.push({ from: agentRef, to: appRef, relType: "ACCESSES" });
  }

  if (agent.vector_database) {
    const vdRef = uniqueKey(["data", "vector_database", agent.vector_database]);
    pushComponent(componentMap, {
      category: "data",
      type: "vector-database",
      name: agent.vector_database,
      properties: {
        indexedContent: unknown(),
        refreshPolicy: unknown(),
        accessControls: unknown(),
        sensitivity: unknown()
      },
      usedBy: [agent.name],
      agentIds: [agent.id]
    });
    dependencyEdges.push({ from: agentRef, to: vdRef, relType: "USES_VECTOR_STORE" });
  }

  if (agent.memory_store) {
    const memRef = uniqueKey(["data", "memory_store", agent.memory_store]);
    pushComponent(componentMap, {
      category: "data",
      type: "memory-store",
      name: agent.memory_store,
      properties: {
        retention: unknown(),
        contents: unknown()
      },
      usedBy: [agent.name],
      agentIds: [agent.id]
    });
    dependencyEdges.push({ from: agentRef, to: memRef, relType: "USES_MEMORY" });
  }

  for (const prompt of asArray(agent.prompt_templates)) {
    const promptName =
      typeof prompt === "string" ? prompt : prompt?.name || prompt?.id || "prompt-template";
    const promptRef = uniqueKey(["data", "prompt_template", promptName, agent.id]);
    pushComponent(componentMap, {
      category: "data",
      type: "prompt-template",
      name: promptName,
      properties: {
        version: typeof prompt === "object" ? prompt.version || null : null,
        hash: typeof prompt === "object" ? prompt.hash || prompt.instructionsHash || null : null,
        hashStatus: typeof prompt === "object" && (prompt.hash || prompt.instructionsHash) ? "observed" : "missing"
      },
      usedBy: [agent.name],
      agentIds: [agent.id]
    });
    dependencyEdges.push({ from: agentRef, to: promptRef, relType: "USES_PROMPT" });
  }

  if (agent.identity_used || asArray(agent.permissions).length || agent.api_keys_detected || agent.secrets_detected) {
    const idName = agent.identity_used || `identity-for-${agent.name}`;
    const idRef = uniqueKey(["identity_access", "identity", idName, agent.id]);
    pushComponent(componentMap, {
      category: "identity_access",
      type: "identity",
      name: idName,
      properties: {
        permissions: asArray(agent.permissions),
        authMode: unknown(),
        apiKeysDetected: Boolean(agent.api_keys_detected),
        secretsDetected: Boolean(agent.secrets_detected),
        accessFlags: {
          internet: Boolean(agent.internet_access),
          filesystem: Boolean(agent.filesystem_access),
          database: Boolean(agent.database_access),
          github: Boolean(agent.github_access),
          slack: Boolean(agent.slack_access),
          email: Boolean(agent.email_access),
          calendar: Boolean(agent.calendar_access),
          browser: Boolean(agent.browser_access)
        },
        executionCapability: agent.execution_capability || null
      },
      usedBy: [agent.name],
      agentIds: [agent.id]
    });
    dependencyEdges.push({ from: agentRef, to: idRef, relType: "USES_IDENTITY" });
  }

  pushComponent(componentMap, {
    category: "governance",
    type: "governance-record",
    name: `governance:${agent.name}`,
    bomRef: uniqueKey(["governance", agent.id]),
    properties: {
      owner: agent.owner || null,
      department: agent.department || null,
      businessUnit: agent.business_unit || null,
      approvalStatus: shadow.isShadow ? "shadow_candidate" : agent.owner ? "owned" : "unassigned",
      environment: meta.environment || null,
      complianceMappings: unknown(),
      behavioralEvals: unknown(),
      guardrails: unknown(),
      riskIndicators: asArray(agent.risk_indicators),
      firstDiscovered: agent.first_discovered || null,
      lastSeen: agent.last_seen || null
    },
    usedBy: [agent.name],
    agentIds: [agent.id]
  });
}

function summarizeCoverage(components) {
  const systems = components.filter((c) => c.category === "systems");
  const tallies = {
    systems: systems.length,
    models: 0,
    data: 0,
    software_infra: 0,
    tools_integrations: 0,
    identity_access: 0,
    governance: 0
  };
  for (const c of components) {
    if (c.category !== "systems" && tallies[c.category] != null) tallies[c.category] += 1;
  }

  let ownershipComplete = 0;
  let modelNamed = 0;
  let shadowCandidates = 0;
  for (const s of systems) {
    if (s.properties?.owner) ownershipComplete += 1;
    if (s.properties?.model) modelNamed += 1;
    if (s.properties?.shadowAi) shadowCandidates += 1;
  }

  return {
    ...tallies,
    componentTotal: components.length,
    ownershipCoveragePct: systems.length ? Math.round((ownershipComplete / systems.length) * 100) : 0,
    modelNamedPct: systems.length ? Math.round((modelNamed / systems.length) * 100) : 0,
    shadowCandidates,
    gaps: [
      "Model version / checksum / license / lineage not observed by agentless discovery",
      "Training datasets and data classification not in Visentra V1 collectors",
      "Package SBOM / container CVE correlation not ingested",
      "Behavioral evals and guardrail inventory not captured",
      "Prompt hashes only when collectors emit them"
    ]
  };
}

/**
 * Build a tenant AI BOM document from inventory + relationships.
 */
export async function buildAiBom(pool, tenantId, { limit = 2000 } = {}) {
  const max = Math.min(Math.max(Number(limit) || 2000, 1), 5000);
  const agents = await pool.query(
    `SELECT * FROM agents WHERE tenant_id=$1 ORDER BY last_seen DESC LIMIT $2`,
    [tenantId, max]
  );

  const componentMap = new Map();
  const dependencyEdges = [];

  for (const agent of agents.rows) {
    collectFromAgent(agent, componentMap, dependencyEdges);
  }

  // Enrich with SQL relationships (agent → asset) when present
  if (agents.rows.length) {
    const ids = agents.rows.map((a) => a.id);
    const rels = await pool.query(
      `SELECT r.from_id, r.rel_type, r.to_type, r.to_id, a.name AS to_name, a.asset_type, a.external_key
       FROM relationships r
       LEFT JOIN assets a ON a.id = r.to_id AND a.tenant_id = r.tenant_id
       WHERE r.tenant_id=$1 AND r.from_id = ANY($2::uuid[])
       LIMIT 10000`,
      [tenantId, ids]
    );
    for (const rel of rels.rows) {
      const agent = agents.rows.find((a) => a.id === rel.from_id);
      if (!agent) continue;
      const agentRef = `agent:${agent.id}`;
      const toName = rel.to_name || rel.external_key || String(rel.to_id);
      let category = "tools_integrations";
      let type = String(rel.to_type || "asset").toLowerCase();
      if (/model/i.test(type) || rel.rel_type === "INVOKES_MODEL") {
        category = "models";
        type = "ml-model";
      } else if (/mcp/i.test(type) || rel.rel_type === "CONNECTS_MCP") {
        category = "tools_integrations";
        type = "mcp-server";
      } else if (/framework/i.test(type)) {
        category = "software_infra";
        type = "framework";
      } else if (/identity/i.test(type) || rel.rel_type === "USES_IDENTITY") {
        category = "identity_access";
        type = "identity";
      }
      const bomRef = uniqueKey([category, type, toName]);
      pushComponent(componentMap, {
        category,
        type,
        name: toName,
        properties: {
          assetType: rel.asset_type || rel.to_type || null,
          externalKey: rel.external_key || null,
          fromRelationship: true
        },
        usedBy: [agent.name],
        agentIds: [agent.id]
      });
      dependencyEdges.push({ from: agentRef, to: bomRef, relType: rel.rel_type || "RELATED_TO" });
    }
  }

  const components = Array.from(componentMap.values()).sort((a, b) => {
    const order = ["systems", "models", "data", "software_infra", "tools_integrations", "identity_access", "governance"];
    const ai = order.indexOf(a.category);
    const bi = order.indexOf(b.category);
    if (ai !== bi) return ai - bi;
    return String(a.name).localeCompare(String(b.name));
  });

  // Dedupe dependency edges
  const edgeKeys = new Set();
  const dependencies = [];
  for (const edge of dependencyEdges) {
    const key = `${edge.from}->${edge.to}:${edge.relType}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    dependencies.push(edge);
  }

  const summary = summarizeCoverage(components);
  const generatedAt = new Date().toISOString();

  return {
    ...BOM_SPEC,
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      generatedAt,
      tenantId,
      tool: "Visentra AI BOM",
      note: "Composition derived from discovery inventory. Unknown fields are intentional gaps, not empty omissions."
    },
    summary,
    components,
    dependencies,
    systems: components.filter((c) => c.category === "systems"),
    categories: {
      models: components.filter((c) => c.category === "models"),
      data: components.filter((c) => c.category === "data"),
      software_infra: components.filter((c) => c.category === "software_infra"),
      tools_integrations: components.filter((c) => c.category === "tools_integrations"),
      identity_access: components.filter((c) => c.category === "identity_access"),
      governance: components.filter((c) => c.category === "governance")
    }
  };
}

export function aiBomToCycloneDxLite(bom) {
  // Lightweight CycloneDX-shaped export for interoperability (not full ML-BOM compliance).
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: bom.serialNumber,
    version: bom.version,
    metadata: {
      timestamp: bom.metadata.generatedAt,
      tools: [{ vendor: "Visentra", name: "AI BOM", version: BOM_SPEC.specVersion }],
      component: {
        type: "application",
        name: "Visentra AI estate",
        "bom-ref": "visentra-ai-estate"
      },
      properties: [
        { name: "visentra:scope", value: BOM_SPEC.scope },
        { name: "visentra:note", value: bom.metadata.note }
      ]
    },
    components: bom.components
      .filter((c) => c.category !== "governance")
      .map((c) => ({
        type:
          c.type === "ml-model"
            ? "machine-learning-model"
            : c.type === "ai-agent"
              ? "application"
              : "library",
        "bom-ref": c.bomRef,
        name: c.name,
        version: c.version || undefined,
        publisher: c.provider || undefined,
        properties: Object.entries({
          "visentra:category": c.category,
          "visentra:type": c.type,
          ...(c.properties && typeof c.properties === "object"
            ? Object.fromEntries(
                Object.entries(c.properties)
                  .filter(([, v]) => v != null && typeof v !== "object")
                  .map(([k, v]) => [`visentra:${k}`, String(v)])
              )
            : {})
        }).map(([name, value]) => ({ name, value }))
      })),
    dependencies: (() => {
      const byFrom = new Map();
      for (const edge of bom.dependencies) {
        if (!byFrom.has(edge.from)) byFrom.set(edge.from, new Set());
        byFrom.get(edge.from).add(edge.to);
      }
      return Array.from(byFrom.entries()).map(([ref, deps]) => ({
        ref,
        dependsOn: Array.from(deps)
      }));
    })()
  };
}
