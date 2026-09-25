/**
 * Azure scanner (v2).
 *
 * The legacy ecosystem scanner in azureDeepScan.js is disabled. This module
 * is the only live Azure discovery path.
 *
 * It does not invent hostnames. Foundry calls go to the project endpoint
 * Azure publishes on the Cognitive Services project. 404 means that route
 * is not the agent API (hub projects use /assistants). 403 means the
 * credential lacks Azure AI User on the account. Agent 365 is not required.
 */
import { ALLOW, safeFetch } from "../utils/http.js";

const ARM_SCOPE = "https://management.azure.com/.default";
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const AI_SCOPE = "https://ai.azure.com/.default";
const COGNITIVE_SCOPE = "https://cognitiveservices.azure.com/.default";
const COGNITIVE_API = "2025-06-01";
const AGENT_ROUTES = [
  ["agents", "v1"],
  ["agents", "2025-05-01"],
  ["assistants", "2025-05-15-preview"],
  ["assistants", "2025-05-01"],
  ["assistants", "2024-07-01-preview"]
];

function sanitize(error) {
  return String(error?.message || error || "unknown error").slice(0, 500);
}

async function httpJson(url, token, policy) {
  const res = await safeFetch(
    url,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
    policy
  );
  const json = await res.json().catch(() => ({}));
  const error = json?.error?.message || json?.message || null;
  return { ok: res.ok, status: res.status, json, error };
}

async function accessToken(creds, scope) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scope
  });
  const res = await safeFetch(
    `https://login.microsoftonline.com/${creds.tenantId}/oauth2/v2.0/token`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body },
    ALLOW.microsoftLogin
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(sanitize(json.error_description || json.error || `token failed (${res.status})`));
  }
  return json.access_token;
}

export function parseFoundryTags(tags = []) {
  const out = {
    agentGuid: null,
    accountName: null,
    projectName: null,
    projectId: null,
    region: null
  };
  for (const raw of Array.isArray(tags) ? tags : []) {
    const s = String(raw || "");
    const colon = s.indexOf(":");
    if (colon <= 0) continue;
    const key = s.slice(0, colon);
    const value = s.slice(colon + 1).trim();
    if (!value) continue;
    if (/^agentGuid$/i.test(key)) out.agentGuid = value;
    else if (/^region$/i.test(key)) out.region = value;
    else if (/^projectId$/i.test(key)) {
      out.projectId = value;
      const parts = value.split("@");
      out.accountName = parts[0] || null;
      out.projectName = parts[1] || null;
    }
  }
  return out;
}

export function inferFoundryName(displayName, tags = {}) {
  let name = String(displayName || "")
    .replace(/\s*\(Entra Agent ID\)\s*$/i, "")
    .replace(/-AgentIdentity$/i, "")
    .trim();
  const prefix = tags.accountName && tags.projectName ? `${tags.accountName}-${tags.projectName}-` : "";
  if (prefix && name.toLowerCase().startsWith(prefix.toLowerCase())) name = name.slice(prefix.length);
  return name || null;
}

/** ARM project name is often `account/project`. The data-plane name is the last segment. */
export function projectLeafName(project) {
  const fromId = String(project?.id || "").split("/projects/").pop();
  const name = String(project?.name || "");
  return (fromId || name.split("/").filter(Boolean).pop() || name).trim();
}

export function projectMatches(project, projectName) {
  const wanted = String(projectName || "").toLowerCase();
  if (!wanted) return false;
  const full = String(project?.name || "").toLowerCase();
  return full === wanted || projectLeafName(project).toLowerCase() === wanted;
}

