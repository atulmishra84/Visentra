/**
 * Azure deep discovery: Foundry/agents + compute runtime APIs.
 * Uses official Azure REST endpoints via safeFetch (no invented URLs).
 *
 * APIs used (Microsoft docs):
 * - ARM Cognitive Services Projects list — api-version=2025-06-01
 * - ARM Cognitive Services Accounts get — api-version=2025-06-01
 * - Foundry Agents list — {endpoint}/agents?api-version=v1
 * - Foundry Agent container get — .../containers/default?api-version=v1
 * - Classic Assistants list — {endpoint}/assistants?api-version=2025-05-01
 * - Container Apps get/revisions — api-version=2024-03-01
 * - Web Sites get — api-version=2023-12-01
 * - VM instance view — api-version=2024-07-01
 * - AKS listClusterUserCredential — api-version=2024-01-01
 */

import { safeFetch, assertAllowedUrl, ALLOW } from "../utils/http.js";
import { isAiRelevantText } from "./aiRelevance.js";

export const COGNITIVE_API_VERSION = "2025-06-01";
export const CONTAINER_APPS_API_VERSION = "2024-03-01";
export const WEB_API_VERSION = "2023-12-01";
export const VM_API_VERSION = "2024-07-01";
export const AKS_API_VERSION = "2024-01-01";
export const FOUNDRY_AGENTS_API_VERSION = "v1";
export const ASSISTANTS_API_VERSION = "2025-05-01";

const SECRET_ENV_RE = /secret|token|key|password|connectionstring|connection_string|apikey|api_key|credential|private/i;

/**
 * Strip credentials / bearer tokens from error messages.
 */
export function sanitizeAzureError(error) {
  let message = String(error?.message || error || "unknown error");
  message = message.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [REDACTED]");
  message = message.replace(/client_secret=[^&\s]+/gi, "client_secret=[REDACTED]");
  message = message.replace(/access_token[=:][^&\s"]+/gi, "access_token=[REDACTED]");
  message = message.replace(/eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g, "[REDACTED_JWT]");
  return message.slice(0, 500);
}

export function parseResourceId(resourceId) {
  const parts = String(resourceId || "").split("/").filter(Boolean);
  const idx = (name) => {
    const i = parts.findIndex((p) => p.toLowerCase() === name.toLowerCase());
    return i >= 0 ? parts[i + 1] : null;
  };
  return {
    subscriptionId: idx("subscriptions"),
    resourceGroup: idx("resourceGroups"),
    provider: idx("providers"),
    name: parts[parts.length - 1] || null,
    parts
  };
}

export function emptyAgentBlock(overrides = {}) {
  return {
    detected: false,
    detectionMethod: null,
    agentId: null,
    agentName: null,
    agentType: null,
    agentStatus: null,
    runtimeStatus: null,
    deploymentStatus: null,
    lastSeenAt: null,
    source: null,
    ...overrides
  };
}

export function emptyRuntimeBlock(overrides = {}) {
  return {
    detected: false,
    status: null,
    runtimeType: null,
    runtimeId: null,
    runtimeName: null,
    resourceId: null,
    region: null,
    ...overrides
  };
}

export function normalizeRuntimeStatus(raw) {
  const v = String(raw || "").toLowerCase();
  if (!v || v === "null" || v === "undefined") return "unknown";
  if (/^(running|ready|succeeded|active|online|healthy|started)$/.test(v)) return "running";
  if (/^(stopped|deallocated|disabled|inactive|suspended|offline)$/.test(v)) return "stopped";
  if (/^(failed|error|unhealthy|crashloop|terminated)$/.test(v)) return "failed";
  if (/starting|stopping|updating|creating|deleting|pending|provisioning/.test(v)) return "unknown";
  return "unknown";
}

function mapContainerStatus(status) {
  const v = String(status || "");
  if (/^Running$/i.test(v)) return "running";
  if (/^(Stopped|Deleted)$/i.test(v)) return "stopped";
  if (/^Failed$/i.test(v)) return "failed";
  return "unknown";
}

/**
 * ARM GET helper. optional=true returns { ok:false, status, permissionDenied } instead of throwing.
 */
export async function armGet(token, url, { optional = false } = {}) {
  assertAllowedUrl(url, ALLOW.azureArm);
  const res = await safeFetch(
    url,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
    ALLOW.azureArm
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const permissionDenied = res.status === 401 || res.status === 403;
    if (optional) {
      return {
        ok: false,
        status: res.status,
        permissionDenied,
        error: sanitizeAzureError(json.error?.message || `ARM GET failed (${res.status})`),
        json
      };
    }
    const err = new Error(json.error?.message || `ARM GET failed (${res.status})`);
    err.status = res.status;
    err.permissionDenied = permissionDenied;
    throw err;
  }
  return { ok: true, status: res.status, json, permissionDenied: false };
}

export async function dataPlaneGet(token, url, policy, { optional = true, headers = {} } = {}) {
  assertAllowedUrl(url, policy);
  const res = await safeFetch(
    url,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...headers
      }
    },
    policy
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const permissionDenied = res.status === 401 || res.status === 403;
    if (optional) {
      return {
        ok: false,
        status: res.status,
        permissionDenied,
        error: sanitizeAzureError(
          json.error?.message || json.message || `Data-plane GET failed (${res.status})`
        ),
        json
      };
    }
    const err = new Error(json.error?.message || json.message || `Data-plane GET failed (${res.status})`);
    err.status = res.status;
    err.permissionDenied = permissionDenied;
    throw err;
  }
  return { ok: true, status: res.status, json, permissionDenied: false };
}

