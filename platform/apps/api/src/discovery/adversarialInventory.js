/**
 * Adversarial-testing inventory model for agentic red teaming.
 *
 * Designed as attack-surface input for AgentBreaker / SIRAJ / DeepTeam / PyRIT style
 * frameworks and aligned with OWASP LLM Top 10 (2025/26) + Agentic ASI01–ASI10 themes:
 * tool misuse, prompt injection, over-permissioned identity, sensitive data reach,
 * memory/KB poisoning surfaces, and unsafe connectivity.
 *
 * Partial data is expected — every block carries confidence + evidence when possible.
 * Secrets/values are never stored; only names, hashes, and redacted previews.
 */

import crypto from "crypto";

export const ADVERSARIAL_SCHEMA_VERSION = "1.0.0";

export const ASSET_CATEGORIES = [
  "agent",
  "ai_resource",
  "tool",
  "knowledge_base",
  "model_endpoint",
  "mcp_server",
  "runtime",
  "unknown"
];

/** Empty P0 tool record — always include keys for consumers. */
export function emptyTool(overrides = {}) {
  return {
    name: null,
    description: null,
    parameters_schema: null,
    permissions: [],
    risk_flags: {
      can_execute_code: false,
      can_access_pii: false,
      can_access_phi: false,
      can_modify_state: false,
      can_call_external_apis: false,
      can_access_filesystem: false,
      can_access_secrets: false
    },
    source: null,
    confidence: "low",
    evidence: [],
    ...overrides
  };
}

export function emptyInstructions(overrides = {}) {
  return {
    present: false,
    source: null,
    hash: null,
    length: null,
    preview: null,
    contains_tool_guidance: null,
    contains_safety_rules: null,
    confidence: "low",
    evidence: [],
    ...overrides
  };
}

export function emptyIdentityAndAccess(overrides = {}) {
  return {
    identity_type: null,
    name: null,
    arn: null,
    permissions: [],
    over_permissioned: null,
    credential_exposure_risk: "unknown",
    confidence: "low",
    evidence: [],
    ...overrides
  };
}

export function emptyDataAccess(overrides = {}) {
  return {
    has_pii: null,
    has_phi: null,
    data_classes: [],
    data_stores: [],
    confidence: "low",
    evidence: [],
    ...overrides
  };
}

export function emptyMcpServer(overrides = {}) {
  return {
    name: null,
    endpoint: null,
    tools_exposed: [],
    auth: { type: null, details_present: false },
    confidence: "low",
    evidence: [],
    ...overrides
  };
}

export function emptyMemoryAndContext(overrides = {}) {
  return {
    has_memory: null,
    memory_type: null,
    vector_stores: [],
    knowledge_bases: [],
    confidence: "low",
    evidence: [],
    ...overrides
  };
}

export function emptyConnectivity(overrides = {}) {
  return {
    internet_access: null,
    filesystem_access: null,
    code_execution: null,
    browser_access: null,
    email_access: null,
    slack_access: null,
    github_access: null,
    database_access: null,
    inbound_triggers: [],
    confidence: "low",
    evidence: [],
    ...overrides
  };
}

/**
 * Canonical empty adversarial surface — all P0/P1/P2 keys present.
 */
export function emptyAdversarialSurface(overrides = {}) {
  return {
    schema_version: ADVERSARIAL_SCHEMA_VERSION,
    // Classification
    agent_detected: false,
    category: "unknown",
    confidence_score: 0,
    evidence: [],
    // P0
    tools: [],
    instructions: emptyInstructions(),
    identity_and_access: emptyIdentityAndAccess(),
    data_access: emptyDataAccess(),
    // P1
    mcp_servers: [],
    memory_and_context: emptyMemoryAndContext(),
    connectivity: emptyConnectivity(),
    // P2
    platform: {
      provider: null,
      cloud_provider: null,
      region: null,
      framework: null,
      service: null,
      resource_id: null,
      account_id: null
    },
    model: {
      name: null,
      provider: null,
      foundation_model: null
    },
    risk_indicators: [],
    observability: {
      guardrails_detected: null,
      guardrail_id: null,
      logging_detected: null,
      evidence: []
    },
    ownership: {
      owner: null,
      shadow_ai: null,
      ownership_status: null
    },
    owasp_hints: {
      llm_top10: [],
      agentic_asi: []
    },
    ...overrides
  };
}

