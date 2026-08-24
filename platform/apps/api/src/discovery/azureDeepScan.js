/**
 * Unified Azure ecosystem deep discovery — single scanner.
 *
 * Merged 2026-08-24: this file used to cover only ARM (management.azure.com)
 * resources. It now also covers the four planes that a subscription-scoped
 * ARM scan structurally cannot see, because they live outside ARM entirely:
 *
 *   1. ARM                — Azure AI Foundry / OpenAI, Bot Service, ML
 *                            workspaces, Container Apps, AKS, Web/Functions,
 *                            VMs (unchanged from before the merge)
 *   2. Entra Agent ID      — Microsoft Graph service principals with
 *                            servicePrincipalType=ServiceIdentity (the real
 *                            agent-identity type; covers Copilot Studio +
 *                            Agent 365 agents regardless of naming)
 *   3. Power Platform      — Copilot Studio agents stored as Dataverse `bot`
 *                            records, per environment
 *   4. Teams               — org app catalog, flags bot/agent manifests
 *   5. M365 Agent Registry — disabled stub (Defender XDR / Advanced Hunting
 *                            not licensed for this tenant); one config flag
 *                            + the query in discoverM365AgentRegistry() away
 *                            from being enabled later
 *
 * Call discoverAzureEcosystem(conn) for the combined single-scanner result.
 * The original discoverAzureConnector(conn) (ARM only) is preserved
 * unchanged for any caller that still wants ARM-only behavior/stats shape.
 *
 * `azureArm.js` is now a re-export shim pointing at this file — no other
 * file in the codebase should need to change.
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
 * - Microsoft Graph servicePrincipals (Entra Agent ID) — v1.0
 * - Microsoft Graph appCatalogs/teamsApps — v1.0
 * - Power Platform Admin API environments — api-version=2023-06-01
 * - Dataverse Web API bots — v9.2
 *
 * NEW SETUP REQUIRED IN utils/http.js:
 * This file references ALLOW.graphMicrosoft (already used by entraIdentity.js
 * and agent365DeepScan.js — should already exist), plus two NEW policy keys
 * that were not part of the original ARM-only file: ALLOW.powerPlatformAdmin
 * and ALLOW.dataverse. If those aren't yet defined in utils/http.js, this
 * file falls back to inline allow-lists (see FALLBACK_* constants below) so
 * it still runs — but add real entries to utils/http.js for consistency with
 * how every other host allowlist in this codebase is centrally audited:
 *
 *   powerPlatformAdmin: { allowHosts: ["api.bap.microsoft.com", "api.powerplatform.com"] },
 *   dataverse: { allowHosts: [] }, // extended per-environment at call time, like ALLOW.azureAks
 */

import { safeFetch, assertAllowedUrl, ALLOW } from "../utils/http.js";
import {
  DISCOVERY_AI_ONLY,
  classifyAzureResource,
  isAzureAiResource,
  shouldIngestAiOnly,
  isAiRelevantText
} from "./aiRelevance.js";
import { alignObservationWithDeepSurface } from "./providerDeepAlign.js";

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

/* =========================================================================
 * ARM connector orchestration (moved from azureArm.js as part of the merge)
 * ========================================================================= */

const MAX_RESOURCES = Number(
  process.env.AZURE_DISCOVERY_MAX_RESOURCES || process.env.DISCOVERY_MAX_RESOURCES || 500
);

const AZURE_DISCOVERY_AGENT_SCAN =
  String(process.env.AZURE_DISCOVERY_AGENT_SCAN || "true").toLowerCase() !== "false";

const AZURE_DISCOVERY_RUNTIME_SCAN =
  String(process.env.AZURE_DISCOVERY_RUNTIME_SCAN || "true").toLowerCase() !== "false";

/** Effective AI-only flag (AZURE_DISCOVERY_AI_ONLY overrides, else DISCOVERY_AI_ONLY). */
export const EFFECTIVE_AZURE_AI_ONLY =
  process.env.AZURE_DISCOVERY_AI_ONLY != null
    ? String(process.env.AZURE_DISCOVERY_AI_ONLY).toLowerCase() !== "false"
    : DISCOVERY_AI_ONLY;

/** @deprecated use isAzureAiResource — kept for tests/callers */
export function isAiRelevant(resource) {
  return isAzureAiResource(resource);
}

export { classifyAzureResource, isAzureAiResource };

const ARM_SCOPE = "https://management.azure.com/.default";
const AI_DATA_SCOPE = "https://ai.azure.com/.default";
const COGNITIVE_SCOPE = "https://cognitiveservices.azure.com/.default";

export async function getAzureAccessToken({ tenantId, clientId, clientSecret, scope = ARM_SCOPE }) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope
  });

  const res = await safeFetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    },
    ALLOW.microsoftLogin
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      sanitizeAzureError(json.error_description || json.error || `Azure token failed (${res.status})`)
    );
  }
  return json.access_token;
}

async function getOptionalToken(creds, scope) {
  try {
    return await getAzureAccessToken({ ...creds, scope });
  } catch {
    return null;
  }
}

async function listSubscriptionResources(token, subscriptionId) {
  const resources = [];
  let url =
    `https://management.azure.com/subscriptions/${subscriptionId}/resources` +
    `?api-version=2021-04-01`;

  while (url) {
    assertAllowedUrl(url, ALLOW.azureArm);
    const res = await safeFetch(
      url,
      {
        headers: { Authorization: `Bearer ${token}` }
      },
      ALLOW.azureArm
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        sanitizeAzureError(json.error?.message || `Azure resource list failed (${res.status})`)
      );
    }
    resources.push(...(json.value || []));
    url = json.nextLink || null;
  }
  return resources;
}

function baseObservationFields(conn) {
  return {
    collector_id: "cloud_azure",
    category: "cloud",
    cloud_provider: "azure",
    provider: "azure",
    deployment_type: "cloud"
  };
}

function buildAgentAndRuntime({
  agentDetected = false,
  detectionMethod = null,
  agentId = null,
  agentName = null,
  agentType = null,
  agentStatus = null,
  agentRuntimeStatus = null,
  deploymentStatus = null,
  lastSeenAt = null,
  source = null,
  runtimeDetected = false,
  runtimeStatus = null,
  runtimeType = null,
  runtimeId = null,
  runtimeName = null,
  resourceId = null,
  region = null
} = {}) {
  return {
    agent: emptyAgentBlock({
      detected: agentDetected,
      detectionMethod,
      agentId,
      agentName,
      agentType,
      agentStatus,
      runtimeStatus: agentRuntimeStatus,
      deploymentStatus,
      lastSeenAt,
      source
    }),
    runtime: emptyRuntimeBlock({
      detected: runtimeDetected,
      status: runtimeStatus,
      runtimeType,
      runtimeId,
      runtimeName,
      resourceId,
      region
    })
  };
}

/**
 * Build observation for an Azure ARM resource (AI platform or compute host).
 * Does NOT claim agent confirmed merely because the resource type is AI-related.
 */
