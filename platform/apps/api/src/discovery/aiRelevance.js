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
  "Microsoft.Insights/components"
];

function azureTypeMatches(type, patterns) {
  const t = String(type || "");
  return patterns.some((p) => t === p || t.startsWith(`${p}/`));
}

/**
 * Strict Azure AI relevance — used when DISCOVERY_AI_ONLY is on.
 */
export function isAzureAiResource(resource) {
  const type = resource.type || "";
  const name = String(resource.name || "");
  const kind = String(resource.kind || "");
  const tags = resource.tags || {};
  const tagBlob = Object.entries(tags)
    .flatMap(([k, v]) => [k, v])
    .filter(Boolean)
    .join(" ");

  if (azureTypeMatches(type, AZURE_AI_TYPE_ALWAYS)) return true;
  if (/openai|MachineLearning|CognitiveServices|BotService|Foundry|AIServices/i.test(type)) return true;
  if (/openai|ai\.|ml\.|foundry|copilot|llm|gpt|claude|bedrock|agent|cognitive|assistants?/i.test(kind)) return true;

  const signal = isAiRelevantText(name, kind, tagBlob, type.split("/").pop());
  if (azureTypeMatches(type, AZURE_AI_TYPE_CONDITIONAL) && signal) return true;
  if (signal && /openai|ai-|ml-|foundry|copilot|llm|gpt|claude|bedrock|agent/i.test(name)) return true;
  return false;
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
