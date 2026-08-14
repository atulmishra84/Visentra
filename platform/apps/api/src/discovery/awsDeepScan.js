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
import {
  attachAdversarialSurface,
  toolsFromBedrockActionGroup,
  buildInstructionsFromText
} from "./adversarialInventory.js";

const DEEP_AGENT_LIMIT = Number(process.env.AWS_DISCOVERY_DEEP_MAX_AGENTS || 40);
const DEEP_ENDPOINT_LIMIT = Number(process.env.AWS_DISCOVERY_DEEP_MAX_ENDPOINTS || 40);
const DEEP_LAMBDA_LIMIT = Number(process.env.AWS_DISCOVERY_DEEP_MAX_LAMBDAS || 40);
const DEEP_ACTION_GROUP_LIMIT = Number(process.env.AWS_DISCOVERY_DEEP_MAX_ACTION_GROUPS || 15);

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
  const instruction = String(detail.instruction || "");
  return {
    deepScan: "bedrock_get_agent",
    foundationModel: detail.foundationModel || null,
    agentStatus: detail.agentStatus || null,
    idleSessionTTLInSeconds: detail.idleSessionTTLInSeconds ?? null,
    agentResourceRoleArn: detail.agentResourceRoleArn || null,
    preparedAt: detail.preparedAt || null,
    updatedAt: detail.updatedAt || null,
    description: detail.description ? String(detail.description).slice(0, 200) : null,
    instructionPreview: instruction ? instruction.slice(0, 240) : null,
    instructionFull: instruction || null,
    agentVersion: detail.agentVersion || detail.latestAgentVersion || "DRAFT",
    guardrailConfiguration: detail.guardrailConfiguration || null,
    customerEncryptionKeyArn: detail.customerEncryptionKeyArn ? "[present]" : null,
    deploymentStatus: lifecycle.deploymentStatus,
    agentRuntimeStatus: lifecycle.runtimeStatus,
    runtimeStatusReason: lifecycle.reason
  };
}

/**
 * List action groups for an agent version (POST).
 * POST /agents/{id}/agentversions/{ver}/actiongroups/
 */
export async function listBedrockAgentActionGroups(
  awsJson,
  conn,
  region,
  agentId,
  agentVersion = "DRAFT",
  discoveryErrors = []
) {
  if (!agentId) return [];
  const version = agentVersion || "DRAFT";
  try {
    const json = await awsJson(
      {
        conn,
        service: "bedrock",
        hostname: `bedrock-agent.${region}.amazonaws.com`,
        method: "POST",
        path: `/agents/${encodeURIComponent(agentId)}/agentversions/${encodeURIComponent(version)}/actiongroups/`,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ maxResults: 50 })
      },
      true
    );
    if (json?.__error) {
      discoveryErrors.push({
        resourceId: agentId,
        discoveryType: "bedrock-list-action-groups",
        discoveryStatus: json.permissionDenied ? "permission_denied" : "error",
        error: json.message
      });
      return [];
    }
    return json?.actionGroupSummaries || [];
  } catch (err) {
    discoveryErrors.push({
      resourceId: agentId,
      discoveryType: "bedrock-list-action-groups",
      discoveryStatus: err.permissionDenied ? "permission_denied" : "error",
      error: sanitizeCloudError(err)
    });
    return [];
  }
}

/**
 * GetAgentActionGroup — includes functionSchema / apiSchema for tool parameters.
 * GET /agents/{id}/agentversions/{ver}/actiongroups/{actionGroupId}/
 */