export function resourceToObservation(resource, conn, classification, extras = {}) {
  const tags = resource.tags || {};
  const type = resource.type || "unknown";
  const shortType = type.split("/").slice(-1)[0];
  const displayName = resource.name || shortType;
  const aiRelevant = classification?.aiRelevant === true;
  const category = classification?.category || (aiRelevant ? "unknown_ai_resource" : "non_ai");
  const parsed = parseResourceId(resource.id);

  const agentRuntime = extras.agentRuntime || buildAgentAndRuntime();
  const agent = agentRuntime.agent;
  const runtime = agentRuntime.runtime;

  // running_status stays unknown unless we have runtime evidence for THIS observation.
  // VM power / ACA running does not imply agent running — that lives on agent.runtimeStatus.
  let runningStatus = "unknown";
  if (runtime.detected && runtime.status) {
    runningStatus = runtime.status;
  }
  if (extras.runningStatus) runningStatus = extras.runningStatus;

  const evidence = [
    ...(classification?.evidence || []),
    ...(extras.evidence || [])
  ];

  let confidence = classification?.confidence ?? (aiRelevant ? 0.8 : 0.7);
  if (typeof extras.confidence === "number") confidence = extras.confidence;

  // Legacy metadata.agentStatus: only set when an agent was actually detected.
  let legacyAgentStatus = null;
  if (agent.detected) {
    legacyAgentStatus =
      agent.detectionMethod === "runtime_heuristic" || agent.detectionMethod === "name_heuristic"
        ? "candidate"
        : "confirmed";
  }

  const inventoryClass = extras.inventoryClass
    || (agent.detected
      ? "ai_cloud_agent"
      : aiRelevant
        ? "ai_cloud_resource"
        : "cloud_resource");

  // evidenceClass: confirmed agents and AI runtimes; pure AI resources stay inventory-only.
  let evidenceClass = null;
  if (agent.detected && legacyAgentStatus === "confirmed") evidenceClass = "cloud_ai_runtime";
  else if (agent.detected) evidenceClass = "cloud_ai_runtime";
  else if (aiRelevant && classification?.layer === "ai_resource") evidenceClass = null;

  const relationships = extras.relationships || [
    {
      rel_type: "DEPLOYED_IN",
      to_type: "CloudResource",
      to_key: resource.id,
      to_name: displayName
    },
    {
      rel_type: "HOSTED_BY",
      to_type: "CloudResource",
      to_key: resource.id,
      to_name: displayName
    }
  ];

  return {
    ...baseObservationFields(conn),
    fingerprint: extras.fingerprint || `azure:${resource.id}`,
    name: extras.name || (aiRelevant ? `${displayName} (AI)` : displayName),
    region: resource.location || null,
    endpoint: resource.id,
    running_status: runningStatus,
    confidence_score: confidence,
    owner: tags.owner || tags.Owner || null,
    department: tags.department || tags.Department || null,
    business_unit: tags.businessUnit || tags.bu || null,
    framework: extras.framework || shortType,
    model: extras.model || (agent.detected ? "azure-ai-agent" : aiRelevant ? "ai-relevant" : null),
    agent,
    runtime,
    metadata: {
      connectorId: conn.id,
      connectorName: conn.name,
      discoveryMode: extras.discoveryMode || "azure-arm-live",
      discoveryLayer: extras.discoveryLayer || classification?.layer || "resource",
      subscriptionId: conn.config.subscriptionId,
      tenantId: conn.config.tenantId || null,
      azureResourceId: resource.id,
      azureType: type,
      azureKind: resource.kind || null,
      resourceGroup: parsed.resourceGroup,
      aiRelevant,
      aiResourceType: category,
      agentDetected: agent.detected,
      agentDetectionMethod: agent.detectionMethod,
      runtimeDetected: runtime.detected,
      runtimeType: runtime.runtimeType,
      runtimeStatus: runtime.status,
      evidenceClass,
      evidence,
      inventoryClass,
      // Legacy fields — preserved for consumers; meanings tightened:
      // agentStatus is null unless an agent was detected (not merely an AI resource).
      agentStatus: legacyAgentStatus,
      managedCloudAgent: Boolean(
        agent.detected &&
          agent.detectionMethod &&
          /azure_foundry_api|azure_assistants_api|azure_bot_service_arm/.test(agent.detectionMethod)
      ),
      discoveryStatus: extras.discoveryStatus || null,
      runtimeStatusReason: extras.runtimeStatusReason || null,
      tags,
      ...((extras.metadata && typeof extras.metadata === "object") ? extras.metadata : {})
    },
    relationships
  };
}

function agentObservationFromFinding(finding, resource, conn, classification) {
  const agentId = finding.agentId;
  const runtimeDetected = finding.runtimeStatus && finding.runtimeStatus !== "unknown"
    ? true
    : Boolean(finding.containerAppId);
  const agentRuntime = buildAgentAndRuntime({
    agentDetected: true,
    detectionMethod: finding.detectionMethod,
    agentId,
    agentName: finding.agentName,
    agentType: finding.agentType,
    agentStatus: finding.agentStatus,
    agentRuntimeStatus: finding.runtimeStatus || "unknown",
    deploymentStatus: finding.deploymentStatus,
    lastSeenAt: finding.lastSeenAt,
    source: finding.source,
    runtimeDetected,
    runtimeStatus: finding.runtimeStatus || "unknown",
    runtimeType: finding.containerAppId
      ? "azure_container_app"
      : /hosted|container_app/i.test(String(finding.agentType || ""))
        ? "azure_foundry_hosted"
        : "azure_foundry_agent",
    runtimeId: finding.containerAppId || agentId,
    runtimeName: finding.agentName,
    resourceId: resource.id,
    region: finding.region || resource.location || null
  });

  const relationships = [
    {
      rel_type: "HOSTED_BY",
      to_type: "CloudResource",
      to_key: resource.id,
      to_name: resource.name
    },
    {
      rel_type: "DEPLOYED_IN",
      to_type: "CloudResource",
      to_key: resource.id,
      to_name: resource.name
    }
  ];
  if (finding.containerAppId) {
    relationships.push({
      rel_type: "RUNS_ON",
      to_type: "AzureRuntime",
      to_key: finding.containerAppId,
      to_name: finding.agentName
    });
  }

  return alignObservationWithDeepSurface(
    resourceToObservation(resource, conn, classification, {
      fingerprint: `azure-agent:${conn.config.subscriptionId}:${agentId}`,
      name: `${finding.agentName || agentId} (Azure Agent)`,
      framework: finding.agentType || "azure-agent",
      model: finding.foundationModel || finding.agentType || "azure-foundry-agent",
      confidence: finding.confidence,
      evidence: finding.evidence,
      discoveryMode: "azure-agent-api",
      discoveryLayer: "agent",
      inventoryClass: "ai_cloud_agent",
      runningStatus: "unknown", // agent obs running_status stays unknown unless we conflate; runtime is on agent/runtime blocks
      runtimeStatusReason: finding.runtimeReason || null,
      agentRuntime,
      relationships,
      metadata: {
        projectName: finding.projectName || null,
        projectEndpoint: finding.projectEndpoint || null,
        foundrySource: finding.source,
        description: finding.description || null,
      }
    }),
    {
      provider: "azure",
      schema: "azure-deep.v1",
      deepScan:
        finding.detectionMethod === "azure_assistants_api"
          ? "azure_assistants_list"
          : "azure_foundry_agents_list",
      agentId,
      agentName: finding.agentName,
      agentType: finding.agentType,
      foundationModel: finding.foundationModel || null,
      description: finding.description || null,
      instructionText: finding.instructionText || null,
      tools: finding.tools || [],
      knowledgeBases: finding.knowledgeBases || [],
      identity: {
        identity_type: "azure_managed_identity",
        note: "Azure agent identity is account/project scoped; no AWS IAM roleArn equivalent.",
      },
      limitations: [
        "Aligned from Azure Foundry Agents / Assistants list payloads (not Bedrock GetAgent).",
        "Hosted container runtime status is separate from tool/instruction enrichment.",
      ],
    }
  );
}

function botServiceObservation(resource, conn, classification) {
  const agentId = resource.id;
  const agentRuntime = buildAgentAndRuntime({
    agentDetected: true,
    detectionMethod: "azure_bot_service_arm",
    agentId,
    agentName: resource.name,
    agentType: "azure_bot_service",
    agentStatus: "confirmed",
    agentRuntimeStatus: "unknown",
    deploymentStatus: null,
    lastSeenAt: null,
    source: "azure_bot_service",
    runtimeDetected: false,
    runtimeStatus: "unknown",
    runtimeType: null,
    runtimeId: null,
    runtimeName: null,
    resourceId: resource.id,
    region: resource.location || null
  });

  return alignObservationWithDeepSurface(
    resourceToObservation(resource, conn, classification, {
      fingerprint: `azure-agent:${conn.config.subscriptionId}:${agentId}`,
      name: `${resource.name} (Azure Bot)`,
      confidence: 0.95,
      evidence: [
        ...(classification.evidence || []),
        "Azure Bot Service bot resource returned by ARM",
        "ARM does not expose live bot conversation runtime state"
      ],
      discoveryMode: "azure-arm-bot",
      discoveryLayer: "agent",
      inventoryClass: "ai_cloud_agent",
      runtimeStatusReason: "Bot Service ARM resource has no continuous runtime status",
      agentRuntime
    }),
    {
      provider: "azure",
      schema: "azure-deep.v1",
      deepScan: "azure_bot_service_arm",
      agentId,
      agentName: resource.name,
      agentType: "azure_bot_service",
      tools: [],
      limitations: [
        "Bot Service ARM list confirms the bot resource but does not return tools/instructions.",
      ],
    }
  );
}

