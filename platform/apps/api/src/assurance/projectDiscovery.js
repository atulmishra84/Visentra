/**
 * Turn facts discovery actually stored into assurance capability and runtime
 * rows. Planes that were not read stay uncovered so evaluation remains Unknown.
 */

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function text(value, max = 240) {
  const raw = String(value || "").trim();
  return raw ? raw.slice(0, max) : null;
}

function metaOf(record) {
  const metadata = record?.metadata;
  return metadata && typeof metadata === "object" ? metadata : {};
}

function payloadOf(observation) {
  if (observation?.payload && typeof observation.payload === "object") return observation.payload;
  return observation || {};
}

export function toolCapability(tool) {
  if (tool == null) return null;
  if (typeof tool === "string") {
    const name = text(tool, 160);
    return name ? { kind: "tool", operation: "tool", resource: name, allowed: true, dataClass: null } : null;
  }
  if (typeof tool !== "object") return null;
  const type = text(tool.type, 40) || "tool";
  const name = text(tool.name || tool.id || type, 160);
  const path = text(
    tool.path || tool.openapi?.path || tool.server?.url || tool.function?.name || null,
    240
  );
  if (/openapi|http|api|connector/i.test(type) && path) {
    return { kind: "api", operation: text(tool.method, 40) || "CALL", resource: path, allowed: true, dataClass: null };
  }
  if (!name) return null;
  return { kind: "tool", operation: type, resource: name, allowed: true, dataClass: null };
}

export function permissionCapability(permission) {
  if (permission == null) return null;
  if (typeof permission === "string") {
    const resource = text(permission, 240);
    if (!resource) return null;
    const database = /sql|database|cosmos|postgres/i.test(resource);
    const write = /(write|update|insert|delete|contributor)/i.test(resource);
    const phi = /\bphi\b|health\.read|patient/i.test(resource);
    return {
      kind: database ? "database" : "role",
      operation: write ? (/\bdelete\b/i.test(resource) ? "DELETE" : "UPDATE") : "READ",
      resource,
      allowed: true,
      dataClass: phi ? "phi" : null,
      destructive: /\bdelete\b|drop|purge/i.test(resource)
    };
  }
  if (typeof permission !== "object") return null;
  const resource = text(permission.resource || permission.scope || permission.role || permission.name, 240);
  if (!resource) return null;
  return {
    kind: text(permission.kind, 40) || "role",
    operation: text(permission.operation || permission.action, 40) || "READ",
    resource,
    allowed: permission.allowed !== false,
    dataClass: text(permission.dataClass, 32),
    destructive: permission.destructive === true
  };
}

function pushChain(chain, step, name) {
  const label = text(name, 160);
  if (!label) return;
  if (chain.some((item) => item.step === step && item.name === label)) return;
  chain.push({ step, name: label });
}

function runtimeFromObservation(observation) {
  const payload = payloadOf(observation);
  const metadata = metaOf(payload);
  const collector = payload.collector_id || observation.collector_id || "";
  const occurredAt = observation.observed_at || metadata.runtime?.occurredAt || payload.last_seen || null;
  if (collector === "otel_tracing" || metadata.discoveryMode === "otel-runtime-traces") {
    const runtime = metadata.runtime || {};
    const path = text(runtime.httpTarget || runtime.path, 240);
    return {
      source: "discovery:otel",
      occurredAt,
      action: text(runtime.httpMethod, 40) || text(runtime.operation || metadata.spanName, 40) || "span",
      operation: text(runtime.operation || metadata.spanName, 40) || "span",
      resource: path || text(runtime.toolName || payload.model, 240) || text(payload.name, 160),
      kind: path ? "api" : "trace",
      dataClass: "none",
      decision: "allowed",
      identity: text(payload.name, 160)
    };
  }
  if (collector === "network_proxy" || metadata.discoveryMode === "network-proxy-egress") {
    const runtime = metadata.runtime || {};
    const host = text(runtime.destHost || metadata.targetDomain, 240);
    if (!host) return null;
    return {
      source: "discovery:proxy",
      occurredAt,
      action: text(runtime.method, 40) || "CONNECT",
      operation: text(runtime.method, 40) || "CONNECT",
      resource: host,
      kind: "trace",
      dataClass: "none",
      decision: "allowed",
      identity: text(runtime.clientIp || metadata.clientIp, 80)
    };
  }
  return null;
}

export function projectAssuranceFacts(agent, observations = []) {
  const metadata = metaOf(agent);
  const link = metadata.foundryLink && typeof metadata.foundryLink === "object" ? metadata.foundryLink : {};
  const chain = [];
  pushChain(chain, "identity", agent.identity_used);
  pushChain(chain, "entra_object", metadata.objectId);
  pushChain(chain, "foundry_account", link.accountName);
  pushChain(chain, "foundry_project", link.projectName);
  pushChain(chain, "foundry_agent", link.inferredAgentName || metadata.agentName);
  const observedModel =
    metadata.modelSource === "host_inference" ? null : (agent.model || metadata.foundationModel);
  pushChain(chain, "model", observedModel);

  const capabilities = [];
  for (const tool of asArray(agent.tools)) {
    const mapped = toolCapability(tool);
    if (mapped) capabilities.push(mapped);
  }
  for (const permission of asArray(agent.permissions)) {
    const mapped = permissionCapability(permission);
    if (mapped) capabilities.push(mapped);
  }

  const events = [];
  for (const observation of observations) {
    const payload = payloadOf(observation);
    const observationMeta = metaOf(payload);
    for (const tool of asArray(payload.tools).concat(asArray(observationMeta.foundryTools))) {
      const mapped = toolCapability(tool);
      if (mapped && !capabilities.some((item) => item.kind === mapped.kind && item.resource === mapped.resource && item.operation === mapped.operation)) {
        capabilities.push(mapped);
      }
    }
    if (observationMeta.foundryDefinitionRead === true) {
      pushChain(chain, "foundry_definition", "read");
    }
    if (payload.collector_id === "api_gateway" || observationMeta.discoveryMode === "api-gateway-routes") {
      const route = text(observationMeta.routePath, 240);
      const host = text(observationMeta.targetHost, 240);
      const resource = route || host;
      if (resource) {
        capabilities.push({
          kind: "api",
          operation: "ROUTE",
          resource,
          allowed: true,
          dataClass: null
        });
      }
    }
    const runtime = runtimeFromObservation(observation);
    if (runtime?.resource) events.push(runtime);
  }

  const coverage = {
    authorization: capabilities.some((item) => item.kind === "role" || item.kind === "scope"),
    database: capabilities.some((item) => item.kind === "database"),
    api: capabilities.some((item) => item.kind === "api"),
    runtime: events.length > 0
  };

  const hasFacts = chain.length > 0 || capabilities.length > 0 || events.length > 0;
  return {
    hasFacts,
    snapshot: {
      source: "discovery",
      chain,
      capabilities,
      coverage
    },
    events
  };
}
