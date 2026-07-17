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