async function discoverContainerAppRuntime(token, resource, conn, classification, discoveryErrors) {
  const observations = [];
  const detail = await getContainerApp(token, resource);
  if (!detail.ok) {
    discoveryErrors.push({
      resourceId: resource.id,
      discoveryType: "container-app",
      discoveryStatus: detail.permissionDenied ? "permission_denied" : "error",
      error: detail.error
    });
    return observations;
  }

  const app = detail.json;
  const signals = extractSafeAppSignals(app);
  const revisions = await listContainerAppRevisions(token, resource);
  if (!revisions.ok && revisions.permissionDenied) {
    discoveryErrors.push({
      resourceId: resource.id,
      discoveryType: "container-app-revisions",
      discoveryStatus: "permission_denied",
      error: revisions.error
    });
  }

  const active = (revisions.revisions || []).filter((r) => r.properties?.active);
  let runtimeStatus = "unknown";
  const runningState = app.properties?.runningStatus || signals.runningStatus;
  if (runningState) runtimeStatus = normalizeRuntimeStatus(runningState);
  else if (active.some((r) => Number(r.properties?.replicas || 0) > 0)) runtimeStatus = "running";
  else if (active.length && active.every((r) => Number(r.properties?.replicas || 0) === 0)) {
    runtimeStatus = "stopped";
  }

  const heuristic = isHeuristicAiWorkload(signals, resource);
  const agentDetected = heuristic;
  const agentRuntime = buildAgentAndRuntime({
    agentDetected,
    detectionMethod: agentDetected ? "runtime_heuristic" : null,
    agentId: agentDetected ? resource.id : null,
    agentName: agentDetected ? resource.name : null,
    agentType: agentDetected ? "container_app_workload" : null,
    agentStatus: agentDetected ? "candidate" : null,
    agentRuntimeStatus: agentDetected ? "unknown" : null,
    // Container running ≠ agent running confirmation
    deploymentStatus: runningState || null,
    lastSeenAt: null,
    source: agentDetected ? "azure_container_app_heuristic" : null,
    runtimeDetected: true,
    runtimeStatus,
    runtimeType: "azure_container_app",
    runtimeId: resource.id,
    runtimeName: resource.name,
    resourceId: resource.id,
    region: resource.location || null
  });

  observations.push(
    resourceToObservation(resource, conn, classification, {
      fingerprint: `azure-runtime:${resource.id}`,
      name: heuristic ? `${resource.name} (AI Container App)` : resource.name,
      confidence: agentDetected ? 0.72 : classification.confidence,
      evidence: [
        ...(classification.evidence || []),
        `Container App runningStatus=${runningState || "unknown"}`,
        agentDetected
          ? "Heuristic AI signals from image/env names/tags (values redacted)"
          : "No reliable agent evidence beyond compute host",
        "Container App running does not confirm an AI agent is running"
      ],
      discoveryMode: "azure-container-apps",
      discoveryLayer: agentDetected ? "agent_candidate" : "runtime",
      inventoryClass: agentDetected ? "ai_cloud_agent" : "ai_cloud_resource",
      runningStatus: runtimeStatus,
      runtimeStatusReason: agentDetected
        ? "Runtime is running but agent identity is heuristic only"
        : null,
      agentRuntime,
      metadata: {
        envNames: signals.envNames,
        images: signals.images,
        activeRevisionCount: active.length,
        latestRevisionName: signals.latestRevisionName
      },
      relationships: [
        {
          rel_type: "HOSTED_BY",
          to_type: "CloudResource",
          to_key: resource.id,
          to_name: resource.name
        },
        {
          rel_type: "RUNS_ON",
          to_type: "AzureRuntime",
          to_key: resource.id,
          to_name: resource.name
        }
      ]
    })
  );

  return observations;
}

async function discoverWebAppRuntime(token, resource, conn, classification, discoveryErrors) {
  const observations = [];
  const detail = await getWebSite(token, resource);
  if (!detail.ok) {
    discoveryErrors.push({
      resourceId: resource.id,
      discoveryType: classification.category === "azure_function" ? "function-app" : "app-service",
      discoveryStatus: detail.permissionDenied ? "permission_denied" : "error",
      error: detail.error
    });
    return observations;
  }

  const site = detail.json;
  const signals = extractSafeAppSignals(site);
  const state = site.properties?.state || site.properties?.availabilityState || null;
  const runtimeStatus = normalizeRuntimeStatus(state === "Running" ? "running" : state);
  const heuristic = isHeuristicAiWorkload(signals, resource) || classification.aiRelevant;
  const isFunction = /functionapp/i.test(String(site.kind || resource.kind || ""));
  const runtimeType = isFunction ? "azure_function" : "azure_app_service";

  const agentDetected = heuristic;
  const agentRuntime = buildAgentAndRuntime({
    agentDetected,
    detectionMethod: agentDetected ? "runtime_heuristic" : null,
    agentId: agentDetected ? resource.id : null,
    agentName: agentDetected ? resource.name : null,
    agentType: agentDetected ? (isFunction ? "function_app_workload" : "app_service_workload") : null,
    agentStatus: agentDetected ? "candidate" : null,
    agentRuntimeStatus: agentDetected ? "unknown" : null,
    deploymentStatus: state,
    source: agentDetected ? `azure_${runtimeType}_heuristic` : null,
    runtimeDetected: true,
    runtimeStatus,
    runtimeType,
    runtimeId: resource.id,
    runtimeName: resource.name,
    resourceId: resource.id,
    region: resource.location || null
  });

  observations.push(
    resourceToObservation(resource, conn, classification, {
      fingerprint: `azure-runtime:${resource.id}`,
      confidence: agentDetected ? 0.7 : classification.confidence,
      evidence: [
        ...(classification.evidence || []),
        `${isFunction ? "Function App" : "App Service"} state=${state || "unknown"}`,
        "Secret app settings are not retrieved",
        agentDetected
          ? "Heuristic AI workload signals (name/kind/tags/stack)"
          : "No agent evidence"
      ],
      discoveryMode: isFunction ? "azure-functions" : "azure-app-service",
      discoveryLayer: agentDetected ? "agent_candidate" : "runtime",
      inventoryClass: agentDetected ? "ai_cloud_agent" : "ai_cloud_resource",
      runningStatus: runtimeStatus,
      runtimeStatusReason: agentDetected
        ? "App running status is not agent execution status"
        : null,
      agentRuntime,
      metadata: {
        kind: site.kind || resource.kind || null,
        linuxFx: signals.linuxFx,
        envNames: signals.envNames
      }
    })
  );

  return observations;
}

async function discoverVmRuntime(token, resource, conn, classification, discoveryErrors) {
  const observations = [];
  const view = await getVmInstanceView(token, resource);
  if (!view.ok) {
    discoveryErrors.push({
      resourceId: resource.id,
      discoveryType: "vm-instance-view",
      discoveryStatus: view.permissionDenied ? "permission_denied" : "error",
      error: view.error
    });
  }

  const power = view.ok ? powerStateFromInstanceView(view.json) : "unknown";
  const agentRuntime = buildAgentAndRuntime({
    agentDetected: classification.aiRelevant,
    detectionMethod: classification.aiRelevant ? "runtime_heuristic" : null,
    agentId: classification.aiRelevant ? resource.id : null,
    agentName: classification.aiRelevant ? resource.name : null,
    agentType: classification.aiRelevant ? "vm_workload_candidate" : null,
    agentStatus: classification.aiRelevant ? "candidate" : null,
    // Critical: VM power ≠ agent running
    agentRuntimeStatus: classification.aiRelevant ? "unknown" : null,
    deploymentStatus: power,
    source: classification.aiRelevant ? "azure_vm_heuristic" : null,
    runtimeDetected: view.ok,
    runtimeStatus: power,
    runtimeType: "azure_vm",
    runtimeId: resource.id,
    runtimeName: resource.name,
    resourceId: resource.id,
    region: resource.location || null
  });

  observations.push(
    resourceToObservation(resource, conn, classification, {
      fingerprint: `azure-runtime:${resource.id}`,
      confidence: classification.aiRelevant ? 0.62 : 0.8,
      evidence: [
        ...(classification.evidence || []),
        view.ok
          ? `VM power state=${power}`
          : "VM instance view unavailable",
        "ARM cannot determine in-guest processes; agent runtime remains unknown"
      ],
      discoveryMode: "azure-vm",
      discoveryLayer: classification.aiRelevant ? "agent_candidate" : "runtime",
      inventoryClass: classification.aiRelevant ? "ai_cloud_agent" : "cloud_resource",
      runningStatus: power,
      runtimeStatusReason:
        "VM power state does not imply agent process status; no guest inspection performed",
      discoveryStatus: view.permissionDenied ? "permission_denied" : null,
      agentRuntime
    })
  );

  return observations;
}

