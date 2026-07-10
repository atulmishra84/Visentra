import { safeFetch, assertAllowedUrl, assertDnsLabel, ALLOW } from "../utils/http.js";
import { isAiRelevantText } from "./aiRelevance.js";

/**
 * SaaS / platform agent discovery adapters.
 * Discovers Copilot, Salesforce Agentforce, Workday, and ServiceNow AI agents
 * via customer-provided API credentials (agentless).
 */

const PLATFORM_LABELS = {
  m365_copilot: "Microsoft 365 Copilot / Copilot Studio",
  salesforce: "Salesforce Agentforce",
  workday: "Workday Illuminate / AI",
  servicenow: "ServiceNow Now Assist / Virtual Agent",
  openai: "OpenAI / ChatGPT"
};

async function azureAppToken(tenantId, clientId, clientSecret, scope) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope
  });
  const res = await safeFetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  }, ALLOW.microsoftLogin);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error_description || json.error || `Token request failed (${res.status})`);
  }
  return json.access_token;
}

function platformObservation({
  provider,
  conn,
  id,
  name,
  owner,
  model,
  framework,
  status,
  extra = {}
}) {
  const label = PLATFORM_LABELS[provider] || provider;
  return {
    collector_id: "saas_platform",
    fingerprint: `saas:${provider}:agent:${id}`,
    name,
    category: "saas",
    provider,
    deployment_type: "saas",
    framework: framework || label,
    model: model || null,
    owner: owner || null,
    running_status: status || "unknown",
    confidence_score: 0.94,
    business_unit: conn.environment || null,
    metadata: {
      connectorId: conn.id,
      connectorName: conn.name,
      discoveryMode: "saas-platform-api",
      inventoryClass: "platform_agent",
      evidenceClass: "platform_agent",
      agentStatus: "confirmed",
      aiRelevant: true,
      platform: provider,
      platformLabel: label,
      managedPlatformAgent: true,
      environment: conn.environment,
      ...extra
    },
    relationships: [
      {
        rel_type: "RUNS_ON",
        to_type: "SaaSPlatform",
        to_key: `saas-${provider}`,
        to_name: label
      }
    ]
  };
}

function connectorHealthObservation(provider, conn, message, agentCount = 0) {
  const label = PLATFORM_LABELS[provider] || provider;
  return {
    collector_id: "saas_platform",
    fingerprint: `saas-connector:${provider}:${conn.id}`,
    name: `${label} — ${conn.name}`,
    category: "saas",
    provider,
    deployment_type: "saas",
    framework: label,
    running_status: "running",
    confidence_score: 0.95,
    metadata: {
      connectorId: conn.id,
      connectorName: conn.name,
      discoveryMode: "saas-platform-validated",
      inventoryClass: "saas_connector",
      platform: provider,
      platformLabel: label,
      managedPlatformAgent: true,
      agentCount,
      testMessage: message,
      environment: conn.environment
    },
    relationships: [
      {
        rel_type: "RUNS_ON",
        to_type: "SaaSPlatform",
        to_key: `saas-${provider}`,
        to_name: label
      }
    ]
  };
}

/* ---------------- Microsoft 365 Copilot / Copilot Studio ---------------- */

export async function validateM365Copilot({ config, secrets }) {
  const { tenantId, clientId } = config;
  const clientSecret = secrets.clientSecret;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Microsoft Copilot requires tenantId, clientId, and clientSecret");
  }
  const token = await azureAppToken(tenantId, clientId, clientSecret, "https://graph.microsoft.com/.default");

  // Org profile proves Graph auth; Copilot inventory needs Reports.Read.All / app catalog scopes
  const org = await safeFetch("https://graph.microsoft.com/v1.0/organization?$select=id,displayName", {
    headers: { Authorization: `Bearer ${token}` }
  }, ALLOW.graphMicrosoft);
  if (!org.ok && org.status !== 403) {
    const err = await org.json().catch(() => ({}));
    throw new Error(err.error?.message || `Graph organization probe failed (${org.status})`);
  }

  return {
    ok: true,
    message:
      org.status === 403
        ? "Copilot app token OK. Grant Organization.Read.All and Reports.Read.All for Copilot usage/agent discovery."
        : "Microsoft Graph authenticated for Copilot / M365 discovery.",
    accessToken: token
  };
}

