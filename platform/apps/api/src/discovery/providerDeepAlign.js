/**
 * Cross-provider deep + adversarial alignment with AWS metadata.deep / adversarial_surface.
 *
 * AWS (aws-deep.v2) and Agent 365 (agent365-deep.v1) already stamp the full contract.
 * Other scanners reuse this helper so confirmed agents always get:
 *   - metadata.deep          (provider schema + awsDeepCompatible: "aws-deep.v2")
 *   - metadata.deepScan / deepScanSchema / deepScanStatus / deepScanError
 *   - metadata.adversarial_surface (schema 1.0.0 via attachAdversarialSurface)
 *
 * Never invents agents — only enriches observations already classified as agents.
 * Never persists full instruction text (preview + hash only).
 */

import {
  attachAdversarialSurface,
  buildInstructionsFromText,
  emptyTool,
  inferToolRiskFlags,
  instructionPreview,
} from "./adversarialInventory.js";

export const AWS_DEEP_COMPAT = "aws-deep.v2";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/**
 * Normalize heterogeneous tool signals (string type, OpenAI tool object, Bedrock-like).
 */
export function normalizeAlignedTools(tools, source = "provider_list") {
  return asArray(tools)
    .map((tool, index) => {
      if (typeof tool === "string") {
        const name = tool.trim();
        if (!name) return null;
        const risk_flags = inferToolRiskFlags({ name, source });
        return emptyTool({
          name,
          description: null,
          risk_flags,
          source,
          confidence: "medium",
          evidence: [`Tool type from ${source}`],
          type: name,
        });
      }
      const row = asObject(tool);
      const type = firstString(row.type, row.kind) || null;
      const name =
        firstString(row.function?.name, row.name, row.toolName, row.id) ||
        (type && type !== "function" ? type : "") ||
        `tool_${index + 1}`;
      const description = firstString(
        row.description,
        row.function?.description,
        type ? `type=${type}` : "",
      );
      const parameters_schema =
        row.parameters_schema ||
        row.parameters ||
        row.function?.parameters ||
        null;
      const risk_flags =
        row.risk_flags && typeof row.risk_flags === "object"
          ? row.risk_flags
          : inferToolRiskFlags({ name, description, parameters_schema, source: type || source });
      return emptyTool({
        name,
        description: description || null,
        parameters_schema,
        risk_flags,
        source: row.source || source,
        confidence: row.confidence || "medium",
        evidence: asArray(row.evidence).length
          ? asArray(row.evidence)
          : [`Tool from ${source}`],
        type,
      });
    })
    .filter(Boolean);
}

function normalizeKnowledgeBases(items) {
  return asArray(items)
    .map((kb, index) => {
      if (typeof kb === "string") {
        return { id: null, name: kb, description: null, knowledgeBaseState: null };
      }
      const row = asObject(kb);
      const name = firstString(row.name, row.id, row.knowledgeBaseId);
      if (!name && !row.id) return null;
      return {
        id: row.id || row.knowledgeBaseId || null,
        name: name || `kb_${index + 1}`,
        description: firstString(row.description) || null,
        knowledgeBaseState: row.knowledgeBaseState || row.state || null,
        type: row.type || null,
      };
    })
    .filter(Boolean);
}

/**
 * Build an aws-deep.v2-compatible deep profile from provider list/detail signals.
 */
export function buildCompatibleDeepProfile({
  schema,
  deepScan,
  provider,
  agentId = null,
  agentName = null,
  agentType = null,
  foundationModel = null,
  description = null,
  instructionText = null,
  tools = [],
  knowledgeBases = [],
  identity = null,
  guardrails = null,
  access = null,
  limitations = [],
  extra = {},
  fetchedAt = null,
} = {}) {
  const normalizedTools = normalizeAlignedTools(tools, deepScan || `${provider}_deep`);
  const normalizedKbs = normalizeKnowledgeBases(knowledgeBases);
  const hasBody = typeof instructionText === "string" && instructionText.trim().length > 0;
  const built = hasBody
    ? buildInstructionsFromText(instructionText, deepScan || `${provider}_instructions`)
    : null;

  const instructions = hasBody
    ? {
        present: true,
        hash: built.hash,
        length: built.length,
        preview: built.preview || instructionPreview(instructionText, 240),
        source: built.source,
        contains_tool_guidance: built.contains_tool_guidance,
        contains_safety_rules: built.contains_safety_rules,
      }
    : {
        present: false,
        hash: null,
        length: 0,
        preview: description ? instructionPreview(description, 240) : null,
        source: description ? "description_only" : "none",
        note: "Full system instructions not returned by this provider API (or not collected).",
      };

  const identityBlock = {
    identity_type: identity?.identity_type || identity?.kind || null,
    kind: identity?.kind || identity?.identity_type || null,
    name: identity?.name || null,
    arn: identity?.arn || identity?.roleArn || null,
    principalId: identity?.principalId || null,
    note: identity?.note || null,
  };

  return {
    deepScan: deepScan || `${provider}_list`,
    schemaVersion: schema || `${provider}-deep.v1`,
    awsDeepCompatible: AWS_DEEP_COMPAT,
    fetchedAt: fetchedAt || new Date().toISOString(),
    provider: provider || null,
    packageId: null,
    agentId: agentId || null,
    displayName: agentName || null,
    type: agentType || null,
    foundationModel: foundationModel || null,
    description: description || null,
    identity: identityBlock,
    access: access || null,
    instructions,
    instructionPreview: instructions.preview,
    instructionHash: instructions.hash,
    instructionLength: instructions.length || 0,
    guardrails: guardrails || { present: false, note: "No guardrail config collected for this provider." },
    tools: normalizedTools,
    toolCount: normalizedTools.length,
    actionGroups: normalizedTools.map((t) => ({
      actionGroupName: t.name,
      description: t.description,
      actionGroupState: "ENABLED",
      source: t.source,
    })),
    actionGroupCount: normalizedTools.length,
    knowledgeBases: normalizedKbs,
    knowledgeBaseCount: normalizedKbs.length,
    codeInterpreter: normalizedTools.some((t) => t.risk_flags?.can_execute_code),
    limitations: asArray(limitations),
    ...asObject(extra),
  };
}

