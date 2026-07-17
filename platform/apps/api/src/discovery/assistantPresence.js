/**
 * Assistant presence + "assisted-by" inference helpers.
 *
 * Presence (strong when process/app evidence exists):
 *   cursor | claude | copilot | ollama
 *
 * Assisted-by (always candidate — tooling marks, not authorship proof):
 *   cursor | claude | copilot
 */

export const ASSISTANT_IDS = ["cursor", "claude", "copilot", "ollama"];

const PRESENCE_PATTERNS = {
  cursor: /\bcursor(?:-agent)?\b|cursor\.exe|Cursor\.app|\/Cursor\//i,
  claude: /\bclaude(?:-code|\.exe)?\b|Claude\.app|Anthropic|claude_desktop/i,
  copilot: /\bcopilot\b|github.?copilot|copilot-language-server|Copilot\.app/i,
  ollama: /\bollama\b|Ollama\.app/i
};

const ASSISTED_BY_MARKERS = {
  cursor: [
    ".cursorrules",
    ".cursor/rules",
    ".cursor/mcp.json",
    ".cursor",
    "cursor.json"
  ],
  claude: ["CLAUDE.md", ".claude", ".claude/settings.json", "claude_desktop_config.json"],
  copilot: [".github/copilot-instructions.md", "copilot-instructions.md", ".github/agents"]
};

const AGENT_FRAMEWORK_RE =
  /\b(langgraph|langchain|crewai|autogen|semantic.?kernel|openai.?agents|agents?\.sdk|@modelcontextprotocol|mcp-server|bedrock.?agent|llama.?index|haystack|dspy|pydantic.?ai|open.?interpreter|autogpt|babyagi)\b/i;

const AGENT_FILE_MARKERS = [
  "AGENTS.md",
  "agents.md",
  ".github/agents",
  "mcp.json",
  ".mcp.json",
  "agent.yaml",
  "agent.yml",
  "agents.yaml",
  "agents.yml",
  "langgraph.json",
  "crewai.yaml",
  "Dockerfile.agent"
];

const DEPENDENCY_HINTS = [
  "langchain",
  "langgraph",
  "crewai",
  "autogen",
  "semantic-kernel",
  "@modelcontextprotocol",
  "mcp",
  "openai-agents",
  "anthropic",
  "ollama",
  "llama-index",
  "llamaindex",
  "haystack",
  "pydantic-ai",
  "openai"
];

export function detectAssistantPresence(...parts) {
  const blob = parts.filter(Boolean).join(" ");
  const assistants = [];
  for (const id of ASSISTANT_IDS) {
    if (PRESENCE_PATTERNS[id].test(blob)) assistants.push(id);
  }
  return {
    assistants,
    hasPresence: assistants.length > 0,
    primary: assistants[0] || null
  };
}

export function detectAssistedByFromMarkers(markers = []) {
  const assistedBy = new Set();
  const normalized = markers.map((m) => String(m || "").replace(/\\/g, "/"));
  for (const [assistant, paths] of Object.entries(ASSISTED_BY_MARKERS)) {
    for (const marker of normalized) {
      if (paths.some((p) => marker === p || marker.endsWith(`/${p}`) || marker.includes(p))) {
        assistedBy.add(assistant);
      }
    }
  }
  return [...assistedBy];
}

export function detectAssistedByFromText(...parts) {
  const blob = parts.filter(Boolean).join("\n");
  const assistedBy = new Set(detectAssistedByFromMarkers(
    blob.split(/[\s,;|]+/).filter(Boolean)
  ));
  if (/\.cursorrules|\.cursor\/|cursor rules|built with cursor|cursor ide/i.test(blob)) {
    assistedBy.add("cursor");
  }
  if (/\bCLAUDE\.md\b|\.claude\/|claude code|anthropic claude/i.test(blob)) {
    assistedBy.add("claude");
  }
  if (/copilot-instructions|github copilot|@github\/copilot/i.test(blob)) {
    assistedBy.add("copilot");
  }
  return [...assistedBy];
}

