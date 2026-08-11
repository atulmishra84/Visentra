/**
 * Shared AI-agent relevance filters for discovery collectors.
 * Default posture: AI agents / AI workloads only (DISCOVERY_AI_ONLY=true).
 */

export const DISCOVERY_AI_ONLY = String(process.env.DISCOVERY_AI_ONLY || "true").toLowerCase() !== "false";

/** Text / name / label signals for AI agents and AI workloads. */
export const AI_TEXT_RE =
  /(^|[-_\s/.:])(ai|ml|llm|gpt|agent|assistant|copilot|bedrock|openai|anthropic|claude|langchain|langgraph|crewai|autogen|llama|ollama|vllm|gemini|vertex|foundry|mcp|cursor|genai|rag|embedding|vector|sagemaker|cognitive|bot|illuminate|agentforce|now.?assist|dialogflow|agent.?builder|windsurf|aider|continue|n8n|semantic.?kernel|open.?interpreter|chatgpt|custom.?gpt)([-_\s/.:]|$)/i;

/** Process / cmdline signals for IDE agents and local AI runtimes. */
export const AI_AGENT_PROCESS_RE =
  /ollama|langgraph|crewai|autogen|vllm|openai|anthropic|claude|cursor-agent|\bcursor\b|copilot|chatgpt|gemini|bedrock|langchain|mcp-server|@modelcontextprotocol|continue\.dev|\baider\b|windsurf|open-interpreter|semantic.?kernel|botframework|power.?virtual|agentforce|npx\s+.*mcp|jenkins|dialogflow|foundry|codeium|tabnine|amazon.?q|aws.?q|github.?copilot|copilot-language-server|claude-code|aider|n8n|openinterpreter|lmstudio|llama\.cpp|llama-server|text-generation-webui/i;

/** Shared process-query terms for EDR advanced hunting / process APIs. */
export const AI_PROCESS_QUERY_TERMS = [
  "ollama",
  "claude",
  "copilot",
  "langchain",
  "langgraph",
  "crewai",
  "autogen",
  "vllm",
  "openai",
  "chatgpt",
  "mcp",
  "cursor",
  "aider",
  "windsurf",
  "continue",
  "bedrock",
  "semantic-kernel",
  "open-interpreter",
  "n8n",
  "lmstudio"
];

export function isAiRelevantText(...parts) {
  return AI_TEXT_RE.test(parts.filter(Boolean).join(" "));
}

export function isAiAgentProcess(text) {
  return AI_AGENT_PROCESS_RE.test(String(text || ""));
}

/**
 * Azure resource types that are always AI / agent platforms.
 * Ambiguous compute (apps, AKS, sites) must also match name/tag/kind signals.
 */
export const AZURE_AI_TYPE_ALWAYS = [
  "Microsoft.CognitiveServices/accounts",
  "Microsoft.CognitiveServices/accounts/projects",
  "Microsoft.MachineLearningServices/workspaces",
  "Microsoft.BotService/botServices",
  "Microsoft.Search/searchServices",
  "Microsoft.MachineLearningServices/workspaces/onlineEndpoints",
  "Microsoft.MachineLearningServices/workspaces/batchEndpoints",
  "Microsoft.MachineLearningServices/workspaces/computes",
  "Microsoft.MachineLearningServices/workspaces/connections",
  "Microsoft.MachineLearningServices/workspaces/agents",
  "Microsoft.MachineLearningServices/workspaces/serverlessEndpoints"
];

/** Types that may host AI agents — only ingest when name/tags/kind look AI-related. */
export const AZURE_AI_TYPE_CONDITIONAL = [
  "Microsoft.App/containerApps",
  "Microsoft.Web/sites",
  "Microsoft.Web/sites/slots",
  "Microsoft.ContainerService/managedClusters",
  "Microsoft.ContainerInstance/containerGroups",
  "Microsoft.App/jobs",
  "Microsoft.DocumentDB/databaseAccounts",
  "Microsoft.HealthcareApis/services",
  "Microsoft.HealthcareApis/workspaces",
  "Microsoft.Logic/workflows",
  "Microsoft.Insights/components",
  "Microsoft.Compute/virtualMachines"
];