export async function discoverM365Copilot(conn) {
  const result = await validateM365Copilot({ config: conn.config, secrets: conn.secrets });
  const observations = [connectorHealthObservation("m365_copilot", conn, result.message)];
  if (!result.accessToken) return { observations, stats: { agents: 0, message: result.message } };

  const token = result.accessToken;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

  // Service principals that look like Copilot / Copilot Studio / Power Virtual Agents
  const sp = await safeFetch(
    "https://graph.microsoft.com/v1.0/servicePrincipals?$top=50&$select=id,displayName,appId,servicePrincipalType,tags",
    { headers }
  , ALLOW.graphMicrosoft);
  if (sp.ok) {
    const json = await sp.json().catch(() => ({}));
    const apps = (json.value || []).filter((a) =>
      isAiRelevantText(a.displayName, ...(a.tags || [])) ||
      /copilot|power virtual agents|bot framework|openai|ai builder|copilot studio/i.test(a.displayName || "")
    );
    for (const app of apps) {
      observations.push(
        platformObservation({
          provider: "m365_copilot",
          conn,
          id: app.id,
          name: app.displayName,
          framework: "Microsoft Copilot / PVA",
          model: "microsoft-copilot",
          status: "running",
          extra: { appId: app.appId, servicePrincipalType: app.servicePrincipalType, source: "graph-servicePrincipals" }
        })
      );
    }
  }

  // Teams apps (often include Copilot plugins)
  const teamsApps = await safeFetch(
    "https://graph.microsoft.com/v1.0/appCatalogs/teamsApps?$top=50&$select=id,displayName,distributionMethod",
    { headers }
  , ALLOW.graphMicrosoft);
  if (teamsApps.ok) {
    const json = await teamsApps.json().catch(() => ({}));
    for (const app of json.value || []) {
      if (!isAiRelevantText(app.displayName) && !/copilot|gpt|assistant|openai|agentforce|power virtual/i.test(app.displayName || "")) continue;
      observations.push(
        platformObservation({
          provider: "m365_copilot",
          conn,
          id: `teams-app-${app.id}`,
          name: app.displayName,
          framework: "Microsoft Teams App / Copilot plugin",
          model: "microsoft-copilot",
          status: "unknown",
          extra: { teamsAppId: app.id, distributionMethod: app.distributionMethod, source: "graph-teamsApps" }
        })
      );
    }
  }

  // Always surface a canonical Copilot platform agent when auth succeeds
  if (observations.length === 1) {
    observations.push(
      platformObservation({
        provider: "m365_copilot",
        conn,
        id: `tenant-copilot-${conn.config.tenantId}`,
        name: "Microsoft 365 Copilot (tenant)",
        framework: "Microsoft 365 Copilot",
        model: "microsoft-copilot",
        status: "running",
        extra: {
          source: "graph-inferred",
          note: "Grant Reports.Read.All and Power Platform admin scopes for Copilot Studio bot enumeration."
        }
      })
    );
  }

  return {
    observations,
    stats: { agents: Math.max(0, observations.length - 1), message: result.message }
  };
}

/* ---------------- Salesforce Agentforce ---------------- */

export async function validateSalesforce({ config, secrets }) {
  const loginUrl = (config.loginUrl || "https://login.salesforce.com").replace(/\/$/, "");
  assertAllowedUrl(loginUrl, ALLOW.salesforce);
  const clientId = config.clientId;
  const clientSecret = secrets.clientSecret;
  const username = config.username;
  const password = secrets.password;
  const securityToken = secrets.securityToken || "";

  if (!clientId || !clientSecret) {
    throw new Error("Salesforce requires clientId and clientSecret (Connected App)");
  }

  let tokenJson;
  if (username && password) {
    const body = new URLSearchParams({
      grant_type: "password",
      client_id: clientId,
      client_secret: clientSecret,
      username,
      password: `${password}${securityToken}`
    });
    const res = await safeFetch(
      `${loginUrl}/services/oauth2/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body
      },
      ALLOW.salesforce
    );
    tokenJson = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(tokenJson.error_description || tokenJson.error || `Salesforce auth failed (${res.status})`);
    }
  } else {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret
    });
    const res = await safeFetch(
      `${loginUrl}/services/oauth2/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body
      },
      ALLOW.salesforce
    );
    tokenJson = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        tokenJson.error_description ||
          tokenJson.error ||
          `Salesforce client_credentials failed (${res.status}). Enable client credentials flow or provide username/password.`
      );
    }
  }

  const instanceUrl = (tokenJson.instance_url || config.instanceUrl || "").replace(/\/$/, "");
  if (instanceUrl) assertAllowedUrl(instanceUrl, ALLOW.salesforce);
  return {
    ok: true,
    message: `Salesforce authenticated (${instanceUrl || loginUrl}).`,
    accessToken: tokenJson.access_token,
    instanceUrl
  };
}

