/**
 * Promote weak candidates when multiple independent scanners agree.
 * Runs on a discovery job's observation batch before ingest.
 */

const STRONG_CLASSES = new Set(["platform_agent", "process_agent", "cloud_ai_runtime"]);
const WEAK_CLASSES = new Set(["repo_candidate"]);

function normalizeToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function observationKeys(obs) {
  const meta = obs.metadata || {};
  const keys = new Set();
  for (const part of [
    obs.hostname,
    obs.device,
    obs.repository,
    obs.name,
    meta.jobName,
    meta.webUrl,
    meta.owner,
    meta.crowdstrikeDeviceId,
    meta.defenderMachineId,
    meta.intuneDeviceId,
    meta.cortexEndpointId,
    meta.netskopeClientId
  ]) {
    const token = normalizeToken(part);
    if (token && token.length >= 4) keys.add(token);
  }
  // Also index significant name fragments (agent-ish tokens)
  for (const token of normalizeToken(obs.name).split(/\s+/)) {
    if (token.length >= 5 && /agent|copilot|assistant|langchain|crewai|bedrock|mcp|cursor|claude|openai|illuminate/.test(token)) {
      keys.add(token);
    }
  }
  return [...keys];
}

function evidenceClassOf(obs) {
  return String(obs?.metadata?.evidenceClass || "");
}

function agentStatusOf(obs) {
  return String(obs?.metadata?.agentStatus || "");
}

/**
 * If a candidate shares identity tokens with a confirmed strong observation,
 * promote it to confirmed and record correlation metadata.
 */
export function promoteCorrelatedCandidates(observations = []) {
  if (!Array.isArray(observations) || observations.length < 2) return observations;

  const strongKeys = new Map(); // key -> supporting fingerprints
  for (const obs of observations) {
    const cls = evidenceClassOf(obs);
    const status = agentStatusOf(obs);
    const strong =
      (STRONG_CLASSES.has(cls) && status === "confirmed") ||
      Boolean(obs?.metadata?.processEvidence) ||
      obs?.metadata?.managedPlatformAgent === true ||
      obs?.metadata?.managedCloudAgent === true;
    if (!strong) continue;
    for (const key of observationKeys(obs)) {
      if (!strongKeys.has(key)) strongKeys.set(key, []);
      strongKeys.get(key).push(obs.fingerprint || obs.name);
    }
  }

  if (!strongKeys.size) return observations;

  return observations.map((obs) => {
    const cls = evidenceClassOf(obs);
    const status = agentStatusOf(obs);
    if (status === "confirmed") return obs;
    if (!WEAK_CLASSES.has(cls) && status !== "candidate") return obs;

    const matches = [];
    for (const key of observationKeys(obs)) {
      const supporters = strongKeys.get(key);
      if (supporters?.length) matches.push({ key, supporters: supporters.slice(0, 3) });
    }
    if (!matches.length) return obs;

    const meta = { ...(obs.metadata || {}) };
    meta.agentStatus = "confirmed";
    meta.correlatedPromotion = true;
    meta.correlationMatches = matches.slice(0, 5);
    meta.evidenceReason = `${cls}:confirmed:correlated`;
    // Keep original weak class but bump confidence via promotion flag for UI/audit.
    meta.promotedFrom = status || "candidate";
    return {
      ...obs,
      confidence_score: Math.max(Number(obs.confidence_score) || 0, 0.84),
      metadata: meta
    };
  });
}
