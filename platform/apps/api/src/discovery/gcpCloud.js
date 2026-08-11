import crypto from "crypto";
import { safeFetch, ALLOW } from "../utils/http.js";
import {
  DISCOVERY_AI_ONLY,
  isAiRelevantText,
  classifyGcpResource
} from "./aiRelevance.js";
import {
  emptyAgentBlock,
  emptyRuntimeBlock,
  buildAgentAndRuntime,
  normalizeRuntimeStatus,
  sanitizeCloudError,
  emptyDiscoveryStats,
  tallyDiscoveryObservation,
  dedupeObservationsByFingerprint
} from "./cloudDiscoveryCommon.js";

const GCP_MAX_RESOURCES = Number(process.env.GCP_DISCOVERY_MAX_RESOURCES || 150);
const GCP_DISCOVERY_AGENT_SCAN =
  String(process.env.GCP_DISCOVERY_AGENT_SCAN || "true").toLowerCase() !== "false";
const GCP_DISCOVERY_RUNTIME_SCAN =
  String(process.env.GCP_DISCOVERY_RUNTIME_SCAN || "true").toLowerCase() !== "false";
export const EFFECTIVE_GCP_AI_ONLY =
  process.env.GCP_DISCOVERY_AI_ONLY != null
    ? String(process.env.GCP_DISCOVERY_AI_ONLY).toLowerCase() !== "false"
    : DISCOVERY_AI_ONLY;

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
    throw new Error(
      sanitizeCloudError(json.error_description || json.error || `GCP OAuth token failed (${res.status})`)
    );
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
    const permissionDenied = res.status === 401 || res.status === 403;
    if (optional && (res.status === 403 || res.status === 404 || res.status === 401)) {
      return {
        __error: true,
        permissionDenied,
        status: res.status,
        message: sanitizeCloudError(json.error?.message || json.message || `GCP API failed (${res.status})`)
      };
    }
    const err = new Error(
      sanitizeCloudError(json.error?.message || json.message || `GCP API failed (${res.status})`)
    );
    err.status = res.status;
    err.permissionDenied = permissionDenied;
    throw err;
  }
  return json;
}

function cloudRelationship(id, name, extra = []) {
  return [
    {
      rel_type: "DEPLOYED_IN",
      to_type: "CloudResource",
      to_key: id,
      to_name: name
    },
    ...extra
  ];
}

function mapCloudRunReady(state) {
  const v = String(state || "");
  if (/^CONDITION_SUCCEEDED$/i.test(v) || /^True$/i.test(v)) return "running";
  if (/^CONDITION_FAILED$/i.test(v) || /^False$/i.test(v)) return "failed";
  return normalizeRuntimeStatus(v);
}

/**
 * Build layered GCP observation.
 */
