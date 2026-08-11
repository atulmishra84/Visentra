import crypto from "crypto";
import { safeFetch, assertAllowedUrl, assertDnsLabel, ALLOW } from "../utils/http.js";
import {
  DISCOVERY_AI_ONLY,
  isAiRelevantText,
  isAiAgentProcess,
  shouldIngestAiOnly,
  AI_PROCESS_QUERY_TERMS
} from "./aiRelevance.js";
import {
  emptyAgentBlock,
  emptyRuntimeBlock,
  buildAgentAndRuntime,
  normalizeRuntimeStatus,
  sanitizeCloudError,
  emptyDiscoveryStats,
  tallyDiscoveryObservation
} from "./cloudDiscoveryCommon.js";

const EDR_DEVICE_LIMIT = Number(process.env.EDR_DISCOVERY_MAX_DEVICES || 100);
const EDR_DISCOVERY_AGENT_SCAN =
  String(process.env.EDR_DISCOVERY_AGENT_SCAN || "true").toLowerCase() !== "false";
const EDR_DISCOVERY_PROCESS_SCAN =
  String(process.env.EDR_DISCOVERY_PROCESS_SCAN || "true").toLowerCase() !== "false";

const PROVIDER_LABELS = {
  crowdstrike: "CrowdStrike",
  defender: "Microsoft Defender",
  intune: "Microsoft Intune",
  cortex: "Cortex XDR",
  netskope: "Netskope"
};

const PROCESS_DETECTION_METHODS = {
  crowdstrike: "crowdstrike_process",
  defender: "defender_hunting",
  cortex: "cortex_xql",
  intune: "intune_detected_apps",
  netskope: "netskope_client_apps"
};

function deviceLooksAiAgent(parts) {
  return isAiRelevantText(...parts) || isAiAgentProcess(parts.filter(Boolean).join(" "));
}

function clipEvidence(value, max = 300) {
  return String(value || "").slice(0, max);
}

/** Map EDR device connectivity/health to host runtime — not agent runtime. */
export function mapEdrHostRuntimeStatus(raw) {
  const v = String(raw || "").toLowerCase();
  if (!v || v === "unknown") return "unknown";
  if (
    /^(connected|online|normal|healthy|active|running|compliant|contained|containedPending)$/i.test(v) ||
    /connected|online|normal|healthy|compliant/.test(v)
  ) {
    return "running";
  }
  if (/^(offline|disconnected|inactive|disabled|stopped|noncompliant)$/i.test(v) || /offline|disconnect/.test(v)) {
    return "stopped";
  }
  if (/fail|error|unhealthy|sensor.?out/.test(v)) return "failed";
  const normalized = normalizeRuntimeStatus(raw);
  return normalized === "unknown" && /connected|online|normal/.test(v) ? "running" : normalized;
}

function processEvidenceHash(evidence) {
  return crypto.createHash("sha256").update(String(evidence || "")).digest("hex").slice(0, 12);
}

function inferEvidenceGrade({ processEvidence, processSource, evidenceGrade }) {
  if (evidenceGrade) return evidenceGrade;
  if (!processEvidence) return "name_heuristic";
  const src = String(processSource || "");
  if (/detectedApps|client-apps|client_apps/i.test(src)) return "app_heuristic";
  if (/advanced-hunting|xql|process-query|processes/i.test(src)) return "process";
  return "process";
}

/**
 * Layered endpoint observation:
 * host runtime ≠ agent runtime; hostname heuristics never confirm an agent.
 */