export function projectEndpoints(project) {
  const props = project?.properties || {};
  const bag = props.endpoints && typeof props.endpoints === "object" ? props.endpoints : {};
  const urls = [];
  for (const value of [props.endpoint, ...Object.values(bag)]) {
    if (typeof value === "string" && /^https:\/\//i.test(value)) urls.push(value.replace(/\/$/, ""));
  }
  return [...new Set(urls)];
}

export function explainStatus(status, error) {
  const text = String(error || "");
  const code = Number(status) || (/403/.test(text) ? 403 : /404/.test(text) ? 404 : 0);
  if (code === 401 || code === 403 || /forbidden|authorizationfailed/i.test(text)) {
    return "403 Forbidden: sign-in worked, but this app cannot read Foundry agents. Azure AI Developer in this catalog only includes OpenAI data actions. Add a custom role whose data action is Microsoft.CognitiveServices/accounts/AIServices/agents/read.";
  }
  if (code === 404) {
    return "404 Not Found: this URL is not the agent route for the project. Hub projects (@AML) do not serve /agents?api-version=v1; the scanner uses the ARM project endpoint and then /assistants.";
  }
  if (/ENOTFOUND|getaddrinfo/i.test(text)) {
    return "DNS failed because a hostname was guessed from the resource name. This scanner does not guess hostnames.";
  }
  return null;
}

export function isHubProject(tags = {}) {
  const pid = String(tags.projectId || "").toUpperCase();
  return pid.endsWith("@AML") || pid.includes("@AML") || Boolean(tags.virtualWorkspaceId);
}

export function preferredAgentRoutes(tags = {}) {
  if (isHubProject(tags)) {
    return [
      ["assistants", "2025-05-15-preview"],
      ["assistants", "2025-05-01"],
      ["assistants", "2024-07-01-preview"],
      ["agents", "2025-05-01"],
      ["agents", "v1"]
    ];
  }
  return AGENT_ROUTES;
}

export function chatDeploymentModel(deployments = [], agentNameOrHint = "") {
  const candidates = [];
  for (const deployment of deployments || []) {
    const modelObj = deployment?.properties?.model;
    const modelName = String(modelObj?.name || deployment?.name || "").trim();
    if (!modelName || /embed|whisper|dall-e|^tts|audio|search/i.test(modelName)) continue;
    candidates.push({
      deploymentName: String(deployment?.name || modelName),
      modelName,
      createdOrModified: deployment?.systemData?.lastModifiedAt || deployment?.systemData?.createdAt || null
    });
  }
  if (!candidates.length) return null;
  const unique = [...new Set(candidates.map((c) => c.modelName))];
  if (unique.length === 1) return unique[0];

  if (agentNameOrHint) {
    const hintLc = String(agentNameOrHint).toLowerCase();
    const matched = candidates.find(
      (c) => hintLc.includes(c.modelName.toLowerCase()) || hintLc.includes(c.deploymentName.toLowerCase())
    );
    if (matched) return matched.modelName;
  }

  const priorityList = [
    /gpt-4o$/i,
    /gpt-4o-mini/i,
    /gpt-4-turbo/i,
    /gpt-4/i,
    /o1/i,
    /o3/i,
    /gpt-35-turbo/i
  ];
  for (const rx of priorityList) {
    const hit = candidates.find((c) => rx.test(c.modelName));
    if (hit) return hit.modelName;
  }

  return unique[0] || null;
}

function modelFromAgent(agent) {
  const latest = agent?.versions?.latest || agent?.version || {};
  const def = latest.definition || {};
  const raw = def.model || def.modelName || agent?.model || agent?.model_name || null;
  if (raw && typeof raw === "object") return raw.name || raw.id || null;
  const text = String(raw || "").trim();
  if (!text || /microsoft-agent-identity|azure-foundry-agent|entra-agent-identity/i.test(text)) return null;
  return text;
}

function agentNameOf(agent) {
  return agent?.name || agent?.agent_name || agent?.versions?.latest?.name || null;
}

function unwrapList(json) {
  if (Array.isArray(json)) return json;
  const raw = json?.data || json?.value || json?.agents || [];
  return Array.isArray(raw) ? raw : [];
}

async function readCollection(dataToken, endpoint, path, apiVersion, request) {
  const url = `${endpoint}/${path}?api-version=${apiVersion}&limit=100`;
  try {
    const result = await request(dataToken, url);
    if (!result.ok) return { ...result, agents: [] };
    return { ok: true, status: result.status, agents: unwrapList(result.json) };
  } catch (err) {
    return { ok: false, status: 0, agents: [], error: sanitize(err) };
  }
}

export async function readFoundryAgents(dataToken, endpoint, request, routes = AGENT_ROUTES) {
  let last = { ok: false, agents: [], error: "Foundry read failed" };
  for (const [path, apiVersion] of routes) {
    const result = await readCollection(dataToken, endpoint, path, apiVersion, request);
    if (result.ok && result.agents.length) return result;
    last = result.ok ? result : { ...result, agents: [] };
    if (result.status === 401 || result.status === 403) return last;
    if (/ENOTFOUND|getaddrinfo/i.test(String(result.error || ""))) return last;
  }
  return last;
}

function pickAgent(agents, tags, inferred) {
  const guid = String(tags.agentGuid || "").toLowerCase();
  const name = String(inferred || "").toLowerCase();
  return (
    (agents || []).find((agent) => guid && String(agent.id || "").toLowerCase() === guid) ||
    (agents || []).find((agent) => name && String(agentNameOf(agent) || "").toLowerCase() === name) ||
    null
  );
}

function observation({ conn, tenantId, sp, tags, inferred, model, modelSource, evidence, lastError, lastStatus }) {
  const entraName = sp.displayName || sp.id;
  const name = inferred || entraName;
  const isRestricted = modelSource === "permission_denied" || lastStatus === 401 || lastStatus === 403 || (lastError && /403|denied|forbidden/i.test(lastError));
  const isUnreachable = modelSource === "foundry_unreadable" || lastStatus === 404 || (lastError && /404|not found/i.test(lastError));
  const modelAccessStatus = model
    ? "available"
    : isRestricted
      ? "restricted_403"
      : isUnreachable
        ? "unreachable_404"
        : "missing";
  const remediationGuide = model
    ? null
    : isRestricted
      ? `Assign 'Cognitive Services OpenAI User' or 'Azure AI User' to connector App on ${tags.accountName || "the Cognitive Services account"} to reveal model definition.`
      : isUnreachable
        ? `Foundry data plane could not be reached on ${tags.accountName || "the Cognitive Services account"}. Verify project endpoint mapping.`
        : null;

  return {
    collector_id: "identity_entra_agent",
    fingerprint: `entra-agent-id:${tenantId}:${sp.id}`,
    name,
    category: "identity",
    provider: "entra_agent_id",
    cloud_provider: "azure",
    deployment_type: "identity",
    region: tags.region || "global",
    running_status: sp.accountEnabled === false ? "disabled" : "unknown",
    confidence_score: 0.95,
    framework: "entra-agent-identity",
    model: model || null,
    metadata: {
      connectorId: conn.id,
      connectorName: conn.name,
      environment: conn.environment,
      discoveryMode: "azure-scanner-v2",
      discoveryLayer: "agent",
      inventoryClass: "ai_cloud_agent",
      evidenceClass: "platform_agent",
      agentStatus: "confirmed",
      aiRelevant: true,
      cloudProvider: "azure",
      tenantId,
      objectId: sp.id,
      tags: sp.tags || [],
      foundryLink: { ...tags, inferredAgentName: inferred },
      entraDisplayName: entraName,
      agentName: name,
      modelSource: modelSource || "unknown",
      foundationModel: model || null,
      modelAccessStatus,
      remediationGuide,
      evidence,
      deep: {
        schemaVersion: "azure-scanner-v2",
        deepScan: "azure_scanner_v2",
        displayName: name,
        foundationModel: model || null,
        modelAccessStatus,
        remediationGuide,
        agentId: sp.id,
        provider: "entra_agent_id"
      }
    },
    relationships: [
      { rel_type: "OBSERVED_BY", to_type: "IdentityProvider", to_key: "entra-id", to_name: "Microsoft Entra ID" }
    ]
  };
}

async function defaultGraphIdentities(token) {
  const result = await httpJson(
    "https://graph.microsoft.com/v1.0/servicePrincipals/microsoft.graph.agentIdentity",
    token,
    ALLOW.graphMicrosoft
  );
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      items: [],
      error: sanitize(result.json?.error?.message || `Graph failed (${result.status})`)
    };
  }
  return { ok: true, status: 200, items: result.json.value || [] };
}

