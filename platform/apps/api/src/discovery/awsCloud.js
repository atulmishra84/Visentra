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

function cloudRelationship(id, name) {
  return [
    {
      rel_type: "DEPLOYED_IN",
      to_type: "CloudResource",
      to_key: id,
      to_name: name
    }
  ];
}

function awsObservation({ conn, id, name, awsType, service, region, aiRelevant = true, status, model, extra = {} }) {
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
    running_status: status || "unknown",
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
      aiRelevant,
      inventoryClass: aiRelevant ? "ai_cloud_resource" : "cloud_resource",
      evidenceClass: aiRelevant ? "cloud_ai_runtime" : null,
      agentStatus: aiRelevant
        ? /BedrockAgent|SageMakerEndpoint/i.test(awsType)
          ? "confirmed"
          : "candidate"
        : null,
      managedCloudAgent: /BedrockAgent/i.test(awsType),
      environment: conn.environment,
      ...extra
    },
    relationships: cloudRelationship(id, name)
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

async function listBedrockAgents(conn, region) {
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
  return json?.agentSummaries || json?.agents || [];
}

async function listSageMakerEndpoints(conn, region) {
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
  return json?.Endpoints || [];
}

async function listAiLambdaFunctions(conn, region) {
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
  const functions = json?.Functions || [];
  return functions.filter((fn) =>
    isAiRelevantText(
      fn.FunctionName,
      fn.Description,
      fn.Runtime,
      fn.Role,
      fn.PackageType,
      Object.keys(fn.Environment?.Variables || {}).join(" "),
      Object.values(fn.Environment?.Variables || {}).join(" ")
    )
  );
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
      relationships: cloudRelationship(`aws-account-${creds.accountId}`, `AWS account ${creds.accountId}`)
    }
  ];

  const [agents, endpoints, lambdas] = await Promise.all([
    listBedrockAgents(conn, creds.region).catch(() => []),
    listSageMakerEndpoints(conn, creds.region).catch(() => []),
    listAiLambdaFunctions(conn, creds.region).catch(() => [])
  ]);

  for (const agent of agents) {
    const id = agent.agentArn || `arn:aws:bedrock-agent:${creds.region}:${creds.accountId}:agent/${agent.agentId || agent.agentName}`;
    observations.push(
      awsObservation({
        conn,
        id,
        name: agent.agentName || agent.agentId || "Bedrock Agent",
        awsType: "BedrockAgent",
        service: "bedrock-agent",
        region: creds.region,
        aiRelevant: true,
        status: agent.agentStatus,
        model: agent.foundationModel || "bedrock-agent",
        extra: { agentId: agent.agentId, updatedAt: agent.updatedAt || null }
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

  const selected = observations.slice(0, AWS_MAX_RESOURCES + 1);
  return {
    observations: selected,
    stats: {
      totalResourcesScanned: agents.length + endpoints.length + lambdas.length,
      aiRelevantResources: agents.length + endpoints.length + lambdas.length,
      cloudResourcesIngested: Math.max(0, selected.length - 1)
    }
  };
}
