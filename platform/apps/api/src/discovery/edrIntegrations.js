import crypto from "crypto";
import { safeFetch, assertAllowedUrl, assertDnsLabel, ALLOW } from "../utils/http.js";
import {
  DISCOVERY_AI_ONLY,
  isAiRelevantText,
  isAiAgentProcess,
  shouldIngestAiOnly
} from "./aiRelevance.js";

const EDR_DEVICE_LIMIT = Number(process.env.EDR_DISCOVERY_MAX_DEVICES || 100);

function deviceLooksAiAgent(parts) {
  return isAiRelevantText(...parts) || isAiAgentProcess(parts.filter(Boolean).join(" "));
}

function cortexAuthHeaders(apiKey, apiKeyId) {
  const nonce = crypto.randomBytes(16).toString("hex");
  const timestamp = Date.now().toString();
  const authHash = crypto.createHash("sha256").update(apiKey + nonce + timestamp).digest("hex");
  return {
    "x-xdr-auth-id": String(apiKeyId),
    "x-xdr-nonce": nonce,
    "x-xdr-timestamp": timestamp,
    "x-xdr-auth-hash": authHash,
    "Content-Type": "application/json"
  };
}

async function azureAppToken(tenantId, clientId, clientSecret, scope) {
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
    throw new Error(json.error_description || json.error || `Token request failed (${res.status})`);
  }
  return json.access_token;
}

function endpointObservation({
  provider,
  conn,
  id,
  name,
  hostname,
  os,
  owner,
  ip,
  status,
  extra = {},
  aiRelevant = true,
  processEvidence = null
}) {
  const label =
    {
      crowdstrike: "CrowdStrike",
      defender: "Microsoft Defender",
      intune: "Microsoft Intune",
      cortex: "Cortex XDR",
      netskope: "Netskope"
    }[provider] || provider;

  const display = name || hostname || `${label} device ${id}`;
  return {
    collector_id: "edr",
    fingerprint: `edr:${provider}:ai-agent:${id}`,
    name: aiRelevant ? `${display} (AI agent host)` : display,
    category: "endpoint",
    provider,
    deployment_type: "endpoint",
    hostname: hostname || null,
    operating_system: os || null,
    owner: owner || null,
    ip: ip || null,
    device: name || hostname || id,
    running_status: status || "unknown",
    confidence_score: processEvidence ? 0.9 : 0.82,
    framework: label,
    model: aiRelevant ? "ai-agent-endpoint" : null,
    metadata: {
      connectorId: conn.id,
      connectorName: conn.name,
      discoveryMode: "edr-ai-agent-filter",
      inventoryClass: aiRelevant ? "endpoint_ai_agent" : "endpoint_device",
      evidenceClass: aiRelevant ? "process_agent" : null,
      agentStatus: aiRelevant ? (processEvidence ? "confirmed" : "candidate") : null,
      aiRelevant,
      edrProvider: provider,
      environment: conn.environment,
      processEvidence: processEvidence || null,
      ...extra
    },
    relationships: [
      {
        rel_type: "OBSERVED_BY",
        to_type: "EDRPlatform",
        to_key: `edr-${provider}`,
        to_name: label
      }
    ]
  };
}

function maybePushAiEndpoint(observations, args) {
  const blob = [
    args.name,
    args.hostname,
    args.os,
    args.owner,
    args.processEvidence,
    ...(Array.isArray(args.signalParts) ? args.signalParts : [])
  ];
  const aiRelevant = deviceLooksAiAgent(blob);
  if (!shouldIngestAiOnly(aiRelevant)) return false;
  observations.push(
    endpointObservation({
      ...args,
      aiRelevant: true
    })
  );
  return true;
}