export function endpointObservation({
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
  processEvidence = null,
  evidenceGrade = null
}) {
  const label = PROVIDER_LABELS[provider] || provider;
  const display = name || hostname || `${label} device ${id}`;
  const grade = inferEvidenceGrade({
    processEvidence,
    processSource: extra.processSource,
    evidenceGrade
  });
  const hostRuntimeStatus = mapEdrHostRuntimeStatus(status);
  const hostRuntimeDetected = Boolean(status && String(status).toLowerCase() !== "unknown");

  let agentDetected = false;
  let detectionMethod = null;
  let agentStatus = null;
  let agentRuntimeStatus = null;
  let inventoryClass = "endpoint_device";
  let evidenceClass = null;
  let confidence = 0.78;
  let displayName = display;
  let fingerprint = `edr:${provider}:device:${id}`;
  let discoveryLayer = "endpoint_resource";
  const evidence = [];

  if (!EDR_DISCOVERY_AGENT_SCAN || !aiRelevant) {
    evidence.push("Endpoint device inventory only");
  } else if (grade === "process" && processEvidence) {
    agentDetected = true;
    detectionMethod = PROCESS_DETECTION_METHODS[provider] || "edr_process_api";
    agentStatus = "confirmed";
    agentRuntimeStatus = "running";
    inventoryClass = "endpoint_ai_agent";
    evidenceClass = "process_agent";
    confidence = 0.9;
    displayName = `${display} (AI agent)`;
    fingerprint = `edr-agent:${provider}:${id}:${processEvidenceHash(processEvidence)}`;
    discoveryLayer = "agent";
    evidence.push("Live AI agent process/cmdline returned by EDR process API");
    evidence.push("Device online status is host runtime, separate from agent process");
  } else if (grade === "app_heuristic" && processEvidence) {
    agentDetected = true;
    detectionMethod = "app_heuristic";
    agentStatus = "candidate";
    agentRuntimeStatus = "unknown";
    inventoryClass = "endpoint_ai_agent";
    evidenceClass = "repo_candidate";
    confidence = 0.68;
    displayName = `${display} (AI candidate host)`;
    fingerprint = `edr:${provider}:ai-candidate:${id}`;
    discoveryLayer = "agent_candidate";
    evidence.push("Installed/app name signal only — not confirmed running process");
    evidence.push("App inventory ≠ agent runtime confirmation");
  } else if (aiRelevant) {
    agentDetected = true;
    detectionMethod = "name_heuristic";
    agentStatus = "candidate";
    agentRuntimeStatus = "unknown";
    inventoryClass = "endpoint_ai_agent";
    evidenceClass = "repo_candidate";
    confidence = 0.62;
    displayName = `${display} (AI candidate host)`;
    fingerprint = `edr:${provider}:ai-candidate:${id}`;
    discoveryLayer = "agent_candidate";
    evidence.push("Hostname/owner/device metadata matched AI heuristics");
    evidence.push("Heuristic detection is never marked confirmed");
  }

  if (hostRuntimeDetected) {
    evidence.push(`Host connectivity/health=${status} → runtime.status=${hostRuntimeStatus}`);
  }

  const agentRuntime = buildAgentAndRuntime({
    agentDetected,
    detectionMethod,
    agentId: agentDetected ? id : null,
    agentName: agentDetected ? display : null,
    agentType: agentDetected ? "endpoint_ai_agent" : null,
    agentStatus,
    agentRuntimeStatus,
    deploymentStatus: status || null,
    source: agentDetected ? `edr_${provider}` : null,
    runtimeDetected: hostRuntimeDetected,
    runtimeStatus: hostRuntimeDetected ? hostRuntimeStatus : null,
    runtimeType: "endpoint_host",
    runtimeId: id,
    runtimeName: display,
    resourceId: id,
    region: null
  });

  return {
    collector_id: "edr",
    fingerprint,
    name: displayName,
    category: "endpoint",
    provider,
    deployment_type: "endpoint",
    hostname: hostname || null,
    operating_system: os || null,
    owner: owner || null,
    ip: ip || null,
    device: name || hostname || id,
    // Host runtime only — never claim agent running from device CONNECTED alone
    running_status: hostRuntimeDetected ? hostRuntimeStatus : "unknown",
    confidence_score: confidence,
    framework: label,
    model: agentDetected
      ? agentStatus === "confirmed"
        ? "endpoint-ai-agent"
        : "endpoint-ai-candidate"
      : aiRelevant
        ? "ai-relevant-endpoint"
        : null,
    agent: agentRuntime.agent,
    runtime: agentRuntime.runtime,
    metadata: {
      connectorId: conn.id,
      connectorName: conn.name,
      discoveryMode: "edr-layered-discovery",
      discoveryLayer,
      inventoryClass,
      evidenceClass,
      evidence,
      agentStatus,
      agentDetected,
      agentDetectionMethod: detectionMethod,
      runtimeDetected: hostRuntimeDetected,
      runtimeType: "endpoint_host",
      runtimeStatus: hostRuntimeDetected ? hostRuntimeStatus : null,
      runtimeStatusReason: agentDetected
        ? "Host connectivity is not agent process status unless process evidence exists"
        : "Host runtime reflects EDR device connectivity/health",
      aiRelevant,
      edrProvider: provider,
      evidenceGrade: grade,
      environment: conn.environment,
      processEvidence: processEvidence ? clipEvidence(processEvidence) : null,
      ...extra
    },
    relationships: [
      {
        rel_type: "OBSERVED_BY",
        to_type: "EDRPlatform",
        to_key: `edr-${provider}`,
        to_name: label
      },
      {
        rel_type: "HOSTED_BY",
        to_type: "EndpointDevice",
        to_key: `edr-${provider}:${id}`,
        to_name: display
      },
      ...(agentDetected && agentStatus === "confirmed"
        ? [
            {
              rel_type: "RUNS_ON",
              to_type: "EndpointRuntime",
              to_key: `edr-${provider}:${id}`,
              to_name: display
            }
          ]
        : [])
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
  if (!EDR_DISCOVERY_AGENT_SCAN && !args.processEvidence) return false;
  observations.push(
    endpointObservation({
      ...args,
      aiRelevant: true
    })
  );
  return true;
}

function edrConnectorObservation(provider, conn, message) {
  const label = PROVIDER_LABELS[provider] || provider;
  return {
    collector_id: "edr",
    fingerprint: `edr-connector:${provider}:${conn.id}`,
    name: `${label} — ${conn.name}`,
    category: "endpoint",
    provider,
    deployment_type: "endpoint",
    running_status: "running",
    confidence_score: 0.9,
    framework: label,
    agent: emptyAgentBlock(),
    runtime: emptyRuntimeBlock(),
    metadata: {
      connectorId: conn.id,
      connectorName: conn.name,
      discoveryMode: "edr-api-validated",
      discoveryLayer: "connector",
      inventoryClass: "edr_connector",
      testMessage: message,
      environment: conn.environment,
      agentScan: EDR_DISCOVERY_AGENT_SCAN,
      processScan: EDR_DISCOVERY_PROCESS_SCAN
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

function finalizeEdrResult(observations, baseStats = {}, discoveryErrors = []) {
  const stats = {
    ...emptyDiscoveryStats(),
    devices: baseStats.devices || 0,
    aiAgents: baseStats.aiAgents || 0,
    processHits: baseStats.processHits || 0,
    aiOnly: DISCOVERY_AI_ONLY,
    message: baseStats.message || null
  };
  for (const obs of observations) tallyDiscoveryObservation(stats, obs);
  // Map cloud tally field name for EDR consumers
  stats.endpointsIngested = stats.cloudResourcesIngested;
  stats.discoveryErrors = discoveryErrors.length;
  if (observations[0]?.metadata?.inventoryClass === "edr_connector") {
    Object.assign(observations[0].metadata, {
      agentsDiscovered: stats.agentsDiscovered,
      confirmedAgents: stats.confirmedAgents,
      heuristicAgents: stats.heuristicAgents,
      runtimesDiscovered: stats.runtimesDiscovered,
      discoveryErrors: stats.discoveryErrors,
      discoveryErrorSamples: discoveryErrors.slice(0, 15)
    });
  }
  return { observations, stats, discoveryErrors };
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
  const discoveryErrors = [];
  const observations = [edrConnectorObservation("crowdstrike", conn, result.message)];

  if (!result.accessToken) {
    return finalizeEdrResult(observations, { devices: 0, message: result.message }, discoveryErrors);
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
    discoveryErrors.push({
      discoveryType: "crowdstrike-devices",
      discoveryStatus: idsRes.status === 403 ? "permission_denied" : "error",
      error: sanitizeCloudError(`CrowdStrike device query failed (${idsRes.status})`)
    });
    return finalizeEdrResult(observations, { devices: 0, message: result.message }, discoveryErrors);
  }
  const idsJson = await idsRes.json().catch(() => ({}));
  const ids = Array.isArray(idsJson.resources) ? idsJson.resources.slice(0, EDR_DEVICE_LIMIT) : [];
  if (!ids.length) return finalizeEdrResult(observations, { devices: 0, message: result.message }, discoveryErrors);

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

  const processHosts = new Map();
  if (EDR_DISCOVERY_PROCESS_SCAN) {
    try {
      const filter = AI_PROCESS_QUERY_TERMS.map((t) => `cmdline:*${t}*`).join("+");
      const procRes = await safeFetch(
        `${base}/processes/queries/processes/v1?limit=50&filter=${encodeURIComponent(filter)}`,
        {
          headers: { Authorization: `Bearer ${result.accessToken}`, Accept: "application/json" }
        },
        ALLOW.crowdstrike
      );
      if (procRes.status === 401 || procRes.status === 403) {
        discoveryErrors.push({
          discoveryType: "crowdstrike-processes",
          discoveryStatus: "permission_denied",
          error: `Process query forbidden (${procRes.status})`
        });
      } else if (procRes.ok) {
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
    } catch (err) {
      discoveryErrors.push({
        discoveryType: "crowdstrike-processes",
        discoveryStatus: "error",
        error: sanitizeCloudError(err)
      });
    }
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
      evidenceGrade: processEvidence ? "process" : null,
      signalParts: [d.hostname, d.product_type_desc, d.machine_domain, processEvidence],
      extra: {
        crowdstrikeDeviceId: d.device_id,
        productType: d.product_type_desc,
        processSource: processEvidence ? "process-query" : null
      }
    });
    if (pushed) aiAgents += 1;
  }
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
      evidenceGrade: "process",
      signalParts: [evidence],
      extra: { crowdstrikeDeviceId: deviceId, source: "process-query", processSource: "process-query" }
    });
    if (pushed) aiAgents += 1;
  }
  return finalizeEdrResult(
    observations,
    {
      devices: devices.length,
      aiAgents,
      processHits: processHosts.size,
      message: result.message
    },
    discoveryErrors
  );
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
  const discoveryErrors = [];
  const observations = [edrConnectorObservation("defender", conn, result.message)];
  if (!result.accessToken) {
    return finalizeEdrResult(observations, { devices: 0, message: result.message }, discoveryErrors);
  }

  const res = await safeFetch(
    `https://api.securitycenter.microsoft.com/api/machines?$top=${EDR_DEVICE_LIMIT}`,
    { headers: { Authorization: `Bearer ${result.accessToken}` } },
    ALLOW.defender
  );
  if (!res.ok) {
    discoveryErrors.push({
      discoveryType: "defender-machines",
      discoveryStatus: res.status === 403 ? "permission_denied" : "error",
      error: sanitizeCloudError(`Defender machines query failed (${res.status})`)
    });
    return finalizeEdrResult(observations, { devices: 0, message: result.message }, discoveryErrors);
  }
  const json = await res.json().catch(() => ({}));
  const machines = Array.isArray(json.value) ? json.value : [];

  const processHosts = new Map();
  if (EDR_DISCOVERY_PROCESS_SCAN) {
    try {
      const terms = AI_PROCESS_QUERY_TERMS.map(
        (t) => `FileName has "${t}" or ProcessCommandLine has "${t}"`
      ).join(" or ");
      const query =
        `DeviceProcessEvents` +
        `| where ${terms}` +
        `| summarize evidence=any(ProcessCommandLine), file=any(FileName) by DeviceId, DeviceName` +
        `| take 80`;
      const hunt = await safeFetch(
        "https://api.securitycenter.microsoft.com/api/advancedhunting/run",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${result.accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({ Query: query })
        },
        ALLOW.defender
      );
      if (hunt.status === 401 || hunt.status === 403) {
        discoveryErrors.push({
          discoveryType: "defender-advanced-hunting",
          discoveryStatus: "permission_denied",
          error: `Advanced hunting forbidden (${hunt.status})`
        });
      } else if (hunt.ok) {
        const huntJson = await hunt.json().catch(() => ({}));
        for (const row of huntJson.Results || huntJson.results || []) {
          const evidence = clipEvidence(row.evidence || row.ProcessCommandLine || row.file || row.FileName);
          const deviceId = row.DeviceId || row.deviceId;
          if (!deviceId || !evidence) continue;
          if (!isAiAgentProcess(evidence) && !isAiRelevantText(evidence)) continue;
          processHosts.set(String(deviceId), evidence);
        }
      }
    } catch (err) {
      discoveryErrors.push({
        discoveryType: "defender-advanced-hunting",
        discoveryStatus: "error",
        error: sanitizeCloudError(err)
      });
    }
  }

  let aiAgents = 0;
  for (const m of machines) {
    const processEvidence = processHosts.get(String(m.id)) || null;
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
      processEvidence,
      evidenceGrade: processEvidence ? "process" : null,
      signalParts: [m.computerDnsName, m.osPlatform, m.riskScore, processEvidence],
      extra: {
        defenderMachineId: m.id,
        riskScore: m.riskScore,
        processSource: processEvidence ? "advanced-hunting" : null
      }
    });
    if (pushed) aiAgents += 1;
  }
  for (const [deviceId, evidence] of processHosts) {
    if (machines.some((m) => String(m.id) === String(deviceId))) continue;
    const pushed = maybePushAiEndpoint(observations, {
      provider: "defender",
      conn,
      id: deviceId,
      name: `AI process host ${deviceId}`,
      hostname: null,
      os: null,
      owner: null,
      ip: null,
      status: "running",
      processEvidence: evidence,
      evidenceGrade: "process",
      signalParts: [evidence],
      extra: {
        defenderMachineId: deviceId,
        source: "advanced-hunting",
        processSource: "advanced-hunting"
      }
    });
    if (pushed) aiAgents += 1;
  }
  return finalizeEdrResult(
    observations,
    {
      devices: machines.length,
      aiAgents,
      processHits: processHosts.size,
      message: result.message
    },
    discoveryErrors
  );
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
  const discoveryErrors = [];
  const observations = [edrConnectorObservation("intune", conn, result.message)];
  if (!result.accessToken) {
    return finalizeEdrResult(observations, { devices: 0, message: result.message }, discoveryErrors);
  }

  const res = await safeFetch(
    `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$top=${EDR_DEVICE_LIMIT}`,
    { headers: { Authorization: `Bearer ${result.accessToken}` } },
    ALLOW.graphMicrosoft
  );
  if (!res.ok) {
    discoveryErrors.push({
      discoveryType: "intune-devices",
      discoveryStatus: res.status === 403 ? "permission_denied" : "error",
      error: sanitizeCloudError(`Intune managedDevices query failed (${res.status})`)
    });
    return finalizeEdrResult(observations, { devices: 0, message: result.message }, discoveryErrors);
  }
  const json = await res.json().catch(() => ({}));
  const devices = Array.isArray(json.value) ? json.value : [];

  // App inventory only — candidate evidence, never process-confirmed.
  const appHosts = new Map();
  if (EDR_DISCOVERY_PROCESS_SCAN) {
    try {
      for (const term of AI_PROCESS_QUERY_TERMS.slice(0, 12)) {
        const appsRes = await safeFetch(
          `https://graph.microsoft.com/v1.0/deviceManagement/detectedApps?$filter=contains(displayName,'${term}')&$top=25&$expand=managedDevices($select=id,deviceName)`,
          { headers: { Authorization: `Bearer ${result.accessToken}`, Accept: "application/json" } },
          ALLOW.graphMicrosoft
        ).catch(() => null);
        if (!appsRes) continue;
        if (appsRes.status === 401 || appsRes.status === 403) {
          discoveryErrors.push({
            discoveryType: "intune-detectedApps",
            discoveryStatus: "permission_denied",
            error: `detectedApps forbidden (${appsRes.status})`
          });
          break;
        }
        if (!appsRes.ok) continue;
        const appsJson = await appsRes.json().catch(() => ({}));
        for (const app of appsJson.value || []) {
          const evidence = clipEvidence(`${app.displayName || term} ${app.version || ""}`.trim());
          for (const device of app.managedDevices || []) {
            const id = device.id;
            if (!id) continue;
            appHosts.set(String(id), evidence);
          }
        }
      }
    } catch (err) {
      discoveryErrors.push({
        discoveryType: "intune-detectedApps",
        discoveryStatus: "error",
        error: sanitizeCloudError(err)
      });
    }
  }

  let aiAgents = 0;
  for (const d of devices) {
    const processEvidence = appHosts.get(String(d.id)) || null;
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
      processEvidence,
      evidenceGrade: processEvidence ? "app_heuristic" : null,
      signalParts: [d.deviceName, d.model, d.manufacturer, d.userPrincipalName, processEvidence],
      extra: {
        intuneDeviceId: d.id,
        model: d.model,
        manufacturer: d.manufacturer,
        processSource: processEvidence ? "detectedApps" : null
      }
    });
    if (pushed) aiAgents += 1;
  }
  for (const [deviceId, evidence] of appHosts) {
    if (devices.some((d) => String(d.id) === String(deviceId))) continue;
    const pushed = maybePushAiEndpoint(observations, {
      provider: "intune",
      conn,
      id: deviceId,
      name: `AI app host ${deviceId}`,
      hostname: null,
      os: null,
      owner: null,
      ip: null,
      status: "unknown",
      processEvidence: evidence,
      evidenceGrade: "app_heuristic",
      signalParts: [evidence],
      extra: { intuneDeviceId: deviceId, source: "detectedApps", processSource: "detectedApps" }
    });
    if (pushed) aiAgents += 1;
  }
  return finalizeEdrResult(
    observations,
    {
      devices: devices.length,
      aiAgents,
      processHits: appHosts.size,
      message: result.message
    },
    discoveryErrors
  );
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
  const discoveryErrors = [];
  const observations = [edrConnectorObservation("cortex", conn, result.message)];

  const res = await safeFetch(
    `${result.baseUrl}/endpoints/get_endpoints/`,
    {
      method: "POST",
      headers: cortexAuthHeaders(result.apiKey, result.apiKeyId),
      body: JSON.stringify({
        request_data: {
          search_from: 0,
          search_to: EDR_DEVICE_LIMIT
        }
      })
    },
    ALLOW.cortex
  );
  if (!res.ok) {
    discoveryErrors.push({
      discoveryType: "cortex-endpoints",
      discoveryStatus: res.status === 403 ? "permission_denied" : "error",
      error: sanitizeCloudError(`Cortex get_endpoints failed (${res.status})`)
    });
    return finalizeEdrResult(observations, { devices: 0, message: result.message }, discoveryErrors);
  }
  const json = await res.json().catch(() => ({}));
  const endpoints = json.reply?.endpoints || [];

  const processHosts = new Map();
  if (EDR_DISCOVERY_PROCESS_SCAN) {
    try {
      const terms = AI_PROCESS_QUERY_TERMS.slice(0, 10)
        .map(
          (t) =>
            `action_process_image_name contains "${t}" or action_process_image_command_line contains "${t}"`
        )
        .join(" or ");
      const xql =
        `dataset = xdr_data | filter event_type = ENUM.PROCESS and (${terms})` +
        ` | fields agent_id, agent_hostname, action_process_image_name, action_process_image_command_line` +
        ` | limit 80`;
      const start = await safeFetch(
        `${result.baseUrl}/xql/start_xql_query/`,
        {
          method: "POST",
          headers: cortexAuthHeaders(result.apiKey, result.apiKeyId),
          body: JSON.stringify({ request_data: { query: xql, tenants: [] } })
        },
        ALLOW.cortex
      ).catch(() => null);
      if (start && (start.status === 401 || start.status === 403)) {
        discoveryErrors.push({
          discoveryType: "cortex-xql",
          discoveryStatus: "permission_denied",
          error: `XQL start forbidden (${start.status})`
        });
      } else {
        const startJson = start?.ok ? await start.json().catch(() => ({})) : {};
        const queryId = startJson.reply || startJson.reply?.query_id || startJson.query_id;
        if (queryId) {
          for (let attempt = 0; attempt < 4; attempt += 1) {
            await new Promise((r) => setTimeout(r, 700));
            const get = await safeFetch(
              `${result.baseUrl}/xql/get_query_results/`,
              {
                method: "POST",
                headers: cortexAuthHeaders(result.apiKey, result.apiKeyId),
                body: JSON.stringify({
                  request_data: { query_id: queryId, pending_flag: true, limit: 80, format: "json" }
                })
              },
              ALLOW.cortex
            ).catch(() => null);
            if (!get?.ok) continue;
            const getJson = await get.json().catch(() => ({}));
            const status = String(getJson.reply?.status || getJson.status || "");
            const rows = getJson.reply?.results?.data || getJson.reply?.data || getJson.results || [];
            if (Array.isArray(rows) && rows.length) {
              for (const row of rows) {
                const id = row.agent_id || row.endpoint_id;
                const evidence = clipEvidence(
                  row.action_process_image_command_line || row.action_process_image_name || row.cmdline
                );
                if (!id || !evidence) continue;
                if (!isAiAgentProcess(evidence) && !isAiRelevantText(evidence)) continue;
                processHosts.set(String(id), evidence);
              }
              break;
            }
            if (/SUCCESS|COMPLETED|DONE/i.test(status) && !rows?.length) break;
          }
        }
      }
    } catch (err) {
      discoveryErrors.push({
        discoveryType: "cortex-xql",
        discoveryStatus: "error",
        error: sanitizeCloudError(err)
      });
    }
  }

  let aiAgents = 0;
  if (Array.isArray(endpoints)) {
    for (const e of endpoints) {
      const id = e.endpoint_id || e.agent_id || e.host_name;
      const processEvidence =
        processHosts.get(String(e.endpoint_id)) || processHosts.get(String(e.agent_id)) || null;
      const pushed = maybePushAiEndpoint(observations, {
        provider: "cortex",
        conn,
        id,
        name: e.host_name || e.endpoint_name || e.endpoint_id,
        hostname: e.host_name,
        os: [e.os_type, e.os_version].filter(Boolean).join(" "),
        owner: e.users?.[0] || null,
        ip: e.ip || e.ipv6?.[0] || null,
        status: e.endpoint_status || "unknown",
        processEvidence,
        evidenceGrade: processEvidence ? "process" : null,
        signalParts: [e.host_name, e.endpoint_name, e.group_name, ...(e.users || []), processEvidence],
        extra: {
          cortexEndpointId: e.endpoint_id,
          groupName: e.group_name,
          processSource: processEvidence ? "xql" : null
        }
      });
      if (pushed) aiAgents += 1;
    }
  }
  for (const [deviceId, evidence] of processHosts) {
    if (
      Array.isArray(endpoints) &&
      endpoints.some(
        (e) => String(e.endpoint_id) === String(deviceId) || String(e.agent_id) === String(deviceId)
      )
    ) {
      continue;
    }
    const pushed = maybePushAiEndpoint(observations, {
      provider: "cortex",
      conn,
      id: deviceId,
      name: `AI process host ${deviceId}`,
      hostname: null,
      os: null,
      owner: null,
      ip: null,
      status: "running",
      processEvidence: evidence,
      evidenceGrade: "process",
      signalParts: [evidence],
      extra: { cortexEndpointId: deviceId, source: "xql", processSource: "xql" }
    });
    if (pushed) aiAgents += 1;
  }
  return finalizeEdrResult(
    observations,
    {
      devices: Array.isArray(endpoints) ? endpoints.length : 0,
      aiAgents,
      processHits: processHosts.size,
      message: result.message
    },
    discoveryErrors
  );
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
  const discoveryErrors = [];
  const observations = [edrConnectorObservation("netskope", conn, result.message)];

  const clientsRes = await safeFetch(
    `${result.base}/api/v1/clients?token=${encodeURIComponent(result.token)}&limit=${EDR_DEVICE_LIMIT}`,
    { headers: { Accept: "application/json" } },
    ALLOW.netskope
  ).catch((err) => {
    discoveryErrors.push({
      discoveryType: "netskope-clients",
      discoveryStatus: "error",
      error: sanitizeCloudError(err)
    });
    return null;
  });

  if (clientsRes && (clientsRes.status === 401 || clientsRes.status === 403)) {
    discoveryErrors.push({
      discoveryType: "netskope-clients",
      discoveryStatus: "permission_denied",
      error: `Netskope clients forbidden (${clientsRes.status})`
    });
    return finalizeEdrResult(observations, { devices: 0, message: result.message }, discoveryErrors);
  }

  if (clientsRes?.ok) {
    const json = await clientsRes.json().catch(() => ({}));
    const data = json.data || json;
    const clients = Array.isArray(data) ? data : Array.isArray(data?.clients) ? data.clients : [];
    let aiAgents = 0;
    for (const c of clients.slice(0, EDR_DEVICE_LIMIT)) {
      const id =
        c.client_id || c.device_id || c.host_info?.hostname || c._id || JSON.stringify(c).slice(0, 40);
      const appBlob = [
        ...(Array.isArray(c.apps) ? c.apps.map((a) => a.name || a.app_name || a) : []),
        ...(Array.isArray(c.applications) ? c.applications.map((a) => a.name || a.app_name || a) : []),
        c.last_event?.app,
        c.host_info?.device_make,
        c.host_info?.device_model
      ]
        .filter(Boolean)
        .join(" ");
      // Client app names are inventory signals only — never process confirmation.
      const processEvidence =
        isAiAgentProcess(appBlob) || isAiRelevantText(appBlob) ? clipEvidence(appBlob) : null;
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
        processEvidence,
        evidenceGrade: processEvidence ? "app_heuristic" : null,
        signalParts: [
          c.host_info?.hostname,
          c.hostname,
          c.device_name,
          c.username,
          c.host_info?.os,
          processEvidence
        ],
        extra: {
          netskopeClientId: id,
          processSource: processEvidence ? "client-apps" : null
        }
      });
      if (pushed) aiAgents += 1;
    }
    return finalizeEdrResult(
      observations,
      {
        devices: clients.length,
        aiAgents,
        processHits: 0,
        message: result.message
      },
      discoveryErrors
    );
  }

  return finalizeEdrResult(
    observations,
    { devices: 0, aiAgents: 0, message: result.message },
    discoveryErrors
  );
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