export async function getCognitiveAccount(token, resource) {
  const { subscriptionId, resourceGroup, name } = parseResourceId(resource.id);
  if (!subscriptionId || !resourceGroup || !name) return null;
  const url =
    `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}` +
    `/providers/Microsoft.CognitiveServices/accounts/${encodeURIComponent(name)}` +
    `?api-version=${COGNITIVE_API_VERSION}`;
  const result = await armGet(token, url, { optional: true });
  if (!result.ok) return result;
  return { ok: true, account: result.json };
}

export async function listCognitiveProjects(token, resource) {
  const { subscriptionId, resourceGroup, name } = parseResourceId(resource.id);
  if (!subscriptionId || !resourceGroup || !name) return { ok: true, projects: [] };
  const url =
    `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}` +
    `/providers/Microsoft.CognitiveServices/accounts/${encodeURIComponent(name)}/projects` +
    `?api-version=${COGNITIVE_API_VERSION}`;
  const result = await armGet(token, url, { optional: true });
  if (!result.ok) return { ...result, projects: [] };
  return { ok: true, projects: result.json.value || [] };
}

function accountEndpointHost(account) {
  const props = account?.properties || {};
  const endpoints = props.endpoints || {};
  const endpoint =
    props.endpoint ||
    endpoints["AI Foundry API"] ||
    endpoints.OpenAI ||
    endpoints["Azure OpenAI"] ||
    null;
  const subdomain = props.customSubDomainName;
  if (endpoint) {
    try {
      return new URL(endpoint).hostname;
    } catch {
      /* fall through */
    }
  }
  if (subdomain) return `${subdomain}.services.ai.azure.com`;
  return null;
}

function foundryProjectEndpoint(accountNameOrHost, projectName) {
  const host = String(accountNameOrHost || "").includes(".")
    ? accountNameOrHost
    : `${accountNameOrHost}.services.ai.azure.com`;
  const project = encodeURIComponent(projectName || "_project");
  return `https://${host}/api/projects/${project}`;
}

/**
 * List Foundry agents for a project (official Agents API, api-version=v1).
 */
export async function listFoundryAgents(dataToken, projectEndpoint) {
  const url = `${projectEndpoint}/agents?api-version=${FOUNDRY_AGENTS_API_VERSION}&limit=100`;
  const result = await dataPlaneGet(dataToken, url, ALLOW.azureAiServices, { optional: true });
  if (!result.ok) return { ...result, agents: [] };
  const agents = result.json.data || result.json.value || result.json.agents || [];
  return { ok: true, agents: Array.isArray(agents) ? agents : [] };
}

/**
 * Optional container runtime status for hosted Foundry agents.
 */
export async function getFoundryAgentContainer(dataToken, projectEndpoint, agentName, agentVersion) {
  if (!agentName || !agentVersion) return { ok: false, status: null };
  const url =
    `${projectEndpoint}/agents/${encodeURIComponent(agentName)}` +
    `/versions/${encodeURIComponent(agentVersion)}/containers/default` +
    `?api-version=${FOUNDRY_AGENTS_API_VERSION}`;
  const result = await dataPlaneGet(dataToken, url, ALLOW.azureAiServices, {
    optional: true,
    headers: { "Foundry-Features": "ContainerAgents=V1Preview,HostedAgents=V1Preview" }
  });
  if (!result.ok) return { ...result, container: null };
  return { ok: true, container: result.json };
}