export async function validateCrowdstrike({ config, secrets }) {
  const base = (config.baseUrl || "https://api.crowdstrike.com").replace(/\/$/, "");
  assertAllowedUrl(base, ALLOW.crowdstrike);
  const clientId = config.clientId;
  const clientSecret = secrets.clientSecret;
  if (!clientId || !clientSecret) throw new Error("CrowdStrike clientId and clientSecret are required");

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret
  });
  const tokenRes = await safeFetch(
    `${base}/oauth2/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body
    },
    ALLOW.crowdstrike
  );
  const tokenJson = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    throw new Error(tokenJson.errors?.[0]?.message || tokenJson.message || `CrowdStrike auth failed (${tokenRes.status})`);
  }

  const probe = await safeFetch(`${base}/devices/queries/devices/v1?limit=1`, {
    headers: { Authorization: `Bearer ${tokenJson.access_token}`, Accept: "application/json" }
  }, ALLOW.crowdstrike);
  if (!probe.ok && probe.status !== 403) {
    const err = await probe.json().catch(() => ({}));
    throw new Error(err.errors?.[0]?.message || `CrowdStrike device query failed (${probe.status})`);
  }
  if (probe.status === 403) {
    return {
      ok: true,
      message: "CrowdStrike OAuth succeeded. Grant Hosts:read (or equivalent) for device/process discovery."
    };
  }
  const data = await probe.json().catch(() => ({}));
  const count = Array.isArray(data.resources) ? data.resources.length : 0;
  return {
    ok: true,
    message: `CrowdStrike authenticated (${base}). Device query OK (sample ${count}).`,
    accessToken: tokenJson.access_token,
    base
  };
}

export async function discoverCrowdstrike(conn) {
  const result = await validateCrowdstrike({ config: conn.config, secrets: conn.secrets });
  const observations = [
    {
      collector_id: "edr",
      fingerprint: `edr-connector:crowdstrike:${conn.id}`,
      name: `CrowdStrike — ${conn.name}`,
      category: "endpoint",
      provider: "crowdstrike",
      deployment_type: "endpoint",
      running_status: "running",
      confidence_score: 0.9,
      framework: "CrowdStrike",
      metadata: {
        connectorId: conn.id,
        connectorName: conn.name,
        discoveryMode: "edr-api-validated",
        inventoryClass: "edr_connector",
        testMessage: result.message,
        environment: conn.environment
      },
      relationships: [
        {
          rel_type: "OBSERVED_BY",
          to_type: "EDRPlatform",
          to_key: "edr-crowdstrike",
          to_name: "CrowdStrike"
        }
      ]
    }
  ];

  if (!result.accessToken) {
    return { observations, stats: { devices: 0, message: result.message } };
  }

  const base = result.base;
  assertAllowedUrl(base, ALLOW.crowdstrike);
  const idsRes = await safeFetch(
    `${base}/devices/queries/devices/v1?limit=${EDR_DEVICE_LIMIT}`,
    {
      headers: { Authorization: `Bearer ${result.accessToken}`, Accept: "application/json" }
    },
    ALLOW.crowdstrike
  );
  if (!idsRes.ok) {
    return { observations, stats: { devices: 0, message: result.message } };
  }
  const idsJson = await idsRes.json().catch(() => ({}));
  const ids = Array.isArray(idsJson.resources) ? idsJson.resources.slice(0, EDR_DEVICE_LIMIT) : [];
  if (!ids.length) return { observations, stats: { devices: 0, message: result.message } };

  const detailRes = await safeFetch(
    `${base}/devices/entities/devices/v2`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${result.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ids })
    },
    ALLOW.crowdstrike
  );
  const detailJson = await detailRes.json().catch(() => ({}));
  const devices = Array.isArray(detailJson.resources) ? detailJson.resources : [];

  // Optional: surface hosts with AI-agent process evidence (best-effort; ignore auth gaps)
  const processHosts = new Map();
  try {
    const filter =
      "cmdline:*ollama*+cmdline:*claude*+cmdline:*copilot*+cmdline:*langchain*+cmdline:*crewai*+cmdline:*autogen*+cmdline:*vllm*+cmdline:*openai*+cmdline:*mcp*";
    const procRes = await safeFetch(
      `${base}/processes/queries/processes/v1?limit=50&filter=${encodeURIComponent(filter)}`,
      {
        headers: { Authorization: `Bearer ${result.accessToken}`, Accept: "application/json" }
      },
      ALLOW.crowdstrike
    );
    if (procRes.ok) {
      const procJson = await procRes.json().catch(() => ({}));
      const procIds = Array.isArray(procJson.resources) ? procJson.resources.slice(0, 50) : [];
      if (procIds.length) {
        const ent = await safeFetch(
          `${base}/processes/entities/processes/GET/v2`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${result.accessToken}`,
              Accept: "application/json",
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ ids: procIds })
          },
          ALLOW.crowdstrike
        );
        const entJson = await ent.json().catch(() => ({}));
        for (const p of entJson.resources || []) {
          const host = p.device_id || p.aid;
          if (!host) continue;
          const evidence = String(p.cmdline || p.file_name || p.name || "ai-process");
          if (!isAiAgentProcess(evidence) && !isAiRelevantText(evidence)) continue;
          processHosts.set(host, evidence.slice(0, 300));
        }
      }
    }
  } catch {
    /* process API optional */
  }

  let aiAgents = 0;
  for (const d of devices) {
    const processEvidence = processHosts.get(d.device_id) || null;
    const pushed = maybePushAiEndpoint(observations, {
      provider: "crowdstrike",
      conn,
      id: d.device_id,
      name: d.hostname || d.device_id,
      hostname: d.hostname,
      os: [d.platform_name, d.os_version].filter(Boolean).join(" "),
      owner: d.last_login_user || d.machine_domain || null,
      ip: d.local_ip || d.external_ip || null,
      status: d.status || "unknown",
      processEvidence,
      signalParts: [d.hostname, d.product_type_desc, d.machine_domain, processEvidence],
      extra: { crowdstrikeDeviceId: d.device_id, productType: d.product_type_desc }
    });
    if (pushed) aiAgents += 1;
  }
  // Devices only seen via AI process evidence
  for (const [deviceId, evidence] of processHosts) {
    if (devices.some((d) => d.device_id === deviceId)) continue;
    const pushed = maybePushAiEndpoint(observations, {
      provider: "crowdstrike",
      conn,
      id: deviceId,
      name: `AI process host ${deviceId}`,
      hostname: null,
      os: null,
      owner: null,
      ip: null,
      status: "running",
      processEvidence: evidence,
      signalParts: [evidence],
      extra: { crowdstrikeDeviceId: deviceId, source: "process-query" }
    });
    if (pushed) aiAgents += 1;
  }
  return {
    observations,
    stats: {
      devices: devices.length,
      aiAgents,
      aiOnly: DISCOVERY_AI_ONLY,
      message: result.message
    }
  };
}