async function discoverAksRuntime(token, resource, conn, classification, discoveryErrors) {
  const observations = [];
  const cluster = await getAksCluster(token, resource);
  if (!cluster.ok) {
    discoveryErrors.push({
      resourceId: resource.id,
      discoveryType: "aks-cluster",
      discoveryStatus: cluster.permissionDenied ? "permission_denied" : "error",
      error: cluster.error
    });
  }

  // Cluster-level runtime observation
  const powerState = cluster.json?.properties?.powerState?.code || cluster.json?.properties?.provisioningState;
  const clusterRuntimeStatus = normalizeRuntimeStatus(powerState);

  observations.push(
    resourceToObservation(resource, conn, classification, {
      fingerprint: `azure-runtime:${resource.id}`,
      confidence: classification.confidence,
      evidence: [
        ...(classification.evidence || []),
        `AKS cluster power/provisioning=${powerState || "unknown"}`,
        "Cluster existence alone does not confirm AI agents"
      ],
      discoveryMode: "azure-aks",
      discoveryLayer: "runtime",
      inventoryClass: "ai_cloud_resource",
      runningStatus: clusterRuntimeStatus,
      agentRuntime: buildAgentAndRuntime({
        agentDetected: false,
        runtimeDetected: true,
        runtimeStatus: clusterRuntimeStatus,
        runtimeType: "azure_aks",
        runtimeId: resource.id,
        runtimeName: resource.name,
        resourceId: resource.id,
        region: resource.location || null
      }),
      discoveryStatus: cluster.permissionDenied ? "permission_denied" : null
    })
  );

  const workloads = await listAksAiWorkloads(token, resource);
  if (!workloads.ok) {
    discoveryErrors.push({
      resourceId: resource.id,
      discoveryType: "aks-workloads",
      discoveryStatus: workloads.permissionDenied ? "permission_denied" : "error",
      error: workloads.error
    });
    return observations;
  }

  for (const wl of workloads.workloads || []) {
    // Never confirm merely because the container/deployment name contains "agent".
    const detectionMethod = "runtime_heuristic";
    const confidence = wl.nameOnlyAgentHint && !isAiRelevantText(wl.images.join(" "), wl.envNames.join(" "))
      ? 0.55
      : 0.7;
    const agentId = `${resource.id}:${wl.namespace}:${wl.name}`;
    const agentRuntime = buildAgentAndRuntime({
      agentDetected: true,
      detectionMethod,
      agentId,
      agentName: `${wl.namespace}/${wl.name}`,
      agentType: "aks_deployment",
      agentStatus: "candidate",
      agentRuntimeStatus: confidence >= 0.6 ? wl.status : "unknown",
      source: "azure_aks_heuristic",
      runtimeDetected: true,
      runtimeStatus: wl.status,
      runtimeType: "azure_aks_deployment",
      runtimeId: wl.uid || agentId,
      runtimeName: wl.name,
      resourceId: resource.id,
      region: resource.location || null
    });

    observations.push(
      resourceToObservation(resource, conn, classification, {
        fingerprint: `azure-agent:${conn.config.subscriptionId}:${agentId}`,
        name: `AKS ${wl.namespace}/${wl.name} (AI candidate)`,
        confidence,
        evidence: [
          "AKS deployment matched AI workload heuristics (images/labels/env names)",
          wl.nameOnlyAgentHint
            ? "Name contains 'agent' — insufficient alone for confirmation"
            : "AI signals beyond name alone",
          `Pod/deployment ready status=${wl.status}`,
          "Heuristic detection is never marked confirmed"
        ],
        discoveryMode: "azure-aks-workload",
        discoveryLayer: "agent_candidate",
        inventoryClass: "ai_cloud_agent",
        runningStatus: wl.status,
        runtimeStatusReason:
          "Workload running status reflects Kubernetes replicas, not confirmed agent identity",
        agentRuntime,
        metadata: {
          namespace: wl.namespace,
          images: wl.images,
          envNames: wl.envNames,
          labels: wl.labels
        },
        relationships: [
          {
            rel_type: "HOSTED_BY",
            to_type: "CloudResource",
            to_key: resource.id,
            to_name: resource.name
          },
          {
            rel_type: "RUNS_ON",
            to_type: "AzureRuntime",
            to_key: wl.uid || agentId,
            to_name: `${wl.namespace}/${wl.name}`
          },
          {
            rel_type: "RUNS_IN",
            to_type: "KubernetesNamespace",
            to_key: `${resource.id}:${wl.namespace}`,
            to_name: wl.namespace
          }
        ]
      })
    );
  }

  return observations;
}

function emptyStats() {
  return {
    totalResourcesScanned: 0,
    aiRelevantResources: 0,
    agentCandidates: 0,
    agentsDiscovered: 0,
    confirmedAgents: 0,
    heuristicAgents: 0,
    runtimesDiscovered: 0,
    runningRuntimes: 0,
    stoppedRuntimes: 0,
    unknownRuntimeStatus: 0,
    discoveryErrors: 0,
    nonAiResourcesSkipped: 0,
    cloudResourcesIngested: 0
  };
}

function tallyObservation(stats, obs) {
  if (obs.metadata?.inventoryClass === "connector_scan") return;
  stats.cloudResourcesIngested += 1;
  if (obs.agent?.detected) {
    stats.agentsDiscovered += 1;
    if (obs.metadata?.agentStatus === "confirmed") stats.confirmedAgents += 1;
    if (obs.metadata?.agentStatus === "candidate") {
      stats.heuristicAgents += 1;
      stats.agentCandidates += 1;
    }
  }
  if (obs.runtime?.detected) {
    stats.runtimesDiscovered += 1;
    if (obs.runtime.status === "running") stats.runningRuntimes += 1;
    else if (obs.runtime.status === "stopped") stats.stoppedRuntimes += 1;
    else stats.unknownRuntimeStatus += 1;
  }
}

function dedupeObservations(observations) {
  const byFp = new Map();
  for (const obs of observations) {
    const fp = obs.fingerprint;
    if (!byFp.has(fp)) {
      byFp.set(fp, obs);
      continue;
    }
    // Prefer higher confidence / confirmed agent when fingerprints collide.
    const prev = byFp.get(fp);
    const prevScore = Number(prev.confidence_score) || 0;
    const nextScore = Number(obs.confidence_score) || 0;
    const prevConfirmed = prev.metadata?.agentStatus === "confirmed";
    const nextConfirmed = obs.metadata?.agentStatus === "confirmed";
    if (nextConfirmed && !prevConfirmed) byFp.set(fp, obs);
    else if (nextConfirmed === prevConfirmed && nextScore > prevScore) byFp.set(fp, obs);
  }
  return [...byFp.values()];
}

/**
 * Discover Azure subscription resources for one connector.
 * When AI-only mode is on, only AI-relevant resources are ingested.
 */