export function hashText(value) {
  if (!value) return null;
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

export function instructionPreview(text, max = 280) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Heuristic risk flags from tool name/description/schema text (no secret values). */
export function inferToolRiskFlags({ name, description, parameters_schema, source } = {}) {
  const blob = [name, description, source, JSON.stringify(parameters_schema || {})]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return {
    can_execute_code: /code|exec|shell|bash|python|lambda|interpreter|eval|run_command/.test(blob),
    can_access_pii: /pii|email|ssn|phone|customer|crm|profile|user.?data/.test(blob),
    can_access_phi: /phi|hipaa|ehr|fhir|patient|medical|health/.test(blob),
    can_modify_state: /write|update|delete|create|put|post|patch|mutate|send|invoke/.test(blob),
    can_call_external_apis: /\b(http|https|webhook|url|internet|external.?api|openapi)\b/.test(blob),
    can_access_filesystem: /file|s3|filesystem|path|bucket|download|upload/.test(blob),
    can_access_secrets: /secret|token|password|credential|key.?vault|kms/.test(blob)
  };
}

/**
 * Map Bedrock functionSchema / apiSchema into tools[].
 * Never includes Lambda env values or secrets.
 */
export function toolsFromBedrockActionGroup(actionGroup = {}) {
  const tools = [];
  const groupName = actionGroup.actionGroupName || actionGroup.actionGroupId || "action_group";
  const description = actionGroup.description || null;
  const source = `bedrock_action_group:${groupName}`;
  const executor = actionGroup.actionGroupExecutor || {};
  const lambdaArn = executor.lambda || null;
  const parentSig = actionGroup.parentActionSignature || actionGroup.parentActionGroupSignature || null;

  if (parentSig) {
    const name = String(parentSig);
    tools.push(
      emptyTool({
        name,
        description: description || `Bedrock built-in action group (${name})`,
        parameters_schema: null,
        permissions: lambdaArn ? [`invoke:${lambdaArn}`] : [],
        risk_flags: inferToolRiskFlags({ name, description, source: parentSig }),
        source,
        confidence: "high",
        evidence: [`GetAgentActionGroup parentActionSignature=${name}`]
      })
    );
  }

  const functions = actionGroup.functionSchema?.functions || actionGroup.functionSchema?.Functions || [];
  for (const fn of functions) {
    const name = fn.name || fn.Name || `${groupName}_fn`;
    const desc = fn.description || fn.Description || description;
    const parameters = fn.parameters || fn.Parameters || null;
    // Normalize to a lightweight JSON-schema-ish object when possible
    let parameters_schema = null;
    if (parameters && typeof parameters === "object") {
      parameters_schema = {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(parameters).map(([key, spec]) => [
            key,
            {
              type: spec?.type || spec?.Type || "string",
              description: spec?.description || spec?.Description || null,
              required: Boolean(spec?.required ?? spec?.Required)
            }
          ])
        )
      };
    }
    tools.push(
      emptyTool({
        name,
        description: desc,
        parameters_schema,
        permissions: lambdaArn ? [`invoke:${lambdaArn}`] : [],
        risk_flags: inferToolRiskFlags({ name, description: desc, parameters_schema, source }),
        source,
        confidence: parameters_schema ? "high" : "medium",
        evidence: [
          `Bedrock action group function ${name}`,
          lambdaArn ? `Executor Lambda present` : "No Lambda executor listed"
        ]
      })
    );
  }

  // OpenAPI payload present but not expanded — still signal attack surface
  if (actionGroup.apiSchema && !functions.length && !parentSig) {
    const payload = actionGroup.apiSchema.payload || actionGroup.apiSchema.s3 || null;
    tools.push(
      emptyTool({
        name: `${groupName}_openapi`,
        description: description || "OpenAPI-defined action group",
        parameters_schema: typeof payload === "object" ? { openapi_ref: true } : null,
        permissions: lambdaArn ? [`invoke:${lambdaArn}`] : [],
        risk_flags: inferToolRiskFlags({
          name: groupName,
          description,
          source: "openapi"
        }),
        source,
        confidence: "medium",
        evidence: ["Bedrock action group exposes apiSchema (OpenAPI)"]
      })
    );
  }

  if (!tools.length) {
    tools.push(
      emptyTool({
        name: groupName,
        description,
        permissions: lambdaArn ? [`invoke:${lambdaArn}`] : [],
        risk_flags: inferToolRiskFlags({ name: groupName, description, source }),
        source,
        confidence: "low",
        evidence: ["Action group listed; function/API schema not expanded"]
      })
    );
  }

  return tools;
}