export async function validateDefender({ config, secrets }) {
  const tenantId = config.tenantId;
  const clientId = config.clientId;
  const clientSecret = secrets.clientSecret;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Defender requires tenantId, clientId, and clientSecret");
  }
  const token = await azureAppToken(
    tenantId,
    clientId,
    clientSecret,
    "https://api.securitycenter.microsoft.com/.default"
  );
  const res = await safeFetch(
    "https://api.securitycenter.microsoft.com/api/machines?$top=1",
    {
      headers: { Authorization: `Bearer ${token}` }
    },
    ALLOW.defender
  );
  if (!res.ok && res.status !== 403) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Defender API failed (${res.status})`);
  }
  if (res.status === 403) {
    return {
      ok: true,
      message: "Defender token OK. Grant Machine.Read.All (application) for endpoint discovery.",
      accessToken: token
    };
  }
  const json = await res.json().catch(() => ({}));
  const n = Array.isArray(json.value) ? json.value.length : 0;
  return {
    ok: true,
    message: `Microsoft Defender for Endpoint authenticated. Sample machines: ${n}.`,
    accessToken: token
  };
}

export async function discoverDefender(conn) {
  const result = await validateDefender({ config: conn.config, secrets: conn.secrets });
  const observations = [
    {
      collector_id: "edr",
      fingerprint: `edr-connector:defender:${conn.id}`,
      name: `Microsoft Defender — ${conn.name}`,
      category: "endpoint",
      provider: "defender",
      deployment_type: "endpoint",
      running_status: "running",
      confidence_score: 0.9,
      framework: "Microsoft Defender",
      metadata: {
        connectorId: conn.id,
        connectorName: conn.name,
        discoveryMode: "edr-api-validated",
        inventoryClass: "edr_connector",
        testMessage: result.message,
        environment: conn.environment
      },
      relationships: [
        {
          rel_type: "OBSERVED_BY",
          to_type: "EDRPlatform",
          to_key: "edr-defender",
          to_name: "Microsoft Defender"
        }
      ]
    }
  ];
  if (!result.accessToken) return { observations, stats: { devices: 0, message: result.message } };

  const res = await safeFetch(
    `https://api.securitycenter.microsoft.com/api/machines?$top=${EDR_DEVICE_LIMIT}`,
    { headers: { Authorization: `Bearer ${result.accessToken}` } }
  , ALLOW.defender);
  if (!res.ok) return { observations, stats: { devices: 0, message: result.message } };
  const json = await res.json().catch(() => ({}));
  const machines = Array.isArray(json.value) ? json.value : [];
  let aiAgents = 0;
  for (const m of machines) {
    const pushed = maybePushAiEndpoint(observations, {
      provider: "defender",
      conn,
      id: m.id,
      name: m.computerDnsName || m.id,
      hostname: m.computerDnsName,
      os: [m.osPlatform, m.version].filter(Boolean).join(" "),
      owner: null,
      ip: m.lastIpAddress || m.lastExternalIpAddress || null,
      status: m.healthStatus || m.onboardingStatus || "unknown",
      signalParts: [m.computerDnsName, m.osPlatform, m.riskScore],
      extra: { defenderMachineId: m.id, riskScore: m.riskScore }
    });
    if (pushed) aiAgents += 1;
  }
  return {
    observations,
    stats: { devices: machines.length, aiAgents, aiOnly: DISCOVERY_AI_ONLY, message: result.message }
  };
}

