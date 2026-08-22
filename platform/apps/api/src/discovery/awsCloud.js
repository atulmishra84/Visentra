import crypto from "crypto";
import { safeFetch, assertDnsLabel, ALLOW } from "../utils/http.js";
import { isAiRelevantText } from "./aiRelevance.js";

const AWS_MAX_RESOURCES = Number(process.env.AWS_DISCOVERY_MAX_RESOURCES || 150);

function requireAwsConfig({ config = {}, secrets = {} }) {
  const region = assertDnsLabel(config.region || "us-east-1", "region");
  const accessKeyId = String(config.accessKeyId || "").trim();
  const secretAccessKey = String(secrets.secretAccessKey || "").trim();
  const accountId = String(config.accountId || "").trim();
  if (!/^\d{12}$/.test(accountId)) throw new Error("AWS accountId must be a 12-digit account ID");
  if (!accessKeyId || !secretAccessKey) throw new Error("AWS accessKeyId and secretAccessKey are required");
  return { region, accessKeyId, secretAccessKey, accountId, sessionToken: secrets.sessionToken || null };
}

function awsEncode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalQuery(query = {}) {
  const entries = [];
  for (const [key, value] of Object.entries(query)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const item of value) entries.push([key, item]);
    } else {
      entries.push([key, value]);
    }
  }
  return entries
    .sort(([aKey, aVal], [bKey, bVal]) => (aKey === bKey ? String(aVal).localeCompare(String(bVal)) : aKey.localeCompare(bKey)))
    .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`)
    .join("&");
}

function hmac(key, value) {
  return crypto.createHmac("sha256", key).update(value).digest();
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function signingKey(secretAccessKey, dateStamp, region, service) {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

function signedHeaders({ method, hostname, path, query, body, headers, region, service, credentials }) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body || "");
  const lower = {
    host: hostname,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate
  };
  for (const [key, value] of Object.entries(headers || {})) lower[key.toLowerCase()] = String(value).trim();
  if (credentials.sessionToken) lower["x-amz-security-token"] = credentials.sessionToken;

  const headerNames = Object.keys(lower).sort();
  const canonicalHeaders = headerNames.map((key) => `${key}:${String(lower[key]).replace(/\s+/g, " ")}\n`).join("");
  const signedHeaderNames = headerNames.join(";");
  const canonicalRequest = [
    method.toUpperCase(),
    path || "/",
    canonicalQuery(query),
    canonicalHeaders,
    signedHeaderNames,
    payloadHash
  ].join("\n");
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signature = crypto.createHmac("sha256", signingKey(credentials.secretAccessKey, dateStamp, region, service)).update(stringToSign).digest("hex");

  return {
    ...lower,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaderNames}, Signature=${signature}`
  };
}

async function awsFetch({ conn, service, hostname, path = "/", query = {}, method = "GET", headers = {}, body = "" }) {
  const creds = requireAwsConfig(conn);
  const qs = canonicalQuery(query);
  const url = `https://${hostname}${path}${qs ? `?${qs}` : ""}`;
  const signed = signedHeaders({
    method,
    hostname,
    path,
    query,
    body,
    headers,
    region: creds.region,
    service,
    credentials: creds
  });
  return safeFetch(
    url,
    {
      method,
      headers: signed,
      body: method.toUpperCase() === "GET" || method.toUpperCase() === "HEAD" ? undefined : body
    },
    ALLOW.aws
  );
}

function xmlValue(xml, tag) {
  const match = String(xml || "").match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return match?.[1] || null;
}

async function awsJson(request, optional = false) {
  const res = await awsFetch(request);
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    if (optional && (res.status === 403 || res.status === 404)) return null;
    throw new Error(json.message || json.Message || json.__type || xmlValue(text, "Message") || `AWS API failed (${res.status})`);
  }
  return json;
}

async function awsXml(request) {
  const res = await awsFetch(request);
  const text = await res.text();
  if (!res.ok) throw new Error(xmlValue(text, "Message") || `AWS API failed (${res.status})`);
  return text;
}