export function buildInstructionsFromText(text, source = "bedrock_get_agent") {
  const raw = String(text || "");
  if (!raw.trim()) {
    return emptyInstructions({
      present: false,
      source: null,
      confidence: "high",
      evidence: ["No instruction field returned by API"]
    });
  }
  const lower = raw.toLowerCase();
  return emptyInstructions({
    present: true,
    source,
    hash: hashText(raw),
    length: raw.length,
    preview: instructionPreview(raw),
    contains_tool_guidance: /tool|action group|function|api|use the|when calling/.test(lower),
    contains_safety_rules: /must not|do not|never|refuse|policy|guardrail|safety|harmless|illegal/.test(lower),
    confidence: "high",
    evidence: [`Instruction captured from ${source} (hash only + preview; full text not stored long-term beyond preview)`]
  });
}

/**
 * Derive OWASP-oriented attack-surface hints from populated P0/P1 fields.
 * Hints are advisory tags for red-team prioritization — not vulnerability findings.
 */
export function deriveOwaspHints(surface) {
  const llm = new Set();
  const asi = new Set();
  const tools = surface.tools || [];
  const risky = tools.some((t) => Object.values(t.risk_flags || {}).some(Boolean));
  if (tools.length) {
    llm.add("LLM01_PromptInjection"); // tool-using agents amplify injection → tool misuse
    asi.add("ASI01_AgentGoalHijack");
    asi.add("ASI02_ToolMisuse");
  }
  if (risky) {
    llm.add("LLM06_ExcessiveAgency");
    asi.add("ASI05_UnexpectedCodeExecution");
  }
  if (surface.instructions?.present) {
    llm.add("LLM01_PromptInjection");
    if (surface.instructions.contains_safety_rules === false) llm.add("LLM02_SensitiveInfoDisclosure");
  }
  if (surface.data_access?.has_pii || surface.data_access?.has_phi) {
    llm.add("LLM02_SensitiveInfoDisclosure");
    asi.add("ASI04_DataExfiltration");
  }
  if (surface.identity_and_access?.over_permissioned) {
    llm.add("LLM06_ExcessiveAgency");
    asi.add("ASI03_PrivilegeCompromise");
  }
  if (surface.memory_and_context?.knowledge_bases?.length || surface.memory_and_context?.has_memory) {
    llm.add("LLM08_VectorAndEmbeddingWeaknesses");
    asi.add("ASI06_MemoryAndContextPoisoning");
  }
  if (surface.connectivity?.internet_access || surface.connectivity?.code_execution) {
    llm.add("LLM06_ExcessiveAgency");
    asi.add("ASI08_CascadingFailures");
  }
  if (surface.observability?.guardrails_detected === false) {
    llm.add("LLM09_Misinformation");
    asi.add("ASI10_InsufficientSafetyAlignment");
  }
  return {
    llm_top10: [...llm],
    agentic_asi: [...asi]
  };
}

