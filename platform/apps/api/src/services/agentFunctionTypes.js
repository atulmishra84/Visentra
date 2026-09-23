/**
 * Functionality-based agent types for inventory and compliance scoping.
 * Distinct from provider agentType / inventoryClass (platform vs cloud vs IDE):
 * these labels describe what the agent does so controls can be prioritized later.
 */

/** @typedef {"conversational"|"rag_knowledge"|"code_execution"|"workflow_orchestration"|"identity_broker"|"data_access"|"tool_operator"|"platform_runtime"|"autonomous_operator"|"unknown"} AgentFunctionTypeId */

/**
 * @typedef {object} AgentFunctionType
 * @property {AgentFunctionTypeId} id
 * @property {string} label
 * @property {string} description
 * @property {string[]} complianceFocus  Built-in control ids most relevant to this function
 * @property {string} riskFamily
 */

/** @type {AgentFunctionType[]} */
export const AGENT_FUNCTION_TYPES = [
  {
    id: "conversational",
    label: "Conversational",
    description: "Chat, Q&A, bot, or copilot agents that interact with people through language.",
    complianceFocus: ["owasp_llm.LLM01", "owasp_llm.LLM07", "owasp_llm.LLM09"],
    riskFamily: "prompt_and_output"
  },
  {
    id: "rag_knowledge",
    label: "Knowledge / RAG",
    description: "Retrieves or grounds answers from knowledge bases, vector stores, or memory.",
    complianceFocus: ["owasp_llm.LLM04", "owasp_llm.LLM08", "owasp_llm.LLM02"],
    riskFamily: "data_and_retrieval"
  },
  {
    id: "code_execution",
    label: "Code execution",
    description: "Can run, evaluate, or generate executable code or shell commands.",
    complianceFocus: ["owasp_llm.LLM05", "owasp_llm.LLM06"],
    riskFamily: "execution"
  },
  {
    id: "workflow_orchestration",
    label: "Workflow / automation",
    description: "Multi-step automation, triggers, or orchestrated tool chains.",
    complianceFocus: ["owasp_llm.LLM06", "owasp_llm.LLM10", "nist.MANAGE_1"],
    riskFamily: "agency"
  },
  {
    id: "identity_broker",
    label: "Identity / access",
    description: "Acts as or brokers identity, directory, or agent-identity principals.",
    complianceFocus: ["hipaa.AC", "hipaa.IA", "nist.GOVERN_1"],
    riskFamily: "identity"
  },
  {
    id: "data_access",
    label: "Data access",
    description: "Primary function is reading or writing stores that may hold PII, PHI, or secrets.",
    complianceFocus: ["owasp_llm.LLM02", "hipaa.PHI_MIN", "hipaa.TR", "nist.MAP_2"],
    riskFamily: "sensitive_data"
  },
  {
    id: "tool_operator",
    label: "Tool operator",
    description: "Invokes tools, plugins, MCP servers, or connected applications.",
    complianceFocus: ["owasp_llm.LLM03", "owasp_llm.LLM06"],
    riskFamily: "agency"
  },
  {
    id: "platform_runtime",
    label: "Platform runtime",
    description: "Hosted agent platform or cloud runtime that defines agent workloads.",
    complianceFocus: ["owasp_llm.LLM03", "nist.MAP_1", "nist.MEASURE_1"],
    riskFamily: "supply_chain"
  },
  {
    id: "autonomous_operator",
    label: "Autonomous operator",
    description: "High-autonomy agent combining tools, egress, and/or code execution.",
    complianceFocus: ["owasp_llm.LLM06", "nist.MANAGE_1", "owasp_llm.LLM10"],
    riskFamily: "agency"
  },
  {
    id: "unknown",
    label: "Unclassified",
    description: "Functionality is not yet evidenced from discovery signals.",
    complianceFocus: ["nist.MAP_1"],
    riskFamily: "unknown"
  }
];

const TYPE_BY_ID = new Map(AGENT_FUNCTION_TYPES.map((t) => [t.id, t]));

/** Tie-break when scores match — more compliance-critical first. */
const PRIMARY_PRIORITY = [
  "autonomous_operator",
  "code_execution",
  "identity_broker",
  "rag_knowledge",
  "data_access",
  "workflow_orchestration",
  "tool_operator",
  "conversational",
  "platform_runtime",
  "unknown"
];

