import crypto from "crypto";
import { safeFetch, assertDnsLabel, ALLOW } from "../utils/http.js";
import {
  DISCOVERY_AI_ONLY,
  isAiRelevantText,
  classifyAwsResource
} from "./aiRelevance.js";
import {
  emptyAgentBlock,
  emptyRuntimeBlock,
  buildAgentAndRuntime,
  normalizeRuntimeStatus,
  sanitizeCloudError,
  emptyDiscoveryStats,
  tallyDiscoveryObservation,
  dedupeObservationsByFingerprint,
  safeEnvNames
} from "./cloudDiscoveryCommon.js";
import { enrichAwsWithDeepScan } from "./awsDeepScan.js";

const AWS_MAX_RESOURCES = Number(process.env.AWS_DISCOVERY_MAX_RESOURCES || 150);
const AWS_DISCOVERY_AGENT_SCAN =
  String(process.env.AWS_DISCOVERY_AGENT_SCAN || "true").toLowerCase() !== "false";
const AWS_DISCOVERY_RUNTIME_SCAN =
  String(process.env.AWS_DISCOVERY_RUNTIME_SCAN || "true").toLowerCase() !== "false";
const AWS_DISCOVERY_DEEP_SCAN =
  String(process.env.AWS_DISCOVERY_DEEP_SCAN || "true").toLowerCase() !== "false";
export const EFFECTIVE_AWS_AI_ONLY =
  process.env.AWS_DISCOVERY_AI_ONLY != null
    ? String(process.env.AWS_DISCOVERY_AI_ONLY).toLowerCase() !== "false"
    : DISCOVERY_AI_ONLY;

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
  const signature = crypto
    .createHmac("sha256", signingKey(credentials.secretAccessKey, dateStamp, region, service))
    .update(stringToSign)
    .digest("hex");

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

export async function awsJson(request, optional = false) {
  const res = await awsFetch(request);
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    const permissionDenied = res.status === 401 || res.status === 403;
    if (optional && (res.status === 403 || res.status === 404 || res.status === 401)) {
      return { __error: true, permissionDenied, status: res.status, message: sanitizeCloudError(json.message || json.Message || `AWS API failed (${res.status})`) };
    }
    const err = new Error(
      sanitizeCloudError(json.message || json.Message || json.__type || xmlValue(text, "Message") || `AWS API failed (${res.status})`)
    );
    err.status = res.status;
    err.permissionDenied = permissionDenied;
    throw err;
  }
  return json;
}

async function awsXml(request) {
  const res = await awsFetch(request);
  const text = await res.text();
  if (!res.ok) throw new Error(sanitizeCloudError(xmlValue(text, "Message") || `AWS API failed (${res.status})`));
  return text;
}

function cloudRelationship(id, name, extra = []) {
  return [
    {
      rel_type: "DEPLOYED_IN",
      to_type: "CloudResource",
      to_key: id,
      to_name: name
    },
    ...extra
  ];
}

/**
 * Map Bedrock agent lifecycle to deployment status. Agents are request-driven —
 * PREPARED ≠ continuously running.
 */
export function mapBedrockAgentLifecycle(agentStatus) {
  const raw = String(agentStatus || "");
  if (/^FAILED$/i.test(raw)) {
    return { deploymentStatus: raw, runtimeStatus: "failed", runningStatus: "failed" };
  }
  if (/^(PREPARED|NOT_PREPARED|CREATING|PREPARING|UPDATING|VERSIONING|DELETING)$/i.test(raw)) {
    return {
      deploymentStatus: raw || null,
      runtimeStatus: "unknown",
      runningStatus: "unknown",
      reason: "Bedrock agents are request-driven; agentStatus is lifecycle/deployment, not continuous runtime"
    };
  }
  return {
    deploymentStatus: raw || null,
    runtimeStatus: "unknown",
    runningStatus: "unknown",
    reason: "Bedrock agent runtime not exposed as continuous execution state"
  };
}