export function collectRiskIndicators(surface) {
  const risks = [];
  for (const t of surface.tools || []) {
    const f = t.risk_flags || {};
    if (f.can_execute_code) risks.push(`tool_code_exec:${t.name}`);
    if (f.can_access_phi) risks.push(`tool_phi:${t.name}`);
    if (f.can_access_pii) risks.push(`tool_pii:${t.name}`);
    if (f.can_access_secrets) risks.push(`tool_secrets:${t.name}`);
    if (f.can_modify_state) risks.push(`tool_state_change:${t.name}`);
  }
  if (surface.identity_and_access?.over_permissioned) risks.push("over_permissioned_identity");
  if (surface.identity_and_access?.credential_exposure_risk === "high") {
    risks.push("credential_exposure_risk");
  }
  if (surface.data_access?.has_phi) risks.push("phi_reach");
  if (surface.data_access?.has_pii) risks.push("pii_reach");
  if (surface.connectivity?.code_execution) risks.push("code_execution_capability");
  if (surface.connectivity?.internet_access) risks.push("internet_egress");
  if (surface.instructions?.present && surface.instructions.contains_safety_rules === false) {
    risks.push("instructions_without_detected_safety_rules");
  }
  if (surface.observability?.guardrails_detected === false) risks.push("no_guardrail_detected");
  if (surface.ownership?.shadow_ai) risks.push("shadow_ai");
  return [...new Set(risks)].slice(0, 40);
}

/**
 * Classify inventory category for red-team consumers.
 */
export function classifyAdversarialCategory(obs = {}) {
  const meta = obs.metadata || {};
  const awsType = String(meta.awsType || obs.framework || "");
  const agentDetected =
    obs.agent?.detected === true ||
    meta.agentDetected === true ||
    meta.agentStatus === "confirmed" ||
    meta.inventoryClass === "ai_cloud_agent";

  if (/BedrockKnowledgeBase/i.test(awsType)) {
    return {
      agent_detected: false,
      category: "knowledge_base",
      evidence: ["AWS type BedrockKnowledgeBase is an AI resource / retrieval store, not an agent"]
    };
  }
  if (/SageMakerEndpoint/i.test(awsType)) {
    return {
      agent_detected: false,
      category: "model_endpoint",
      evidence: ["SageMaker endpoint is model-serving infrastructure, not an agent"]
    };
  }
  if (/BedrockAgent/i.test(awsType) || (agentDetected && meta.agentDetectionMethod === "bedrock_agents_api")) {
    return {
      agent_detected: true,
      category: "agent",
      evidence: ["Official Bedrock Agents API inventory"]
    };
  }
  if (/LambdaFunction|EcsService/i.test(awsType)) {
    return {
      agent_detected: Boolean(obs.agent?.detected || meta.agentDetected),
      category: "runtime",
      evidence: ["Heuristic compute workload — candidate runtime, not confirmed agent unless correlated"]
    };
  }
  if (agentDetected) {
    return { agent_detected: true, category: "agent", evidence: ["agent.detected=true on observation"] };
  }
  if (meta.aiRelevant) {
    return {
      agent_detected: false,
      category: "ai_resource",
      evidence: ["AI-relevant resource without confirmed agent detection"]
    };
  }
  return { agent_detected: false, category: "unknown", evidence: ["Insufficient classification signals"] };
}

/**
 * Build adversarial_surface from an AWS (or generic) observation + optional deep details.
 */