export async function discoverAzureConnector(conn) {
  const tenantId = conn.config.tenantId;
  const clientId = conn.config.clientId;
  const subscriptionId = conn.config.subscriptionId;
  const clientSecret = conn.secrets.clientSecret;

  if (!tenantId || !clientId || !clientSecret || !subscriptionId) {
    throw new Error("Azure connector missing tenantId, clientId, clientSecret, or subscriptionId");
  }

  const creds = { tenantId, clientId, clientSecret };
  const token = await getAzureAccessToken(creds);
  const dataToken =
    (await getOptionalToken(creds, AI_DATA_SCOPE)) ||
    (await getOptionalToken(creds, COGNITIVE_SCOPE)) ||
    token;

  const resources = await listSubscriptionResources(token, subscriptionId);
  const discoveryErrors = [];
  const stats = emptyStats();
  stats.totalResourcesScanned = resources.length;

  const classified = resources.map((r) => ({ resource: r, classification: classifyAzureResource(r) }));
  const aiResources = classified.filter((c) => c.classification.aiRelevant);
  const otherResources = classified.filter((c) => !c.classification.aiRelevant);
  stats.aiRelevantResources = aiResources.length;
  stats.nonAiResourcesSkipped = EFFECTIVE_AZURE_AI_ONLY ? otherResources.length : 0;

  let selected = [...aiResources];
  if (!EFFECTIVE_AZURE_AI_ONLY) {
    for (const c of otherResources) {
      if (selected.length >= MAX_RESOURCES) break;
      selected.push(c);
    }
  }
  selected = selected.slice(0, MAX_RESOURCES);

  const observations = [];

  for (const { resource, classification } of selected) {
    const type = String(resource.type || "");
    const category = classification.category;

    try {
      // --- AI platform resources ---
      if (type === "Microsoft.BotService/botServices" || category === "azure_bot_service") {
        observations.push(botServiceObservation(resource, conn, classification));
        continue;
      }

      if (
        AZURE_DISCOVERY_AGENT_SCAN &&
        (type === "Microsoft.CognitiveServices/accounts" ||
          type.startsWith("Microsoft.CognitiveServices/accounts/") ||
          category === "azure_openai" ||
          category === "azure_ai_foundry" ||
          category === "azure_ai_services")
      ) {
        // Always emit the AI resource observation (not an agent by itself).
        observations.push(
          resourceToObservation(resource, conn, classification, {
            discoveryLayer: "ai_resource",
            evidence: [
              ...(classification.evidence || []),
              "AI resource confirmed; agent presence requires Agents/Assistants API evidence"
            ],
            agentRuntime: buildAgentAndRuntime({ agentDetected: false })
          })
        );

        const findings = await discoverCognitiveAgents({
          armToken: token,
          dataToken,
          resource,
          classification,
          discoveryErrors
        });
        for (const finding of findings) {
          observations.push(agentObservationFromFinding(finding, resource, conn, classification));
        }
        continue;
      }

      if (
        category === "azure_machine_learning" ||
        category === "azure_ai_search" ||
        classification.layer === "ai_resource"
      ) {
        observations.push(
          resourceToObservation(resource, conn, classification, {
            discoveryLayer: "ai_resource",
            evidence: [
              ...(classification.evidence || []),
              "AI platform resource — not automatically an agent"
            ],
            agentRuntime: buildAgentAndRuntime({ agentDetected: false })
          })
        );
        // ML workspace agents sub-resource type is rare in subscription list; skip invented APIs.
        continue;
      }

      // --- Compute / runtime hosts ---
      if (!AZURE_DISCOVERY_RUNTIME_SCAN) {
        observations.push(resourceToObservation(resource, conn, classification));
        continue;
      }

      if (category === "azure_container_app" || type === "Microsoft.App/containerApps") {
        const more = await discoverContainerAppRuntime(
          token,
          resource,
          conn,
          classification,
          discoveryErrors
        );
        observations.push(...more);
        continue;
      }

      if (category === "azure_aks" || type === "Microsoft.ContainerService/managedClusters") {
        const more = await discoverAksRuntime(token, resource, conn, classification, discoveryErrors);
        observations.push(...more);
        continue;
      }

      if (
        category === "azure_function" ||
        category === "azure_app_service" ||
        type === "Microsoft.Web/sites" ||
        type.startsWith("Microsoft.Web/sites/")
      ) {
        const more = await discoverWebAppRuntime(
          token,
          resource,
          conn,
          classification,
          discoveryErrors
        );
        observations.push(...more);
        continue;
      }

      if (category === "azure_vm" || type === "Microsoft.Compute/virtualMachines") {
        const more = await discoverVmRuntime(token, resource, conn, classification, discoveryErrors);
        observations.push(...more);
        continue;
      }

      // Fallback: classified AI-relevant resource without a deeper scanner
      if (shouldIngestAiOnly(classification.aiRelevant) || !EFFECTIVE_AZURE_AI_ONLY) {
        observations.push(
          resourceToObservation(resource, conn, classification, {
            agentRuntime: buildAgentAndRuntime({ agentDetected: false })
          })
        );
      }
    } catch (err) {
      discoveryErrors.push({
        resourceId: resource.id,
        discoveryType: "resource-scan",
        discoveryStatus: err.permissionDenied ? "permission_denied" : "error",
        error: sanitizeAzureError(err)
      });
      // Still emit a minimal resource observation so ARM success is preserved.
      try {
        observations.push(
          resourceToObservation(resource, conn, classification, {
            discoveryStatus: err.permissionDenied ? "permission_denied" : "error",
            evidence: [
              ...(classification.evidence || []),
              `Deep discovery failed: ${sanitizeAzureError(err)}`
            ]
          })
        );
      } catch {
        /* ignore secondary failure */
      }
    }
  }

  const deduped = dedupeObservations(observations);
  for (const obs of deduped) tallyObservation(stats, obs);
  stats.discoveryErrors = discoveryErrors.length;

  deduped.unshift({
    ...baseObservationFields(conn),
    fingerprint: `azure-connector-scan:${conn.id}:${subscriptionId}`,
    name: `Azure scan — ${conn.name}`,
    region: "global",
    running_status: "running",
    confidence_score: 0.95,
    framework: "subscription-scan",
    agent: emptyAgentBlock(),
    runtime: emptyRuntimeBlock({ detected: false, status: null }),
    metadata: {
      connectorId: conn.id,
      connectorName: conn.name,
      discoveryMode: "azure-arm-live",
      discoveryLayer: "connector",
      subscriptionId,
      tenantId,
      totalResourcesScanned: stats.totalResourcesScanned,
      aiRelevantResources: stats.aiRelevantResources,
      agentCandidates: stats.agentCandidates,
      agentsDiscovered: stats.agentsDiscovered,
      confirmedAgents: stats.confirmedAgents,
      heuristicAgents: stats.heuristicAgents,
      runtimesDiscovered: stats.runtimesDiscovered,
      runningRuntimes: stats.runningRuntimes,
      stoppedRuntimes: stats.stoppedRuntimes,
      unknownRuntimeStatus: stats.unknownRuntimeStatus,
      discoveryErrors: stats.discoveryErrors,
      discoveryErrorSamples: discoveryErrors.slice(0, 25),
      nonAiResourcesSkipped: stats.nonAiResourcesSkipped,
      cloudResourcesIngested: stats.cloudResourcesIngested,
      inventoryClass: "connector_scan",
      aiOnly: EFFECTIVE_AZURE_AI_ONLY,
      agentScan: AZURE_DISCOVERY_AGENT_SCAN,
      runtimeScan: AZURE_DISCOVERY_RUNTIME_SCAN,
      environment: conn.environment,
      maxResources: MAX_RESOURCES
    },
    relationships: [
      {
        rel_type: "DEPLOYED_IN",
        to_type: "CloudResource",
        to_key: `azure-sub-${subscriptionId}`,
        to_name: `Subscription ${subscriptionId}`
      }
    ]
  });

  return {
    observations: deduped,
    stats,
    discoveryErrors
  };
}

export async function validateAzureConnector(conn) {
  const token = await getAzureAccessToken({
    tenantId: conn.config.tenantId,
    clientId: conn.config.clientId,
    clientSecret: conn.secrets.clientSecret
  });
  const subscriptionId = conn.config.subscriptionId;
  const res = await safeFetch(
    `https://management.azure.com/subscriptions/${subscriptionId}?api-version=2020-01-01`,
    { headers: { Authorization: `Bearer ${token}` } },
    ALLOW.azureArm
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      sanitizeAzureError(json.error?.message || `Subscription check failed (${res.status})`)
    );
  }
  return {
    ok: true,
    message: `Authenticated to Azure subscription ${json.displayName || subscriptionId} (${json.state || "unknown"}).`
  };
}

/**
 * Non-destructive capability probe — does not scan the full subscription.
 */
export async function validateAzureConnectorCapabilities(conn) {
  const tenantId = conn.config.tenantId;
  const clientId = conn.config.clientId;
  const clientSecret = conn.secrets.clientSecret;
  const subscriptionId = conn.config.subscriptionId;
  const creds = { tenantId, clientId, clientSecret };

  const capabilities = {
    arm: false,
    aiDiscovery: false,
    foundryDiscovery: false,
    containerAppsDiscovery: false,
    aksDiscovery: false,
    functionsDiscovery: false,
    appServiceDiscovery: false,
    vmDiscovery: false
  };

  let token;
  try {
    token = await getAzureAccessToken(creds);
    const sub = await safeFetch(
      `https://management.azure.com/subscriptions/${subscriptionId}?api-version=2020-01-01`,
      { headers: { Authorization: `Bearer ${token}` } },
      ALLOW.azureArm
    );
    capabilities.arm = sub.ok;
  } catch {
    return { ok: false, capabilities, message: "ARM authentication failed" };
  }

  async function probe(path) {
    const url = `https://management.azure.com/subscriptions/${subscriptionId}/providers/${path}`;
    try {
      const res = await safeFetch(
        url,
        { headers: { Authorization: `Bearer ${token}` } },
        ALLOW.azureArm
      );
      // 200 = allowed; 404 provider path oddities still mean auth worked for ARM filter.
      // 403 = permission denied for that provider namespace.
      return res.status !== 401 && res.status !== 403;
    } catch {
      return false;
    }
  }

  capabilities.aiDiscovery = await probe(
    `Microsoft.CognitiveServices/accounts?api-version=${encodeURIComponent("2025-06-01")}&$top=1`
  );
  capabilities.foundryDiscovery = capabilities.aiDiscovery;
  capabilities.containerAppsDiscovery = await probe(
    `Microsoft.App/containerApps?api-version=${encodeURIComponent("2024-03-01")}&$top=1`
  );
  capabilities.aksDiscovery = await probe(
    `Microsoft.ContainerService/managedClusters?api-version=${encodeURIComponent("2024-01-01")}&$top=1`
  );
  const webOk = await probe(
    `Microsoft.Web/sites?api-version=${encodeURIComponent("2023-12-01")}&$top=1`
  );
  capabilities.functionsDiscovery = webOk;
  capabilities.appServiceDiscovery = webOk;
  capabilities.vmDiscovery = await probe(
    `Microsoft.Compute/virtualMachines?api-version=${encodeURIComponent("2024-07-01")}&$top=1`
  );

  // Optional data-plane token for Foundry
  const aiToken = await getOptionalToken(creds, AI_DATA_SCOPE);
  if (!aiToken) {
    const cogToken = await getOptionalToken(creds, COGNITIVE_SCOPE);
    if (!cogToken) capabilities.foundryDiscovery = capabilities.foundryDiscovery && false;
  }

  return {
    ok: capabilities.arm,
    capabilities,
    message: capabilities.arm
      ? "Azure connector capability probe completed (read-only)."
      : "Azure ARM capability probe failed."
  };
}