export async function getBedrockAgentActionGroup(
  awsJson,
  conn,
  region,
  agentId,
  agentVersion,
  actionGroupId,
  discoveryErrors = []
) {
  if (!agentId || !actionGroupId) return null;
  const version = agentVersion || "DRAFT";
  try {
    const json = await awsJson(
      {
        conn,
        service: "bedrock",
        hostname: `bedrock-agent.${region}.amazonaws.com`,
        method: "GET",
        path: `/agents/${encodeURIComponent(agentId)}/agentversions/${encodeURIComponent(version)}/actiongroups/${encodeURIComponent(actionGroupId)}/`
      },
      true
    );
    if (json?.__error) {
      discoveryErrors.push({
        resourceId: `${agentId}:${actionGroupId}`,
        discoveryType: "bedrock-get-action-group",
        discoveryStatus: json.permissionDenied ? "permission_denied" : "error",
        error: json.message
      });
      return null;
    }
    return json?.agentActionGroup || json || null;
  } catch (err) {
    discoveryErrors.push({
      resourceId: `${agentId}:${actionGroupId}`,
      discoveryType: "bedrock-get-action-group",
      discoveryStatus: err.permissionDenied ? "permission_denied" : "error",
      error: sanitizeCloudError(err)
    });
    return null;
  }
}

/**
 * List knowledge bases associated with an agent version.
 * POST /agents/{id}/agentversions/{ver}/knowledgebases/
 */
export async function listBedrockAgentKnowledgeBases(
  awsJson,
  conn,
  region,
  agentId,
  agentVersion = "DRAFT",
  discoveryErrors = []
) {
  if (!agentId) return [];
  const version = agentVersion || "DRAFT";
  try {
    const json = await awsJson(
      {
        conn,
        service: "bedrock",
        hostname: `bedrock-agent.${region}.amazonaws.com`,
        method: "POST",
        path: `/agents/${encodeURIComponent(agentId)}/agentversions/${encodeURIComponent(version)}/knowledgebases/`,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ maxResults: 50 })
      },
      true
    );
    if (json?.__error) {
      discoveryErrors.push({
        resourceId: agentId,
        discoveryType: "bedrock-list-agent-knowledge-bases",
        discoveryStatus: json.permissionDenied ? "permission_denied" : "error",
        error: json.message
      });
      return [];
    }
    return json?.agentKnowledgeBaseSummaries || json?.knowledgeBaseSummaries || [];
  } catch (err) {
    discoveryErrors.push({
      resourceId: agentId,
      discoveryType: "bedrock-list-agent-knowledge-bases",
      discoveryStatus: err.permissionDenied ? "permission_denied" : "error",
      error: sanitizeCloudError(err)
    });
    return [];
  }
}

/**
 * Collect tools + KB associations for a Bedrock agent (best-effort).
 */