export function gcpObservation({
  conn,
  id,
  name,
  gcpType,
  service,
  region = "global",
  classification,
  status,
  model,
  extra = {},
  fingerprint,
  discoveryLayer,
  inventoryClass,
  agentRuntime,
  relationships,
  confidence,
  evidence = [],
  discoveryMode = "gcp-api-live",
  runtimeStatusReason = null,
  discoveryStatus = null
}) {
  const classif =
    classification ||
    classifyGcpResource({
      gcpType,
      name,
      service,
      labels: extra.labels,
      images: extra.images,
      description: extra.description,
      extra
    });
  const aiRelevant = classif.aiRelevant === true;
  const blocks = agentRuntime || buildAgentAndRuntime({ agentDetected: false });
  const agent = blocks.agent;
  const runtime = blocks.runtime;

  let runningStatus = "unknown";
  if (runtime.detected && runtime.status) runningStatus = runtime.status;

  let legacyAgentStatus = null;
  if (agent.detected) {
    legacyAgentStatus =
      agent.detectionMethod === "runtime_heuristic" || agent.detectionMethod === "name_heuristic"
        ? "candidate"
        : "confirmed";
  }

  const inv =
    inventoryClass ||
    (agent.detected ? "ai_cloud_agent" : aiRelevant ? "ai_cloud_resource" : "cloud_resource");

  let evidenceClass = null;
  if (agent.detected) evidenceClass = "cloud_ai_runtime";

  return {
    collector_id: "cloud_gcp",
    fingerprint: fingerprint || `gcp:${id}`,
    name: aiRelevant ? `${name} (AI)` : name,
    category: "cloud",
    cloud_provider: "gcp",
    region,
    provider: "gcp",
    deployment_type: "cloud",
    endpoint: id,
    running_status: runningStatus,
    confidence_score: confidence ?? classif.confidence ?? (aiRelevant ? 0.85 : 0.7),
    framework: gcpType,
    model: model || (agent.detected ? "gcp-ai-agent" : aiRelevant ? "ai-relevant" : null),
    agent,
    runtime,
    metadata: {
      connectorId: conn.id,
      connectorName: conn.name,
      discoveryMode,
      discoveryLayer: discoveryLayer || classif.layer || "resource",
      projectId: conn.config.projectId,
      gcpType,
      gcpService: service,
      aiRelevant,
      aiResourceType: classif.category,
      agentDetected: agent.detected,
      agentDetectionMethod: agent.detectionMethod,
      runtimeDetected: runtime.detected,
      runtimeType: runtime.runtimeType,
      runtimeStatus: runtime.status,
      evidence: [...(classif.evidence || []), ...evidence],
      evidenceClass,
      inventoryClass: inv,
      agentStatus: legacyAgentStatus,
      managedCloudAgent: Boolean(
        agent.detected &&
          agent.detectionMethod &&
          /dialogflow_cx_api|vertex_reasoning_engine_api/.test(agent.detectionMethod)
      ),
      discoveryStatus,
      runtimeStatusReason,
      environment: conn.environment,
      ...extra
    },
    relationships:
      relationships ||
      cloudRelationship(id, name, [
        { rel_type: "HOSTED_BY", to_type: "CloudResource", to_key: id, to_name: name }
      ])
  };
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

/** Non-destructive capability probe — not a full project scan. */
export async function validateGcpConnectorCapabilities(conn) {
  const cfg = requireGcpConfig(conn);
  const capabilities = {
    crm: false,
    vertexAi: false,
    dialogflow: false,
    reasoningEngines: false,
    discoveryEngine: false,
    cloudRun: false
  };

  let token;
  try {
    const validation = await validateGcpConnector(conn);
    token = validation.accessToken;
    capabilities.crm = true;
  } catch {
    return { ok: false, capabilities, message: "GCP authentication failed" };
  }

  async function probe(url) {
    const json = await googleJson(url, token, { optional: true });
    if (json?.__error) return !json.permissionDenied;
    return true;
  }

  const loc = DEFAULT_VERTEX_LOCATIONS[0] || "us-central1";
  capabilities.vertexAi = await probe(
    `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/locations/${loc}/endpoints?pageSize=1`
  );
  capabilities.dialogflow = await probe(
    `https://dialogflow.googleapis.com/v3/projects/${encodeURIComponent(cfg.projectId)}/locations/global/agents?pageSize=1`
  );
  capabilities.reasoningEngines = await probe(
    `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/locations/${loc}/reasoningEngines?pageSize=1`
  );
  capabilities.discoveryEngine = await probe(
    `https://discoveryengine.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/locations/global/collections/default_collection/engines?pageSize=1`
  );
  capabilities.cloudRun = await probe(
    `https://run.googleapis.com/v2/projects/${encodeURIComponent(cfg.projectId)}/locations/${loc}/services?pageSize=1`
  );

  return {
    ok: capabilities.crm,
    capabilities,
    message: "GCP connector capability probe completed (read-only)."
  };
}

async function listVertexLocations(projectId, token, discoveryErrors) {
  const json = await googleJson(
    `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations`,
    token,
    { optional: true }
  );
  if (json?.__error) {
    discoveryErrors.push({
      discoveryType: "vertex-locations",
      discoveryStatus: json.permissionDenied ? "permission_denied" : "error",
      error: json.message
    });
    return DEFAULT_VERTEX_LOCATIONS;
  }
  const fromApi = (json?.locations || [])
    .map((loc) => String(loc.locationId || loc.name?.split("/").pop() || ""))
    .filter(Boolean);
  return fromApi.length ? fromApi.slice(0, 12) : DEFAULT_VERTEX_LOCATIONS;
}

async function listVertexResources(projectId, token, discoveryErrors) {
  const resources = [];
  const locations = await listVertexLocations(projectId, token, discoveryErrors);
  for (const location of locations) {
    const base = `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}`;
    const [endpoints, models] = await Promise.all([
      googleJson(`${base}/endpoints?pageSize=50`, token, { optional: true }).catch(() => null),
      googleJson(`${base}/models?pageSize=50`, token, { optional: true }).catch(() => null)
    ]);
    if (endpoints?.__error) {
      discoveryErrors.push({
        discoveryType: "vertex-endpoints",
        discoveryStatus: endpoints.permissionDenied ? "permission_denied" : "error",
        error: endpoints.message,
        region: location
      });
    }
    if (models?.__error) {
      discoveryErrors.push({
        discoveryType: "vertex-models",
        discoveryStatus: models.permissionDenied ? "permission_denied" : "error",
        error: models.message,
        region: location
      });
    }
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
        extra: {
          versionId: model.versionId || null,
          labels: model.labels || {},
          supportedDeploymentResourcesTypes: model.supportedDeploymentResourcesTypes || []
        }
      });
    }
  }
  return resources;
}