/** Extensible type → category map for structured Azure classification. */
export const AZURE_RESOURCE_CATEGORY_RULES = [
  {
    category: "azure_openai",
    typeEquals: ["Microsoft.CognitiveServices/accounts"],
    kindRe: /openai/i,
    confidence: 0.98
  },
  {
    category: "azure_ai_foundry",
    typeEquals: ["Microsoft.CognitiveServices/accounts", "Microsoft.CognitiveServices/accounts/projects"],
    kindRe: /aiservices|ai\.services|foundry/i,
    confidence: 0.97
  },
  {
    category: "azure_ai_services",
    typeEquals: ["Microsoft.CognitiveServices/accounts"],
    confidence: 0.95
  },
  {
    category: "azure_machine_learning",
    typeEquals: [
      "Microsoft.MachineLearningServices/workspaces",
      "Microsoft.MachineLearningServices/workspaces/onlineEndpoints",
      "Microsoft.MachineLearningServices/workspaces/batchEndpoints",
      "Microsoft.MachineLearningServices/workspaces/computes",
      "Microsoft.MachineLearningServices/workspaces/connections",
      "Microsoft.MachineLearningServices/workspaces/agents",
      "Microsoft.MachineLearningServices/workspaces/serverlessEndpoints"
    ],
    typeIncludes: ["Microsoft.MachineLearningServices/"],
    confidence: 0.96
  },
  {
    category: "azure_ai_search",
    typeEquals: ["Microsoft.Search/searchServices"],
    confidence: 0.95
  },
  {
    category: "azure_bot_service",
    typeEquals: ["Microsoft.BotService/botServices"],
    typeIncludes: ["Microsoft.BotService/"],
    confidence: 0.97
  },
  {
    category: "azure_container_app",
    typeEquals: ["Microsoft.App/containerApps", "Microsoft.App/jobs"],
    confidence: 0.9
  },
  {
    category: "azure_aks",
    typeEquals: ["Microsoft.ContainerService/managedClusters"],
    confidence: 0.9
  },
  {
    category: "azure_function",
    typeEquals: ["Microsoft.Web/sites", "Microsoft.Web/sites/slots"],
    kindRe: /functionapp/i,
    confidence: 0.9
  },
  {
    category: "azure_app_service",
    typeEquals: ["Microsoft.Web/sites", "Microsoft.Web/sites/slots"],
    confidence: 0.88
  },
  {
    category: "azure_vm",
    typeEquals: ["Microsoft.Compute/virtualMachines"],
    confidence: 0.85
  }
];

function azureTypeMatches(type, patterns) {
  const t = String(type || "");
  return patterns.some((p) => t === p || t.startsWith(`${p}/`));
}

function resourceSignalBlob(resource = {}) {
  const tags = resource.tags || {};
  const tagBlob = Object.entries(tags)
    .flatMap(([k, v]) => [k, v])
    .filter(Boolean)
    .join(" ");
  return {
    type: resource.type || "",
    name: String(resource.name || ""),
    kind: String(resource.kind || ""),
    tags,
    tagBlob
  };
}

function matchCategoryRule(resource) {
  const { type, kind } = resourceSignalBlob(resource);
  for (const rule of AZURE_RESOURCE_CATEGORY_RULES) {
    const typeHit =
      (rule.typeEquals && rule.typeEquals.some((t) => type === t || type.startsWith(`${t}/`))) ||
      (rule.typeIncludes && rule.typeIncludes.some((t) => type.includes(t)));
    if (!typeHit) continue;
    if (rule.kindRe) {
      const isProjectSubresource = /\/projects(\/|$)/i.test(type);
      if (isProjectSubresource && rule.category === "azure_ai_foundry") return rule;
      if (!rule.kindRe.test(kind)) continue;
    }
    return rule;
  }
  return null;
}

/**
 * Structured Azure resource classification.
 * Distinguishes AI platform resources from ambiguous compute that may host AI.
 *
 * @returns {{
 *   aiRelevant: boolean,
 *   category: string,
 *   confidence: number,
 *   evidence: string[],
 *   layer: "ai_resource" | "compute_candidate" | "non_ai",
 *   alwaysAiType: boolean,
 *   conditionalType: boolean
 * }}
 */