const ARM_PAGE_LIMIT = 20;

/**
 * Azure often returns an empty first page plus nextLink. Stopping on page 1
 * hides Foundry accounts that appear on later pages.
 */
export async function collectArmPageValues(startUrl, fetchPage, { maxPages = ARM_PAGE_LIMIT } = {}) {
  const items = [];
  let next = startUrl;
  const seen = new Set();
  for (let page = 0; page < maxPages && next; page += 1) {
    if (seen.has(next)) break;
    seen.add(next);
    const pageResult = await fetchPage(next);
    if (!pageResult?.ok) {
      if (page === 0) return [];
      break;
    }
    items.push(...(pageResult.value || []));
    next = pageResult.nextLink || null;
  }
  return items;
}

async function listArmValues(token, url) {
  return collectArmPageValues(url, async (pageUrl) => {
    const result = await httpJson(pageUrl, token, ALLOW.azureArm);
    return {
      ok: result.ok,
      value: result.json?.value || [],
      nextLink: result.json?.nextLink || null
    };
  });
}

async function defaultArmAccounts(token, subscriptionId) {
  return listArmValues(
    token,
    `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.CognitiveServices/accounts?api-version=${COGNITIVE_API}`
  );
}

async function defaultProjects(token, account) {
  const id = String(account?.id || "");
  if (!id) return [];
  return listArmValues(token, `https://management.azure.com${id}/projects?api-version=${COGNITIVE_API}`);
}