export async function discoverSalesforce(conn) {
  const result = await validateSalesforce({ config: conn.config, secrets: conn.secrets });
  const observations = [connectorHealthObservation("salesforce", conn, result.message)];
  if (!result.accessToken || !result.instanceUrl) {
    return { observations, stats: { agents: 0, message: result.message } };
  }

  const headers = {
    Authorization: `Bearer ${result.accessToken}`,
    Accept: "application/json"
  };
  const base = result.instanceUrl;
  assertAllowedUrl(base, ALLOW.salesforce);
  const apiVersion = conn.config.apiVersion || "v59.0";

  // BotDefinition (Einstein Bots / legacy)
  const bots = await safeFetch(
    `${base}/services/data/${apiVersion}/query?q=${encodeURIComponent(
      "SELECT Id, MasterLabel, DeveloperName, Active, BotType FROM BotDefinition LIMIT 50"
    )}`,
    { headers }
  , ALLOW.salesforce);
  if (bots.ok) {
    const json = await bots.json().catch(() => ({}));
    for (const bot of json.records || []) {
      observations.push(
        platformObservation({
          provider: "salesforce",
          conn,
          id: bot.Id,
          name: bot.MasterLabel || bot.DeveloperName,
          framework: "Salesforce Einstein Bot",
          model: "salesforce-einstein",
          status: bot.Active ? "running" : "stopped",
          extra: { botType: bot.BotType, developerName: bot.DeveloperName, source: "soql-BotDefinition" }
        })
      );
    }
  }

  // GenAiPromptTemplate (Agentforce / Einstein generative)
  const prompts = await safeFetch(
    `${base}/services/data/${apiVersion}/query?q=${encodeURIComponent(
      "SELECT Id, MasterLabel, DeveloperName FROM GenAiPromptTemplate LIMIT 50"
    )}`,
    { headers }
  , ALLOW.salesforce);
  if (prompts.ok) {
    const json = await prompts.json().catch(() => ({}));
    for (const row of json.records || []) {
      observations.push(
        platformObservation({
          provider: "salesforce",
          conn,
          id: row.Id,
          name: row.MasterLabel || row.DeveloperName,
          framework: "Salesforce Agentforce / GenAI",
          model: "salesforce-agentforce",
          status: "unknown",
          extra: { developerName: row.DeveloperName, source: "soql-GenAiPromptTemplate" }
        })
      );
    }
  }

  // Connect bots API (when available)
  const connectBots = await safeFetch(`${base}/services/data/${apiVersion}/connect/bots`, { headers }, ALLOW.salesforce);
  if (connectBots.ok) {
    const json = await connectBots.json().catch(() => ({}));
    const list = json.bots || json.records || (Array.isArray(json) ? json : []);
    for (const bot of list) {
      const id = bot.id || bot.botId || bot.Id;
      if (!id) continue;
      observations.push(
        platformObservation({
          provider: "salesforce",
          conn,
          id: String(id),
          name: bot.name || bot.label || bot.MasterLabel || String(id),
          framework: "Salesforce Agentforce",
          model: "salesforce-agentforce",
          status: bot.status || "unknown",
          extra: { source: "connect-bots" }
        })
      );
    }
  }

  if (observations.length === 1) {
    observations.push(
      platformObservation({
        provider: "salesforce",
        conn,
        id: `sf-org-${conn.id}`,
        name: "Salesforce Agentforce (org capability)",
        framework: "Salesforce Agentforce",
        model: "salesforce-agentforce",
        status: "unknown",
        extra: {
          source: "inferred",
          note: "Auth OK. Grant API access to BotDefinition / GenAiPromptTemplate / Agentforce objects for full agent inventory."
        }
      })
    );
  }

  return {
    observations,
    stats: { agents: Math.max(0, observations.length - 1), message: result.message }
  };
}

/* ---------------- Workday ---------------- */

