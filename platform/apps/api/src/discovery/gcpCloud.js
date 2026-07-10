import crypto from "crypto";
import { safeFetch, ALLOW } from "../utils/http.js";
import { isAiRelevantText } from "./aiRelevance.js";

const GCP_MAX_RESOURCES = Number(process.env.GCP_DISCOVERY_MAX_RESOURCES || 150);
const DEFAULT_VERTEX_LOCATIONS = (process.env.GCP_DISCOVERY_LOCATIONS || "us-central1,us-east1,us-west1,europe-west4,asia-east1")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function requireGcpConfig({ config = {}, secrets = {} }) {
  const projectId = String(config.projectId || "").trim();
  const clientEmail = String(config.clientEmail || "").trim();
  const privateKey = String(secrets.privateKey || "").replace(/\\n/g, "\n").trim();
  if (!projectId) throw new Error("GCP projectId is required");
  if (!clientEmail || !privateKey) throw new Error("GCP clientEmail and privateKey are required");
  return { projectId, clientEmail, privateKey };
}

export async function getGcpAccessToken({ projectId, clientEmail, privateKey }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = crypto.createSign("RSA-SHA256").update(signingInput).sign(privateKey);
  const assertion = `${signingInput}.${base64url(signature)}`;
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion
  });
  const res = await safeFetch(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    },
    ALLOW.googleApis
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error_description || json.error || `GCP OAuth token failed (${res.status})`);
  }
  return json.access_token;
}

async function googleJson(url, token, { optional = false } = {}) {
  const res = await safeFetch(
    url,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    },
    ALLOW.googleApis
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (optional && (res.status === 403 || res.status === 404)) return null;
    throw new Error(json.error?.message || json.message || `GCP API failed (${res.status})`);
  }
  return json;
}

function cloudRelationship(id, name) {
  return [
    {
      rel_type: "DEPLOYED_IN",
      to_type: "CloudResource",
      to_key: id,
      to_name: name
    }
  ];
}

function gcpObservation({ conn, id, name, gcpType, service, region = "global", aiRelevant = true, status, model, extra = {} }) {
  return {
    collector_id: "cloud_gcp",
    fingerprint: `gcp:${id}`,
    name: aiRelevant ? `${name} (AI)` : name,
    category: "cloud",
    cloud_provider: "gcp",
    region,
    provider: "gcp",
    deployment_type: "cloud",
    endpoint: id,
    running_status: status || "unknown",
    confidence_score: aiRelevant ? 0.9 : 0.76,
    framework: gcpType,
    model: model || (aiRelevant ? "ai-relevant" : null),
    metadata: {
      connectorId: conn.id,
      connectorName: conn.name,
      discoveryMode: "gcp-api-live",
      projectId: conn.config.projectId,
      gcpType,
      gcpService: service,
      aiRelevant,
      inventoryClass: aiRelevant ? "ai_cloud_resource" : "cloud_resource",
      evidenceClass: aiRelevant ? "cloud_ai_runtime" : null,
      agentStatus: aiRelevant
        ? /vertex|gemini|endpoint|model/i.test(String(gcpType || service || ""))
          ? "confirmed"
          : "candidate"
        : null,
      managedCloudAgent: /vertex|gemini/i.test(String(gcpType || service || "")),
      environment: conn.environment,
      ...extra
    },
    relationships: cloudRelationship(id, name)
  };
}

async function listVertexLocations(projectId, token) {
  const json = await googleJson(`https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations`, token, {
    optional: true
  });
  const fromApi = (json?.locations || [])
    .map((loc) => String(loc.locationId || loc.name?.split("/").pop() || ""))
    .filter(Boolean);
  return fromApi.length ? fromApi.slice(0, 12) : DEFAULT_VERTEX_LOCATIONS;
}

async function listVertexResources(projectId, token) {
  const resources = [];
  const locations = await listVertexLocations(projectId, token);
  for (const location of locations) {
    const base = `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}`;
    const [endpoints, models] = await Promise.all([
      googleJson(`${base}/endpoints?pageSize=50`, token, { optional: true }).catch(() => null),
      googleJson(`${base}/models?pageSize=50`, token, { optional: true }).catch(() => null)
    ]);
    for (const endpoint of endpoints?.endpoints || []) {
      resources.push({
        id: endpoint.name,
        name: endpoint.displayName || endpoint.name?.split("/").pop() || "Vertex AI endpoint",
        gcpType: "VertexAIEndpoint",
        service: "aiplatform",
        region: location,
        status: endpoint.deployedModels?.length ? "running" : "unknown",
        model: "vertex-ai-endpoint",
        extra: { deployedModels: endpoint.deployedModels?.length || 0, labels: endpoint.labels || {} }
      });
    }
    for (const model of models?.models || []) {
      resources.push({
        id: model.name,
        name: model.displayName || model.name?.split("/").pop() || "Vertex AI model",
        gcpType: "VertexAIModel",
        service: "aiplatform",
        region: location,
        status: "unknown",
        model: model.versionId || "vertex-ai-model",
        extra: { versionId: model.versionId || null, labels: model.labels || {}, supportedDeploymentResourcesTypes: model.supportedDeploymentResourcesTypes || [] }
      });
    }
  }
  return resources;
}

