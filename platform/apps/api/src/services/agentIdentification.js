/**
 * Cloud / identity locator fields for Agent Identification.
 * Collectors often put IDs on obs.agent / obs.runtime / metadata.deep.
 * Persist them on agents.metadata so list, detail, and graph UIs can render them.
 */

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text && text !== "null" && text !== "undefined") return text;
  }
  return null;
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const text = firstNonEmpty(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function isAws(obs, meta) {
  return (
    String(obs.cloud_provider || obs.provider || "").toLowerCase() === "aws" ||
    Boolean(meta.awsType || meta.accountId)
  );
}

function isAzure(obs, meta) {
  const provider = String(obs.cloud_provider || obs.provider || "").toLowerCase();
  return (
    provider === "azure" ||
    provider === "entra_agent_id" ||
    Boolean(meta.azureType || meta.subscriptionId || meta.foundrySource || meta.azureResourceId)
  );
}

function isEntra(obs, meta, ownership = {}) {
  return Boolean(
    meta.objectId ||
      meta.appId ||
      ownership.objectId ||
      ownership.appId ||
      meta.identityProvider === "entra" ||
      String(obs.provider || "").includes("entra") ||
      meta.source === "graph-agent365-catalog" ||
      meta.agent365PackageId
  );
}

export function howIdentifiedFromCloud(obs = {}, meta = {}, agent = {}) {
  if (isAws(obs, meta)) {
    const method =
      agent.detectionMethod === "bedrock_agents_api" || meta.managedCloudAgent
        ? "AWS Bedrock ListAgents"
        : firstNonEmpty(agent.detectionMethod, meta.discoveryMode, meta.howIdentified, "AWS API");
    return [
      method,
      meta.accountId ? `account ${meta.accountId}` : null,
      meta.agentId ? `agent ${meta.agentId}` : null,
      obs.region || meta.region || null
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (isEntra(obs, meta) && !meta.azureType && !meta.foundrySource) {
    return firstNonEmpty(
      meta.howIdentified,
      agent.detectionMethod === "entra_agent_identity_api"
        ? "Microsoft Graph Agent ID"
        : null,
      meta.objectKind ? `Entra ${meta.objectKind}` : null,
      "Entra identity"
    );
  }
  if (isAzure(obs, meta)) {
    const method = firstNonEmpty(
      agent.detectionMethod,
      meta.discoveryMode,
      meta.foundrySource,
      "Azure ARM"
    );
    return [
      method,
      meta.subscriptionId ? `subscription ${meta.subscriptionId}` : null,
      meta.resourceGroup ? `rg ${meta.resourceGroup}` : null,
      meta.agentId ? `agent ${meta.agentId}` : null
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return null;
}

/**
 * Copy locator fields onto metadata before Postgres ingest.
 */
export function stampAgentIdentification(obs = {}) {
  const meta = { ...asObject(obs.metadata) };
  const agent = asObject(obs.agent || meta.agent);
  const runtime = asObject(obs.runtime || meta.runtime);
  const deep = asObject(meta.deep);

  const agentId = firstNonEmpty(meta.agentId, deep.agentId, deep.agent_id, agent.agentId);
  const agentName = firstNonEmpty(meta.agentName, deep.agentName, deep.displayName, agent.agentName);
  const agentArn = firstNonEmpty(
    meta.agentArn,
    deep.agentArn,
    String(obs.endpoint || "").startsWith("arn:") ? obs.endpoint : null
  );
  const azureResourceId = firstNonEmpty(
    meta.azureResourceId,
    String(obs.endpoint || "").startsWith("/subscriptions/") ? obs.endpoint : null,
    runtime.resourceId
  );

  if (agentId) meta.agentId = agentId;
  if (agentName) meta.agentName = agentName;
  if (agentArn) meta.agentArn = agentArn;
  if (azureResourceId) meta.azureResourceId = azureResourceId;
  if (agent.agentType && !meta.agentType) meta.agentType = agent.agentType;
  if (agent.detectionMethod && !meta.agentDetectionMethod) meta.agentDetectionMethod = agent.detectionMethod;
  if (agent.source && !meta.agentSource) meta.agentSource = agent.source;
  if (runtime.resourceId && !meta.runtimeResourceId) meta.runtimeResourceId = runtime.resourceId;
  if (runtime.runtimeType && !meta.runtimeType) meta.runtimeType = runtime.runtimeType;
  if (obs.agent && !meta.agent) meta.agent = obs.agent;
  if (obs.runtime && !meta.runtime) meta.runtime = obs.runtime;

  const aliases = uniqueStrings([
    ...(Array.isArray(meta.aliases) ? meta.aliases : []),
    ...(Array.isArray(deep.aliases) ? deep.aliases : [])
  ]);
  if (aliases.length) meta.aliases = aliases;

  if (!meta.howIdentified) {
    const identified = howIdentifiedFromCloud(obs, meta, agent);
    if (identified) meta.howIdentified = identified;
  }

  return { ...obs, metadata: meta };
}

export function buildAgentIdentification(obs = {}) {
  const meta = asObject(obs.metadata);
  const stamped = stampAgentIdentification(obs).metadata;
  const merged = { ...meta, ...stamped };
  const ownership = asObject(merged.ownership || obs.ownership);
  const deep = asObject(merged.deep);
  const identity = asObject(deep.identity);

  const provider = firstNonEmpty(
    obs.cloud_provider,
    obs.provider,
    isAws(obs, merged) ? "aws" : null,
    isAzure(obs, merged) ? "azure" : null,
    isEntra(obs, merged, ownership) ? "entra" : null
  );

  return {
    provider,
    howIdentified: firstNonEmpty(merged.howIdentified, obs.howIdentified),
    detectionMethod: firstNonEmpty(merged.agentDetectionMethod, merged.agent?.detectionMethod),
    agentId: firstNonEmpty(merged.agentId, deep.agentId),
    agentName: firstNonEmpty(merged.agentName, deep.agentName, deep.displayName, obs.name),
    agentArn: firstNonEmpty(merged.agentArn, deep.agentArn),
    accountId: firstNonEmpty(merged.accountId, deep.accountId),
    subscriptionId: firstNonEmpty(merged.subscriptionId),
    tenantId: firstNonEmpty(merged.tenantId, ownership.tenantId),
    resourceGroup: firstNonEmpty(merged.resourceGroup),
    azureResourceId: firstNonEmpty(merged.azureResourceId),
    projectName: firstNonEmpty(merged.projectName, deep.projectName),
    region: firstNonEmpty(obs.region, merged.region, deep.region),
    aliases: Array.isArray(merged.aliases) ? merged.aliases : [],
    objectId: firstNonEmpty(ownership.objectId, merged.objectId),
    appId: firstNonEmpty(ownership.appId, merged.appId),
    executionRole: firstNonEmpty(identity.arn, deep.agentResourceRoleArn, identity.name),
    identityProvider: firstNonEmpty(ownership.identityProvider, merged.identityProvider)
  };
}