export async function validateWorkday({ config, secrets }) {
  const tenant = assertDnsLabel(
    String(config.tenant || "")
      .replace(/^https?:\/\//, "")
      .replace(/\.workday\.com.*$/, "")
      .replace(/\/$/, ""),
    "tenant"
  );
  const clientId = config.clientId;
  const clientSecret = secrets.clientSecret;
  const refreshToken = secrets.refreshToken;
  const username = config.username;
  const password = secrets.password;

  if (!tenant) throw new Error("Workday requires tenant (e.g. acme for acme.workday.com)");

  // Prefer OAuth refresh token (ISU / API client)
  if (clientId && clientSecret && refreshToken) {
    const tokenUrl = `https://${tenant}.workday.com/ccx/oauth2/${tenant}/token`;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret
    });
    const res = await safeFetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    }, ALLOW.workday);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error_description || json.error || `Workday OAuth failed (${res.status})`);
    }
    return {
      ok: true,
      message: `Workday OAuth authenticated for tenant ${tenant}.`,
      accessToken: json.access_token,
      tenant,
      mode: "oauth"
    };
  }

  // Fallback: REST basic auth probe against common workers endpoint
  if (username && password) {
    const url = `https://${tenant}.workday.com/ccx/api/v1/${tenant}/workers?limit=1`;
    const res = await safeFetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        Accept: "application/json"
      }
    }, ALLOW.workday);
    if (!res.ok && res.status !== 403) {
      const text = await res.text().catch(() => "");
      throw new Error(`Workday basic auth failed (${res.status}). ${text.slice(0, 160)}`);
    }
    return {
      ok: true,
      message:
        res.status === 403
          ? `Workday reachable for ${tenant}. Grant Workers/Integrations read for AI agent discovery.`
          : `Workday authenticated for tenant ${tenant} (basic).`,
      tenant,
      mode: "basic",
      username,
      password
    };
  }

  throw new Error("Workday requires (clientId+clientSecret+refreshToken) or (username+password)");
}

export async function discoverWorkday(conn) {
  const result = await validateWorkday({ config: conn.config, secrets: conn.secrets });
  const observations = [connectorHealthObservation("workday", conn, result.message)];
  const tenant = result.tenant;
  const headers = { Accept: "application/json" };
  if (result.accessToken) headers.Authorization = `Bearer ${result.accessToken}`;
  else if (result.username && result.password) {
    headers.Authorization = `Basic ${Buffer.from(`${result.username}:${result.password}`).toString("base64")}`;
  }

  // Integration Systems often host AI/automation extensions
  const integrations = await safeFetch(
    `https://${tenant}.workday.com/ccx/api/v1/${tenant}/integrationSystems?limit=50`,
    { headers }
  , ALLOW.workday).catch(() => null);

  if (integrations?.ok) {
    const json = await integrations.json().catch(() => ({}));
    const rows = json.data || json.integrationSystems || [];
    for (const row of rows) {
      const name = row.descriptor || row.name || row.id;
      if (!isAiRelevantText(String(name)) && !/illuminate|copilot|assistant|genai|agentforce/i.test(String(name))) continue;
      observations.push(
        platformObservation({
          provider: "workday",
          conn,
          id: row.id || name,
          name: String(name),
          framework: "Workday Integration / Illuminate",
          model: "workday-ai",
          status: "unknown",
          extra: { source: "workday-integrationSystems" }
        })
      );
    }
  }

  // Always emit Workday Illuminate / Assistant platform capability when auth works
  observations.push(
    platformObservation({
      provider: "workday",
      conn,
      id: `workday-illuminate-${tenant}`,
      name: `Workday Illuminate AI (${tenant})`,
      framework: "Workday Illuminate",
      model: "workday-illuminate",
      status: "running",
      extra: {
        source: "workday-platform",
        note: "Connect Workday Extend / Orchestrate APIs for custom agent enumeration when available in your tenant."
      }
    })
  );

  return {
    observations,
    stats: { agents: Math.max(0, observations.length - 1), message: result.message }
  };
}

/* ---------------- ServiceNow ---------------- */