async function listLegacyAiModels(projectId, token) {
  const json = await googleJson(`https://ml.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/models`, token, {
    optional: true
  });
  return (json?.models || []).map((model) => ({
    id: model.name || `projects/${projectId}/models/${model.name}`,
    name: model.name?.split("/").pop() || model.name || "AI Platform model",
    gcpType: "AIPlatformModel",
    service: "ml.googleapis.com",
    region: "global",
    status: model.onlinePredictionLogging ? "running" : "unknown",
    model: "ai-platform-model",
    extra: { regions: model.regions || [], labels: model.labels || {} }
  }));
}

async function listDiscoveryEngines(projectId, token) {
  const json = await googleJson(
    `https://discoveryengine.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/global/collections/default_collection/engines?pageSize=50`,
    token,
    { optional: true }
  );
  return (json?.engines || []).map((engine) => ({
    id: engine.name,
    name: engine.displayName || engine.name?.split("/").pop() || "Discovery Engine",
    gcpType: "DiscoveryEngine",
    service: "discoveryengine",
    region: "global",
    status: "running",
    model: "discovery-engine",
    extra: { solutionType: engine.solutionType || null, industryVertical: engine.industryVertical || null }
  }));
}

async function listEnabledAiApis(projectId, token) {
  const json = await googleJson(
    `https://serviceusage.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/services?filter=state:ENABLED&pageSize=100`,
    token,
    { optional: true }
  );
  return (json?.services || [])
    .filter((svc) => isAiRelevantText(svc.name, svc.config?.name, svc.config?.title))
    .map((svc) => ({
      id: svc.name || svc.config?.name,
      name: svc.config?.title || svc.config?.name || svc.name,
      gcpType: "EnabledApi",
      service: "serviceusage",
      region: "global",
      status: svc.state || "ENABLED",
      model: "enabled-ai-api",
      extra: { serviceName: svc.config?.name || svc.name }
    }));
}

async function listAiCloudRunServices(projectId, token) {
  const resources = [];
  for (const location of DEFAULT_VERTEX_LOCATIONS.slice(0, 8)) {
    const json = await googleJson(
      `https://run.googleapis.com/v2/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/services?pageSize=50`,
      token,
      { optional: true }
    ).catch(() => null);
    for (const svc of json?.services || []) {
      const images = (svc.template?.containers || []).map((c) => c.image).filter(Boolean);
      const labels = svc.labels || {};
      if (!isAiRelevantText(svc.name, svc.description, Object.keys(labels).join(" "), Object.values(labels).join(" "), images.join(" "))) continue;
      resources.push({
        id: svc.name,
        name: svc.name?.split("/").pop() || "Cloud Run service",
        gcpType: "CloudRunService",
        service: "run",
        region: location,
        status: svc.conditions?.find((c) => c.type === "Ready")?.state || "unknown",
        model: "cloud-run-ai-service",
        extra: { uri: svc.uri || null, labels, images }
      });
    }
  }
  return resources;
}

export async function validateGcpConnector(conn) {
  const cfg = requireGcpConfig(conn);
  const token = await getGcpAccessToken(cfg);
  const project = await googleJson(
    `https://cloudresourcemanager.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}`,
    token
  );
  return {
    ok: true,
    message: `Authenticated to GCP project ${project.projectId || cfg.projectId} (${project.lifecycleState || "unknown"}).`,
    accessToken: token,
    project
  };
}

export async function discoverGcpConnector(conn) {
  const cfg = requireGcpConfig(conn);
  const validation = await validateGcpConnector(conn);
  const token = validation.accessToken;
  const observations = [
    {
      collector_id: "cloud_gcp",
      fingerprint: `gcp-connector-scan:${conn.id}:${cfg.projectId}`,
      name: `GCP scan — ${conn.name}`,
      category: "cloud",
      cloud_provider: "gcp",
      region: "global",
      provider: "gcp",
      deployment_type: "cloud",
      running_status: "running",
      confidence_score: 0.95,
      framework: "project-scan",
      metadata: {
        connectorId: conn.id,
        connectorName: conn.name,
        discoveryMode: "gcp-api-live",
        projectId: cfg.projectId,
        projectNumber: validation.project?.projectNumber || null,
        inventoryClass: "connector_scan",
        environment: conn.environment,
        maxResources: GCP_MAX_RESOURCES
      },
      relationships: cloudRelationship(`gcp-project-${cfg.projectId}`, `GCP project ${cfg.projectId}`)
    }
  ];

  const resourceGroups = await Promise.all([
    listVertexResources(cfg.projectId, token).catch(() => []),
    listLegacyAiModels(cfg.projectId, token).catch(() => []),
    listDiscoveryEngines(cfg.projectId, token).catch(() => []),
    listAiCloudRunServices(cfg.projectId, token).catch(() => [])
  ]);
  let resources = resourceGroups.flat();

  if (!resources.length) {
    resources = await listEnabledAiApis(cfg.projectId, token).catch(() => []);
  }

  for (const resource of resources.slice(0, GCP_MAX_RESOURCES)) {
    observations.push(gcpObservation({ conn, aiRelevant: true, ...resource }));
  }

  return {
    observations,
    stats: {
      totalResourcesScanned: resources.length,
      aiRelevantResources: resources.length,
      cloudResourcesIngested: Math.max(0, observations.length - 1)
    }
  };
}