async function listLegacyAiModels(projectId, token, discoveryErrors) {
  const json = await googleJson(
    `https://ml.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/models`,
    token,
    { optional: true }
  );
  if (json?.__error) {
    discoveryErrors.push({
      discoveryType: "ml-models",
      discoveryStatus: json.permissionDenied ? "permission_denied" : "error",
      error: json.message
    });
    return [];
  }
  return (json?.models || []).map((model) => ({
    id: model.name || `projects/${projectId}/models/${model.name}`,
    name: model.name?.split("/").pop() || model.name || "AI Platform model",
    gcpType: "AIPlatformModel",
    service: "ml.googleapis.com",
    region: "global",
    status: "unknown",
    model: "ai-platform-model",
    extra: { regions: model.regions || [], labels: model.labels || {} }
  }));
}

async function listDiscoveryEngines(projectId, token, discoveryErrors) {
  const json = await googleJson(
    `https://discoveryengine.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/global/collections/default_collection/engines?pageSize=50`,
    token,
    { optional: true }
  );
  if (json?.__error) {
    discoveryErrors.push({
      discoveryType: "discovery-engine",
      discoveryStatus: json.permissionDenied ? "permission_denied" : "error",
      error: json.message
    });
    return [];
  }
  return (json?.engines || []).map((engine) => ({
    id: engine.name,
    name: engine.displayName || engine.name?.split("/").pop() || "Discovery Engine",
    gcpType: "DiscoveryEngine",
    service: "discoveryengine",
    region: "global",
    status: "unknown",
    model: "discovery-engine",
    extra: { solutionType: engine.solutionType || null, industryVertical: engine.industryVertical || null }
  }));
}

async function listDialogflowCxAgents(projectId, token, discoveryErrors) {
  const resources = [];
  for (const location of ["global", "us-central1", "europe-west1", "asia-southeast1"]) {
    const json = await googleJson(
      `https://dialogflow.googleapis.com/v3/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/agents?pageSize=50`,
      token,
      { optional: true }
    ).catch((err) => {
      discoveryErrors.push({
        discoveryType: "dialogflow-cx",
        discoveryStatus: err.permissionDenied ? "permission_denied" : "error",
        error: sanitizeCloudError(err),
        region: location
      });
      return null;
    });
    if (json?.__error) {
      discoveryErrors.push({
        discoveryType: "dialogflow-cx",
        discoveryStatus: json.permissionDenied ? "permission_denied" : "error",
        error: json.message,
        region: location
      });
      continue;
    }
    for (const agent of json?.agents || []) {
      resources.push({
        id: agent.name,
        name: agent.displayName || agent.name?.split("/").pop() || "Dialogflow CX agent",
        gcpType: "DialogflowCxAgent",
        service: "dialogflow",
        region: location,
        status: "unknown",
        model: "dialogflow-cx-agent",
        extra: {
          defaultLanguageCode: agent.defaultLanguageCode || null,
          timeZone: agent.timeZone || null
        }
      });
    }
  }
  return resources;
}

async function listVertexReasoningEngines(projectId, token, discoveryErrors) {
  const resources = [];
  const locations = await listVertexLocations(projectId, token, discoveryErrors);
  for (const location of locations.slice(0, 8)) {
    const json = await googleJson(
      `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/reasoningEngines?pageSize=50`,
      token,
      { optional: true }
    ).catch(() => null);
    if (json?.__error) {
      discoveryErrors.push({
        discoveryType: "vertex-reasoning-engines",
        discoveryStatus: json.permissionDenied ? "permission_denied" : "error",
        error: json.message,
        region: location
      });
      continue;
    }
    for (const engine of json?.reasoningEngines || []) {
      resources.push({
        id: engine.name,
        name: engine.displayName || engine.name?.split("/").pop() || "Vertex AI Agent Engine",
        gcpType: "VertexReasoningEngine",
        service: "aiplatform",
        region: location,
        status: "unknown",
        model: "vertex-agent-engine",
        extra: { description: engine.description || null, labels: engine.labels || {} }
      });
    }
  }
  return resources;
}