/**
 * Classic Assistants API (Azure OpenAI / Foundry-compatible).
 */
export async function listAssistants(dataToken, accountHost) {
  if (!accountHost) return { ok: false, assistants: [] };
  const base = accountHost.includes(".")
    ? `https://${accountHost}`
    : `https://${accountHost}.openai.azure.com`;
  // Prefer AI Services host shape; fall back to openai.azure.com style.
  const candidates = [
    `${base.replace(/\/$/, "")}/openai/assistants?api-version=${ASSISTANTS_API_VERSION}`,
    `https://${String(accountHost).replace(/\.services\.ai\.azure\.com$/i, "")}.openai.azure.com/openai/assistants?api-version=${ASSISTANTS_API_VERSION}`
  ];
  for (const url of candidates) {
    try {
      const host = new URL(url).hostname;
      const policy = host.endsWith("openai.azure.com")
        ? ALLOW.azureOpenAi
        : host.endsWith("services.ai.azure.com")
          ? ALLOW.azureAiServices
          : null;
      if (!policy) continue;
      const result = await dataPlaneGet(dataToken, url, policy, { optional: true });
      if (result.ok) {
        const assistants = result.json.data || result.json.value || [];
        return { ok: true, assistants: Array.isArray(assistants) ? assistants : [] };
      }
      if (result.permissionDenied) return { ...result, assistants: [] };
    } catch {
      /* try next */
    }
  }
  return { ok: false, assistants: [], error: "Assistants API unavailable" };
}

export async function getContainerApp(token, resource) {
  const { subscriptionId, resourceGroup, name } = parseResourceId(resource.id);
  if (!subscriptionId || !resourceGroup || !name) return { ok: false };
  const url =
    `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}` +
    `/providers/Microsoft.App/containerApps/${encodeURIComponent(name)}` +
    `?api-version=${CONTAINER_APPS_API_VERSION}`;
  return armGet(token, url, { optional: true });
}

export async function listContainerAppRevisions(token, resource) {
  const { subscriptionId, resourceGroup, name } = parseResourceId(resource.id);
  if (!subscriptionId || !resourceGroup || !name) return { ok: false, revisions: [] };
  const url =
    `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}` +
    `/providers/Microsoft.App/containerApps/${encodeURIComponent(name)}/revisions` +
    `?api-version=${CONTAINER_APPS_API_VERSION}`;
  const result = await armGet(token, url, { optional: true });
  if (!result.ok) return { ...result, revisions: [] };
  return { ok: true, revisions: result.json.value || [] };
}

export async function getWebSite(token, resource) {
  const { subscriptionId, resourceGroup, name } = parseResourceId(resource.id);
  if (!subscriptionId || !resourceGroup || !name) return { ok: false };
  const url =
    `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}` +
    `/providers/Microsoft.Web/sites/${encodeURIComponent(name)}` +
    `?api-version=${WEB_API_VERSION}`;
  return armGet(token, url, { optional: true });
}

export async function getVmInstanceView(token, resource) {
  const { subscriptionId, resourceGroup, name } = parseResourceId(resource.id);
  if (!subscriptionId || !resourceGroup || !name) return { ok: false };
  const url =
    `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}` +
    `/providers/Microsoft.Compute/virtualMachines/${encodeURIComponent(name)}/instanceView` +
    `?api-version=${VM_API_VERSION}`;
  return armGet(token, url, { optional: true });
}

export async function getAksCluster(token, resource) {
  const { subscriptionId, resourceGroup, name } = parseResourceId(resource.id);
  if (!subscriptionId || !resourceGroup || !name) return { ok: false };
  const url =
    `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}` +
    `/providers/Microsoft.ContainerService/managedClusters/${encodeURIComponent(name)}` +
    `?api-version=${AKS_API_VERSION}`;
  return armGet(token, url, { optional: true });
}

export async function listAksUserCredentials(token, resource) {
  const { subscriptionId, resourceGroup, name } = parseResourceId(resource.id);
  if (!subscriptionId || !resourceGroup || !name) return { ok: false };
  const url =
    `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}` +
    `/providers/Microsoft.ContainerService/managedClusters/${encodeURIComponent(name)}` +
    `/listClusterUserCredential?api-version=${AKS_API_VERSION}`;
  assertAllowedUrl(url, ALLOW.azureArm);
  const res = await safeFetch(
    url,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Length": "0" }
    },
    ALLOW.azureArm
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      permissionDenied: res.status === 401 || res.status === 403,
      error: sanitizeAzureError(json.error?.message || `AKS credentials failed (${res.status})`)
    };
  }
  return { ok: true, json };
}

