/**
 * AWS deep discovery: Bedrock GetAgent, SageMaker DescribeEndpoint,
 * Lambda GetFunctionConfiguration.
 *
 * Uses signed AWS REST via the shared `awsJson` helper from awsCloud.js
 * (injected to avoid circular imports). Read-only only.
 *
 * Hard rules:
 * - GetAgent lifecycle ≠ continuous agent runtime
 * - SageMaker InService ≠ AI agent running
 * - Lambda State / env names ≠ confirmed agent
 * - Never return environment variable values — names only
 */

import { sanitizeCloudError, safeEnvNames, normalizeRuntimeStatus } from "./cloudDiscoveryCommon.js";

const DEEP_AGENT_LIMIT = Number(process.env.AWS_DISCOVERY_DEEP_MAX_AGENTS || 40);
const DEEP_ENDPOINT_LIMIT = Number(process.env.AWS_DISCOVERY_DEEP_MAX_ENDPOINTS || 40);
const DEEP_LAMBDA_LIMIT = Number(process.env.AWS_DISCOVERY_DEEP_MAX_LAMBDAS || 40);

/** Local copies — avoid circular import with awsCloud.js. */
export function mapBedrockAgentLifecycleDeep(agentStatus) {
  const raw = String(agentStatus || "");
  if (/^FAILED$/i.test(raw)) {
    return { deploymentStatus: raw, runtimeStatus: "failed", reason: null };
  }
  if (/^(PREPARED|NOT_PREPARED|CREATING|PREPARING|UPDATING|VERSIONING|DELETING)$/i.test(raw)) {
    return {
      deploymentStatus: raw || null,
      runtimeStatus: "unknown",
      reason: "Bedrock agents are request-driven; agentStatus is lifecycle/deployment, not continuous runtime"
    };
  }
  return {
    deploymentStatus: raw || null,
    runtimeStatus: "unknown",
    reason: "Bedrock agent runtime not exposed as continuous execution state"
  };
}

export function mapSageMakerEndpointStatusDeep(status) {
  const raw = String(status || "");
  if (/^InService$/i.test(raw)) return "running";
  if (/^OutOfService$/i.test(raw) || /^Deleting$/i.test(raw)) return "stopped";
  if (/^Failed$/i.test(raw)) return "failed";
  return "unknown";
}

/**
 * Bedrock Agents GetAgent — official detail API.
 * GET https://bedrock-agent.{region}.amazonaws.com/agents/{agentId}/
 */
export async function getBedrockAgent(awsJson, conn, region, agentId, discoveryErrors = []) {
  if (!agentId) return null;
  try {
    const json = await awsJson(
      {
        conn,
        service: "bedrock",
        hostname: `bedrock-agent.${region}.amazonaws.com`,
        path: `/agents/${encodeURIComponent(agentId)}/`,
        method: "GET"
      },
      true
    );
    if (json?.__error) {
      discoveryErrors.push({
        resourceId: agentId,
        discoveryType: "bedrock-get-agent",
        discoveryStatus: json.permissionDenied ? "permission_denied" : "error",
        error: json.message
      });
      return null;
    }
    return json?.agent || json || null;
  } catch (err) {
    discoveryErrors.push({
      resourceId: agentId,
      discoveryType: "bedrock-get-agent",
      discoveryStatus: err.permissionDenied ? "permission_denied" : "error",
      error: sanitizeCloudError(err)
    });
    return null;
  }
}

/**
 * SageMaker DescribeEndpoint — refine endpoint runtime metadata.
 * POST X-Amz-Target: SageMaker.DescribeEndpoint
 */
export async function describeSageMakerEndpoint(
  awsJson,
  conn,
  region,
  endpointName,
  discoveryErrors = []
) {
  if (!endpointName) return null;
  try {
    const json = await awsJson(
      {
        conn,
        service: "sagemaker",
        hostname: `api.sagemaker.${region}.amazonaws.com`,
        method: "POST",
        path: "/",
        headers: {
          "Content-Type": "application/x-amz-json-1.1",
          "X-Amz-Target": "SageMaker.DescribeEndpoint"
        },
        body: JSON.stringify({ EndpointName: endpointName })
      },
      true
    );
    if (json?.__error) {
      discoveryErrors.push({
        resourceId: endpointName,
        discoveryType: "sagemaker-describe-endpoint",
        discoveryStatus: json.permissionDenied ? "permission_denied" : "error",
        error: json.message
      });
      return null;
    }
    return json || null;
  } catch (err) {
    discoveryErrors.push({
      resourceId: endpointName,
      discoveryType: "sagemaker-describe-endpoint",
      discoveryStatus: err.permissionDenied ? "permission_denied" : "error",
      error: sanitizeCloudError(err)
    });
    return null;
  }
}