export function buildAdversarialSurface(obs = {}, extras = {}) {
  const meta = obs.metadata && typeof obs.metadata === "object" ? obs.metadata : {};
  const classification = classifyAdversarialCategory(obs);
  const tools = Array.isArray(extras.tools) ? extras.tools : Array.isArray(meta.adversarialTools) ? meta.adversarialTools : [];
  let instructions = extras.instructions || null;
  if (!instructions) {
    if (extras.instructionText) {
      instructions = buildInstructionsFromText(extras.instructionText, "bedrock_get_agent");
    } else if (meta.deep?.instructionPreview) {
      instructions = buildInstructionsFromText(
        meta.deep.instructionPreview,
        "bedrock_get_agent_preview"
      );
      instructions.confidence = "medium";
      instructions.evidence = [
        ...(instructions.evidence || []),
        "Built from instruction preview only — full text may be truncated"
      ];
    } else {
      instructions = emptyInstructions({
        present: false,
        confidence: meta.deepScan ? "medium" : "low",
        evidence: meta.deepScan
          ? ["Deep scan ran but no instruction text available"]
          : ["Instruction not collected yet"]
      });
    }
  }

  const roleArn =
    extras.roleArn ||
    meta.deep?.agentResourceRoleArn ||
    meta.deep?.role ||
    null;

  const identity_and_access = emptyIdentityAndAccess({
    identity_type: roleArn ? "aws_iam_role" : obs.identity_used ? "principal" : null,
    name: roleArn ? roleArn.split("/").pop() : obs.identity_used || null,
    arn: roleArn,
    permissions: Array.isArray(extras.permissions) ? extras.permissions : [],
    over_permissioned: extras.overPermissioned ?? null,
    credential_exposure_risk: Array.isArray(meta.envNames)
      ? meta.envNames.some((n) => /secret|token|key|password|credential/i.test(n))
        ? "medium"
        : "low"
      : "unknown",
    confidence: roleArn ? "medium" : "low",
    evidence: roleArn
      ? ["IAM role ARN from Bedrock GetAgent / Lambda configuration (policy documents not expanded)"]
      : ["No execution role discovered"]
  });

  const kbList = extras.knowledgeBases || meta.agentKnowledgeBases || [];
  const memory_and_context = emptyMemoryAndContext({
    has_memory: kbList.length > 0 || Boolean(obs.memory_store || obs.vector_database) ? true : classification.category === "agent" ? false : null,
    memory_type: kbList.length ? "knowledge_base_retrieval" : obs.memory_store || null,
    vector_stores: obs.vector_database
      ? [{ name: obs.vector_database, sensitivity: "unknown", access_level: "unknown" }]
      : [],
    knowledge_bases: kbList.map((kb) => ({
      id: kb.knowledgeBaseId || kb.id || null,
      name: kb.name || kb.knowledgeBaseId || null,
      state: kb.knowledgeBaseState || kb.status || null,
      sensitivity: "unknown",
      access_level: "read",
      evidence: ["Associated via ListAgentKnowledgeBases / account KB inventory"]
    })),
    confidence: kbList.length ? "high" : "low",
    evidence: kbList.length
      ? [`${kbList.length} knowledge base association(s) discovered`]
      : ["No memory/KB associations discovered"]
  });

  const data_access = emptyDataAccess({
    has_pii: extras.hasPii ?? meta.hasPii ?? null,
    has_phi: extras.hasPhi ?? meta.hasPhi ?? null,
    data_classes: extras.dataClasses || meta.dataClasses || [],
    data_stores: memory_and_context.knowledge_bases.map((kb) => ({
      name: kb.name || kb.id,
      type: "knowledge_base",
      sensitivity: kb.sensitivity,
      access_level: kb.access_level
    })),
    confidence: extras.hasPii != null || extras.hasPhi != null ? "medium" : "low",
    evidence:
      extras.hasPii != null || extras.hasPhi != null
        ? ["Data classification from enrichment signals"]
        : [
            "PII/PHI not inferred from content; set when KB/tool/IAM signals indicate sensitive reach"
          ]
  });

  const connectivity = emptyConnectivity({
    internet_access: extras.internetAccess ?? obs.internet_access ?? null,
    filesystem_access: extras.filesystemAccess ?? obs.filesystem_access ?? null,
    code_execution:
      extras.codeExecution ??
      tools.some((t) => t.risk_flags?.can_execute_code) ??
      null,
    browser_access: obs.browser_access ?? null,
    email_access: obs.email_access ?? null,
    slack_access: obs.slack_access ?? null,
    github_access: obs.github_access ?? null,
    database_access: obs.database_access ?? null,
    inbound_triggers: extras.inboundTriggers || meta.aliases || [],
    confidence: tools.length || roleArn ? "medium" : "low",
    evidence: [
      tools.some((t) => t.risk_flags?.can_execute_code)
        ? "Code execution inferred from tool risk flags"
        : "Connectivity mostly unknown without deeper IAM/tool policy expansion"
    ]
  });

  const guardrail =
    meta.deep?.guardrailConfiguration ||
    extras.guardrailConfiguration ||
    meta.guardrailConfiguration ||
    null;

  const surface = emptyAdversarialSurface({
    agent_detected: classification.agent_detected,
    category: classification.category,
    confidence_score: Number(obs.confidence_score) || 0,
    evidence: [
      ...(classification.evidence || []),
      ...(Array.isArray(meta.evidence) ? meta.evidence : []),
      ...(extras.evidence || [])
    ].filter(Boolean).slice(0, 30),
    tools,
    instructions,
    identity_and_access,
    data_access,
    mcp_servers: extras.mcpServers || [],
    memory_and_context,
    connectivity,
    platform: {
      provider: obs.provider || null,
      cloud_provider: obs.cloud_provider || null,
      region: obs.region || meta.region || null,
      framework: obs.framework || null,
      service: meta.awsService || null,
      resource_id: obs.endpoint || meta.resourceId || null,
      account_id: meta.accountId || null
    },
    model: {
      name: obs.model || null,
      provider: obs.cloud_provider || obs.provider || null,
      foundation_model: meta.foundationModel || meta.deep?.foundationModel || obs.model || null
    },
    observability: {
      guardrails_detected: guardrail ? true : guardrail === null ? null : false,
      guardrail_id: guardrail?.guardrailIdentifier || guardrail?.guardrailId || null,
      logging_detected: null,
      evidence: guardrail
        ? ["Guardrail configuration present on Bedrock agent"]
        : ["No guardrail configuration discovered on resource"]
    },
    ownership: {
      owner: obs.owner || null,
      shadow_ai: meta.shadowAi === true,
      ownership_status: meta.ownershipStatus || (obs.owner ? "attributed" : "unknown")
    }
  });

  surface.risk_indicators = collectRiskIndicators(surface);
  surface.owasp_hints = deriveOwaspHints(surface);
  return surface;
}

