/**
 * Mesh plane/lane constants for the API runtime image.
 * Keep aligned with packages/shared and apps/web/src/lib/mesh.ts.
 */

export const AGENT_PLANES = ["containerized", "serverless", "saas_third_party", "endpoint"];

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