/* =========================================================================
 * NEW: Entra Agent ID discovery (Microsoft Graph, tenant-scoped)
 *
 * Targets the actual Entra Agent ID type Microsoft assigns to Copilot
 * Studio and Agent 365 agents: a service principal with
 * servicePrincipalType = "ServiceIdentity" (and @odata.type =
 * "#microsoft.graph.agentIdentity" on newer Graph versions). This is a
 * real, platform-confirmed agent identity — distinct from entraIdentity.js's
 * broader heuristic name/tag match over ALL service principals/applications,
 * which only catches agents that happen to have an AI-sounding name.
 * entraIdentity.js is left unchanged and still useful as a wider net; this
 * collector is the authoritative, narrow one.
 *
 * Requires Graph application permission Application.Read.All (or
 * Directory.Read.All), admin-consented. No Defender/Advanced Hunting
 * license required — this is core Entra ID.
 * ========================================================================= */

const ENTRA_AGENT_ID_SCAN = String(process.env.ENTRA_AGENT_ID_SCAN || "true").toLowerCase() !== "false";
const ENTRA_AGENT_ID_MAX = Number(process.env.ENTRA_AGENT_ID_MAX || 200);
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";

// Prefer ALLOW.graphMicrosoft from utils/http.js (already used by entraIdentity.js
// and agent365DeepScan.js). Fallback keeps this collector working even if that
// key isn't wired up yet in this checkout.
const GRAPH_POLICY = ALLOW.graphMicrosoft || { allowHosts: ["graph.microsoft.com"] };

const AGENT_IDENTITY_FILTER_URL =
  "https://graph.microsoft.com/v1.0/servicePrincipals" +
  "?$filter=servicePrincipalType eq 'ServiceIdentity'" +
  "&$select=id,appId,displayName,servicePrincipalType,createdDateTime,accountEnabled,tags,publisherName,appOwnerOrganizationId";

const ENTRA_AGENT_ID_FALLBACK_URL =
  "https://graph.microsoft.com/v1.0/servicePrincipals" +
  "?$select=id,appId,displayName,servicePrincipalType,createdDateTime,accountEnabled,tags,publisherName,appOwnerOrganizationId";

/**
 * Shared Graph GET-all-pages helper (used by Entra Agent ID + Teams catalog
 * collectors below). Never throws on HTTP failure when optional=true —
 * mirrors the armGet/dataPlaneGet convention used throughout this file.
 */
async function graphGetAllPages(url, token, { optional = true } = {}) {
  let items = [];
  let next = url;
  while (next) {
    assertAllowedUrl(next, GRAPH_POLICY);
    const res = await safeFetch(
      next,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
      GRAPH_POLICY
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const permissionDenied = res.status === 401 || res.status === 403;
      if (optional) {
        return {
          ok: false,
          status: res.status,
          permissionDenied,
          items,
          error: sanitizeAzureError(json.error?.message || `Graph request failed (${res.status})`)
        };
      }
      throw new Error(sanitizeAzureError(json.error?.message || `Graph request failed (${res.status})`));
    }
    items = items.concat(json.value || []);
    next = json["@odata.nextLink"] || null;
  }
  return { ok: true, items };
}

function entraAgentIdentityObservation(sp, conn, tenantId) {
  const displayName = sp.displayName || sp.appId || sp.id;
  const agentId = sp.id;
  const agentRuntime = buildAgentAndRuntime({
    agentDetected: true,
    detectionMethod: "entra_agent_identity_api",
    agentId,
    agentName: displayName,
    agentType: "entra_agent_identity",
    agentStatus: "confirmed",
    agentRuntimeStatus: "unknown",
    source: "entra_agent_id",
    runtimeDetected: false
  });

  return {
    collector_id: "identity_entra_agent",
    fingerprint: `entra-agent-id:${tenantId}:${agentId}`,
    name: `${displayName} (Entra Agent ID)`,
    category: "identity",
    provider: "entra_agent_id",
    deployment_type: "identity",
    region: "global",
    running_status: sp.accountEnabled === false ? "disabled" : "unknown",
    confidence_score: 0.95,
    framework: "entra-agent-identity",
    model: "microsoft-agent-identity",
    agent: agentRuntime.agent,
    runtime: agentRuntime.runtime,
    metadata: {
      connectorId: conn.id,
      connectorName: conn.name,
      discoveryMode: "entra-agent-id-graph",
      discoveryLayer: "agent",
      inventoryClass: "ai_cloud_agent",
      evidenceClass: "platform_agent",
      agentStatus: "confirmed",
      tenantId,
      objectId: sp.id,
      appId: sp.appId || null,
      servicePrincipalType: sp.servicePrincipalType,
      publisherName: sp.publisherName || null,
      appOwnerOrganizationId: sp.appOwnerOrganizationId || null,
      createdDateTime: sp.createdDateTime || null,
      tags: sp.tags || [],
      aiRelevant: true,
      environment: conn.environment,
      evidence: [
        "servicePrincipalType=ServiceIdentity (Microsoft Entra Agent ID)",
        "Confirms a real agent identity — covers Copilot Studio agents (auto-assigned since Jul 2026) and Agent 365-onboarded agents",
        "Does not require the object's display name to mention AI/agent/copilot"
      ]
    },
    relationships: [
      { rel_type: "OBSERVED_BY", to_type: "IdentityProvider", to_key: "entra-id", to_name: "Microsoft Entra ID" },
      { rel_type: "RUNS_IN", to_type: "EntraTenant", to_key: `entra-tenant-${tenantId}`, to_name: `Entra tenant ${tenantId}` }
    ]
  };
}

export async function discoverEntraAgentIdentities(conn) {
  if (!ENTRA_AGENT_ID_SCAN) {
    return { observations: [], stats: { skipped: true, reason: "ENTRA_AGENT_ID_SCAN=false" }, discoveryErrors: [] };
  }

  const tenantId = conn.config.tenantId;
  const creds = { tenantId, clientId: conn.config.clientId, clientSecret: conn.secrets.clientSecret };
  const discoveryErrors = [];

  let token;
  try {
    token = await getAzureAccessToken({ ...creds, scope: GRAPH_SCOPE });
  } catch (err) {
    discoveryErrors.push({ discoveryType: "entra-agent-id-token", discoveryStatus: "error", error: sanitizeAzureError(err) });
    return { observations: [], stats: { agentIdentitiesFound: 0 }, discoveryErrors };
  }

  let result = await graphGetAllPages(AGENT_IDENTITY_FILTER_URL, token, { optional: true });

  // Some tenants/Graph API versions reject the servicePrincipalType filter
  // with a 400 - fall back to client-side filtering rather than lose coverage.
  if (!result.ok && result.status === 400) {
    discoveryErrors.push({
      discoveryType: "entra-agent-id-filter",
      discoveryStatus: "fallback",
      error: "Server-side servicePrincipalType filter rejected (400); falling back to client-side scan"
    });
    const all = await graphGetAllPages(ENTRA_AGENT_ID_FALLBACK_URL, token, { optional: true });
    result = {
      ok: all.ok,
      permissionDenied: all.permissionDenied,
      items: (all.items || []).filter(
        (sp) => sp.servicePrincipalType === "ServiceIdentity" || sp["@odata.type"] === "#microsoft.graph.agentIdentity"
      )
    };
  }

  if (!result.ok) {
    discoveryErrors.push({
      discoveryType: "entra-agent-id-list",
      discoveryStatus: result.permissionDenied ? "permission_denied" : "error",
      error: result.error || "Failed to list Entra Agent ID service principals"
    });
    return { observations: [], stats: { agentIdentitiesFound: 0 }, discoveryErrors };
  }

  const items = (result.items || []).slice(0, ENTRA_AGENT_ID_MAX);
  const observations = items.map((sp) => entraAgentIdentityObservation(sp, conn, tenantId));

  return {
    observations,
    stats: { agentIdentitiesFound: items.length, scanned: (result.items || []).length },
    discoveryErrors
  };
}

/* =========================================================================
 * NEW: Power Platform / Copilot Studio discovery
 *
 * Copilot Studio agents are stored as Dataverse `bot` records inside each
 * Power Platform environment. Two hops: list environments via the Power
 * Platform Admin API, then query each environment's Dataverse Web API.
 *
 * Setup required in the tenant:
 *  - a tenant admin runs, once: New-PowerAppManagementApp -ApplicationId <clientId>
 *    (Power Platform PowerShell module) to authorize this app registration
 *    for the admin API used to list environments.
 *  - this app registration's service principal must be added as an
 *    Application User with a security role in each Dataverse environment you
 *    want scanned. Environments missing this are skipped with a warning per
 *    environment, not a hard failure for the whole collector.
 * ========================================================================= */