function awsTopologyRelationships(conn, { resourceId, resourceName, aliases = [], knowledgeBases = [] }) {
  const accountId = String(conn.config?.accountId || "").trim();
  const rels = [
    {
      rel_type: "DEPLOYED_IN",
      to_type: "CloudAccount",
      to_key: `aws-account-${accountId}`,
      to_name: `AWS account ${accountId}`
    },
    {
      rel_type: "OBSERVED_BY",
      to_type: "Connector",
      to_key: `aws-connector-${conn.id}`,
      to_name: conn.name || "AWS connector"
    },
    {
      rel_type: "DEPLOYED_IN",
      to_type: "CloudResource",
      to_key: resourceId,
      to_name: resourceName
    }
  ];
  for (const alias of aliases.slice(0, 8)) {
    const aliasId = alias.agentAliasId || alias.agentAliasName;
    if (!aliasId) continue;
    rels.push({
      rel_type: "EXPOSES_ALIAS",
      to_type: "AgentAlias",
      to_key: `aws-alias:${alias.agentId || "agent"}:${aliasId}`,
      to_name: alias.agentAliasName || aliasId
    });
  }
  for (const kb of knowledgeBases.slice(0, 12)) {
    const kbId = kb.knowledgeBaseId || kb.id;
    if (!kbId) continue;
    const kbArn =
      kb.knowledgeBaseArn ||
      `arn:aws:bedrock:${conn.config?.region || "us-east-1"}:${accountId}:knowledge-base/${kbId}`;
    rels.push({
      rel_type: "USES_KNOWLEDGE_BASE",
      to_type: "CloudResource",
      to_key: kbArn,
      to_name: kb.name || kbId
    });
  }
  return rels;
}

/** Map provider lifecycle strings onto agents.running_status CHECK values. */
function normalizeRunningStatus(status) {
  const raw = String(status || "").trim();
  if (!raw) return "unknown";
  const s = raw.toUpperCase().replace(/[\s-]+/g, "_");
  if (
    /^(RUNNING|ACTIVE|IN_SERVICE|AVAILABLE|PREPARED|READY|SUCCEEDED|HEALTHY|ENABLED|CREATING|PREPARING|UPDATING|VERSIONING)$/.test(
      s
    )
  ) {
    return /^(CREATING|PREPARING|UPDATING|VERSIONING)$/.test(s) ? "scheduled" : "running";
  }
  if (/^(STOPPED|STOPPING|INACTIVE|FAILED|DELETED|DELETING|DISABLED|NOT_PREPARED|OUTOFSERVICE|TERMINATED)$/.test(s)) {
    return /^(FAILED|NOT_PREPARED)$/.test(s) ? "unknown" : "stopped";
  }
  if (/^(SCHEDULED|PENDING)$/.test(s)) return "scheduled";
  if (["running", "stopped", "unknown", "scheduled"].includes(raw.toLowerCase())) return raw.toLowerCase();
  return "unknown";
}

function awsObservation({
  conn,
  id,
  name,
  awsType,
  service,
  region,
  aiRelevant = true,
  status,
  model,
  extra = {},
  relationships
}) {
  return {
    collector_id: "cloud_aws",
    fingerprint: `aws:${id}`,
    name: aiRelevant ? `${name} (AI)` : name,
    category: "cloud",
    cloud_provider: "aws",
    region,
    provider: "aws",
    deployment_type: "cloud",
    endpoint: id,
    running_status: normalizeRunningStatus(status),
    confidence_score: aiRelevant ? 0.9 : 0.78,
    framework: awsType,
    model: model || (aiRelevant ? "ai-relevant" : null),
    metadata: {
      connectorId: conn.id,
      connectorName: conn.name,
      discoveryMode: "aws-api-live",
      accountId: conn.config.accountId,
      awsType,
      awsService: service,
      awsLifecycleStatus: status || null,
      aiRelevant,
      inventoryClass: aiRelevant ? "ai_cloud_resource" : "cloud_resource",
      evidenceClass: aiRelevant ? "cloud_ai_runtime" : null,
      agentStatus: aiRelevant
        ? /BedrockAgent|SageMakerEndpoint|BedrockKnowledgeBase/i.test(awsType)
          ? "confirmed"
          : "candidate"
        : null,
      managedCloudAgent: /BedrockAgent/i.test(awsType),
      environment: conn.environment,
      ...extra
    },
    relationships:
      relationships ||
      awsTopologyRelationships(conn, { resourceId: id, resourceName: name })
  };
}