async function defaultDeployments(token, account) {
  const id = String(account?.id || "");
  if (!id) return [];
  return listArmValues(token, `https://management.azure.com${id}/deployments?api-version=${COGNITIVE_API}`);
}

async function defaultDataGet(token, url) {
  let policy = ALLOW.azureAiServices;
  try {
    const host = new URL(url).hostname;
    if (host.endsWith("openai.azure.com")) policy = ALLOW.azureOpenAi;
    else if (host === "management.azure.com") policy = ALLOW.azureArm;
  } catch {
    /* request will fail closed */
  }
  return httpJson(url, token, policy);
}

export async function probeFoundryAgentReadCapability(conn, deps = {}) {
  const creds = {
    tenantId: conn?.config?.tenantId,
    clientId: conn?.config?.clientId,
    clientSecret: conn?.secrets?.clientSecret
  };
  const subscriptionId = conn?.config?.subscriptionId;
  const getToken = deps.getToken || accessToken;
  const listAccounts = deps.listAccounts || (async (token) => defaultArmAccounts(token, subscriptionId));
  const listProjects = deps.listProjects || defaultProjects;
  const request = deps.request || defaultDataGet;

  let armToken = null;
  let dataToken = null;
  try {
    armToken = await getToken(creds, ARM_SCOPE);
  } catch (err) {
    return { ok: false, message: `ARM auth failed: ${sanitize(err)}` };
  }

  try {
    dataToken =
      (await getToken(creds, AI_SCOPE).catch(() => null)) ||
      (await getToken(creds, COGNITIVE_SCOPE).catch(() => null));
  } catch {
    dataToken = null;
  }

  if (!dataToken) {
    return {
      ok: false,
      message:
        "foundryAgentRead=false: no Azure AI data-plane token could be acquired. Assign Azure AI User or Cognitive Services OpenAI User."
    };
  }

  const accounts = await listAccounts(armToken);
  if (!accounts?.length) {
    return {
      ok: false,
      message: "foundryAgentRead=false: no Cognitive Services or Foundry accounts visible in this subscription."
    };
  }

  let lastError = null;
  for (const account of accounts.slice(0, 5)) {
    const projects = await listProjects(armToken, account);
    for (const project of (projects || []).slice(0, 3)) {
      const endpoints = projectEndpoints(project);
      for (const endpoint of endpoints) {
        const result = await readFoundryAgents(dataToken, endpoint, (token, url) => request(token, url));
        if (result.ok) {
          return {
            ok: true,
            accountName: account.name,
            projectName: project.name,
            agentCount: (result.agents || []).length,
            message: `foundryAgentRead=true on ${account.name}/${project.name} (${(result.agents || []).length} agents listed).`
          };
        }
        lastError = result.error || lastError;
      }
    }
  }

  return {
    ok: false,
    message: lastError || "foundryAgentRead=false: could not read any project agents endpoint."
  };
}