export async function validateIntune({ config, secrets }) {
  const tenantId = config.tenantId;
  const clientId = config.clientId;
  const clientSecret = secrets.clientSecret;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Intune requires tenantId, clientId, and clientSecret");
  }
  const token = await azureAppToken(tenantId, clientId, clientSecret, "https://graph.microsoft.com/.default");
  const res = await safeFetch("https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$top=1", {
    headers: { Authorization: `Bearer ${token}` }
  }, ALLOW.graphMicrosoft);
  if (!res.ok && res.status !== 403) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Intune/Graph failed (${res.status})`);
  }
  if (res.status === 403) {
    return {
      ok: true,
      message: "Intune token OK. Grant DeviceManagementManagedDevices.Read.All for discovery.",
      accessToken: token
    };
  }
  const json = await res.json().catch(() => ({}));
  const n = Array.isArray(json.value) ? json.value.length : 0;
  return {
    ok: true,
    message: `Microsoft Intune authenticated. Sample managed devices: ${n}.`,
    accessToken: token
  };
}

export async function discoverIntune(conn) {
  const result = await validateIntune({ config: conn.config, secrets: conn.secrets });
  const observations = [
    {
      collector_id: "edr",
      fingerprint: `edr-connector:intune:${conn.id}`,
      name: `Microsoft Intune — ${conn.name}`,
      category: "endpoint",
      provider: "intune",
      deployment_type: "endpoint",
      running_status: "running",
      confidence_score: 0.9,
      framework: "Microsoft Intune",
      metadata: {
        connectorId: conn.id,
        connectorName: conn.name,
        discoveryMode: "edr-api-validated",
        inventoryClass: "edr_connector",
        testMessage: result.message,
        environment: conn.environment
      },
      relationships: [
        {
          rel_type: "OBSERVED_BY",
          to_type: "EDRPlatform",
          to_key: "edr-intune",
          to_name: "Microsoft Intune"
        }
      ]
    }
  ];
  if (!result.accessToken) return { observations, stats: { devices: 0, message: result.message } };

  const res = await safeFetch(
    `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$top=${EDR_DEVICE_LIMIT}`,
    { headers: { Authorization: `Bearer ${result.accessToken}` } }
  , ALLOW.graphMicrosoft);
  if (!res.ok) return { observations, stats: { devices: 0, message: result.message } };
  const json = await res.json().catch(() => ({}));
  const devices = Array.isArray(json.value) ? json.value : [];
  let aiAgents = 0;
  for (const d of devices) {
    const pushed = maybePushAiEndpoint(observations, {
      provider: "intune",
      conn,
      id: d.id,
      name: d.deviceName || d.id,
      hostname: d.deviceName,
      os: [d.operatingSystem, d.osVersion].filter(Boolean).join(" "),
      owner: d.userPrincipalName || d.emailAddress || null,
      ip: null,
      status: d.complianceState || d.managementState || "unknown",
      signalParts: [d.deviceName, d.model, d.manufacturer, d.userPrincipalName],
      extra: { intuneDeviceId: d.id, model: d.model, manufacturer: d.manufacturer }
    });
    if (pushed) aiAgents += 1;
  }
  return {
    observations,
    stats: { devices: devices.length, aiAgents, aiOnly: DISCOVERY_AI_ONLY, message: result.message }
  };
}

export async function validateCortex({ config, secrets }) {
  const fqdn = assertDnsLabel(config.fqdn, "fqdn");
  const apiKeyId = config.apiKeyId;
  const apiKey = secrets.apiKey;
  const region = assertDnsLabel(config.region || "us", "region");
  if (!apiKeyId || !apiKey) throw new Error("Cortex requires fqdn, apiKeyId, and apiKey");

  const baseUrl = `https://api-${fqdn}.xdr.${region}.paloaltonetworks.com/public_api/v1`;
  assertAllowedUrl(baseUrl, ALLOW.cortex);
  const res = await safeFetch(
    `${baseUrl}/endpoints/get_endpoints/`,
    {
      method: "POST",
      headers: cortexAuthHeaders(apiKey, apiKeyId),
      body: JSON.stringify({
        request_data: {
          filters: [{ field: "endpoint_status", operator: "in", value: ["CONNECTED", "connected"] }],
          search_from: 0,
          search_to: 1
        }
      })
    },
    ALLOW.cortex
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.reply?.err_msg || json.err_msg || `Cortex XDR failed (${res.status})`);
  }
  const endpoints = json.reply?.endpoints || json.reply || [];
  const n = Array.isArray(endpoints) ? endpoints.length : 0;
  return {
    ok: true,
    message: `Cortex XDR authenticated for tenant ${fqdn}. Sample endpoints: ${n}.`,
    baseUrl,
    apiKey,
    apiKeyId
  };
}