/**
 * Lambda GetFunctionConfiguration — compute runtime + env names only.
 * GET /2015-03-31/functions/{name}/configuration
 */
export async function getLambdaFunctionConfiguration(
  awsJson,
  conn,
  region,
  functionName,
  discoveryErrors = []
) {
  if (!functionName) return null;
  try {
    const json = await awsJson(
      {
        conn,
        service: "lambda",
        hostname: `lambda.${region}.amazonaws.com`,
        path: `/2015-03-31/functions/${encodeURIComponent(functionName)}/configuration`,
        method: "GET"
      },
      true
    );
    if (json?.__error) {
      discoveryErrors.push({
        resourceId: functionName,
        discoveryType: "lambda-get-configuration",
        discoveryStatus: json.permissionDenied ? "permission_denied" : "error",
        error: json.message
      });
      return null;
    }
    return json || null;
  } catch (err) {
    discoveryErrors.push({
      resourceId: functionName,
      discoveryType: "lambda-get-configuration",
      discoveryStatus: err.permissionDenied ? "permission_denied" : "error",
      error: sanitizeCloudError(err)
    });
    return null;
  }
}

/** Safe summary from GetAgent — no secrets. */
export function summarizeBedrockAgentDetail(detail) {
  if (!detail || typeof detail !== "object") return null;
  const lifecycle = mapBedrockAgentLifecycleDeep(detail.agentStatus);
  const instruction = String(detail.instruction || "").slice(0, 240);
  return {
    deepScan: "bedrock_get_agent",
    foundationModel: detail.foundationModel || null,
    agentStatus: detail.agentStatus || null,
    idleSessionTTLInSeconds: detail.idleSessionTTLInSeconds ?? null,
    agentResourceRoleArn: detail.agentResourceRoleArn || null,
    preparedAt: detail.preparedAt || null,
    updatedAt: detail.updatedAt || null,
    description: detail.description ? String(detail.description).slice(0, 200) : null,
    instructionPreview: instruction || null,
    customerEncryptionKeyArn: detail.customerEncryptionKeyArn ? "[present]" : null,
    deploymentStatus: lifecycle.deploymentStatus,
    agentRuntimeStatus: lifecycle.runtimeStatus,
    runtimeStatusReason: lifecycle.reason
  };
}

/** Safe summary from DescribeEndpoint. */
export function summarizeSageMakerEndpointDetail(detail) {
  if (!detail || typeof detail !== "object") return null;
  const variants = Array.isArray(detail.ProductionVariants)
    ? detail.ProductionVariants.slice(0, 8).map((v) => ({
        variantName: v.VariantName || null,
        currentInstanceCount: v.CurrentInstanceCount ?? null,
        currentWeight: v.CurrentWeight ?? null
      }))
    : [];
  return {
    deepScan: "sagemaker_describe_endpoint",
    endpointStatus: detail.EndpointStatus || null,
    endpointConfigName: detail.EndpointConfigName || null,
    failureReason: detail.FailureReason ? String(detail.FailureReason).slice(0, 240) : null,
    lastModifiedTime: detail.LastModifiedTime || null,
    creationTime: detail.CreationTime || null,
    productionVariants: variants,
    runtimeStatus: mapSageMakerEndpointStatusDeep(detail.EndpointStatus)
  };
}

/** Safe summary from GetFunctionConfiguration — env names only. */
export function summarizeLambdaConfiguration(detail) {
  if (!detail || typeof detail !== "object") return null;
  const envNames = safeEnvNames(detail.Environment?.Variables || {});
  return {
    deepScan: "lambda_get_configuration",
    runtime: detail.Runtime || null,
    handler: detail.Handler || null,
    state: detail.State || null,
    lastUpdateStatus: detail.LastUpdateStatus || null,
    packageType: detail.PackageType || null,
    architectures: detail.Architectures || null,
    timeout: detail.Timeout ?? null,
    memorySize: detail.MemorySize ?? null,
    lastModified: detail.LastModified || null,
    role: detail.Role || null,
    envNames,
    runtimeStatus: normalizeRuntimeStatus(detail.State || "Active")
  };
}

/**
 * Enrich listed AWS observations with deep API details.
 * Failures are recorded; scan continues.
 */