/**
 * Attach adversarial_surface onto observation metadata + promote tools for ingest columns.
 */
export function attachAdversarialSurface(obs, extras = {}) {
  const surface = buildAdversarialSurface(obs, extras);
  const toolNames = surface.tools.map((t) => t.name).filter(Boolean);
  return {
    ...obs,
    // Promote for agents.tools JSONB column (names + rich objects when available)
    tools: surface.tools.length
      ? surface.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters_schema: t.parameters_schema,
          risk_flags: t.risk_flags,
          source: t.source
        }))
      : obs.tools || [],
    internet_access: surface.connectivity.internet_access ?? obs.internet_access,
    filesystem_access: surface.connectivity.filesystem_access ?? obs.filesystem_access,
    browser_access: surface.connectivity.browser_access ?? obs.browser_access,
    risk_indicators: [
      ...new Set([...(obs.risk_indicators || []), ...surface.risk_indicators])
    ].slice(0, 40),
    metadata: {
      ...(obs.metadata || {}),
      adversarial_surface: surface,
      agent_detected: surface.agent_detected,
      adversarial_category: surface.category,
      // Keep legacy fields in sync
      agentDetected: surface.agent_detected,
      hasInstructions: surface.instructions.present,
      instructionsHash: surface.instructions.hash,
      instructionSource: surface.instructions.source,
      instructionPreview: surface.instructions.preview
    }
  };
}