export async function discoverCortex(conn) {
  const result = await validateCortex({ config: conn.config, secrets: conn.secrets });
  const observations = [
    {
      collector_id: "edr",
      fingerprint: `edr-connector:cortex:${conn.id}`,
      name: `Cortex XDR — ${conn.name}`,
      category: "endpoint",
      provider: "cortex",
      deployment_type: "endpoint",
      running_status: "running",
      confidence_score: 0.9,
      framework: "Cortex XDR",
      metadata: {
        connectorId: conn.id,
        connectorName: conn.name,
        discoveryMode: "edr-api-validated",
        inventoryClass: "edr_connector",
        testMessage: result.message,
        environment: conn.environment
      },
      relationships: [
        {
          rel_type: "OBSERVED_BY",
          to_type: "EDRPlatform",
          to_key: "edr-cortex",
          to_name: "Cortex XDR"
        }
      ]
    }
  ];

  const res = await safeFetch(`${result.baseUrl}/endpoints/get_endpoints/`, {
    method: "POST",
    headers: cortexAuthHeaders(result.apiKey, result.apiKeyId),
    body: JSON.stringify({
      request_data: {
        search_from: 0,
        search_to: EDR_DEVICE_LIMIT
      }
    })
  }, ALLOW.cortex);
  const json = await res.json().catch(() => ({}));
  const endpoints = json.reply?.endpoints || [];
  let aiAgents = 0;
  if (Array.isArray(endpoints)) {
    for (const e of endpoints) {
      const pushed = maybePushAiEndpoint(observations, {
        provider: "cortex",
        conn,
        id: e.endpoint_id || e.agent_id || e.host_name,
        name: e.host_name || e.endpoint_name || e.endpoint_id,
        hostname: e.host_name,
        os: [e.os_type, e.os_version].filter(Boolean).join(" "),
        owner: e.users?.[0] || null,
        ip: e.ip || e.ipv6?.[0] || null,
        status: e.endpoint_status || "unknown",
        signalParts: [e.host_name, e.endpoint_name, e.group_name, ...(e.users || [])],
        extra: { cortexEndpointId: e.endpoint_id, groupName: e.group_name }
      });
      if (pushed) aiAgents += 1;
    }
  }
  return {
    observations,
    stats: {
      devices: Array.isArray(endpoints) ? endpoints.length : 0,
      aiAgents,
      aiOnly: DISCOVERY_AI_ONLY,
      message: result.message
    }
  };
}