export async function enrichAwsWithDeepScan({
  awsJson,
  conn,
  region,
  observations,
  discoveryErrors = [],
  enabled = true
}) {
  if (!enabled || !Array.isArray(observations)) {
    return { deepScanned: 0, discoveryErrors };
  }

  let deepScanned = 0;

  const agents = observations.filter(
    (o) => o.metadata?.awsType === "BedrockAgent" && o.metadata?.agentId
  );
  for (const obs of agents.slice(0, DEEP_AGENT_LIMIT)) {
    const detail = await getBedrockAgent(awsJson, conn, region, obs.metadata.agentId, discoveryErrors);
    const summary = summarizeBedrockAgentDetail(detail);
    if (!summary) continue;
    deepScanned += 1;
    obs.metadata = {
      ...obs.metadata,
      deepScan: summary.deepScan,
      foundationModel: summary.foundationModel || obs.model,
      deep: summary
    };
    if (summary.foundationModel) obs.model = summary.foundationModel;
    // Keep agent confirmed; runtime stays unknown (request-driven).
    if (obs.agent) {
      obs.agent.deploymentStatus = summary.deploymentStatus || obs.agent.deploymentStatus;
      obs.agent.runtimeStatus = summary.agentRuntimeStatus || "unknown";
      obs.agent.lastSeenAt = summary.updatedAt || obs.agent.lastSeenAt;
    }
    if (summary.runtimeStatusReason) {
      obs.metadata.runtimeStatusReason = summary.runtimeStatusReason;
      obs.metadata.evidence = [
        ...(obs.metadata.evidence || []),
        "Deep scan: Bedrock GetAgent (lifecycle only; not continuous runtime)"
      ];
    }
  }

  const endpoints = observations.filter(
    (o) => o.metadata?.awsType === "SageMakerEndpoint"
  );
  for (const obs of endpoints.slice(0, DEEP_ENDPOINT_LIMIT)) {
    const name = obs.name?.replace(/\s*\(AI\)\s*$/, "") || obs.runtime?.runtimeName;
    const detail = await describeSageMakerEndpoint(awsJson, conn, region, name, discoveryErrors);
    const summary = summarizeSageMakerEndpointDetail(detail);
    if (!summary) continue;
    deepScanned += 1;
    obs.metadata = {
      ...obs.metadata,
      deepScan: summary.deepScan,
      endpointStatus: summary.endpointStatus,
      endpointConfigName: summary.endpointConfigName,
      deep: summary
    };
    if (obs.runtime?.detected) {
      obs.runtime.status = summary.runtimeStatus;
      obs.running_status = summary.runtimeStatus;
      obs.metadata.runtimeStatus = summary.runtimeStatus;
    }
    obs.metadata.evidence = [
      ...(obs.metadata.evidence || []),
      "Deep scan: SageMaker DescribeEndpoint (model serving ≠ agent)"
    ];
  }

  const lambdas = observations.filter((o) => o.metadata?.awsType === "LambdaFunction");
  for (const obs of lambdas.slice(0, DEEP_LAMBDA_LIMIT)) {
    const name = obs.agent?.agentName || obs.name?.replace(/\s*\(AI\)\s*$/, "");
    const detail = await getLambdaFunctionConfiguration(
      awsJson,
      conn,
      region,
      name,
      discoveryErrors
    );
    const summary = summarizeLambdaConfiguration(detail);
    if (!summary) continue;
    deepScanned += 1;
    // Never stash env values — only names from summarizeLambdaConfiguration
    obs.metadata = {
      ...obs.metadata,
      deepScan: summary.deepScan,
      envNames: summary.envNames,
      runtime: summary.runtime,
      deep: {
        ...summary
        // Environment.Variables intentionally omitted
      }
    };
    if (obs.runtime?.detected) {
      obs.runtime.status = summary.runtimeStatus;
      obs.running_status = summary.runtimeStatus;
      obs.metadata.runtimeStatus = summary.runtimeStatus;
    }
    // Stay candidate — deep config does not confirm agent identity
    if (obs.agent?.detected) {
      obs.agent.agentStatus = "candidate";
      obs.agent.runtimeStatus = "unknown";
      obs.metadata.agentStatus = "candidate";
    }
    obs.metadata.evidence = [
      ...(obs.metadata.evidence || []),
      "Deep scan: Lambda GetFunctionConfiguration (env names only; still heuristic candidate)"
    ];
    // Ensure no secret values leaked from raw detail
    if (obs.metadata.deep?.Environment) delete obs.metadata.deep.Environment;
  }

  return { deepScanned, discoveryErrors };
}