async function listEnabledAiApis(projectId, token, discoveryErrors) {
  const json = await googleJson(
    `https://serviceusage.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/services?filter=state:ENABLED&pageSize=100`,
    token,
    { optional: true }
  );
  if (json?.__error) {
    discoveryErrors.push({
      discoveryType: "serviceusage",
      discoveryStatus: json.permissionDenied ? "permission_denied" : "error",
      error: json.message
    });
    return [];
  }
  return (json?.services || [])
    .filter((svc) => isAiRelevantText(svc.name, svc.config?.name, svc.config?.title))
    .map((svc) => ({
      id: svc.name || svc.config?.name,
      name: svc.config?.title || svc.config?.name || svc.name,
      gcpType: "EnabledApi",
      service: "serviceusage",
      region: "global",
      status: "unknown",
      model: "enabled-ai-api",
      extra: { serviceName: svc.config?.name || svc.name }
    }));
}

async function listAiCloudRunServices(projectId, token, discoveryErrors) {
  const resources = [];
  for (const location of DEFAULT_VERTEX_LOCATIONS.slice(0, 8)) {
    const json = await googleJson(
      `https://run.googleapis.com/v2/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/services?pageSize=50`,
      token,
      { optional: true }
    ).catch(() => null);
    if (json?.__error) {
      discoveryErrors.push({
        discoveryType: "cloud-run",
        discoveryStatus: json.permissionDenied ? "permission_denied" : "error",
        error: json.message,
        region: location
      });
      continue;
    }
    for (const svc of json?.services || []) {
      const images = (svc.template?.containers || []).map((c) => c.image).filter(Boolean);
      const labels = svc.labels || {};
      const envNames = [];
      for (const c of svc.template?.containers || []) {
        for (const env of c.env || []) {
          if (!env.name) continue;
          envNames.push(/secret|token|key|password|credential/i.test(env.name) ? `${env.name}(redacted)` : env.name);
        }
      }
      if (
        !isAiRelevantText(
          svc.name,
          svc.description,
          Object.keys(labels).join(" "),
          Object.values(labels).join(" "),
          images.join(" "),
          envNames.join(" ")
        )
      ) {
        continue;
      }
      const ready = svc.conditions?.find((c) => c.type === "Ready")?.state;
      resources.push({
        id: svc.name,
        name: svc.name?.split("/").pop() || "Cloud Run service",
        gcpType: "CloudRunService",
        service: "run",
        region: location,
        status: mapCloudRunReady(ready),
        model: "cloud-run-ai-service",
        extra: { uri: svc.uri || null, labels, images, envNames, readyState: ready || null }
      });
    }
  }
  return resources;
}

