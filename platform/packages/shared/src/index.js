/** Shared constants for Visentra platform packages */
export const COLLECTOR_IDS = [
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
  "SOURCED_FROM",
  "OBSERVED_BY",
  "USES_FRAMEWORK",
  "EXPOSES_ALIAS",
  "USES_KNOWLEDGE_BASE"
];

export const EVIDENCE_CLASSES = [
  "platform_agent",
  "cloud_ai_runtime",
  "ide_agent",
  "process_agent",
  "repo_candidate"
];

export const AGENT_STATUSES = ["confirmed", "candidate"];

/** Global Agent Mesh — deployment planes */
export const AGENT_PLANES = ["containerized", "serverless", "saas_third_party", "endpoint"];

/** Global Agent Mesh — environment lanes (shadow is an overlay, not a lane) */
export const ENVIRONMENT_LANES = ["development", "staging", "production", "saas", "endpoints"];

export const PLANE_LABELS = {
  containerized: "Containerized",
  serverless: "Serverless",
  saas_third_party: "SaaS & third-party",
  endpoint: "Endpoint"
};

export const LANE_LABELS = {
  development: "Development",
  staging: "Staging",
  production: "Production",
  saas: "SaaS",
  endpoints: "Endpoints"
};

/** Compact labels for dense inventory badges */
export const PLANE_LABELS_SHORT = {
  containerized: "Containerized",
  serverless: "Serverless",
  saas_third_party: "SaaS",
  endpoint: "Endpoint"
};

export const LANE_LABELS_SHORT = {
  development: "Dev",
  staging: "Staging",
  production: "Prod",
  saas: "SaaS",
  endpoints: "Endpoints"
};

export function meshPlaneLabel(plane, { short = false } = {}) {
  const map = short ? PLANE_LABELS_SHORT : PLANE_LABELS;
  return map[plane] || plane || "—";
}

export function meshLaneLabel(lane, { short = false } = {}) {
  const map = short ? LANE_LABELS_SHORT : LANE_LABELS;
  return map[lane] || lane || "—";
}
