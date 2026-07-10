/** Shared constants for AgentRadar platform packages */
export const COLLECTOR_IDS = [
  "demo",
  "ide_filesystem",
  "process",
  "mcp",
  "cloud_stub",
  "k8s_api",
  "git_sources",
  "identity_entra",
  "edr",
  "saas_platform",
  "ci_platform"
];

export const AGENT_CATEGORIES = [
  "ide",
  "local",
  "framework",
  "cloud",
  "container",
  "saas",
  "mcp",
  "local_llm",
  "browser",
  "autonomous",
  "ci"
];

export const REL_TYPES = [
  "OWNS",
  "USES_IDE",
  "RUNS_IN",
  "RUNS_ON",
  "INVOKES_MODEL",
  "PROVIDED_BY",
  "USES_TOOL",
  "CONNECTS_MCP",
  "EXPOSES_TOOL",
  "READS_WRITES",
  "DEPLOYED_IN",
  "CALLS",
  "ACCESSES",
  "SOURCED_FROM"
];

export const EVIDENCE_CLASSES = [
  "platform_agent",
  "cloud_ai_runtime",
  "ide_agent",
  "process_agent",
  "repo_candidate"
];

export const AGENT_STATUSES = ["confirmed", "candidate"];