const POWER_PLATFORM_SCAN = String(process.env.POWER_PLATFORM_SCAN || "true").toLowerCase() !== "false";
const POWER_PLATFORM_MAX_ENVIRONMENTS = Number(process.env.POWER_PLATFORM_MAX_ENVIRONMENTS || 50);
const POWER_PLATFORM_SCOPE_BASE = process.env.POWER_PLATFORM_API_BASE || "https://api.bap.microsoft.com";
const POWER_PLATFORM_SCOPE = `${POWER_PLATFORM_SCOPE_BASE}/.default`;

// NEW policy keys — add these to utils/http.js's ALLOW export for centralized
// auditing. Fallbacks here keep the collector working in the meantime.
const POWER_PLATFORM_POLICY = ALLOW.powerPlatformAdmin || {
  allowHosts: ["api.bap.microsoft.com", "api.powerplatform.com"]
};
const DATAVERSE_BASE_POLICY = ALLOW.dataverse || { allowHosts: [] };

function powerPlatformEnvironmentsUrl() {
  return `${POWER_PLATFORM_SCOPE_BASE}/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments?api-version=2023-06-01`;
}

function dataverseBotsUrl(instanceUrl) {
  return (
    `${instanceUrl.replace(/\/$/, "")}/api/data/v9.2/bots` +
    `?$select=botid,name,statecode,createdon,modifiedon,publishedon&$top=500`
  );
}

function copilotStudioAgentObservation({ bot, env, conn, tenantId }) {
  const agentId = bot.botid;
  const displayName = bot.name || agentId;
  const runtimeStatus = bot.statecode === 0 ? "running" : "stopped";
  const agentRuntime = buildAgentAndRuntime({
    agentDetected: true,
    detectionMethod: "power_platform_dataverse_api",
    agentId,
    agentName: displayName,
    agentType: "copilot_studio_agent",
    agentStatus: "confirmed",
    agentRuntimeStatus: runtimeStatus,
    deploymentStatus: bot.statecode === 0 ? "Active" : "Inactive",
    lastSeenAt: bot.modifiedon || null,
    source: "power_platform_copilot_studio",
    runtimeDetected: true,
    runtimeStatus,
    runtimeType: "dataverse_bot",
    runtimeId: agentId,
    runtimeName: displayName
  });

  return {
    collector_id: "saas_copilot_studio",
    fingerprint: `power-platform:${env.environmentId}:${agentId}`,
    name: `${displayName} (Copilot Studio)`,
    category: "saas",
    provider: "power_platform",
    deployment_type: "saas",
    region: "global",
    running_status: runtimeStatus,
    confidence_score: 0.94,
    framework: "copilot-studio",
    model: "copilot-studio-agent",
    agent: agentRuntime.agent,
    runtime: agentRuntime.runtime,
    metadata: {
      connectorId: conn.id,
      connectorName: conn.name,
      discoveryMode: "power-platform-dataverse",
      discoveryLayer: "agent",
      inventoryClass: "ai_cloud_agent",
      evidenceClass: "platform_agent",
      agentStatus: "confirmed",
      tenantId,
      environmentId: env.environmentId,
      environmentDisplayName: env.environmentDisplayName,
      instanceUrl: env.instanceUrl,
      createdon: bot.createdon || null,
      aiRelevant: true,
      environment: conn.environment,
      evidence: [
        "Dataverse `bot` record returned by Power Platform environment Web API",
        `Environment=${env.environmentDisplayName}`
      ]
    },
    relationships: [
      { rel_type: "OBSERVED_BY", to_type: "SaaSPlatform", to_key: "power-platform", to_name: "Microsoft Power Platform" },
      { rel_type: "RUNS_IN", to_type: "PowerPlatformEnvironment", to_key: env.environmentId, to_name: env.environmentDisplayName }
    ]
  };
}

export async function discoverPowerPlatformAgents(conn) {
  if (!POWER_PLATFORM_SCAN) {
    return { observations: [], stats: { skipped: true, reason: "POWER_PLATFORM_SCAN=false" }, discoveryErrors: [] };
  }

  const tenantId = conn.config.tenantId;
  const creds = { tenantId, clientId: conn.config.clientId, clientSecret: conn.secrets.clientSecret };
  const discoveryErrors = [];
  const observations = [];
  let environments = [];

  try {
    const ppToken = await getAzureAccessToken({ ...creds, scope: POWER_PLATFORM_SCOPE });
    const url = powerPlatformEnvironmentsUrl();
    assertAllowedUrl(url, POWER_PLATFORM_POLICY);
    const res = await safeFetch(
      url,
      { headers: { Authorization: `Bearer ${ppToken}`, Accept: "application/json" } },
      POWER_PLATFORM_POLICY
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error?.message || `Power Platform environments list failed (${res.status})`);
    }
    environments = (json.value || []).slice(0, POWER_PLATFORM_MAX_ENVIRONMENTS);
  } catch (err) {
    discoveryErrors.push({
      discoveryType: "power-platform-environments",
      discoveryStatus: /40[13]/.test(String(err?.message || "")) ? "permission_denied" : "error",
      error: sanitizeAzureError(
        `${err.message} — confirm the app registration is registered as a Power Platform management app (New-PowerAppManagementApp)`
      )
    });
    return { observations, stats: { environmentsScanned: 0, agentsFound: 0 }, discoveryErrors };
  }

  let agentsFound = 0;
  for (const env of environments) {
    const environmentId = env.name;
    const environmentDisplayName = env.properties?.displayName || environmentId;
    const instanceUrl = env.properties?.linkedEnvironmentMetadata?.instanceUrl;
    if (!instanceUrl) continue; // no Dataverse database in this environment - no Copilot Studio agents possible

    try {
      const origin = new URL(instanceUrl).origin;
      const hostname = new URL(instanceUrl).hostname;
      const dvToken = await getAzureAccessToken({ ...creds, scope: `${origin}/.default` });
      const dvUrl = dataverseBotsUrl(instanceUrl);
      const dvPolicy = { allowHosts: [...(DATAVERSE_BASE_POLICY.allowHosts || []), hostname] };
      assertAllowedUrl(dvUrl, dvPolicy);
      const res = await safeFetch(
        dvUrl,
        {
          headers: {
            Authorization: `Bearer ${dvToken}`,
            Accept: "application/json",
            "OData-MaxVersion": "4.0",
            "OData-Version": "4.0"
          }
        },
        dvPolicy
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        discoveryErrors.push({
          discoveryType: "power-platform-dataverse-bots",
          discoveryStatus: res.status === 401 || res.status === 403 ? "permission_denied" : "error",
          error: sanitizeAzureError(
            `${json.error?.message || `Dataverse bots query failed (${res.status})`} — environment "${environmentDisplayName}" is likely missing an Application User security role for this app registration`
          )
        });
        continue;
      }
      const bots = json.value || [];
      agentsFound += bots.length;
      for (const bot of bots) {
        observations.push(
          copilotStudioAgentObservation({
            bot,
            env: { environmentId, environmentDisplayName, instanceUrl },
            conn,
            tenantId
          })
        );
      }
    } catch (err) {
      discoveryErrors.push({
        discoveryType: "power-platform-dataverse-bots",
        discoveryStatus: "error",
        error: sanitizeAzureError(err),
        environmentId
      });
    }
  }

  return {
    observations,
    stats: { environmentsScanned: environments.length, agentsFound },
    discoveryErrors
  };
}

/* =========================================================================
 * NEW: Teams app catalog discovery
 *
 * Flags org-published Teams apps whose manifest indicates a bot / custom
 * engine agent / declarative (Copilot) agent. Catches agents published to
 * Teams that may not otherwise have a distinct Entra Agent ID (e.g. an app
 * registered before agent-identity auto-assignment rolled out).
 *
 * Requires Graph application permission TeamsApp.Read.All, admin-consented.
 *
 * The manifest fields Microsoft uses to mark "declarative agent" vs "custom
 * engine agent" vs plain bot have shifted across schema versions — this
 * heuristic intentionally over-flags rather than under-flags, same
 * philosophy as isHeuristicAiWorkload() above.
 * ========================================================================= */

const TEAMS_CATALOG_SCAN = String(process.env.TEAMS_CATALOG_SCAN || "true").toLowerCase() !== "false";
const TEAMS_CATALOG_MAX_APPS = Number(process.env.TEAMS_CATALOG_MAX_APPS || 300);