export async function validateServiceNow({ config, secrets }) {
  const instance = assertDnsLabel(
    String(config.instance || "")
      .replace(/^https?:\/\//, "")
      .replace(/\.service-now\.com.*$/, "")
      .replace(/\/$/, ""),
    "instance"
  );
  const username = config.username;
  const password = secrets.password;
  const clientId = config.clientId;
  const clientSecret = secrets.clientSecret;

  if (!instance) throw new Error("ServiceNow requires instance (e.g. acme for acme.service-now.com)");

  let authHeader;
  if (clientId && clientSecret) {
    const body = new URLSearchParams({
      grant_type: "password",
      client_id: clientId,
      client_secret: clientSecret,
      username: username || "",
      password: password || ""
    });
    if (!username || !password) {
      throw new Error("ServiceNow OAuth password grant requires username and password");
    }
    const tokenRes = await safeFetch(`https://${instance}.service-now.com/oauth_token.do`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    }, ALLOW.servicenow);
    const tokenJson = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok) {
      throw new Error(tokenJson.error_description || tokenJson.error || `ServiceNow OAuth failed (${tokenRes.status})`);
    }
    authHeader = `Bearer ${tokenJson.access_token}`;
  } else if (username && password) {
    authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  } else {
    throw new Error("ServiceNow requires username/password (and optional OAuth clientId/clientSecret)");
  }

  const probe = await safeFetch(
    `https://${instance}.service-now.com/api/now/table/sys_user?sysparm_limit=1&sysparm_fields=sys_id`,
    { headers: { Authorization: authHeader, Accept: "application/json" } }
  , ALLOW.servicenow);
  if (!probe.ok && probe.status !== 403) {
    const err = await probe.json().catch(() => ({}));
    throw new Error(err.error?.message || `ServiceNow probe failed (${probe.status})`);
  }

  return {
    ok: true,
    message:
      probe.status === 403
        ? `ServiceNow auth OK for ${instance}. Grant table read on Virtual Agent / Now Assist tables.`
        : `ServiceNow authenticated to ${instance}.service-now.com.`,
    authHeader,
    instance
  };
}

export async function discoverServiceNow(conn) {
  const result = await validateServiceNow({ config: conn.config, secrets: conn.secrets });
  const observations = [connectorHealthObservation("servicenow", conn, result.message)];
  if (!result.authHeader) return { observations, stats: { agents: 0, message: result.message } };

  const headers = { Authorization: result.authHeader, Accept: "application/json" };
  const base = `https://${result.instance}.service-now.com/api/now/table`;

  const tables = [
    { table: "sys_cs_topic", framework: "ServiceNow Virtual Agent", labelField: "name" },
    { table: "sys_cb_topic", framework: "ServiceNow Conversational Topic", labelField: "name" },
    { table: "sys_hub_flow", framework: "ServiceNow Flow / Now Assist", labelField: "name" },
    { table: "sys_gen_ai_prompt", framework: "ServiceNow Now Assist GenAI", labelField: "name" }
  ];

  for (const spec of tables) {
    const res = await safeFetch(
      `${base}/${spec.table}?sysparm_limit=40&sysparm_fields=sys_id,${spec.labelField},active`,
      { headers }
    , ALLOW.servicenow).catch(() => null);
    if (!res?.ok) continue;
    const json = await res.json().catch(() => ({}));
    for (const row of json.result || []) {
      const name = row[spec.labelField] || row.sys_id;
      if (spec.table === "sys_hub_flow" && !isAiRelevantText(String(name)) && !/assist|genai|virtual|copilot|now assist/i.test(String(name))) {
        continue;
      }
      observations.push(
        platformObservation({
          provider: "servicenow",
          conn,
          id: row.sys_id,
          name: String(name),
          framework: spec.framework,
          model: "servicenow-now-assist",
          status: row.active === "true" || row.active === true ? "running" : "unknown",
          extra: { table: spec.table, source: "servicenow-table-api" }
        })
      );
    }
  }

  if (observations.length === 1) {
    observations.push(
      platformObservation({
        provider: "servicenow",
        conn,
        id: `snow-now-assist-${result.instance}`,
        name: `ServiceNow Now Assist (${result.instance})`,
        framework: "ServiceNow Now Assist",
        model: "servicenow-now-assist",
        status: "running",
        extra: {
          source: "inferred",
          note: "Auth OK. Grant read on sys_cs_topic / Now Assist tables for full agent inventory."
        }
      })
    );
  }

  return {
    observations,
    stats: { agents: Math.max(0, observations.length - 1), message: result.message }
  };
}

/* ---------------- OpenAI / ChatGPT ---------------- */

export async function validateOpenAi({ config, secrets }) {
  const apiKey = String(secrets.apiKey || "").trim();
  if (!apiKey) throw new Error("OpenAI apiKey is required");
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json"
  };
  if (config.organizationId) headers["OpenAI-Organization"] = String(config.organizationId);
  if (config.projectId) headers["OpenAI-Project"] = String(config.projectId);

  const res = await safeFetch("https://api.openai.com/v1/models", { headers }, ALLOW.openai);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error?.message || `OpenAI API failed (${res.status})`);
  }
  const models = Array.isArray(json.data) ? json.data.length : 0;
  return {
    ok: true,
    message: `Authenticated to OpenAI API (models visible: ${models}).`,
    accessToken: apiKey,
    headers
  };
}

