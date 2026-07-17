/**
 * Web mesh label helpers — mirrors @agentradar/shared (typed for Vite/TS).
 * Keep in sync with packages/shared/src/index.js.
 */

export const AGENT_PLANES = ["containerized", "serverless", "saas_third_party", "endpoint"] as const;

export const ENVIRONMENT_LANES = [
  "development",
  "staging",
  "production",
  "saas",
  "endpoints"
] as const;

export const PLANE_LABELS: Record<string, string> = {
  containerized: "Containerized",
  serverless: "Serverless",
  saas_third_party: "SaaS & third-party",
  endpoint: "Endpoint"
};

export const LANE_LABELS: Record<string, string> = {
  development: "Development",
  staging: "Staging",
  production: "Production",
  saas: "SaaS",
  endpoints: "Endpoints"
};

export const PLANE_LABELS_SHORT: Record<string, string> = {
  containerized: "Containerized",
  serverless: "Serverless",
  saas_third_party: "SaaS",
  endpoint: "Endpoint"
};

export const LANE_LABELS_SHORT: Record<string, string> = {
  development: "Dev",
  staging: "Staging",
  production: "Prod",
  saas: "SaaS",
  endpoints: "Endpoints"
};

export function meshOptionLabel(value: string): string {
  return PLANE_LABELS[value] || LANE_LABELS[value] || value;
}

export function meshBadgeLabel(value: string): string {
  return PLANE_LABELS_SHORT[value] || LANE_LABELS_SHORT[value] || value;
}