const TEAMS_CATALOG_URL =
  "https://graph.microsoft.com/v1.0/appCatalogs/teamsApps" +
  "?$filter=distributionMethod eq 'organization'&$expand=appDefinitions";

function looksLikeTeamsAgent(appDefinition = {}) {
  const hay = JSON.stringify(appDefinition).toLowerCase();
  const hasBot = Boolean(appDefinition.bot) || Boolean(appDefinition.botId);
  const mentionsAgent = /copilot|declarative agent|custom engine agent|"agent"/i.test(hay);
  return hasBot || mentionsAgent;
}

function teamsAgentObservation(app, definition, conn, tenantId) {
  const displayName = definition.displayName || app.id;
  const agentId = app.id;
  const hasBot = Boolean(definition.bot) || Boolean(definition.botId);
  const agentStatus = hasBot ? "confirmed" : "candidate";
  const agentRuntime = buildAgentAndRuntime({
    agentDetected: true,
    detectionMethod: hasBot ? "teams_app_catalog_bot" : "teams_app_catalog_heuristic",
    agentId,
    agentName: displayName,
    agentType: "teams_app",
    agentStatus,
    agentRuntimeStatus: "unknown",
    source: "teams_app_catalog",
    runtimeDetected: false
  });

  return {
    collector_id: "saas_teams_catalog",
    fingerprint: `teams-app:${tenantId}:${agentId}`,
    name: `${displayName} (Teams App)`,
    category: "saas",
    provider: "microsoft_teams",
    deployment_type: "saas",
    region: "global",
    running_status: "unknown",
    confidence_score: hasBot ? 0.9 : 0.68,
    framework: "teams-app-catalog",
    model: hasBot ? "teams-bot" : "teams-app-candidate",
    agent: agentRuntime.agent,
    runtime: agentRuntime.runtime,
    metadata: {
      connectorId: conn.id,
      connectorName: conn.name,
      discoveryMode: "teams-app-catalog-graph",
      discoveryLayer: hasBot ? "agent" : "agent_candidate",
      inventoryClass: "ai_cloud_agent",
      evidenceClass: "platform_agent",
      agentStatus,
      tenantId,
      teamsAppId: app.id,
      externalId: app.externalId || null,
      publishingState: definition.publishingState || null,
      aiRelevant: true,
      environment: conn.environment,
      evidence: [
        hasBot ? "Manifest includes a bot definition" : "Manifest text matches agent/copilot heuristics only",
        "Org-published Teams app catalog entry (distributionMethod=organization)"
      ]
    },
    relationships: [
      { rel_type: "OBSERVED_BY", to_type: "SaaSPlatform", to_key: "microsoft-teams", to_name: "Microsoft Teams" },
      { rel_type: "RUNS_IN", to_type: "EntraTenant", to_key: `entra-tenant-${tenantId}`, to_name: `Entra tenant ${tenantId}` }
    ]
  };
}

export async function discoverTeamsAgentApps(conn) {
  if (!TEAMS_CATALOG_SCAN) {
    return { observations: [], stats: { skipped: true, reason: "TEAMS_CATALOG_SCAN=false" }, discoveryErrors: [] };
  }

  const tenantId = conn.config.tenantId;
  const creds = { tenantId, clientId: conn.config.clientId, clientSecret: conn.secrets.clientSecret };
  const discoveryErrors = [];

  let token;
  try {
    token = await getAzureAccessToken({ ...creds, scope: GRAPH_SCOPE });
  } catch (err) {
    discoveryErrors.push({ discoveryType: "teams-catalog-token", discoveryStatus: "error", error: sanitizeAzureError(err) });
    return { observations: [], stats: { appsScanned: 0, agentsFlagged: 0 }, discoveryErrors };
  }

  const result = await graphGetAllPages(TEAMS_CATALOG_URL, token, { optional: true });
  if (!result.ok) {
    discoveryErrors.push({
      discoveryType: "teams-catalog-list",
      discoveryStatus: result.permissionDenied ? "permission_denied" : "error",
      error: result.error || "Failed to read org Teams app catalog — confirm TeamsApp.Read.All is granted and admin-consented"
    });
    return { observations: [], stats: { appsScanned: 0, agentsFlagged: 0 }, discoveryErrors };
  }

  const apps = (result.items || []).slice(0, TEAMS_CATALOG_MAX_APPS);
  const observations = [];
  let agentsFlagged = 0;
  for (const app of apps) {
    const defs = app.appDefinitions || [];
    const latest = defs[defs.length - 1] || {};
    if (!looksLikeTeamsAgent(latest)) continue;
    agentsFlagged += 1;
    observations.push(teamsAgentObservation(app, latest, conn, tenantId));
  }

  return {
    observations,
    stats: { appsScanned: apps.length, agentsFlagged },
    discoveryErrors
  };
}

/* =========================================================================
 * NEW: M365 Agent Registry (Defender XDR / Advanced Hunting) — disabled stub
 *
 * Disabled by default (M365_AGENT_REGISTRY_SCAN=false) — this tenant has no
 * Defender XDR / Advanced Hunting license. Kept as a documented stub so
 * enabling it later is a config flag + implementing the query below, not a
 * new project.
 *
 * When enabled: POST https://api.security.microsoft.com/api/advancedhunting/run
 * (or Graph `/security/runHuntingQuery`) against the `AgentsInfo` table:
 *
 *   AgentsInfo
 *   | project AgentId, AgentName, AgentType, RiskLevel, RiskIndicators,
 *             Tools, OnboardingStatus, LastSeen
 *
 * Requires ThreatHunting.Read.All / AdvancedHunting.Read.All + an active
 * Defender XDR license for the tenant. This is the only one of the 5
 * collectors that gives cross-agent risk/posture signal (tool usage, risk
 * indicators, alerts); the other 4 are identity/inventory only.
 * ========================================================================= */

const M365_AGENT_REGISTRY_SCAN = String(process.env.M365_AGENT_REGISTRY_SCAN || "false").toLowerCase() === "true";

export async function discoverM365AgentRegistry(conn) {
  if (!M365_AGENT_REGISTRY_SCAN) {
    return {
      observations: [],
      stats: { skipped: true, reason: "M365_AGENT_REGISTRY_SCAN=false (no Defender XDR license configured for this tenant)" },
      discoveryErrors: []
    };
  }

  // Not implemented: only reachable once Defender XDR is licensed and
  // M365_AGENT_REGISTRY_SCAN=true. Fail loudly rather than silently
  // returning zero agents, so this is never mistaken for "tenant has none".
  return {
    observations: [],
    stats: { skipped: false, implemented: false },
    discoveryErrors: [
      {
        discoveryType: "m365-agent-registry",
        discoveryStatus: "not_implemented",
        error:
          "M365_AGENT_REGISTRY_SCAN=true but the Advanced Hunting AgentsInfo query is not yet implemented — see comment block above discoverM365AgentRegistry()"
      }
    ]
  };
}

/* =========================================================================
 * NEW: Single-scanner entry point
 *
 * Runs ARM + Entra Agent ID + Power Platform + Teams catalog + (optional)
 * M365 Agent Registry for one connector and merges everything into one
 * observations/discoveryErrors/statsByCollector result. This is the direct
 * answer to "why doesn't my ARM-only scanner see Copilot Studio or Agent 365
 * agents" — those live in Entra ID / Power Platform / Teams, not as ARM
 * resources under the subscription, so they need their own collectors even
 * though this is "one scanner" from the caller's perspective.
 *
 * discoverAzureConnector() itself is left unchanged (ARM-only, same stats
 * shape as before the merge) for any existing caller that depends on it.
 * ========================================================================= */
export async function discoverAzureEcosystem(conn) {
  const labels = ["arm", "entraAgentId", "powerPlatform", "teamsCatalog", "m365AgentRegistry"];
  const results = await Promise.allSettled([
    discoverAzureConnector(conn),
    discoverEntraAgentIdentities(conn),
    discoverPowerPlatformAgents(conn),
    discoverTeamsAgentApps(conn),
    discoverM365AgentRegistry(conn)
  ]);

  const observations = [];
  const discoveryErrors = [];
  const statsByCollector = {};

  results.forEach((result, i) => {
    const label = labels[i];
    if (result.status === "fulfilled") {
      observations.push(...(result.value.observations || []));
      discoveryErrors.push(...(result.value.discoveryErrors || []).map((e) => ({ ...e, collector: label })));
      statsByCollector[label] = result.value.stats || {};
    } else {
      discoveryErrors.push({
        collector: label,
        discoveryType: `${label}-collector`,
        discoveryStatus: "error",
        error: sanitizeAzureError(result.reason)
      });
      statsByCollector[label] = { failed: true };
    }
  });

  return {
    observations,
    discoveryErrors,
    statsByCollector
  };
}