export async function discoverOpenAi(conn) {
  const result = await validateOpenAi({ config: conn.config, secrets: conn.secrets });
  const observations = [connectorHealthObservation("openai", conn, result.message)];
  const headers = {
    ...result.headers,
    "OpenAI-Beta": "assistants=v2"
  };

  // Assistants API — first-class ChatGPT/OpenAI agents
  const asst = await safeFetch(
    "https://api.openai.com/v1/assistants?limit=50",
    { headers },
    ALLOW.openai
  );
  if (asst.ok) {
    const json = await asst.json().catch(() => ({}));
    for (const a of json.data || []) {
      observations.push(
        platformObservation({
          provider: "openai",
          conn,
          id: a.id,
          name: a.name || `OpenAI Assistant ${a.id}`,
          framework: "OpenAI Assistants",
          model: a.model || "openai-assistant",
          status: "running",
          extra: {
            source: "openai-assistants",
            tools: (a.tools || []).map((t) => t.type).filter(Boolean),
            description: a.description || null
          }
        })
      );
    }
  }

  // Model catalog — surface GPT / o-series as cloud AI runtimes (candidates)
  const modelsRes = await safeFetch("https://api.openai.com/v1/models", { headers: result.headers }, ALLOW.openai);
  if (modelsRes.ok) {
    const json = await modelsRes.json().catch(() => ({}));
    const interesting = (json.data || []).filter((m) =>
      /^(gpt-|o[0-9]|chatgpt|text-embedding)/i.test(m.id || "")
    );
    for (const m of interesting.slice(0, 20)) {
      observations.push({
        collector_id: "saas_platform",
        fingerprint: `saas:openai:model:${m.id}`,
        name: `OpenAI model — ${m.id}`,
        category: "saas",
        provider: "openai",
        deployment_type: "saas",
        framework: "OpenAI Models",
        model: m.id,
        running_status: "unknown",
        confidence_score: 0.8,
        metadata: {
          connectorId: conn.id,
          connectorName: conn.name,
          discoveryMode: "openai-api-live",
          inventoryClass: "platform_agent",
          evidenceClass: "cloud_ai_runtime",
          agentStatus: /gpt-|chatgpt|o[0-9]/i.test(m.id) ? "candidate" : "candidate",
          aiRelevant: true,
          managedPlatformAgent: false,
          ownedBy: m.owned_by || null,
          environment: conn.environment
        },
        relationships: [
          {
            rel_type: "RUNS_ON",
            to_type: "SaaSPlatform",
            to_key: "saas-openai",
            to_name: "OpenAI / ChatGPT"
          }
        ]
      });
    }
  }

  // Canonical ChatGPT / OpenAI org agent when auth works
  if (observations.length === 1) {
    observations.push(
      platformObservation({
        provider: "openai",
        conn,
        id: `org-${conn.config.organizationId || conn.id}`,
        name: "ChatGPT / OpenAI (organization)",
        framework: "OpenAI / ChatGPT",
        model: "chatgpt",
        status: "running",
        extra: {
          source: "openai-inferred",
          note: "Grant Assistants API access to enumerate custom GPTs / assistants."
        }
      })
    );
  }

  return {
    observations,
    stats: { agents: Math.max(0, observations.length - 1), message: result.message }
  };
}

export const SAAS_VALIDATORS = {
  m365_copilot: validateM365Copilot,
  salesforce: validateSalesforce,
  workday: validateWorkday,
  servicenow: validateServiceNow,
  openai: validateOpenAi
};

export const SAAS_DISCOVERERS = {
  m365_copilot: discoverM365Copilot,
  salesforce: discoverSalesforce,
  workday: discoverWorkday,
  servicenow: discoverServiceNow,
  openai: discoverOpenAi
};

export const SAAS_PROVIDERS = Object.keys(SAAS_VALIDATORS);

export async function discoverSaasConnector(conn) {
  const discoverer = SAAS_DISCOVERERS[conn.provider];
  if (!discoverer) throw new Error(`No SaaS discoverer for provider ${conn.provider}`);
  return discoverer(conn);
}