export function classifyAzureResource(resource = {}) {
  const { type, name, kind, tagBlob } = resourceSignalBlob(resource);
  const evidence = [];
  const alwaysAiType = azureTypeMatches(type, AZURE_AI_TYPE_ALWAYS);
  const conditionalType = azureTypeMatches(type, AZURE_AI_TYPE_CONDITIONAL);
  const rule = matchCategoryRule(resource);
  const textSignal = isAiRelevantText(name, kind, tagBlob, type.split("/").pop());

  if (alwaysAiType || /openai|MachineLearning|CognitiveServices|BotService|Foundry|AIServices/i.test(type)) {
    const category = rule?.category || "unknown_ai_resource";
    if (alwaysAiType) evidence.push(`Azure type ${type} is a known AI platform resource`);
    if (rule) evidence.push(`Classified as ${rule.category} from type/kind`);
    if (kind) evidence.push(`Azure kind=${kind}`);
    if (textSignal) evidence.push("Name/tags contain AI workload signals");
    return {
      aiRelevant: true,
      category,
      confidence: rule?.confidence ?? 0.9,
      evidence,
      layer: "ai_resource",
      alwaysAiType: true,
      conditionalType: false
    };
  }

  if (/openai|ai\.|ml\.|foundry|copilot|llm|gpt|claude|bedrock|agent|cognitive|assistants?/i.test(kind)) {
    evidence.push(`Azure kind indicates AI: ${kind}`);
    return {
      aiRelevant: true,
      category: rule?.category || "unknown_ai_resource",
      confidence: Math.max(rule?.confidence ?? 0.85, 0.85),
      evidence,
      layer: "ai_resource",
      alwaysAiType: false,
      conditionalType
    };
  }

  if (conditionalType && textSignal) {
    evidence.push(`Conditional host type ${type}`);
    evidence.push("Name/tags/kind match AI workload signals");
    return {
      aiRelevant: true,
      category: rule?.category || "unknown_ai_resource",
      confidence: Math.min(rule?.confidence ?? 0.72, 0.78),
      evidence,
      layer: "compute_candidate",
      alwaysAiType: false,
      conditionalType: true
    };
  }

  if (textSignal && /openai|ai-|ml-|foundry|copilot|llm|gpt|claude|bedrock|agent/i.test(name)) {
    evidence.push("Resource name strongly suggests AI workload");
    return {
      aiRelevant: true,
      category: rule?.category || "unknown_ai_resource",
      confidence: 0.65,
      evidence,
      layer: "compute_candidate",
      alwaysAiType: false,
      conditionalType
    };
  }

  return {
    aiRelevant: false,
    category: "non_ai",
    confidence: 0.99,
    evidence: ["No AI type, kind, or name/tag signals"],
    layer: "non_ai",
    alwaysAiType: false,
    conditionalType
  };
}

/**
 * Strict Azure AI relevance — used when DISCOVERY_AI_ONLY is on.
 */
export function isAzureAiResource(resource) {
  return classifyAzureResource(resource).aiRelevant === true;
}

/**
 * Legacy/broad Azure check kept for callers that need the old heuristic.
 * Prefer isAzureAiResource for ingestion.
 */
export function isAzureAiRelevantLegacy(resource) {
  return isAzureAiResource(resource);
}

export function shouldIngestAiOnly(aiRelevant) {
  if (!DISCOVERY_AI_ONLY) return true;
  return Boolean(aiRelevant);
}

/**
 * Structured AWS resource classification.
 * @returns {{ aiRelevant: boolean, category: string, confidence: number, evidence: string[], layer: string }}
 */
export function classifyAwsResource(resource = {}) {
  const awsType = String(resource.awsType || resource.type || "");
  const name = String(resource.name || "");
  const service = String(resource.service || "");
  const tags = resource.tags || {};
  const tagBlob = Array.isArray(tags)
    ? tags.map((t) => `${t.key || t.Key || ""}:${t.value || t.Value || ""}`).join(" ")
    : Object.entries(tags)
        .flatMap(([k, v]) => [k, v])
        .join(" ");
  const evidence = [];

  if (/^BedrockAgent$/i.test(awsType) || (/bedrock/i.test(service) && /agent/i.test(awsType))) {
    evidence.push("AWS Bedrock Agent entity");
    return {
      aiRelevant: true,
      category: "bedrock_agent",
      confidence: 0.98,
      evidence,
      layer: "agent"
    };
  }
  if (/BedrockKnowledgeBase/i.test(awsType)) {
    evidence.push("Bedrock Knowledge Base is an AI resource, not an agent by itself");
    return {
      aiRelevant: true,
      category: "bedrock_knowledge_base",
      confidence: 0.95,
      evidence,
      layer: "ai_resource"
    };
  }
  if (/SageMakerEndpoint/i.test(awsType)) {
    evidence.push("SageMaker endpoint is an AI model runtime, not automatically an agent");
    return {
      aiRelevant: true,
      category: "sagemaker_endpoint",
      confidence: 0.94,
      evidence,
      layer: "ai_resource"
    };
  }
  if (/LambdaFunction/i.test(awsType) || service === "lambda") {
    const signal = isAiRelevantText(name, tagBlob, resource.description, resource.runtime);
    if (signal) {
      evidence.push("Lambda matched AI workload name/description/runtime/env-name signals");
      return {
        aiRelevant: true,
        category: "lambda",
        confidence: 0.72,
        evidence,
        layer: "compute_candidate"
      };
    }
    return {
      aiRelevant: false,
      category: "non_ai",
      confidence: 0.9,
      evidence: ["Lambda without AI signals"],
      layer: "non_ai"
    };
  }
  if (/EcsService/i.test(awsType) || service === "ecs") {
    const signal = isAiRelevantText(name, tagBlob, resource.taskDefinition);
    if (signal) {
      evidence.push("ECS service matched AI workload heuristics");
      return {
        aiRelevant: true,
        category: "ecs_service",
        confidence: 0.7,
        evidence,
        layer: "compute_candidate"
      };
    }
    return {
      aiRelevant: false,
      category: "non_ai",
      confidence: 0.9,
      evidence: ["ECS service without AI signals"],
      layer: "non_ai"
    };
  }

  if (isAiRelevantText(awsType, name, service, tagBlob)) {
    evidence.push("AWS resource matched AI text signals");
    return {
      aiRelevant: true,
      category: "unknown_ai_resource",
      confidence: 0.65,
      evidence,
      layer: "compute_candidate"
    };
  }

  return {
    aiRelevant: false,
    category: "non_ai",
    confidence: 0.99,
    evidence: ["No AWS AI type or text signals"],
    layer: "non_ai"
  };
}