function adversarialExtrasFromDeep(deep, extras = {}) {
  const d = asObject(deep);
  const tools = asArray(d.tools);
  const kbs = asArray(d.knowledgeBases);
  const instructionText =
    (typeof extras.instructionText === "string" && extras.instructionText) ||
    (typeof d.description === "string" ? d.description : "") ||
    "";

  return {
    tools,
    instructionText: instructionText || null,
    instructions: instructionText
      ? buildInstructionsFromText(
          instructionText,
          asObject(d.instructions).present
            ? d.deepScan || "provider_instructions"
            : "provider_description",
        )
      : undefined,
    roleArn: d.identity?.arn || extras.roleArn || null,
    permissions: asArray(extras.permissions),
    knowledgeBases: kbs,
    hasPii: extras.hasPii ?? null,
    hasPhi: extras.hasPhi ?? null,
    dataClasses: asArray(extras.dataClasses),
    internetAccess: extras.internetAccess ?? null,
    codeExecution: Boolean(d.codeInterpreter) || tools.some((t) => t.risk_flags?.can_execute_code),
    inboundTriggers: asArray(extras.inboundTriggers),
    evidence: asArray(extras.evidence).length
      ? asArray(extras.evidence)
      : [
          `Adversarial surface aligned from ${d.schemaVersion || "provider-deep"} (awsDeepCompatible=${AWS_DEEP_COMPAT})`,
          d.agentId ? `agentId=${d.agentId}` : null,
          `tools=${tools.length}`,
          `knowledgeBases=${kbs.length}`,
        ].filter(Boolean),
  };
}

/**
 * Stamp metadata.deep + adversarial_surface (+ status fields) onto an observation.
 * Skips if deep already present unless force=true.
 */
export function stampDeepAndAdversarial(observation, {
  deep,
  instructionText = null,
  extras = {},
  status = "ok",
  error = null,
  force = false,
} = {}) {
  if (!observation || typeof observation !== "object") return observation;
  const obs = { ...observation, metadata: { ...asObject(observation.metadata) } };

  if (obs.metadata.deep && !force && status === "ok") {
    if (!obs.metadata.adversarial_surface) {
      return attachAdversarialSurface(obs, adversarialExtrasFromDeep(obs.metadata.deep, {
        instructionText,
        ...extras,
      }));
    }
    return obs;
  }

  if (status !== "ok" || !deep) {
    obs.metadata.deepScan = deep?.deepScan || obs.metadata.deepScan || "provider_deep";
    obs.metadata.deepScanSchema = deep?.schemaVersion || obs.metadata.deepScanSchema || null;
    obs.metadata.deepScanStatus = status;
    obs.metadata.deepScanError = error || (status === "ok" ? null : "Deep enrichment unavailable");
    if (status === "ok" && deep) {
      obs.metadata.deep = deep;
      obs.metadata.deepScanError = null;
    }
    return attachAdversarialSurface(obs, {
      evidence: [
        ...(asArray(extras.evidence)),
        status !== "ok" ? `Deep scan status=${status}` : null,
      ].filter(Boolean),
      ...extras,
    });
  }

  // Drop non-enumerable / ephemeral instruction bodies if any
  const { _instructionFull: _drop, ...deepPersisted } = deep;
  obs.metadata.deep = deepPersisted;
  obs.metadata.deepScan = deep.deepScan;
  obs.metadata.deepScanSchema = deep.schemaVersion;
  obs.metadata.deepScanStatus = "ok";
  obs.metadata.deepScanError = null;
  obs.metadata.hasInstructions = Boolean(asObject(deep.instructions).present);
  obs.metadata.instructionSource = asObject(deep.instructions).source || null;
  obs.metadata.toolCount = asArray(deep.tools).length;
  obs.metadata.knowledgeBaseCount = asArray(deep.knowledgeBases).length;
  obs.metadata.evidence = [
    ...asArray(obs.metadata.evidence),
    `Deep scan: ${deep.deepScan} (${deep.schemaVersion}, awsDeepCompatible=${AWS_DEEP_COMPAT})`,
    asArray(deep.tools).length
      ? `Deep scan: ${asArray(deep.tools).length} tool(s)`
      : "Deep scan: no tools expanded",
  ];

  obs.tools = asArray(deep.tools).map((t) => ({
    name: t.name,
    description: t.description,
    parameters_schema: t.parameters_schema,
    risk_flags: t.risk_flags,
    source: t.source,
  }));

  return attachAdversarialSurface(
    obs,
    adversarialExtrasFromDeep(deep, { instructionText, ...extras }),
  );
}