function toLayeredObservation(conn, resource) {
  const classification = classifyGcpResource(resource);
  const { id, name, gcpType, service, region, status, model, extra = {} } = resource;

  if (classification.category === "dialogflow_cx_agent") {
    return gcpObservation({
      conn,
      id,
      name,
      gcpType,
      service,
      region,
      classification,
      model,
      fingerprint: `gcp-agent:${conn.config.projectId}:${id}`,
      discoveryLayer: "agent",
      inventoryClass: "ai_cloud_agent",
      confidence: 0.96,
      evidence: [
        "Dialogflow CX agent returned by Dialogflow API",
        "API does not expose continuous conversation runtime; runtimeStatus=unknown"
      ],
      runtimeStatusReason: "Dialogflow CX list agents has no durable runtime execution field",
      agentRuntime: buildAgentAndRuntime({
        agentDetected: true,
        detectionMethod: "dialogflow_cx_api",
        agentId: id,
        agentName: name,
        agentType: "dialogflow_cx_agent",
        agentStatus: "confirmed",
        agentRuntimeStatus: "unknown",
        source: "gcp_dialogflow_cx",
        runtimeDetected: false,
        runtimeStatus: "unknown",
        runtimeType: "dialogflow_cx",
        runtimeId: id,
        runtimeName: name,
        resourceId: id,
        region
      }),
      extra
    });
  }

  if (classification.category === "vertex_reasoning_engine") {
    return gcpObservation({
      conn,
      id,
      name,
      gcpType,
      service,
      region,
      classification,
      model,
      fingerprint: `gcp-agent:${conn.config.projectId}:${id}`,
      discoveryLayer: "agent",
      inventoryClass: "ai_cloud_agent",
      confidence: 0.95,
      evidence: [
        "Vertex AI Reasoning Engine returned by AI Platform API",
        "List API does not reliably expose continuous runtime; runtimeStatus=unknown"
      ],
      runtimeStatusReason: "Vertex Reasoning Engine list has no continuous runtime status field",
      agentRuntime: buildAgentAndRuntime({
        agentDetected: true,
        detectionMethod: "vertex_reasoning_engine_api",
        agentId: id,
        agentName: name,
        agentType: "vertex_reasoning_engine",
        agentStatus: "confirmed",
        agentRuntimeStatus: "unknown",
        source: "gcp_vertex_reasoning_engine",
        runtimeDetected: false,
        runtimeStatus: "unknown",
        runtimeType: "vertex_reasoning_engine",
        runtimeId: id,
        runtimeName: name,
        resourceId: id,
        region
      }),
      extra
    });
  }

  if (classification.category === "vertex_endpoint") {
    const runtimeStatus = extra.deployedModels > 0 ? "running" : normalizeRuntimeStatus(status);
    return gcpObservation({
      conn,
      id,
      name,
      gcpType,
      service,
      region,
      classification,
      model,
      fingerprint: `gcp-runtime:${id}`,
      discoveryLayer: "ai_resource",
      evidence: [
        "Vertex AI endpoint is model-serving infrastructure",
        "Deployed models ≠ confirmed AI agent"
      ],
      runtimeStatusReason: "Endpoint deployedModels reflects serving runtime, not agent identity",
      agentRuntime: buildAgentAndRuntime({
        agentDetected: false,
        runtimeDetected: true,
        runtimeStatus,
        runtimeType: "vertex_endpoint",
        runtimeId: id,
        runtimeName: name,
        resourceId: id,
        region
      }),
      extra
    });
  }

  if (
    classification.category === "vertex_model" ||
    classification.category === "discovery_engine" ||
    classification.category === "enabled_ai_api"
  ) {
    return gcpObservation({
      conn,
      id,
      name,
      gcpType,
      service,
      region,
      classification,
      model,
      fingerprint: `gcp:${id}`,
      discoveryLayer: "ai_resource",
      evidence: [...(classification.evidence || []), "AI resource only — not an agent"],
      agentRuntime: buildAgentAndRuntime({ agentDetected: false }),
      extra
    });
  }

  if (classification.category === "cloud_run") {
    const runtimeStatus = normalizeRuntimeStatus(status) === "unknown" ? mapCloudRunReady(extra.readyState) : normalizeRuntimeStatus(status);
    return gcpObservation({
      conn,
      id,
      name,
      gcpType,
      service,
      region,
      classification,
      model,
      fingerprint: `gcp-runtime:${id}`,
      discoveryLayer: "agent_candidate",
      inventoryClass: "ai_cloud_agent",
      confidence: 0.7,
      evidence: [
        "Cloud Run matched AI workload heuristics (name/labels/images/env names)",
        "Heuristic detection is never marked confirmed",
        "Ready condition is compute runtime, not confirmed agent execution"
      ],
      runtimeStatusReason: "Cloud Run Ready ≠ confirmed AI agent running",
      agentRuntime: buildAgentAndRuntime({
        agentDetected: true,
        detectionMethod: "runtime_heuristic",
        agentId: id,
        agentName: name,
        agentType: "cloud_run_workload",
        agentStatus: "candidate",
        agentRuntimeStatus: "unknown",
        deploymentStatus: extra.readyState || status || null,
        source: "gcp_cloud_run_heuristic",
        runtimeDetected: true,
        runtimeStatus,
        runtimeType: "gcp_cloud_run",
        runtimeId: id,
        runtimeName: name,
        resourceId: id,
        region
      }),
      relationships: cloudRelationship(id, name, [
        { rel_type: "HOSTED_BY", to_type: "CloudResource", to_key: id, to_name: name },
        { rel_type: "RUNS_ON", to_type: "GcpRuntime", to_key: id, to_name: name }
      ]),
      extra
    });
  }

  return gcpObservation({
    conn,
    id,
    name,
    gcpType,
    service,
    region,
    classification,
    model,
    extra,
    agentRuntime: buildAgentAndRuntime({ agentDetected: false })
  });
}