export async function collectBedrockAgentAttackSurface(
  awsJson,
  conn,
  region,
  agentId,
  agentVersion,
  discoveryErrors = []
) {
  const version = agentVersion || "DRAFT";
  const summaries = await listBedrockAgentActionGroups(
    awsJson,
    conn,
    region,
    agentId,
    version,
    discoveryErrors
  );
  const tools = [];
  for (const summary of summaries.slice(0, DEEP_ACTION_GROUP_LIMIT)) {
    const detail = await getBedrockAgentActionGroup(
      awsJson,
      conn,
      region,
      agentId,
      version,
      summary.actionGroupId,
      discoveryErrors
    );
    if (detail) tools.push(...toolsFromBedrockActionGroup(detail));
    else {
      tools.push(
        ...toolsFromBedrockActionGroup({
          actionGroupId: summary.actionGroupId,
          actionGroupName: summary.actionGroupName,
          description: summary.description,
          actionGroupState: summary.actionGroupState
        })
      );
    }
  }
  const knowledgeBases = await listBedrockAgentKnowledgeBases(
    awsJson,
    conn,
    region,
    agentId,
    version,
    discoveryErrors
  );
  return { tools, knowledgeBases, actionGroupCount: summaries.length };
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
    if (!summary) {
      // Still attach sparse adversarial surface
      Object.assign(obs, attachAdversarialSurface(obs));
      continue;
    }
    deepScanned += 1;
    const agentVersion =
      summary.agentVersion || obs.metadata.latestAgentVersion || obs.metadata.aliases?.[0] || "DRAFT";
    const attack = await collectBedrockAgentAttackSurface(
      awsJson,
      conn,
      region,
      obs.metadata.agentId,
      agentVersion,
      discoveryErrors
    );

    // Strip full instruction from persisted deep blob — keep preview/hash via adversarial surface
    const { instructionFull, ...deepSafe } = summary;
    obs.metadata = {
      ...obs.metadata,
      deepScan: summary.deepScan,
      foundationModel: summary.foundationModel || obs.model,
      deep: deepSafe,
      agentKnowledgeBases: attack.knowledgeBases,
      actionGroupCount: attack.actionGroupCount
    };
    if (summary.foundationModel) obs.model = summary.foundationModel;
    if (obs.agent) {
      obs.agent.deploymentStatus = summary.deploymentStatus || obs.agent.deploymentStatus;
      obs.agent.runtimeStatus = summary.agentRuntimeStatus || "unknown";
      obs.agent.lastSeenAt = summary.updatedAt || obs.agent.lastSeenAt;
    }
    obs.metadata.evidence = [
      ...(obs.metadata.evidence || []),
      "Deep scan: Bedrock GetAgent (lifecycle only; not continuous runtime)",
      attack.tools.length
        ? `Deep scan: ${attack.tools.length} tool(s) from action groups`
        : "Deep scan: no action-group tools expanded",
      attack.knowledgeBases.length
        ? `Deep scan: ${attack.knowledgeBases.length} associated knowledge base(s)`
        : "Deep scan: no agent-associated knowledge bases"
    ];

    Object.assign(
      obs,
      attachAdversarialSurface(obs, {
        tools: attack.tools,
        knowledgeBases: attack.knowledgeBases,
        instructionText: instructionFull || null,
        roleArn: summary.agentResourceRoleArn,
        guardrailConfiguration: summary.guardrailConfiguration,
        evidence: ["Adversarial surface built from Bedrock deep scan"]
      })
    );
  }

  const endpoints = observations.filter(
    (o) => o.metadata?.awsType === "SageMakerEndpoint"
  );
  for (const obs of endpoints.slice(0, DEEP_ENDPOINT_LIMIT)) {
    const name = obs.name?.replace(/\s*\(AI\)\s*$/, "") || obs.runtime?.runtimeName;
    const detail = await describeSageMakerEndpoint(awsJson, conn, region, name, discoveryErrors);
    const summary = summarizeSageMakerEndpointDetail(detail);
    if (!summary) {
      Object.assign(obs, attachAdversarialSurface(obs));
      continue;
    }
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
    Object.assign(obs, attachAdversarialSurface(obs));
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
    if (!summary) {
      Object.assign(obs, attachAdversarialSurface(obs));
      continue;
    }
    deepScanned += 1;
    obs.metadata = {
      ...obs.metadata,
      deepScan: summary.deepScan,
      envNames: summary.envNames,
      runtime: summary.runtime,
      deep: { ...summary }
    };
    if (obs.runtime?.detected) {
      obs.runtime.status = summary.runtimeStatus;
      obs.running_status = summary.runtimeStatus;
      obs.metadata.runtimeStatus = summary.runtimeStatus;
    }
    if (obs.agent?.detected) {
      obs.agent.agentStatus = "candidate";
      obs.agent.runtimeStatus = "unknown";
      obs.metadata.agentStatus = "candidate";
    }
    obs.metadata.evidence = [
      ...(obs.metadata.evidence || []),
      "Deep scan: Lambda GetFunctionConfiguration (env names only; still heuristic candidate)"
    ];
    if (obs.metadata.deep?.Environment) delete obs.metadata.deep.Environment;
    Object.assign(
      obs,
      attachAdversarialSurface(obs, {
        roleArn: summary.role,
        codeExecution: /python|node|java|provided/.test(String(summary.runtime || "")) ? null : null,
        evidence: ["Lambda adversarial surface from configuration (candidate runtime)"]
      })
    );
  }

  // Ensure every observation has adversarial_surface (KB / ECS / unscanned rows)
  for (const obs of observations) {
    if (!obs.metadata?.adversarial_surface) {
      Object.assign(obs, attachAdversarialSurface(obs));
    }
  }

  return { deepScanned, discoveryErrors };
}