export async function validateAwsConnector(conn) {
  const creds = requireAwsConfig(conn);
  const body = new URLSearchParams({ Action: "GetCallerIdentity", Version: "2011-06-15" }).toString();
  const xml = await awsXml({
    conn,
    service: "sts",
    hostname: `sts.${creds.region}.amazonaws.com`,
    method: "POST",
    path: "/",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
    body
  });
  const account = xmlValue(xml, "Account");
  const arn = xmlValue(xml, "Arn");
  if (account && account !== creds.accountId) {
    throw new Error(`AWS credentials are for account ${account}, expected ${creds.accountId}`);
  }
  return {
    ok: true,
    message: `Authenticated to AWS account ${account || creds.accountId}${arn ? ` as ${arn}` : ""}.`,
    account,
    arn
  };
}

/**
 * Bedrock Agent control-plane APIs (ListAgents, ListKnowledgeBases, ListAgentAliases)
 * are POST + JSON body — not GET with query params. Wrong method returns 404 and was
 * previously swallowed as an empty inventory.
 */
async function listBedrockAgents(conn, region) {
  const agents = [];
  let nextToken = null;
  do {
    const body = { maxResults: 100 };
    if (nextToken) body.nextToken = nextToken;
    const json = await awsJson({
      conn,
      service: "bedrock",
      hostname: `bedrock-agent.${region}.amazonaws.com`,
      method: "POST",
      path: "/agents/",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    agents.push(...(json?.agentSummaries || json?.agents || []));
    nextToken = json?.nextToken || null;
  } while (nextToken && agents.length < AWS_MAX_RESOURCES);
  return agents;
}

async function listSageMakerEndpoints(conn, region) {
  const endpoints = [];
  let nextToken = null;
  do {
    const payload = {
      MaxResults: 100,
      SortBy: "CreationTime",
      SortOrder: "Descending"
    };
    if (nextToken) payload.NextToken = nextToken;
    const json = await awsJson({
      conn,
      service: "sagemaker",
      hostname: `api.sagemaker.${region}.amazonaws.com`,
      method: "POST",
      path: "/",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "SageMaker.ListEndpoints"
      },
      body: JSON.stringify(payload)
    });
    endpoints.push(...(json?.Endpoints || []));
    nextToken = json?.NextToken || null;
  } while (nextToken && endpoints.length < AWS_MAX_RESOURCES);
  return endpoints;
}

async function listAiLambdaFunctions(conn, region) {
  const matched = [];
  let marker = null;
  do {
    const query = { MaxItems: 50 };
    if (marker) query.Marker = marker;
    const json = await awsJson({
      conn,
      service: "lambda",
      hostname: `lambda.${region}.amazonaws.com`,
      path: "/2015-03-31/functions/",
      query
    });
    const functions = json?.Functions || [];
    for (const fn of functions) {
      if (
        isAiRelevantText(
          fn.FunctionName,
          fn.Description,
          fn.Runtime,
          fn.Role,
          fn.PackageType,
          Object.keys(fn.Environment?.Variables || {}).join(" "),
          Object.values(fn.Environment?.Variables || {}).join(" ")
        )
      ) {
        matched.push(fn);
      }
    }
    marker = json?.NextMarker || null;
  } while (marker && matched.length < AWS_MAX_RESOURCES);
  return matched;
}

async function listBedrockKnowledgeBases(conn, region) {
  const knowledgeBases = [];
  let nextToken = null;
  do {
    const body = { maxResults: 100 };
    if (nextToken) body.nextToken = nextToken;
    const json = await awsJson({
      conn,
      service: "bedrock",
      hostname: `bedrock-agent.${region}.amazonaws.com`,
      method: "POST",
      path: "/knowledgebases/",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    knowledgeBases.push(...(json?.knowledgeBaseSummaries || json?.knowledgeBases || []));
    nextToken = json?.nextToken || null;
  } while (nextToken && knowledgeBases.length < AWS_MAX_RESOURCES);
  return knowledgeBases;
}

async function listBedrockAgentAliases(conn, region, agentId) {
  if (!agentId) return [];
  const aliases = [];
  let nextToken = null;
  do {
    const body = { maxResults: 100 };
    if (nextToken) body.nextToken = nextToken;
    const json = await awsJson({
      conn,
      service: "bedrock",
      hostname: `bedrock-agent.${region}.amazonaws.com`,
      method: "POST",
      path: `/agents/${encodeURIComponent(agentId)}/agentaliases/`,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    aliases.push(...(json?.agentAliasSummaries || json?.agentAliases || []));
    nextToken = json?.nextToken || null;
  } while (nextToken && aliases.length < 100);
  return aliases;
}

async function listBedrockAgentKnowledgeBases(conn, region, agentId, agentVersion = "DRAFT") {
  if (!agentId) return [];
  const version = String(agentVersion || "DRAFT").trim() || "DRAFT";
  const knowledgeBases = [];
  let nextToken = null;
  do {
    const body = { maxResults: 100 };
    if (nextToken) body.nextToken = nextToken;
    const json = await awsJson({
      conn,
      service: "bedrock",
      hostname: `bedrock-agent.${region}.amazonaws.com`,
      method: "POST",
      path: `/agents/${encodeURIComponent(agentId)}/agentversions/${encodeURIComponent(version)}/knowledgebases/`,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    knowledgeBases.push(...(json?.agentKnowledgeBaseSummaries || []));
    nextToken = json?.nextToken || null;
  } while (nextToken && knowledgeBases.length < 50);
  return knowledgeBases;
}

async function listAiEcsServices(conn, region) {
  const clustersJson = await awsJson({
    conn,
    service: "ecs",
    hostname: `ecs.${region}.amazonaws.com`,
    method: "POST",
    path: "/",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AmazonEC2ContainerServiceV20141113.ListClusters"
    },
    body: JSON.stringify({ maxResults: 100 })
  });
  const clusterArns = clustersJson?.clusterArns || [];
  const services = [];
  for (const cluster of clusterArns.slice(0, 20)) {
    const list = await awsJson({
      conn,
      service: "ecs",
      hostname: `ecs.${region}.amazonaws.com`,
      method: "POST",
      path: "/",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AmazonEC2ContainerServiceV20141113.ListServices"
      },
      body: JSON.stringify({ cluster, maxResults: 100 })
    }).catch(() => null);
    const serviceArns = list?.serviceArns || [];
    if (!serviceArns.length) continue;
    for (let i = 0; i < serviceArns.length; i += 10) {
      const batch = serviceArns.slice(i, i + 10);
      const described = await awsJson({
        conn,
        service: "ecs",
        hostname: `ecs.${region}.amazonaws.com`,
        method: "POST",
        path: "/",
        headers: {
          "Content-Type": "application/x-amz-json-1.1",
          "X-Amz-Target": "AmazonEC2ContainerServiceV20141113.DescribeServices"
        },
        body: JSON.stringify({ cluster, services: batch, include: ["TAGS"] })
      }).catch(() => null);
      for (const svc of described?.services || []) {
        const blob = [
          svc.serviceName,
          svc.taskDefinition,
          ...(svc.tags || []).map((t) => `${t.key || t.Key}:${t.value || t.Value}`),
          ...(svc.loadBalancers || []).map((lb) => lb.containerName)
        ].join(" ");
        if (!isAiRelevantText(blob)) continue;
        services.push(svc);
      }
    }
  }
  return services;
}

async function mapPool(items, concurrency, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index], index);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function collectAwsList(label, fn) {
  try {
    return { label, items: await fn(), error: null };
  } catch (err) {
    return { label, items: [], error: err.message || String(err) };
  }
}

export async function discoverAwsConnector(conn) {
  const creds = requireAwsConfig(conn);
  const validation = await validateAwsConnector(conn);
  const observations = [
    {
      collector_id: "cloud_aws",
      fingerprint: `aws-connector-scan:${conn.id}:${creds.accountId}`,
      name: `AWS scan — ${conn.name}`,
      category: "cloud",
      cloud_provider: "aws",
      region: creds.region,
      provider: "aws",
      deployment_type: "cloud",
      running_status: "running",
      confidence_score: 0.95,
      framework: "account-scan",
      metadata: {
        connectorId: conn.id,
        connectorName: conn.name,
        discoveryMode: "aws-api-live",
        accountId: creds.accountId,
        callerArn: validation.arn || null,
        inventoryClass: "connector_scan",
        environment: conn.environment,
        maxResources: AWS_MAX_RESOURCES
      },
      relationships: awsTopologyRelationships(conn, {
        resourceId: `aws-account-${creds.accountId}`,
        resourceName: `AWS account ${creds.accountId}`
      })
    }
  ];

  // Sequence Bedrock control-plane lists first to avoid stampedes against the same host.
  const bedrockAgentsResult = await collectAwsList("bedrockAgents", () => listBedrockAgents(conn, creds.region));
  const bedrockKbResult = await collectAwsList("bedrockKnowledgeBases", () =>
    listBedrockKnowledgeBases(conn, creds.region)
  );
  const [endpointsResult, lambdasResult, ecsResult] = await Promise.all([
    collectAwsList("sageMakerEndpoints", () => listSageMakerEndpoints(conn, creds.region)),
    collectAwsList("lambdaFunctions", () => listAiLambdaFunctions(conn, creds.region)),
    collectAwsList("ecsServices", () => listAiEcsServices(conn, creds.region))
  ]);
  const settled = [bedrockAgentsResult, endpointsResult, lambdasResult, bedrockKbResult, ecsResult];
  const byLabel = Object.fromEntries(settled.map((s) => [s.label, s]));
  const agents = byLabel.bedrockAgents?.items || [];
  const endpoints = byLabel.sageMakerEndpoints?.items || [];
  const lambdas = byLabel.lambdaFunctions?.items || [];
  const knowledgeBases = byLabel.bedrockKnowledgeBases?.items || [];
  const ecsServices = byLabel.ecsServices?.items || [];
  const kbById = new Map(
    knowledgeBases
      .filter((kb) => kb.knowledgeBaseId)
      .map((kb) => [
        kb.knowledgeBaseId,
        {
          knowledgeBaseId: kb.knowledgeBaseId,
          name: kb.name || kb.knowledgeBaseId,
          knowledgeBaseArn:
            kb.knowledgeBaseArn ||
            `arn:aws:bedrock:${creds.region}:${creds.accountId}:knowledge-base/${kb.knowledgeBaseId}`
        }
      ])
  );
  const scanGaps = settled
    .filter((s) => s.error)
    .map((s) => ({ source: s.label, error: s.error }));
  if (scanGaps.length) {
    console.warn(
      `AWS connector "${conn.name}" partial scan gaps:`,
      scanGaps.map((g) => `${g.source}: ${g.error}`).join("; ")
    );
  }

  const agentObservations = await mapPool(agents, 4, async (agent) => {
    const id =
      agent.agentArn ||
      `arn:aws:bedrock:${creds.region}:${creds.accountId}:agent/${agent.agentId || agent.agentName}`;
    const displayName = agent.agentName || agent.agentId || "Bedrock Agent";
    const [aliases, linkedKbsPrimary] = await Promise.all([
      listBedrockAgentAliases(conn, creds.region, agent.agentId).catch(() => []),
      listBedrockAgentKnowledgeBases(
        conn,
        creds.region,
        agent.agentId,
        agent.latestAgentVersion || "DRAFT"
      ).catch(() => [])
    ]);
    let linkedKbs = linkedKbsPrimary;
    if (!linkedKbs.length && agent.latestAgentVersion && agent.latestAgentVersion !== "DRAFT") {
      linkedKbs = await listBedrockAgentKnowledgeBases(conn, creds.region, agent.agentId, "DRAFT").catch(
        () => []
      );
    }
    const knowledgeBaseLinks = linkedKbs.map((kb) => {
      const known = kbById.get(kb.knowledgeBaseId);
      return {
        knowledgeBaseId: kb.knowledgeBaseId,
        name: known?.name || kb.knowledgeBaseId,
        knowledgeBaseArn:
          known?.knowledgeBaseArn ||
          `arn:aws:bedrock:${creds.region}:${creds.accountId}:knowledge-base/${kb.knowledgeBaseId}`,
        knowledgeBaseState: kb.knowledgeBaseState || null
      };
    });
    return awsObservation({
      conn,
      id,
      name: displayName,
      awsType: "BedrockAgent",
      service: "bedrock-agent",
      region: creds.region,
      aiRelevant: true,
      status: agent.agentStatus,
      model: agent.foundationModel || "bedrock-agent",
      extra: {
        agentId: agent.agentId,
        description: agent.description || null,
        latestAgentVersion: agent.latestAgentVersion || null,
        updatedAt: agent.updatedAt || null,
        aliasCount: aliases.length,
        aliases: aliases.slice(0, 8).map((a) => a.agentAliasName || a.agentAliasId),
        knowledgeBaseIds: knowledgeBaseLinks.map((kb) => kb.knowledgeBaseId).filter(Boolean),
        knowledgeBaseCount: knowledgeBaseLinks.length
      },
      relationships: awsTopologyRelationships(conn, {
        resourceId: id,
        resourceName: displayName,
        aliases: aliases.map((a) => ({ ...a, agentId: agent.agentId })),
        knowledgeBases: knowledgeBaseLinks
      })
    });
  });
  observations.push(...agentObservations);

  for (const kb of knowledgeBases) {
    const id =
      kb.knowledgeBaseArn ||
      `arn:aws:bedrock:${creds.region}:${creds.accountId}:knowledge-base/${kb.knowledgeBaseId || kb.name}`;
    observations.push(
      awsObservation({
        conn,
        id,
        name: kb.name || kb.knowledgeBaseId || "Bedrock Knowledge Base",
        awsType: "BedrockKnowledgeBase",
        service: "bedrock-agent",
        region: creds.region,
        aiRelevant: true,
        status: kb.status || "unknown",
        model: "bedrock-knowledge-base",
        extra: { knowledgeBaseId: kb.knowledgeBaseId || null, description: kb.description || null }
      })
    );
  }

  for (const endpoint of endpoints) {
    const id =
      endpoint.EndpointArn ||
      `arn:aws:sagemaker:${creds.region}:${creds.accountId}:endpoint/${endpoint.EndpointName || "unknown"}`;
    observations.push(
      awsObservation({
        conn,
        id,
        name: endpoint.EndpointName || "SageMaker endpoint",
        awsType: "SageMakerEndpoint",
        service: "sagemaker",
        region: creds.region,
        aiRelevant: true,
        status: endpoint.EndpointStatus,
        model: "sagemaker-endpoint",
        extra: { creationTime: endpoint.CreationTime || null, lastModifiedTime: endpoint.LastModifiedTime || null }
      })
    );
  }

  for (const fn of lambdas) {
    const id = fn.FunctionArn || `arn:aws:lambda:${creds.region}:${creds.accountId}:function:${fn.FunctionName}`;
    observations.push(
      awsObservation({
        conn,
        id,
        name: fn.FunctionName || "Lambda function",
        awsType: "LambdaFunction",
        service: "lambda",
        region: creds.region,
        aiRelevant: true,
        status: fn.State || "unknown",
        model: "lambda-ai-workload",
        extra: {
          runtime: fn.Runtime || null,
          handler: fn.Handler || null,
          lastModified: fn.LastModified || null,
          aiSignal: "name-description-runtime-env"
        }
      })
    );
  }

  for (const svc of ecsServices) {
    const id = svc.serviceArn || `arn:aws:ecs:${creds.region}:${creds.accountId}:service/${svc.serviceName}`;
    observations.push(
      awsObservation({
        conn,
        id,
        name: svc.serviceName || "ECS AI service",
        awsType: "EcsService",
        service: "ecs",
        region: creds.region,
        aiRelevant: true,
        status: svc.status || "unknown",
        model: "ecs-ai-service",
        extra: {
          taskDefinition: svc.taskDefinition || null,
          launchType: svc.launchType || null,
          runningCount: svc.runningCount ?? null,
          aiSignal: "ecs-name-tags"
        }
      })
    );
  }

  const selected = observations.slice(0, AWS_MAX_RESOURCES + 1);
  const totalResourcesScanned =
    agents.length + endpoints.length + lambdas.length + knowledgeBases.length + ecsServices.length;
  const counts = {
    bedrockAgents: agents.length,
    bedrockKnowledgeBases: knowledgeBases.length,
    sageMakerEndpoints: endpoints.length,
    lambdaFunctions: lambdas.length,
    ecsServices: ecsServices.length
  };
  if (selected[0]?.metadata) {
    selected[0].metadata.counts = counts;
    selected[0].metadata.scanGaps = scanGaps;
    selected[0].metadata.totalResourcesScanned = totalResourcesScanned;
  }
  return {
    observations: selected,
    stats: {
      totalResourcesScanned,
      aiRelevantResources: totalResourcesScanned,
      cloudResourcesIngested: Math.max(0, selected.length - 1),
      region: creds.region,
      counts,
      scanGaps
    }
  };
}