export async function discoverGcpConnector(conn) {
  const cfg = requireGcpConfig(conn);
  const validation = await validateGcpConnector(conn);
  const token = validation.accessToken;
  const discoveryErrors = [];
  const stats = emptyDiscoveryStats();

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
      agent: emptyAgentBlock(),
      runtime: emptyRuntimeBlock(),
      metadata: {
        connectorId: conn.id,
        connectorName: conn.name,
        discoveryMode: "gcp-api-live",
        discoveryLayer: "connector",
        projectId: cfg.projectId,
        projectNumber: validation.project?.projectNumber || null,
        inventoryClass: "connector_scan",
        environment: conn.environment,
        maxResources: GCP_MAX_RESOURCES,
        agentScan: GCP_DISCOVERY_AGENT_SCAN,
        runtimeScan: GCP_DISCOVERY_RUNTIME_SCAN,
        aiOnly: EFFECTIVE_GCP_AI_ONLY
      },
      relationships: cloudRelationship(`gcp-project-${cfg.projectId}`, `GCP project ${cfg.projectId}`)
    }
  ];

  const resourceGroups = await Promise.all([
    listVertexResources(cfg.projectId, token, discoveryErrors).catch((err) => {
      discoveryErrors.push({
        discoveryType: "vertex-resources",
        discoveryStatus: "error",
        error: sanitizeCloudError(err)
      });
      return [];
    }),
    listLegacyAiModels(cfg.projectId, token, discoveryErrors).catch(() => []),
    listDiscoveryEngines(cfg.projectId, token, discoveryErrors).catch(() => []),
    GCP_DISCOVERY_RUNTIME_SCAN
      ? listAiCloudRunServices(cfg.projectId, token, discoveryErrors).catch((err) => {
          discoveryErrors.push({
            discoveryType: "cloud-run",
            discoveryStatus: "error",
            error: sanitizeCloudError(err)
          });
          return [];
        })
      : Promise.resolve([]),
    GCP_DISCOVERY_AGENT_SCAN
      ? listDialogflowCxAgents(cfg.projectId, token, discoveryErrors).catch((err) => {
          discoveryErrors.push({
            discoveryType: "dialogflow-cx",
            discoveryStatus: "error",
            error: sanitizeCloudError(err)
          });
          return [];
        })
      : Promise.resolve([]),
    GCP_DISCOVERY_AGENT_SCAN
      ? listVertexReasoningEngines(cfg.projectId, token, discoveryErrors).catch((err) => {
          discoveryErrors.push({
            discoveryType: "vertex-reasoning-engines",
            discoveryStatus: "error",
            error: sanitizeCloudError(err)
          });
          return [];
        })
      : Promise.resolve([])
  ]);
  let resources = resourceGroups.flat();

  if (!resources.length) {
    resources = await listEnabledAiApis(cfg.projectId, token, discoveryErrors).catch(() => []);
  }

  stats.totalResourcesScanned = resources.length;
  stats.aiRelevantResources = resources.filter((r) => classifyGcpResource(r).aiRelevant).length;

  for (const resource of resources.slice(0, GCP_MAX_RESOURCES)) {
    try {
      const classif = classifyGcpResource(resource);
      if (EFFECTIVE_GCP_AI_ONLY && !classif.aiRelevant) {
        stats.nonAiResourcesSkipped += 1;
        continue;
      }
      observations.push(toLayeredObservation(conn, resource));
    } catch (err) {
      discoveryErrors.push({
        resourceId: resource.id,
        discoveryType: "resource-scan",
        discoveryStatus: err.permissionDenied ? "permission_denied" : "error",
        error: sanitizeCloudError(err)
      });
    }
  }

  const selected = dedupeObservationsByFingerprint(observations);
  for (const obs of selected) tallyDiscoveryObservation(stats, obs);
  stats.discoveryErrors = discoveryErrors.length;

  if (selected[0]?.metadata) {
    Object.assign(selected[0].metadata, {
      ...stats,
      discoveryErrorSamples: discoveryErrors.slice(0, 25)
    });
  }

  return {
    observations: selected,
    stats,
    discoveryErrors
  };
}

export { classifyGcpResource };