/**
 * Enrich a confirmed agent observation from list-level signals (no extra API required).
 * Idempotent if deep already present.
 */
export function alignObservationWithDeepSurface(observation, signals = {}) {
  const obs = observation && typeof observation === "object" ? observation : null;
  if (!obs) return observation;

  const meta = asObject(obs.metadata);
  // Only align confirmed / platform agents — never invent deep for capability hints.
  const isAgent =
    meta.agentStatus === "confirmed" ||
    meta.inventoryClass === "platform_agent" ||
    meta.inventoryClass === "ai_cloud_agent" ||
    meta.managedPlatformAgent === true ||
    obs.agent?.detected === true;

  if (!isAgent) return obs;
  if (meta.deep && meta.adversarial_surface) return obs;

  const provider =
    signals.provider ||
    meta.platform ||
    obs.provider ||
    meta.cloud_provider ||
    "unknown";

  const schema = signals.schema || `${String(provider).replace(/[^a-z0-9]+/gi, "_").toLowerCase()}-deep.v1`;
  const deepScan = signals.deepScan || `${provider}_list_align`;

  const tools =
    signals.tools ||
    meta.agentConfig?.tools ||
    obs.tools ||
    meta.tools ||
    [];

  const instructionText =
    signals.instructionText ||
    signals.instructions ||
    meta.instructions ||
    meta.systemPrompt ||
    null;

  const deep = buildCompatibleDeepProfile({
    schema,
    deepScan,
    provider,
    agentId: signals.agentId || meta.agentId || obs.agent?.agentId || null,
    agentName: signals.agentName || obs.name || obs.agent?.agentName || null,
    agentType: signals.agentType || meta.agentType || obs.agent?.agentType || null,
    foundationModel: signals.foundationModel || obs.model || null,
    description: signals.description || meta.description || meta.shortDescription || null,
    instructionText,
    tools,
    knowledgeBases:
      signals.knowledgeBases ||
      meta.agentConfig?.knowledgeSources ||
      meta.knowledgeSources ||
      [],
    identity: signals.identity || {
      identity_type: provider === "azure" || meta.azureType ? "azure_managed_identity" : provider,
      note: "List-level alignment — no AWS-style execution role ARN collected.",
    },
    guardrails: signals.guardrails || null,
    access: signals.access || null,
    limitations: signals.limitations || [
      "Aligned from list/discovery payload; may lack Bedrock-equivalent GetAgent detail.",
      "Full instruction text is not persisted in metadata.deep (preview + hash only when present).",
    ],
    extra: signals.extra || {},
  });

  return stampDeepAndAdversarial(obs, {
    deep,
    instructionText,
    extras: {
      internetAccess: obs.internet_access ?? true,
      permissions: asArray(meta.agentAccess?.permissions),
      inboundTriggers: asArray(meta.agentConfig?.channels || meta.channels),
      evidence: [
        `Provider deep alignment for ${provider}`,
        meta.source ? `source=${meta.source}` : null,
      ].filter(Boolean),
      ...(signals.extras || {}),
    },
    status: "ok",
  });
}

/**
 * Map over observations and align confirmed agents that lack deep/adversarial.
 */
export function alignObservationsWithDeepSurface(observations, signalsFor = () => ({})) {
  return asArray(observations).map((obs) => {
    try {
      return alignObservationWithDeepSurface(obs, signalsFor(obs) || {});
    } catch {
      return obs;
    }
  });
}

export const __test = {
  normalizeAlignedTools,
  buildCompatibleDeepProfile,
  stampDeepAndAdversarial,
  alignObservationWithDeepSurface,
};