const MIN_SCORE = 2;

export function listFunctionTypes() {
  return AGENT_FUNCTION_TYPES.map((t) => ({ ...t }));
}

export function getFunctionType(id) {
  const hit = TYPE_BY_ID.get(String(id || ""));
  return hit ? { ...hit } : null;
}

export function functionTypeLabel(id) {
  return getFunctionType(id)?.label || String(id || "Unclassified");
}

function asList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return value
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [value];
}

function toolName(entry) {
  if (!entry) return "";
  if (typeof entry === "string") return entry;
  if (typeof entry === "object") {
    return String(entry.name || entry.type || entry.id || entry.tool || "").trim();
  }
  return String(entry);
}

function asBool(v) {
  if (v === true || v === false) return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

function metaOf(input) {
  return input?.metadata && typeof input.metadata === "object" ? input.metadata : {};
}

function collectBlob(input, meta) {
  return [
    input.name,
    input.framework,
    input.category,
    input.provider,
    input.deployment_type,
    input.execution_capability,
    meta.agentType,
    meta.azureType,
    meta.awsType,
    meta.gcpType,
    meta.inventoryClass,
    meta.evidenceClass,
    meta.platform,
    meta.platformLabel,
    meta.howIdentified,
    meta.discoveryType
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Classify an observation or agent row by discovered functionality.
 * Honors metadata.functionTypeOverride when it is a known type id.
 *
 * @returns {{
 *   functionType: AgentFunctionTypeId,
 *   functionTypeLabel: string,
 *   functionTypes: AgentFunctionTypeId[],
 *   functionTypeLabels: string[],
 *   functionTypeConfidence: "high"|"medium"|"low",
 *   functionTypeEvidence: string[],
 *   complianceFocus: string[],
 *   riskFamilies: string[]
 * }}
 */
export function classifyAgentFunction(input = {}) {
  const meta = metaOf(input);
  const override = String(meta.functionTypeOverride || meta.functionTypeManual || "").trim();
  if (override && TYPE_BY_ID.has(override)) {
    return buildClassification([override], "high", ["operator_override"], {
      [override]: ["operator_override"]
    });
  }

  const access = input.agentAccess || meta.agentAccess || {};
  const config = input.agentConfig || meta.agentConfig || {};
  const dac = input.dataAccessClassification || meta.dataAccessClassification || {};
  const adv = meta.adversarial_surface && typeof meta.adversarial_surface === "object" ? meta.adversarial_surface : {};
  const deep = meta.deep && typeof meta.deep === "object" ? meta.deep : {};

  const tools = [
    ...asList(input.tools),
    ...asList(config.tools),
    ...asList(meta.tools),
    ...asList(deep.tools),
    ...asList(adv.tools)
  ];
  const toolNames = tools.map(toolName).filter(Boolean);
  const toolBlob = toolNames.join(" ").toLowerCase();
  const mcp = [
    ...asList(input.mcp_connections),
    ...asList(config.mcpServers),
    ...asList(meta.mcpConnections)
  ];
  const knowledge = [
    ...asList(config.knowledgeSources),
    ...asList(meta.knowledgeSources),
    ...asList(meta.knowledgeBases),
    ...asList(deep.knowledgeBases),
    ...asList(adv.memory_and_context?.knowledge_bases)
  ];
  const vectors = [
    input.vector_database,
    config.vectorStores,
    meta.vectorDatabase,
    meta.vectorStore,
    ...asList(config.vectorStores)
  ].filter(Boolean);
  const memory = [
    input.memory_store,
    ...asList(config.memoryStores),
    meta.memoryStore,
    adv.memory_and_context?.has_memory === true ? "memory" : null
  ].filter(Boolean);
  const triggers = [...asList(config.triggers), ...asList(meta.triggers), ...asList(meta.automations)];
  const channels = [...asList(config.channels), ...asList(meta.channels)].map((c) => String(c).toLowerCase());
  const granted = asList(access.granted || meta.granted);
  const scopes = access.scopes && typeof access.scopes === "object" ? access.scopes : {};

  const agentType = String(meta.agentType || input.agentType || "").toLowerCase();
  const category = String(input.category || meta.category || "").toLowerCase();
  const inventoryClass = String(meta.inventoryClass || "").toLowerCase();
  const evidenceClass = String(meta.evidenceClass || "").toLowerCase();
  const blob = collectBlob(input, meta);

  const internet =
    asBool(input.internet_access) === true ||
    asBool(access.internet) === true ||
    scopes.internet === true ||
    adv.connectivity?.internet_access === true;
  const codeExecution =
    asBool(input.code_execution) === true ||
    adv.connectivity?.code_execution === true ||
    /code.?exec|code.?interpreter|python|shell|bash|powershell|eval/i.test(toolBlob) ||
    tools.some((t) => t?.risk_flags?.can_execute_code) ||
    /code.?exec|interpreter/i.test(String(input.execution_capability || ""));
  const hasPhi =
    asBool(dac.hasPhi) === true ||
    asBool(meta.hasPhi) === true ||
    String(dac.primaryDataClass || meta.primaryDataClass || "").toLowerCase() === "phi";
  const hasPii =
    asBool(dac.hasPii) === true ||
    asBool(meta.hasPii) === true ||
    ["pii", "phi"].includes(String(dac.primaryDataClass || meta.primaryDataClass || "").toLowerCase());
  const dbOrFiles =
    asBool(input.database_access) === true ||
    asBool(input.filesystem_access) === true ||
    scopes.database === true ||
    scopes.filesystem === true ||
    granted.includes("database") ||
    granted.includes("filesystem") ||
    granted.includes("sharepoint") ||
    granted.includes("vectorStore");

  const scores = new Map();
  const evidence = new Map();
  const bump = (id, points, reason) => {
    if (!TYPE_BY_ID.has(id) || id === "unknown") return;
    scores.set(id, (scores.get(id) || 0) + points);
    const list = evidence.get(id) || [];
    if (reason && !list.includes(reason)) list.push(reason);
    evidence.set(id, list);
  };

  if (
    category === "identity" ||
    /entra_agent_identity|agent.?identity|identity_broker|directory/i.test(agentType) ||
    /identity/.test(inventoryClass) ||
    /agent.?identity|entra.?agent.?id/.test(blob)
  ) {
    bump("identity_broker", 6, agentType || category || "identity_signal");
  }
  if (meta.objectId && /agent.?identity|entra/i.test(blob)) {
    bump("identity_broker", 3, "entra_object");
  }

  if (codeExecution) {
    bump("code_execution", 6, "code_execution_capability");
  }
  if (/function_app|code_interpreter|sandbox/i.test(agentType) || /code.?interpreter/.test(blob)) {
    bump("code_execution", 3, agentType || "code_runtime");
  }

  if (knowledge.length || vectors.length || memory.length) {
    bump(
      "rag_knowledge",
      knowledge.length ? 6 : 4,
      knowledge.length ? `knowledge:${knowledge.length}` : vectors.length ? "vector_store" : "memory"
    );
  }
  if (/rag|retriev|knowledge|vector|embedding|discovery.?engine/i.test(`${agentType} ${blob}`)) {
    bump("rag_knowledge", 4, "rag_label");
  }

  if (triggers.length || /workflow|orchestr|automate|logic.?app|step.?function|n8n|langgraph|agent.?core/i.test(`${agentType} ${blob}`)) {
    bump("workflow_orchestration", triggers.length ? 5 : 4, triggers.length ? `triggers:${triggers.length}` : "workflow_label");
  }
  if (/function_app_workload|copilot_studio/i.test(agentType) && triggers.length) {
    bump("workflow_orchestration", 2, "studio_triggers");
  }

  if (hasPhi || (hasPii && dbOrFiles) || (dbOrFiles && (granted.includes("secrets") || scopes.secrets))) {
    bump("data_access", hasPhi ? 6 : 4, hasPhi ? "phi" : hasPii ? "pii_store" : "sensitive_store");
  } else if (dbOrFiles) {
    bump("data_access", 2, "store_access");
  }

  if (toolNames.length || mcp.length) {
    bump("tool_operator", toolNames.length >= 3 ? 5 : 3, toolNames.length ? `tools:${toolNames.length}` : `mcp:${mcp.length}`);
  }
  if (/mcp|plugin|tool.?calling|function.?call/i.test(blob)) {
    bump("tool_operator", 2, "tool_platform");
  }

  if (
    /assistant|chat|bot|copilot|dialogflow|teams_app|copilot_studio|azure_bot/i.test(agentType) ||
    /bot|copilot|assistant|dialogflow|webchat/.test(blob) ||
    channels.some((c) => /teams|slack|chat|webchat|msteams|copilot/.test(c))
  ) {
    bump("conversational", 5, agentType || channels[0] || "conversational_label");
  }
  if (asBool(config.instructionsPresent) === true || asBool(meta.hasInstructions) === true) {
    bump("conversational", 2, "instructions");
  }

  if (
    /platform_agent|ai_cloud_agent|ai_cloud_resource/.test(inventoryClass) ||
    /platform_agent|cloud_ai_runtime/.test(evidenceClass) ||
    /bedrock|foundry|vertex|hosted|container_app|aks_deployment|vm_workload|cloud_run/i.test(`${agentType} ${blob}`)
  ) {
    bump("platform_runtime", 3, inventoryClass || evidenceClass || agentType || "cloud_runtime");
  }

  const agencyScore =
    (toolNames.length ? 1 : 0) + (internet ? 1 : 0) + (codeExecution ? 1 : 0) + (asBool(access.overPermissioned) === true ? 1 : 0);
  if (agencyScore >= 3 || /autonomous/.test(`${category} ${blob}`)) {
    bump("autonomous_operator", 5, `agency_combo:${agencyScore}`);
  }

  const matched = [...scores.entries()]
    .filter(([, score]) => score >= MIN_SCORE)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return PRIMARY_PRIORITY.indexOf(a[0]) - PRIMARY_PRIORITY.indexOf(b[0]);
    })
    .map(([id]) => id);

  const topScore = matched.length ? scores.get(matched[0]) || 0 : 0;
  const confidence = topScore >= 6 ? "high" : topScore >= 4 ? "medium" : matched.length ? "low" : "low";
  const evidenceFlat = matched.flatMap((id) => evidence.get(id) || []);
  const evidenceMap = Object.fromEntries(matched.map((id) => [id, evidence.get(id) || []]));

  return buildClassification(matched, confidence, evidenceFlat, evidenceMap);
}

function buildClassification(matchedIds, confidence, evidenceFlat, evidenceMap) {
  const ids = matchedIds.length ? matchedIds : ["unknown"];
  const primary = ids[0];
  const types = ids.map((id) => TYPE_BY_ID.get(id)).filter(Boolean);
  const focus = [...new Set(types.flatMap((t) => t.complianceFocus || []))];
  const families = [...new Set(types.map((t) => t.riskFamily).filter(Boolean))];
  return {
    functionType: primary,
    functionTypeLabel: functionTypeLabel(primary),
    functionTypes: ids,
    functionTypeLabels: ids.map(functionTypeLabel),
    functionTypeConfidence: confidence,
    functionTypeEvidence: [...new Set(evidenceFlat)].slice(0, 12),
    functionTypeEvidenceByType: evidenceMap || {},
    complianceFocus: focus,
    riskFamilies: families
  };
}

/** Flatten classification onto metadata for persist + API consumers. */
export function functionClassificationMeta(classified) {
  const c = classified || classifyAgentFunction({});
  return {
    functionType: c.functionType,
    functionTypes: c.functionTypes,
    functionTypeLabel: c.functionTypeLabel,
    functionTypeLabels: c.functionTypeLabels,
    functionTypeConfidence: c.functionTypeConfidence,
    functionTypeEvidence: c.functionTypeEvidence,
    functionClassification: c
  };
}

/** Controls whose relevantFunctionTypes intersect the agent's function types. */
export function controlsForFunctionTypes(controls, functionTypes) {
  const set = new Set((functionTypes || []).map(String));
  if (!set.size || set.has("unknown")) return controls;
  return (controls || []).filter((control) => {
    const relevant = control.relevantFunctionTypes;
    if (!Array.isArray(relevant) || !relevant.length) return true;
    return relevant.some((id) => set.has(id));
  });
}