function parseKubeconfigServerAndToken(kubeconfigs) {
  const raw = kubeconfigs?.[0]?.value;
  if (!raw) return null;
  let decoded = raw;
  try {
    if (!raw.includes("apiVersion") && !raw.includes("clusters:")) {
      decoded = Buffer.from(raw, "base64").toString("utf8");
    }
  } catch {
    decoded = raw;
  }
  const serverMatch = decoded.match(/server:\s*(\S+)/);
  const tokenMatch = decoded.match(/token:\s*(\S+)/);
  if (!serverMatch?.[1]) return null;
  return {
    server: serverMatch[1].replace(/"/g, ""),
    token: tokenMatch?.[1]?.replace(/"/g, "") || null
  };
}

/**
 * List AKS deployments via Kubernetes API when credentials are available.
 * Never returns secret values — only names, images, labels, env var NAMES.
 */
export async function listAksAiWorkloads(token, resource) {
  const creds = await listAksUserCredentials(token, resource);
  if (!creds.ok) return { ...creds, workloads: [] };
  const parsed = parseKubeconfigServerAndToken(creds.json.kubeconfigs || creds.json.kubeConfigs);
  if (!parsed?.server || !parsed.token) {
    return {
      ok: false,
      error: "AKS kubeconfig missing server/token",
      workloads: [],
      discoveryStatus: "unknown"
    };
  }

  let hostname;
  try {
    hostname = new URL(parsed.server).hostname;
  } catch {
    return { ok: false, error: "Invalid AKS API server URL", workloads: [] };
  }

  const policy = {
    ...ALLOW.azureAks,
    allowHosts: [...(ALLOW.azureAks.allowHosts || []), hostname]
  };

  const path = "/apis/apps/v1/deployments?limit=200";
  const url = `${parsed.server.replace(/\/$/, "")}${path}`;
  try {
    assertAllowedUrl(url, policy);
    const res = await safeFetch(
      url,
      {
        headers: { Authorization: `Bearer ${parsed.token}`, Accept: "application/json" },
        skipTlsVerify: true
      },
      policy
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        permissionDenied: res.status === 401 || res.status === 403,
        error: sanitizeAzureError(json.message || `K8s list deployments failed (${res.status})`),
        workloads: []
      };
    }

    const workloads = [];
    for (const item of json.items || []) {
      const containers = item.spec?.template?.spec?.containers || [];
      const images = containers.map((c) => c.image).filter(Boolean);
      const envNames = [];
      for (const c of containers) {
        for (const env of c.env || []) {
          if (env.name && !SECRET_ENV_RE.test(env.name)) envNames.push(env.name);
          else if (env.name) envNames.push(`${env.name}(redacted)`);
        }
      }
      const labels = { ...(item.metadata?.labels || {}), ...(item.spec?.template?.metadata?.labels || {}) };
      const blob = [
        item.metadata?.name,
        item.metadata?.namespace,
        Object.keys(labels).join(" "),
        Object.values(labels).join(" "),
        images.join(" "),
        envNames.join(" ")
      ].join(" ");
      if (!isAiRelevantText(blob)) continue;
      const ready = Number(item.status?.readyReplicas || 0);
      const desired = Number(item.status?.replicas || 0);
      let status = "unknown";
      if (ready > 0) status = "running";
      else if (desired === 0) status = "stopped";
      else if (item.status?.conditions?.some((c) => /fail|error/i.test(c.reason || c.type || ""))) {
        status = "failed";
      }
      workloads.push({
        name: item.metadata?.name,
        namespace: item.metadata?.namespace || "default",
        uid: item.metadata?.uid || null,
        images,
        envNames,
        labels,
        status,
        // Heuristic only — presence of "agent" in a name is not confirmation.
        heuristicAgent: isAiRelevantText(blob),
        nameOnlyAgentHint: /\bagent\b/i.test(String(item.metadata?.name || ""))
      });
    }
    return { ok: true, workloads };
  } catch (err) {
    return { ok: false, error: sanitizeAzureError(err), workloads: [] };
  }
}

/**
 * Extract safe (non-secret) signals from Container App / Web App configuration.
 */
export function extractSafeAppSignals(appJson) {
  const props = appJson?.properties || appJson || {};
  const template = props.template || {};
  const containers = [
    ...(template.containers || []),
    ...(template.initContainers || []),
    ...((props.siteConfig?.appSettings && []) || [])
  ];
  const images = [];
  const envNames = [];
  for (const c of containers) {
    if (c.image) images.push(c.image);
    for (const env of c.env || []) {
      const name = env.name || env.Name;
      if (!name) continue;
      envNames.push(SECRET_ENV_RE.test(name) ? `${name}(redacted)` : name);
    }
  }
  // App Service siteConfig may list appSetting names without values in some APIs;
  // never include values.
  const linuxFx = props.siteConfig?.linuxFxVersion || props.siteConfig?.windowsFxVersion || null;
  const kind = appJson?.kind || props.kind || null;
  const tags = appJson?.tags || {};
  return {
    images,
    envNames,
    linuxFx,
    kind,
    tags,
    runningStatus: props.runningStatus || props.state || null,
    provisioningState: props.provisioningState || null,
    latestRevisionName: props.latestRevisionName || null,
    latestRevisionFqdn: props.latestRevisionFqdn || null
  };
}

export function isHeuristicAiWorkload(signals, resource) {
  const blob = [
    resource?.name,
    resource?.kind,
    signals.kind,
    signals.linuxFx,
    signals.images.join(" "),
    signals.envNames.join(" "),
    Object.keys(signals.tags || {}).join(" "),
    Object.values(signals.tags || {}).join(" ")
  ].join(" ");
  return isAiRelevantText(blob);
}

/**
 * Discover Foundry/OpenAI agents for a Cognitive Services account.
 */
export async function discoverCognitiveAgents({
  armToken,
  dataToken,
  resource,
  classification,
  discoveryErrors
}) {
  const findings = [];
  const accountResult = await getCognitiveAccount(armToken, resource);
  if (accountResult && accountResult.ok === false) {
    discoveryErrors.push({
      resourceId: resource.id,
      discoveryType: "cognitive-account",
      discoveryStatus: accountResult.permissionDenied ? "permission_denied" : "error",
      error: accountResult.error
    });
  }

  const account = accountResult?.account || resource;
  const host = accountEndpointHost(account) || account?.properties?.customSubDomainName;
  const projectsResult = await listCognitiveProjects(armToken, resource);
  if (!projectsResult.ok && projectsResult.permissionDenied) {
    discoveryErrors.push({
      resourceId: resource.id,
      discoveryType: "foundry-projects",
      discoveryStatus: "permission_denied",
      error: projectsResult.error
    });
  }

  let projects = projectsResult.projects || [];
  if (!projects.length && host) {
    projects = [{ name: "_project", properties: { isDefault: true } }];
  }

  for (const project of projects.slice(0, 20)) {
    const projectName = project.name || project.properties?.displayName || "_project";
    if (!host) {
      discoveryErrors.push({
        resourceId: resource.id,
        discoveryType: "foundry-agent",
        discoveryStatus: "unknown",
        error: "Cognitive account endpoint/customSubDomainName unavailable"
      });
      break;
    }
    const projectEndpoint = foundryProjectEndpoint(host, projectName);
    const agentsResult = await listFoundryAgents(dataToken, projectEndpoint);
    if (!agentsResult.ok) {
      discoveryErrors.push({
        resourceId: resource.id,
        discoveryType: "foundry-agent",
        discoveryStatus: agentsResult.permissionDenied ? "permission_denied" : "error",
        error: agentsResult.error,
        projectName
      });
    }

    for (const agent of agentsResult.agents || []) {
      const agentName = agent.name || agent.id;
      const agentId = agent.id || agentName;
      const latest = agent.versions?.latest || agent.version || {};
      const agentKind = latest.definition?.kind || agent.kind || agent.object || "agent";
      const version = latest.version || latest.id || null;
      let runtimeStatus = "unknown";
      let runtimeReason =
        "Foundry prompt/workflow agents do not expose continuous runtime state via the Agents API";
      let deploymentStatus = null;
      let containerAppId = latest.definition?.container_app_resource_id || null;

      if (/hosted|container_app/i.test(String(agentKind))) {
        const containerResult = await getFoundryAgentContainer(
          dataToken,
          projectEndpoint,
          agentName,
          version
        );
        if (containerResult.ok && containerResult.container) {
          runtimeStatus = mapContainerStatus(containerResult.container.status);
          deploymentStatus = containerResult.container.status || null;
          runtimeReason = `Foundry agent container status=${containerResult.container.status}`;
        } else if (containerResult.permissionDenied) {
          discoveryErrors.push({
            resourceId: resource.id,
            discoveryType: "foundry-agent-container",
            discoveryStatus: "permission_denied",
            error: containerResult.error,
            agentId
          });
          runtimeReason = "permission_denied reading Foundry agent container status";
        } else {
          runtimeReason =
            containerResult.error ||
            "Hosted agent container status unavailable; runtime marked unknown";
        }
      }

      findings.push({
        kind: "agent",
        detectionMethod: "azure_foundry_api",
        agentId,
        agentName,
        agentType: agentKind,
        agentStatus: "confirmed",
        runtimeStatus,
        deploymentStatus,
        lastSeenAt: latest.created_at
          ? new Date(Number(latest.created_at) * 1000).toISOString()
          : null,
        source: "azure_foundry_agents",
        projectName,
        projectEndpoint,
        resourceId: resource.id,
        region: resource.location || account.location || null,
        confidence: 0.96,
        evidence: [
          "Agent resource returned by Azure Foundry Agents API",
          `Project=${projectName}`,
          runtimeReason
        ],
        runtimeReason,
        containerAppId,
        classification,
        // List/detail signals for metadata.deep + adversarial_surface alignment
        foundationModel: latest.definition?.model || agent.model || null,
        description: latest.definition?.description || agent.description || null,
        instructionText:
          latest.definition?.instructions ||
          latest.definition?.system_prompt ||
          agent.instructions ||
          null,
        tools:
          latest.definition?.tools ||
          latest.definition?.actions ||
          agent.tools ||
          [],
        knowledgeBases:
          latest.definition?.knowledge_bases ||
          latest.definition?.vector_stores ||
          [],
      });
    }
  }

  // Classic Assistants API (may coexist on OpenAI / AIServices accounts)
  if (host && /openai|aiservices/i.test(String(resource.kind || classification.category || ""))) {
    const assistantsResult = await listAssistants(dataToken, host);
    if (!assistantsResult.ok && assistantsResult.permissionDenied) {
      discoveryErrors.push({
        resourceId: resource.id,
        discoveryType: "openai-assistants",
        discoveryStatus: "permission_denied",
        error: assistantsResult.error
      });
    }
    for (const assistant of assistantsResult.assistants || []) {
      const agentId = assistant.id;
      if (!agentId) continue;
      // Skip if already discovered via Foundry agents API under same id/name
      if (findings.some((f) => f.agentId === agentId || f.agentName === assistant.name)) continue;
      findings.push({
        kind: "agent",
        detectionMethod: "azure_assistants_api",
        agentId,
        agentName: assistant.name || agentId,
        agentType: "assistant",
        agentStatus: "confirmed",
        runtimeStatus: "unknown",
        deploymentStatus: null,
        lastSeenAt: assistant.created_at
          ? new Date(Number(assistant.created_at) * 1000).toISOString()
          : null,
        source: "azure_openai_assistants",
        projectName: null,
        projectEndpoint: null,
        resourceId: resource.id,
        region: resource.location || null,
        confidence: 0.95,
        evidence: [
          "Assistant returned by Azure OpenAI Assistants API",
          "Assistants API does not expose continuous runtime/execution state"
        ],
        runtimeReason: "Assistants API has no durable runtime status field",
        containerAppId: null,
        classification,
        foundationModel: assistant.model || null,
        description: assistant.description || null,
        instructionText: assistant.instructions || null,
        tools: Array.isArray(assistant.tools) ? assistant.tools : [],
        knowledgeBases: Array.isArray(assistant.tool_resources?.file_search?.vector_store_ids)
          ? assistant.tool_resources.file_search.vector_store_ids.map((id) => ({
              id,
              name: id,
              type: "vector_store",
            }))
          : [],
      });
    }
  }

  return findings;
}

export function powerStateFromInstanceView(instanceView) {
  const statuses = instanceView?.statuses || [];
  const power = statuses.find((s) => String(s.code || "").startsWith("PowerState/"));
  if (!power) return "unknown";
  const code = String(power.code || "").split("/")[1] || "";
  return normalizeRuntimeStatus(code);
}