export async function validateNetskope({ config, secrets }) {
  const tenant = assertDnsLabel(
    String(config.tenant || "")
      .replace(/^https?:\/\//, "")
      .replace(/\.goskope\.com.*$/, "")
      .replace(/\/$/, ""),
    "tenant"
  );
  const token = secrets.apiToken;
  if (!token) throw new Error("Netskope requires tenant (e.g. acme) and apiToken");

  const base = `https://${tenant}.goskope.com`;
  assertAllowedUrl(base, ALLOW.netskope);
  let v2;
  try {
    v2 = await safeFetch(
      `${base}/api/v2/services/npa/publishers`,
      {
        headers: { "Netskope-Api-Token": token, Accept: "application/json" }
      },
      ALLOW.netskope
    );
  } catch (err) {
    throw new Error(
      `Netskope unreachable at ${tenant}.goskope.com (${err.message}). Check tenant name and network egress.`
    );
  }
  if (v2.ok) {
    return {
      ok: true,
      message: `Netskope authenticated to ${tenant}.goskope.com (API v2).`,
      base,
      token,
      mode: "v2"
    };
  }

  let v1;
  let v1Json = {};
  try {
    // Prefer header auth; keep v1 path without token-in-query when possible.
    v1 = await safeFetch(
      `${base}/api/v1/clients?limit=1`,
      {
        headers: { Accept: "application/json", "Netskope-Api-Token": token }
      },
      ALLOW.netskope
    );
    if (!v1.ok) {
      v1 = await safeFetch(
        `${base}/api/v1/clients?token=${encodeURIComponent(token)}&limit=1`,
        {
          headers: { Accept: "application/json" }
        },
        ALLOW.netskope
      );
    }
    v1Json = await v1.json().catch(() => ({}));
  } catch (err) {
    throw new Error(
      `Netskope API v2 returned ${v2.status}; v1 unreachable (${err.message}). Check tenant and API token.`
    );
  }
  if (!v1.ok) {
    const msg =
      v1Json.errors?.[0] ||
      v1Json.message ||
      `Netskope API failed (v2=${v2.status}, v1=${v1.status}). Check tenant name and API token.`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return {
    ok: true,
    message: `Netskope authenticated to ${tenant}.goskope.com (API v1 clients).`,
    base,
    token,
    mode: "v1"
  };
}

export async function discoverNetskope(conn) {
  const result = await validateNetskope({ config: conn.config, secrets: conn.secrets });
  const observations = [
    {
      collector_id: "edr",
      fingerprint: `edr-connector:netskope:${conn.id}`,
      name: `Netskope — ${conn.name}`,
      category: "endpoint",
      provider: "netskope",
      deployment_type: "endpoint",
      running_status: "running",
      confidence_score: 0.9,
      framework: "Netskope",
      metadata: {
        connectorId: conn.id,
        connectorName: conn.name,
        discoveryMode: "edr-api-validated",
        inventoryClass: "edr_connector",
        testMessage: result.message,
        environment: conn.environment
      },
      relationships: [
        {
          rel_type: "OBSERVED_BY",
          to_type: "EDRPlatform",
          to_key: "edr-netskope",
          to_name: "Netskope"
        }
      ]
    }
  ];

  const clientsRes = await safeFetch(
    `${result.base}/api/v1/clients?token=${encodeURIComponent(result.token)}&limit=${EDR_DEVICE_LIMIT}`,
    { headers: { Accept: "application/json" } }
  , ALLOW.netskope).catch(() => null);

  if (clientsRes?.ok) {
    const json = await clientsRes.json().catch(() => ({}));
    const data = json.data || json;
    const clients = Array.isArray(data) ? data : Array.isArray(data?.clients) ? data.clients : [];
    let aiAgents = 0;
    for (const c of clients.slice(0, EDR_DEVICE_LIMIT)) {
      const id = c.client_id || c.device_id || c.host_info?.hostname || c._id || JSON.stringify(c).slice(0, 40);
      const pushed = maybePushAiEndpoint(observations, {
        provider: "netskope",
        conn,
        id: String(id),
        name: c.host_info?.hostname || c.hostname || c.device_name || String(id),
        hostname: c.host_info?.hostname || c.hostname,
        os: c.host_info?.os || c.os || null,
        owner: c.username || c.userkey || null,
        ip: c.last_event?.ip_address || c.ip_address || null,
        status: c.client_status || c.status || "unknown",
        signalParts: [
          c.host_info?.hostname,
          c.hostname,
          c.device_name,
          c.username,
          c.host_info?.os
        ],
        extra: { netskopeClientId: id }
      });
      if (pushed) aiAgents += 1;
    }
    return {
      observations,
      stats: {
        devices: clients.length,
        aiAgents,
        aiOnly: DISCOVERY_AI_ONLY,
        message: result.message
      }
    };
  }

  return { observations, stats: { devices: 0, aiAgents: 0, aiOnly: DISCOVERY_AI_ONLY, message: result.message } };
}

export const EDR_VALIDATORS = {
  crowdstrike: validateCrowdstrike,
  defender: validateDefender,
  intune: validateIntune,
  cortex: validateCortex,
  netskope: validateNetskope
};

export const EDR_DISCOVERERS = {
  crowdstrike: discoverCrowdstrike,
  defender: discoverDefender,
  intune: discoverIntune,
  cortex: discoverCortex,
  netskope: discoverNetskope
};

export const EDR_PROVIDERS = Object.keys(EDR_VALIDATORS);

export async function discoverEdrConnector(conn) {
  const discoverer = EDR_DISCOVERERS[conn.provider];
  if (!discoverer) {
    throw new Error(`No EDR discoverer for provider ${conn.provider}`);
  }
  return discoverer(conn);
}