export function detectAgentFrameworks(...parts) {
  const blob = parts.filter(Boolean).join("\n");
  const found = new Set();
  const matches = blob.match(
    /\b(langgraph|langchain|crewai|autogen|semantic-?kernel|openai-agents|@modelcontextprotocol|mcp-server|bedrock-?agents?|llama-?index|haystack|dspy|pydantic-?ai|open-?interpreter|autogpt)\b/gi
  );
  for (const m of matches || []) found.add(String(m).toLowerCase().replace(/_/g, "-"));
  return [...found];
}

export function looksLikeAgentProject({
  markers = [],
  frameworks = [],
  workflowMatches = [],
  dependencyHints = [],
  mcpServers = []
} = {}) {
  const markerHit = markers.some((m) =>
    AGENT_FILE_MARKERS.some((a) => String(m).endsWith(a) || String(m).includes(a))
  );
  const workflowHit = (workflowMatches || []).some((w) =>
    /agent|langchain|langgraph|crewai|autogen|mcp|openai|anthropic|ollama/i.test(w)
  );
  return (
    markerHit ||
    frameworks.length > 0 ||
    workflowHit ||
    mcpServers.length > 0 ||
    dependencyHints.some((d) => AGENT_FRAMEWORK_RE.test(d))
  );
}

export function classifyRepoProjectKind({
  agentMarkers = [],
  workflowMatches = [],
  frameworks = [],
  dependencyHints = [],
  assistedBy = [],
  mcpServers = [],
  aiRelevant = false
} = {}) {
  const strongAgent = looksLikeAgentProject({
    markers: agentMarkers,
    frameworks,
    workflowMatches,
    dependencyHints,
    mcpServers
  });
  if (strongAgent) {
    return {
      projectKind: "agent_project",
      githubAgentSignal: "strong",
      agentStatus: "candidate"
    };
  }
  if (assistedBy.length) {
    return {
      projectKind: "ai_assisted_repo",
      githubAgentSignal: "assisted",
      agentStatus: "candidate"
    };
  }
  if (aiRelevant) {
    return {
      projectKind: "ai_signal_repo",
      githubAgentSignal: "heuristic",
      agentStatus: "candidate"
    };
  }
  return {
    projectKind: null,
    githubAgentSignal: null,
    agentStatus: null
  };
}

export function extractDependencyHints(fileText = "") {
  const text = String(fileText || "").toLowerCase();
  const found = new Set();
  for (const dep of DEPENDENCY_HINTS) {
    if (text.includes(dep.toLowerCase())) found.add(dep);
  }
  return [...found];
}

export function presenceLabel(assistant) {
  return (
    {
      cursor: "Cursor",
      claude: "Claude",
      copilot: "GitHub Copilot",
      ollama: "Ollama"
    }[assistant] || assistant
  );
}

export function buildAssistedByMetadata(assistedBy = []) {
  if (!assistedBy.length) return {};
  return {
    assistedBy,
    assistedByConfidence: "candidate",
    assistedByNote:
      "Inferred from IDE/repo tooling markers. Indicates Cursor/Claude/Copilot assistance signals — not proof of authorship."
  };
}

export function buildPresenceMetadata(assistants = [], { processEvidence = null } = {}) {
  if (!assistants.length) return {};
  return {
    endpointPresence: assistants,
    presenceConfirmed: Boolean(processEvidence),
    presenceTools: assistants.map(presenceLabel),
    howIdentified: processEvidence
      ? `${assistants.map(presenceLabel).join(", ")} process/app evidence on endpoint`
      : `${assistants.map(presenceLabel).join(", ")} signal on endpoint`
  };
}

export {
  ASSISTED_BY_MARKERS,
  AGENT_FILE_MARKERS,
  AGENT_FRAMEWORK_RE,
  DEPENDENCY_HINTS
};