/**
 * Structured GCP resource classification.
 * @returns {{ aiRelevant: boolean, category: string, confidence: number, evidence: string[], layer: string }}
 */
export function classifyGcpResource(resource = {}) {
  const gcpType = String(resource.gcpType || resource.type || "");
  const name = String(resource.name || "");
  const service = String(resource.service || "");
  const labels = resource.labels || resource.extra?.labels || {};
  const labelBlob = Object.entries(labels)
    .flatMap(([k, v]) => [k, v])
    .join(" ");
  const evidence = [];

  if (/DialogflowCxAgent/i.test(gcpType) || (/dialogflow/i.test(service) && /agent/i.test(gcpType))) {
    evidence.push("Dialogflow CX agent entity from official API");
    return {
      aiRelevant: true,
      category: "dialogflow_cx_agent",
      confidence: 0.97,
      evidence,
      layer: "agent"
    };
  }
  if (/VertexReasoningEngine/i.test(gcpType) || /reasoning.?engine/i.test(gcpType)) {
    evidence.push("Vertex AI Reasoning Engine (Agent Engine) from official API");
    return {
      aiRelevant: true,
      category: "vertex_reasoning_engine",
      confidence: 0.96,
      evidence,
      layer: "agent"
    };
  }
  if (/VertexAIEndpoint/i.test(gcpType)) {
    evidence.push("Vertex AI endpoint is an AI model serving resource, not automatically an agent");
    return {
      aiRelevant: true,
      category: "vertex_endpoint",
      confidence: 0.93,
      evidence,
      layer: "ai_resource"
    };
  }
  if (/VertexAIModel|AIPlatformModel/i.test(gcpType)) {
    evidence.push("Vertex/AI Platform model registry entry is an AI resource");
    return {
      aiRelevant: true,
      category: "vertex_model",
      confidence: 0.92,
      evidence,
      layer: "ai_resource"
    };
  }
  if (/DiscoveryEngine/i.test(gcpType)) {
    evidence.push("Discovery Engine is an AI search/app resource, not an agent by itself");
    return {
      aiRelevant: true,
      category: "discovery_engine",
      confidence: 0.9,
      evidence,
      layer: "ai_resource"
    };
  }
  if (/CloudRunService/i.test(gcpType) || service === "run") {
    const images = (resource.extra?.images || resource.images || []).join(" ");
    if (isAiRelevantText(name, labelBlob, images, resource.description)) {
      evidence.push("Cloud Run service matched AI workload heuristics");
      return {
        aiRelevant: true,
        category: "cloud_run",
        confidence: 0.7,
        evidence,
        layer: "compute_candidate"
      };
    }
    return {
      aiRelevant: false,
      category: "non_ai",
      confidence: 0.9,
      evidence: ["Cloud Run without AI signals"],
      layer: "non_ai"
    };
  }
  if (/EnabledApi/i.test(gcpType)) {
    evidence.push("Enabled AI-related Google API (capability signal, not an agent)");
    return {
      aiRelevant: true,
      category: "enabled_ai_api",
      confidence: 0.6,
      evidence,
      layer: "ai_resource"
    };
  }

  if (isAiRelevantText(gcpType, name, service, labelBlob)) {
    evidence.push("GCP resource matched AI text signals");
    return {
      aiRelevant: true,
      category: "unknown_ai_resource",
      confidence: 0.65,
      evidence,
      layer: "compute_candidate"
    };
  }

  return {
    aiRelevant: false,
    category: "non_ai",
    confidence: 0.99,
    evidence: ["No GCP AI type or text signals"],
    layer: "non_ai"
  };
}

export function isAwsAiResource(resource) {
  return classifyAwsResource(resource).aiRelevant === true;
}

export function isGcpAiResource(resource) {
  return classifyGcpResource(resource).aiRelevant === true;
}