export function mapSageMakerEndpointStatus(status) {
  const raw = String(status || "");
  if (/^InService$/i.test(raw)) return "running";
  if (/^OutOfService$/i.test(raw) || /^Deleting$/i.test(raw)) return "stopped";
  if (/^Failed$/i.test(raw)) return "failed";
  return "unknown";
}

/**
 * Build layered AWS observation. Does not mark AI resources as confirmed agents.
 */
export function awsObservation({
  conn,
  id,
  name,
  awsType,
  service,
  region,
  classification,
  status,
  model,
  extra = {},
  fingerprint,
  discoveryLayer,
  inventoryClass,
  agentRuntime,
  relationships,
  confidence,
  evidence = [],
  discoveryMode = "aws-api-live",
  runtimeStatusReason = null,
  discoveryStatus = null
}) {
  const classif =
    classification ||
    classifyAwsResource({ awsType, name, service, tags: extra.tags, description: extra.description, runtime: extra.runtime });
  const aiRelevant = classif.aiRelevant === true;
  const blocks = agentRuntime || buildAgentAndRuntime({ agentDetected: false });
  const agent = blocks.agent;
  const runtime = blocks.runtime;

  let runningStatus = "unknown";
  if (runtime.detected && runtime.status) runningStatus = runtime.status;
  if (status && runtime.detected) {
    /* prefer runtime.status */
  } else if (!agent.detected && runtime.detected) {
    runningStatus = runtime.status || "unknown";
  }

  let legacyAgentStatus = null;
  if (agent.detected) {
    legacyAgentStatus =
      agent.detectionMethod === "runtime_heuristic" || agent.detectionMethod === "name_heuristic"
        ? "candidate"
        : "confirmed";
  }

  const inv =
    inventoryClass ||
    (agent.detected ? "ai_cloud_agent" : aiRelevant ? "ai_cloud_resource" : "cloud_resource");

  let evidenceClass = null;
  if (agent.detected) evidenceClass = "cloud_ai_runtime";

  return {
    collector_id: "cloud_aws",
    fingerprint: fingerprint || `aws:${id}`,
    name: aiRelevant ? `${name} (AI)` : name,
    category: "cloud",
    cloud_provider: "aws",
    region,
    provider: "aws",
    deployment_type: "cloud",
    endpoint: id,
    running_status: runningStatus,
    confidence_score: confidence ?? classif.confidence ?? (aiRelevant ? 0.85 : 0.7),
    framework: awsType,
    model: model || (agent.detected ? "aws-ai-agent" : aiRelevant ? "ai-relevant" : null),
    agent,
    runtime,
    metadata: {
      connectorId: conn.id,
      connectorName: conn.name,
      discoveryMode,
      discoveryLayer: discoveryLayer || classif.layer || "resource",
      accountId: conn.config.accountId,
      awsType,
      awsService: service,
      aiRelevant,
      aiResourceType: classif.category,
      agentDetected: agent.detected,
      agentDetectionMethod: agent.detectionMethod,
      runtimeDetected: runtime.detected,
      runtimeType: runtime.runtimeType,
      runtimeStatus: runtime.status,
      evidence: [...(classif.evidence || []), ...evidence],
      evidenceClass,
      inventoryClass: inv,
      agentStatus: legacyAgentStatus,
      managedCloudAgent: Boolean(
        agent.detected && agent.detectionMethod && /bedrock_agents_api/.test(agent.detectionMethod)
      ),
      discoveryStatus,
      runtimeStatusReason,
      environment: conn.environment,
      ...extra
    },
    relationships: relationships || cloudRelationship(id, name, [
      { rel_type: "HOSTED_BY", to_type: "CloudResource", to_key: id, to_name: name }
    ])
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

/** Non-destructive capability probe — not a full account scan. */
export async function validateAwsConnectorCapabilities(conn) {
  const creds = requireAwsConfig(conn);
  const capabilities = {
    sts: false,
    bedrockAgents: false,
    bedrockKnowledgeBases: false,
    sagemaker: false,
    lambda: false,
    ecs: false
  };

  try {
    await validateAwsConnector(conn);
    capabilities.sts = true;
  } catch {
    return { ok: false, capabilities, message: "STS authentication failed" };
  }

  async function probe(fn) {
    try {
      const result = await fn();
      if (result?.__error) return !result.permissionDenied;
      return true;
    } catch (err) {
      return !err.permissionDenied;
    }
  }

  capabilities.bedrockAgents = await probe(() =>
    awsJson(
      {
        conn,
        service: "bedrock",
        hostname: `bedrock-agent.${creds.region}.amazonaws.com`,
        path: "/agents/",
        query: { maxResults: 1 }
      },
      true
    )
  );
  capabilities.bedrockKnowledgeBases = await probe(() =>
    awsJson(
      {
        conn,
        service: "bedrock",
        hostname: `bedrock-agent.${creds.region}.amazonaws.com`,
        path: "/knowledgebases/",
        query: { maxResults: 1 }
      },
      true
    )
  );
  capabilities.sagemaker = await probe(() =>
    awsJson(
      {
        conn,
        service: "sagemaker",
        hostname: `api.sagemaker.${creds.region}.amazonaws.com`,
        method: "POST",
        path: "/",
        headers: {
          "Content-Type": "application/x-amz-json-1.1",
          "X-Amz-Target": "SageMaker.ListEndpoints"
        },
        body: JSON.stringify({ MaxResults: 1 })
      },
      true
    )
  );
  capabilities.lambda = await probe(() =>
    awsJson(
      {
        conn,
        service: "lambda",
        hostname: `lambda.${creds.region}.amazonaws.com`,
        path: "/2015-03-31/functions/",
        query: { MaxItems: 1 }
      },
      true
    )
  );
  capabilities.ecs = await probe(() =>
    awsJson(
      {
        conn,
        service: "ecs",
        hostname: `ecs.${creds.region}.amazonaws.com`,
        method: "POST",
        path: "/",
        headers: {
          "Content-Type": "application/x-amz-json-1.1",
          "X-Amz-Target": "AmazonEC2ContainerServiceV20141113.ListClusters"
        },
        body: JSON.stringify({ maxResults: 1 })
      },
      true
    )
  );

  return {
    ok: capabilities.sts,
    capabilities,
    message: "AWS connector capability probe completed (read-only)."
  };
}

async function listBedrockAgents(conn, region, discoveryErrors) {
  const json = await awsJson(
    {
      conn,
      service: "bedrock",
      hostname: `bedrock-agent.${region}.amazonaws.com`,
      path: "/agents/",
      query: { maxResults: 50 }
    },
    true
  );
  if (json?.__error) {
    discoveryErrors.push({
      discoveryType: "bedrock-agents",
      discoveryStatus: json.permissionDenied ? "permission_denied" : "error",
      error: json.message
    });
    return [];
  }
  return json?.agentSummaries || json?.agents || [];
}

async function listSageMakerEndpoints(conn, region, discoveryErrors) {
  const json = await awsJson(
    {
      conn,
      service: "sagemaker",
      hostname: `api.sagemaker.${region}.amazonaws.com`,
      method: "POST",
      path: "/",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "SageMaker.ListEndpoints"
      },
      body: JSON.stringify({ MaxResults: 50, SortBy: "CreationTime", SortOrder: "Descending" })
    },
    true
  );
  if (json?.__error) {
    discoveryErrors.push({
      discoveryType: "sagemaker-endpoints",
      discoveryStatus: json.permissionDenied ? "permission_denied" : "error",
      error: json.message
    });
    return [];
  }
  return json?.Endpoints || [];
}

async function listAiLambdaFunctions(conn, region, discoveryErrors) {
  const json = await awsJson(
    {
      conn,
      service: "lambda",
      hostname: `lambda.${region}.amazonaws.com`,
      path: "/2015-03-31/functions/",
      query: { MaxItems: 50 }
    },
    true
  );
  if (json?.__error) {
    discoveryErrors.push({
      discoveryType: "lambda",
      discoveryStatus: json.permissionDenied ? "permission_denied" : "error",
      error: json.message
    });
    return [];
  }
  const functions = json?.Functions || [];
  return functions.filter((fn) =>
    isAiRelevantText(
      fn.FunctionName,
      fn.Description,
      fn.Runtime,
      fn.Role,
      fn.PackageType,
      Object.keys(fn.Environment?.Variables || {}).join(" ")
      // never use secret values for classification beyond key names
    )
  );
}

async function listBedrockKnowledgeBases(conn, region, discoveryErrors) {
  const json = await awsJson(
    {
      conn,
      service: "bedrock",
      hostname: `bedrock-agent.${region}.amazonaws.com`,
      path: "/knowledgebases/",
      query: { maxResults: 50 }
    },
    true
  );
  if (json?.__error) {
    discoveryErrors.push({
      discoveryType: "bedrock-knowledge-bases",
      discoveryStatus: json.permissionDenied ? "permission_denied" : "error",
      error: json.message
    });
    return [];
  }
  return json?.knowledgeBaseSummaries || json?.knowledgeBases || [];
}

async function listBedrockAgentAliases(conn, region, agentId, discoveryErrors) {
  if (!agentId) return [];
  const json = await awsJson(
    {
      conn,
      service: "bedrock",
      hostname: `bedrock-agent.${region}.amazonaws.com`,
      path: `/agents/${encodeURIComponent(agentId)}/agentaliases/`,
      query: { maxResults: 20 }
    },
    true
  );
  if (json?.__error) {
    discoveryErrors.push({
      resourceId: agentId,
      discoveryType: "bedrock-agent-aliases",
      discoveryStatus: json.permissionDenied ? "permission_denied" : "error",
      error: json.message
    });
    return [];
  }
  return json?.agentAliasSummaries || json?.agentAliases || [];
}

async function listAiEcsServices(conn, region, discoveryErrors) {
  const clustersJson = await awsJson(
    {
      conn,
      service: "ecs",
      hostname: `ecs.${region}.amazonaws.com`,
      method: "POST",
      path: "/",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AmazonEC2ContainerServiceV20141113.ListClusters"
      },
      body: JSON.stringify({ maxResults: 20 })
    },
    true
  );
  if (clustersJson?.__error) {
    discoveryErrors.push({
      discoveryType: "ecs-clusters",
      discoveryStatus: clustersJson.permissionDenied ? "permission_denied" : "error",
      error: clustersJson.message
    });
    return [];
  }
  const clusterArns = clustersJson?.clusterArns || [];
  const services = [];
  for (const cluster of clusterArns.slice(0, 8)) {
    const list = await awsJson(
      {
        conn,
        service: "ecs",
        hostname: `ecs.${region}.amazonaws.com`,
        method: "POST",
        path: "/",
        headers: {
          "Content-Type": "application/x-amz-json-1.1",
          "X-Amz-Target": "AmazonEC2ContainerServiceV20141113.ListServices"
        },
        body: JSON.stringify({ cluster, maxResults: 20 })
      },
      true
    ).catch((err) => {
      discoveryErrors.push({
        discoveryType: "ecs-services",
        discoveryStatus: err.permissionDenied ? "permission_denied" : "error",
        error: sanitizeCloudError(err)
      });
      return null;
    });
    if (list?.__error) {
      discoveryErrors.push({
        discoveryType: "ecs-services",
        discoveryStatus: list.permissionDenied ? "permission_denied" : "error",
        error: list.message
      });
      continue;
    }
    const serviceArns = list?.serviceArns || [];
    if (!serviceArns.length) continue;
    const described = await awsJson(
      {
        conn,
        service: "ecs",
        hostname: `ecs.${region}.amazonaws.com`,
        method: "POST",
        path: "/",
        headers: {
          "Content-Type": "application/x-amz-json-1.1",
          "X-Amz-Target": "AmazonEC2ContainerServiceV20141113.DescribeServices"
        },
        body: JSON.stringify({ cluster, services: serviceArns.slice(0, 10) })
      },
      true
    ).catch(() => null);
    if (described?.__error) continue;
    for (const svc of described?.services || []) {
      const blob = [
        svc.serviceName,
        svc.taskDefinition,
        ...(svc.tags || []).map((t) => `${t.key}:${t.value}`),
        ...(svc.loadBalancers || []).map((lb) => lb.containerName)
      ].join(" ");
      if (!isAiRelevantText(blob)) continue;
      services.push(svc);
    }
  }
  return services;
}

