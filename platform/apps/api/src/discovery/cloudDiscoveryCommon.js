/**
 * Shared helpers for multi-cloud AI agent / runtime discovery observations.
 */

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

export function buildAgentAndRuntime({
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

export function normalizeRuntimeStatus(raw) {
  const v = String(raw || "").toLowerCase();
  if (!v || v === "null" || v === "undefined") return "unknown";
  if (/^(running|ready|succeeded|active|online|healthy|started|inservice|activecondition)$/.test(v)) {
    return "running";
  }
  if (/^(stopped|deallocated|disabled|inactive|suspended|offline|outofservice|draining)$/.test(v)) {
    return "stopped";
  }
  if (/^(failed|error|unhealthy|crashloop|terminated)$/.test(v)) return "failed";
  if (/starting|stopping|updating|creating|deleting|pending|provisioning|preparing|versioning/.test(v)) {
    return "unknown";
  }
  return "unknown";
}

export function sanitizeCloudError(error) {
  let message = String(error?.message || error || "unknown error");
  message = message.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [REDACTED]");
  message = message.replace(/client_secret=[^&\s]+/gi, "client_secret=[REDACTED]");
  message = message.replace(/secretAccessKey[=:][^&\s"]+/gi, "secretAccessKey=[REDACTED]");
  message = message.replace(/access_token[=:][^&\s"]+/gi, "access_token=[REDACTED]");
  message = message.replace(/-----BEGIN[^-]+PRIVATE KEY-----[\s\S]*?-----END[^-]+PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]");
  message = message.replace(/eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g, "[REDACTED_JWT]");
  return message.slice(0, 500);
}

export function emptyDiscoveryStats() {
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

export function tallyDiscoveryObservation(stats, obs) {
  if (/^(connector_scan|edr_connector)$/.test(String(obs.metadata?.inventoryClass || ""))) return;
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

export function dedupeObservationsByFingerprint(observations) {
  const byFp = new Map();
  for (const obs of observations) {
    const fp = obs.fingerprint;
    if (!byFp.has(fp)) {
      byFp.set(fp, obs);
      continue;
    }
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

/** Env names only — never values — from Lambda-style env maps. */
export function safeEnvNames(envVars = {}) {
  return Object.keys(envVars || {}).map((name) =>
    /secret|token|key|password|credential|connection/i.test(name) ? `${name}(redacted)` : name
  );
}