/**
 * Live Azure scan. Dependencies are injectable for tests.
 */
export async function discoverAzureScanner(conn, deps = {}) {
  const creds = {
    tenantId: conn?.config?.tenantId,
    clientId: conn?.config?.clientId,
    clientSecret: conn?.secrets?.clientSecret
  };
  const subscriptionId = conn?.config?.subscriptionId;
  const tenantId = creds.tenantId;
  const discoveryErrors = [];
  const observations = [];

  if (!creds.tenantId || !creds.clientId || !creds.clientSecret || !subscriptionId) {
    discoveryErrors.push({
      collector: "azure-scanner-v2",
      discoveryStatus: "error",
      error: "Azure connector missing tenantId, clientId, clientSecret, or subscriptionId"
    });
    return { observations, discoveryErrors, stats: { agentsDiscovered: 0, discoveryErrors: 1 } };
  }

  const getToken = deps.getToken || accessToken;
  let graphToken = null;
  let armToken = null;
  let dataToken = null;
  try {
    graphToken = await getToken(creds, GRAPH_SCOPE);
  } catch (err) {
    discoveryErrors.push({ collector: "azure-scanner-v2", discoveryType: "graph-token", discoveryStatus: "error", error: sanitize(err) });
  }
  try {
    armToken = await getToken(creds, ARM_SCOPE);
  } catch (err) {
    discoveryErrors.push({ collector: "azure-scanner-v2", discoveryType: "arm-token", discoveryStatus: "error", error: sanitize(err) });
  }
  try {
    dataToken = (await getToken(creds, AI_SCOPE).catch(() => null)) || (await getToken(creds, COGNITIVE_SCOPE).catch(() => null));
  } catch {
    dataToken = null;
  }
  if (!dataToken) {
    discoveryErrors.push({
      collector: "azure-scanner-v2",
      discoveryType: "foundry-token",
      discoveryStatus: "error",
      error: "No Azure AI data-plane token. Assign Azure AI User or Cognitive Services OpenAI User on the Foundry account."
    });
  }

  const listIdentities = deps.listIdentities || (graphToken ? () => defaultGraphIdentities(graphToken) : async () => ({ ok: false, items: [], error: "no graph token" }));
  const listAccounts = deps.listAccounts || (armToken ? () => defaultArmAccounts(armToken, subscriptionId) : async () => []);
  const listProjects = deps.listProjects || (armToken ? (account) => defaultProjects(armToken, account) : async () => []);
  const listDeployments = deps.listDeployments || (armToken ? (account) => defaultDeployments(armToken, account) : async () => []);
  const request = deps.request || defaultDataGet;

  const identityResult = await listIdentities();
  if (!identityResult.ok) {
    const status = identityResult.status;
    discoveryErrors.push({
      collector: "azure-scanner-v2",
      discoveryType: "entra-agent-id",
      discoveryStatus: status === 401 || status === 403 ? "permission_denied" : "error",
      error:
        status === 403
          ? "403 Forbidden listing Entra Agent ID. Grant application permission AgentIdentity.Read.All and admin consent."
          : identityResult.error || "Entra Agent ID list failed"
    });
  }

  const accounts = await listAccounts();
  const projectCache = new Map();

  for (const sp of identityResult.items || []) {
    const tags = parseFoundryTags(sp.tags || []);
    const inferred = tags.accountName && tags.projectName ? inferFoundryName(sp.displayName, tags) : null;
    const evidence = [
      "Listed via Microsoft Graph agentIdentity (azure scanner v2).",
      "Entra Agent ID does not carry the foundation model."
    ];
    let model = null;
    let modelSource = inferred ? "foundry_unreadable" : "unknown";

    const account = (accounts || []).find(
      (item) => String(item.name || "").toLowerCase() === String(tags.accountName || "").toLowerCase()
    );
    let endpoints = [];
    if (account && tags.projectName) {
      const cacheKey = `${account.id || account.name}:${tags.projectName}`;
      if (!projectCache.has(cacheKey)) {
        const projects = await listProjects(account);
        const named = (projects || []).find((project) => projectMatches(project, tags.projectName));
        projectCache.set(cacheKey, { endpoints: projectEndpoints(named), account });
      }
      endpoints = projectCache.get(cacheKey).endpoints;
    }

    if (inferred && !endpoints.length) {
      evidence.push(
        `No ARM project endpoint for ${tags.accountName}/${tags.projectName}. A hostname was not guessed; guessed hosts are what returned 404 and ENOTFOUND.`
      );
    }

    let last = null;
    if (dataToken && endpoints.length) {
      let matched = null;
      const routes = preferredAgentRoutes(tags);
      for (const endpoint of endpoints) {
        const listed = await readFoundryAgents(dataToken, endpoint, (token, url) => request(token, url), routes);
        last = listed;
        if (listed.status === 401 || listed.status === 403) break;
        matched = pickAgent(listed.agents, tags, inferred);
        if (matched) break;
      }
      if (matched) {
        model = modelFromAgent(matched);
        const foundryName = agentNameOf(matched);
        if (foundryName) evidence.push(`Agent name ${foundryName} read from the Foundry project endpoint.`);
        if (model) {
          modelSource = "azure_foundry_agents";
          evidence.push(`Foundation model ${model} read from the Foundry definition.`);
        } else {
          evidence.push("Foundry agent was found, but its definition did not include a model.");
        }
        if (foundryName) {
          observations.push(
            observation({
              conn,
              tenantId,
              sp,
              tags,
              inferred: foundryName,
              model,
              modelSource,
              evidence,
              lastError: last?.error,
              lastStatus: last?.status
            })
          );
          continue;
        }
      } else if (last && !last.ok) {
        const why = explainStatus(last.status, last.error);
        evidence.push(last.error || "Foundry read failed");
        if (why) evidence.push(why);
        discoveryErrors.push({
          collector: "azure-scanner-v2",
          discoveryType: "foundry-project",
          discoveryStatus: last.status === 401 || last.status === 403 ? "permission_denied" : "error",
          error: why || last.error,
          accountName: tags.accountName,
          projectName: tags.projectName
        });
      }
    }

    if (!model && account) {
      const deploymentModel = chatDeploymentModel(await listDeployments(account), inferred || tags.agentGuid);
      if (deploymentModel) {
        model = deploymentModel;
        modelSource = "azure_cognitive_deployment";
        evidence.push(
          `Foundation model ${deploymentModel} mapped from chat deployment on ${account.name}. The agent definition was not returned by data plane.`
        );
      }
    }

    if (inferred) evidence.push(`Inventory name set to Foundry agent ${inferred}.`);
    observations.push(
      observation({
        conn,
        tenantId,
        sp,
        tags,
        inferred,
        model,
        modelSource,
        evidence,
        lastError: last?.error,
        lastStatus: last?.status
      })
    );
  }

  const denied = discoveryErrors.some((item) => item.discoveryStatus === "permission_denied");
  return {
    observations,
    discoveryErrors,
    stats: {
      scanner: "azure-scanner-v2",
      legacyScannerDisabled: true,
      agentsDiscovered: observations.length,
      cloudResourcesIngested: observations.length,
      discoveryErrors: discoveryErrors.length,
      warning: denied
        ? "A 403 means the credential is missing Microsoft.CognitiveServices/accounts/AIServices/agents/read. Azure AI Developer in this catalog does not include that data action. Entra identities need AgentIdentity.Read.All."
        : null
    }
  };
}