export async function discoverAwsConnector(conn) {
  const creds = requireAwsConfig(conn);
  const validation = await validateAwsConnector(conn);
  const discoveryErrors = [];
  const stats = emptyDiscoveryStats();

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
      agent: emptyAgentBlock(),
      runtime: emptyRuntimeBlock(),
      metadata: {
        connectorId: conn.id,
        connectorName: conn.name,
        discoveryMode: "aws-api-live",
        discoveryLayer: "connector",
        accountId: creds.accountId,
        callerArn: validation.arn || null,
        inventoryClass: "connector_scan",
        environment: conn.environment,
        maxResources: AWS_MAX_RESOURCES,
        agentScan: AWS_DISCOVERY_AGENT_SCAN,
        runtimeScan: AWS_DISCOVERY_RUNTIME_SCAN,
        deepScan: AWS_DISCOVERY_DEEP_SCAN,
        aiOnly: EFFECTIVE_AWS_AI_ONLY
      },
      relationships: cloudRelationship(`aws-account-${creds.accountId}`, `AWS account ${creds.accountId}`)
    }
  ];

  const [agents, endpoints, lambdas, knowledgeBases, ecsServices] = await Promise.all([
    AWS_DISCOVERY_AGENT_SCAN
      ? listBedrockAgents(conn, creds.region, discoveryErrors).catch((err) => {
          discoveryErrors.push({
            discoveryType: "bedrock-agents",
            discoveryStatus: "error",
            error: sanitizeCloudError(err)
          });
          return [];
        })
      : Promise.resolve([]),
    listSageMakerEndpoints(conn, creds.region, discoveryErrors).catch((err) => {
      discoveryErrors.push({
        discoveryType: "sagemaker-endpoints",
        discoveryStatus: "error",
        error: sanitizeCloudError(err)
      });
      return [];
    }),
    AWS_DISCOVERY_RUNTIME_SCAN
      ? listAiLambdaFunctions(conn, creds.region, discoveryErrors).catch((err) => {
          discoveryErrors.push({
            discoveryType: "lambda",
            discoveryStatus: "error",
            error: sanitizeCloudError(err)
          });
          return [];
        })
      : Promise.resolve([]),
    listBedrockKnowledgeBases(conn, creds.region, discoveryErrors).catch((err) => {
      discoveryErrors.push({
        discoveryType: "bedrock-knowledge-bases",
        discoveryStatus: "error",
        error: sanitizeCloudError(err)
      });
      return [];
    }),
    AWS_DISCOVERY_RUNTIME_SCAN
      ? listAiEcsServices(conn, creds.region, discoveryErrors).catch((err) => {
          discoveryErrors.push({
            discoveryType: "ecs",
            discoveryStatus: "error",
            error: sanitizeCloudError(err)
          });
          return [];
        })
      : Promise.resolve([])
  ]);

  stats.totalResourcesScanned =
    agents.length + endpoints.length + lambdas.length + knowledgeBases.length + ecsServices.length;
  stats.aiRelevantResources = stats.totalResourcesScanned;

  for (const agent of agents) {
    const agentId = agent.agentId || agent.agentName;
    const id =
      agent.agentArn ||
      `arn:aws:bedrock:${creds.region}:${creds.accountId}:agent/${agentId}`;
    const aliases = await listBedrockAgentAliases(conn, creds.region, agent.agentId, discoveryErrors).catch(
      () => []
    );
    const lifecycle = mapBedrockAgentLifecycle(agent.agentStatus);
    const classification = classifyAwsResource({
      awsType: "BedrockAgent",
      name: agent.agentName || agentId,
      service: "bedrock-agent"
    });
    observations.push(
      awsObservation({
        conn,
        id,
        name: agent.agentName || agentId || "Bedrock Agent",
        awsType: "BedrockAgent",
        service: "bedrock-agent",
        region: creds.region,
        classification,
        model: agent.foundationModel || "bedrock-agent",
        fingerprint: `aws-agent:${creds.accountId}:${agentId}`,
        discoveryLayer: "agent",
        inventoryClass: "ai_cloud_agent",
        confidence: 0.96,
        evidence: [
          "Agent returned by Bedrock Agents API (ListAgents)",
          lifecycle.reason,
          aliases.length ? `Alias count=${aliases.length}` : "No aliases listed"
        ],
        runtimeStatusReason: lifecycle.reason,
        agentRuntime: buildAgentAndRuntime({
          agentDetected: true,
          detectionMethod: "bedrock_agents_api",
          agentId,
          agentName: agent.agentName || agentId,
          agentType: "bedrock_agent",
          agentStatus: "confirmed",
          agentRuntimeStatus: lifecycle.runtimeStatus,
          deploymentStatus: lifecycle.deploymentStatus,
          lastSeenAt: agent.updatedAt || null,
          source: "aws_bedrock_agents",
          runtimeDetected: false,
          runtimeStatus: "unknown",
          runtimeType: "bedrock_agent",
          runtimeId: agentId,
          runtimeName: agent.agentName || agentId,
          resourceId: id,
          region: creds.region
        }),
        relationships: cloudRelationship(id, agent.agentName || agentId, [
          { rel_type: "HOSTED_BY", to_type: "CloudResource", to_key: id, to_name: agent.agentName || agentId }
        ]),
        extra: {
          agentId,
          updatedAt: agent.updatedAt || null,
          aliasCount: aliases.length,
          aliases: aliases.slice(0, 5).map((a) => a.agentAliasName || a.agentAliasId)
        }
      })
    );
  }

  for (const kb of knowledgeBases) {
    const id =
      kb.knowledgeBaseArn ||
      `arn:aws:bedrock:${creds.region}:${creds.accountId}:knowledge-base/${kb.knowledgeBaseId || kb.name}`;
    const classification = classifyAwsResource({
      awsType: "BedrockKnowledgeBase",
      name: kb.name || kb.knowledgeBaseId,
      service: "bedrock-agent"
    });
    const kbStatus = normalizeRuntimeStatus(kb.status);
    observations.push(
      awsObservation({
        conn,
        id,
        name: kb.name || kb.knowledgeBaseId || "Bedrock Knowledge Base",
        awsType: "BedrockKnowledgeBase",
        service: "bedrock-agent",
        region: creds.region,
        classification,
        model: "bedrock-knowledge-base",
        fingerprint: `aws-runtime:${id}`,
        discoveryLayer: "ai_resource",
        evidence: [
          "Bedrock Knowledge Base is an AI resource / tool dependency",
          "Not confirmed as an agent"
        ],
        agentRuntime: buildAgentAndRuntime({
          agentDetected: false,
          runtimeDetected: true,
          runtimeStatus: kbStatus === "unknown" && kb.status ? normalizeRuntimeStatus(kb.status) : kbStatus,
          runtimeType: "bedrock_knowledge_base",
          runtimeId: kb.knowledgeBaseId || id,
          runtimeName: kb.name || kb.knowledgeBaseId,
          resourceId: id,
          region: creds.region
        }),
        extra: { knowledgeBaseId: kb.knowledgeBaseId || null, description: kb.description || null }
      })
    );
  }

  for (const endpoint of endpoints) {
    const id =
      endpoint.EndpointArn ||
      `arn:aws:sagemaker:${creds.region}:${creds.accountId}:endpoint/${endpoint.EndpointName || "unknown"}`;
    const classification = classifyAwsResource({
      awsType: "SageMakerEndpoint",
      name: endpoint.EndpointName,
      service: "sagemaker"
    });
    const runtimeStatus = mapSageMakerEndpointStatus(endpoint.EndpointStatus);
    observations.push(
      awsObservation({
        conn,
        id,
        name: endpoint.EndpointName || "SageMaker endpoint",
        awsType: "SageMakerEndpoint",
        service: "sagemaker",
        region: creds.region,
        classification,
        model: "sagemaker-endpoint",
        fingerprint: `aws-runtime:${id}`,
        discoveryLayer: "ai_resource",
        evidence: [
          "SageMaker endpoint is model-serving infrastructure",
          "Endpoint InService does not mean an AI agent is running"
        ],
        runtimeStatusReason: "SageMaker endpoint status reflects model serving, not agent execution",
        agentRuntime: buildAgentAndRuntime({
          agentDetected: false,
          runtimeDetected: true,
          runtimeStatus,
          runtimeType: "sagemaker_endpoint",
          runtimeId: id,
          runtimeName: endpoint.EndpointName,
          resourceId: id,
          region: creds.region
        }),
        extra: {
          creationTime: endpoint.CreationTime || null,
          lastModifiedTime: endpoint.LastModifiedTime || null,
          endpointStatus: endpoint.EndpointStatus || null
        }
      })
    );
  }

  for (const fn of lambdas) {
    const id = fn.FunctionArn || `arn:aws:lambda:${creds.region}:${creds.accountId}:function:${fn.FunctionName}`;
    const classification = classifyAwsResource({
      awsType: "LambdaFunction",
      name: fn.FunctionName,
      service: "lambda",
      description: fn.Description,
      runtime: fn.Runtime
    });
    const runtimeStatus = normalizeRuntimeStatus(fn.State || "Active");
    const envNames = safeEnvNames(fn.Environment?.Variables || {});
    observations.push(
      awsObservation({
        conn,
        id,
        name: fn.FunctionName || "Lambda function",
        awsType: "LambdaFunction",
        service: "lambda",
        region: creds.region,
        classification,
        model: "lambda-ai-workload",
        fingerprint: `aws-runtime:${id}`,
        discoveryLayer: "agent_candidate",
        inventoryClass: "ai_cloud_agent",
        confidence: 0.7,
        evidence: [
          "Lambda matched AI workload heuristics (name/description/runtime/env names)",
          "Heuristic detection is never marked confirmed",
          "Function State is compute runtime, not confirmed agent execution"
        ],
        runtimeStatusReason: "Lambda State is not confirmed agent running status",
        agentRuntime: buildAgentAndRuntime({
          agentDetected: true,
          detectionMethod: "runtime_heuristic",
          agentId: id,
          agentName: fn.FunctionName,
          agentType: "lambda_workload",
          agentStatus: "candidate",
          agentRuntimeStatus: "unknown",
          deploymentStatus: fn.State || null,
          source: "aws_lambda_heuristic",
          runtimeDetected: true,
          runtimeStatus,
          runtimeType: "aws_lambda",
          runtimeId: id,
          runtimeName: fn.FunctionName,
          resourceId: id,
          region: creds.region
        }),
        relationships: cloudRelationship(id, fn.FunctionName, [
          { rel_type: "HOSTED_BY", to_type: "CloudResource", to_key: id, to_name: fn.FunctionName },
          { rel_type: "RUNS_ON", to_type: "AwsRuntime", to_key: id, to_name: fn.FunctionName }
        ]),
        extra: {
          runtime: fn.Runtime || null,
          handler: fn.Handler || null,
          lastModified: fn.LastModified || null,
          envNames,
          aiSignal: "name-description-runtime-env"
        }
      })
    );
  }

  for (const svc of ecsServices) {
    const id = svc.serviceArn || `arn:aws:ecs:${creds.region}:${creds.accountId}:service/${svc.serviceName}`;
    const classification = classifyAwsResource({
      awsType: "EcsService",
      name: svc.serviceName,
      service: "ecs",
      taskDefinition: svc.taskDefinition,
      tags: svc.tags
    });
    let runtimeStatus = normalizeRuntimeStatus(svc.status);
    if (Number(svc.runningCount) > 0) runtimeStatus = "running";
    else if (svc.desiredCount === 0 || Number(svc.runningCount) === 0) runtimeStatus = "stopped";

    observations.push(
      awsObservation({
        conn,
        id,
        name: svc.serviceName || "ECS AI service",
        awsType: "EcsService",
        service: "ecs",
        region: creds.region,
        classification,
        model: "ecs-ai-service",
        fingerprint: `aws-runtime:${id}`,
        discoveryLayer: "agent_candidate",
        inventoryClass: "ai_cloud_agent",
        confidence: 0.68,
        evidence: [
          "ECS service matched AI name/tag heuristics",
          "ECS runningCount is compute runtime; agent identity is heuristic only"
        ],
        runtimeStatusReason: "ECS service running does not confirm an AI agent",
        agentRuntime: buildAgentAndRuntime({
          agentDetected: true,
          detectionMethod: "runtime_heuristic",
          agentId: id,
          agentName: svc.serviceName,
          agentType: "ecs_workload",
          agentStatus: "candidate",
          agentRuntimeStatus: "unknown",
          deploymentStatus: svc.status || null,
          source: "aws_ecs_heuristic",
          runtimeDetected: true,
          runtimeStatus,
          runtimeType: "aws_ecs",
          runtimeId: id,
          runtimeName: svc.serviceName,
          resourceId: id,
          region: creds.region
        }),
        relationships: cloudRelationship(id, svc.serviceName, [
          { rel_type: "HOSTED_BY", to_type: "CloudResource", to_key: id, to_name: svc.serviceName },
          { rel_type: "RUNS_ON", to_type: "AwsRuntime", to_key: id, to_name: svc.serviceName }
        ]),
        extra: {
          taskDefinition: svc.taskDefinition || null,
          launchType: svc.launchType || null,
          runningCount: svc.runningCount ?? null,
          desiredCount: svc.desiredCount ?? null,
          aiSignal: "ecs-name-tags"
        }
      })
    );
  }

  let selected = dedupeObservationsByFingerprint(observations);

  if (AWS_DISCOVERY_DEEP_SCAN) {
    const deep = await enrichAwsWithDeepScan({
      awsJson,
      conn,
      region: creds.region,
      observations: selected.filter((o) => o.metadata?.inventoryClass !== "connector_scan"),
      discoveryErrors,
      enabled: true
    });
    stats.deepScanned = deep.deepScanned || 0;
  } else {
    stats.deepScanned = 0;
  }

  // Keep connector scan + up to MAX resource rows
  const scan = selected.filter((o) => o.metadata?.inventoryClass === "connector_scan");
  const rest = selected.filter((o) => o.metadata?.inventoryClass !== "connector_scan").slice(0, AWS_MAX_RESOURCES);
  selected = [...scan, ...rest];

  for (const obs of selected) tallyDiscoveryObservation(stats, obs);
  stats.discoveryErrors = discoveryErrors.length;
  stats.nonAiResourcesSkipped = 0;

  if (selected[0]?.metadata) {
    Object.assign(selected[0].metadata, {
      ...stats,
      deepScan: AWS_DISCOVERY_DEEP_SCAN,
      discoveryErrorSamples: discoveryErrors.slice(0, 25)
    });
  }

  return {
    observations: selected,
    stats,
    discoveryErrors
  };
}

export { classifyAwsResource };
