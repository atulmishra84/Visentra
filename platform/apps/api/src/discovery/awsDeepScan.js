/**
 * AWS deep discovery: Bedrock GetAgent (+ versions, action groups, agent KBs),
 * SageMaker DescribeEndpoint, Lambda GetFunctionConfiguration.
 *
 * Uses signed AWS REST via the shared `awsJson` helper from awsCloud.js
 * (injected to avoid circular imports). Read-only only.
 *
 * Hard rules:
 * - GetAgent lifecycle ≠ continuous agent runtime
 * - SageMaker InService ≠ AI agent running
 * - Lambda State / env names ≠ confirmed agent
 * - Never return environment variable values — names only
 * - Never persist full instruction text in metadata.deep (preview + hash only)
 */

import crypto from "crypto";
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
const DEEP_KB_DETAIL_LIMIT = Number(process.env.AWS_DISCOVERY_DEEP_MAX_KB_DETAILS || 10);

const PHI_NAME_RE =
  /\b(fhir|ehr|hipaa|phi|health|medical|patient|clinical|epic|cerner|claims|diagnosis)\b/i;
const PII_NAME_RE =
  /\b(hr|payroll|employee|customer|contact|pii|personal|crm|salesforce|workday|directory)\b/i;

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
 * List agent versions so deep scan can prefer a PREPARED version over DRAFT.
 * POST /agents/{id}/agentversions/
 */
export async function listBedrockAgentVersions(
  awsJson,
  conn,
  region,
  agentId,
  discoveryErrors = []
) {
  if (!agentId) return [];
  try {
    const json = await awsJson(
      {
        conn,
        service: "bedrock",
        hostname: `bedrock-agent.${region}.amazonaws.com`,
        method: "POST",
        path: `/agents/${encodeURIComponent(agentId)}/agentversions/`,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ maxResults: 20 })
      },
      true
    );
    if (json?.__error) {
      discoveryErrors.push({
        resourceId: agentId,
        discoveryType: "bedrock-list-agent-versions",
        discoveryStatus: json.permissionDenied ? "permission_denied" : "error",
        error: json.message
      });
      return [];
    }
    return json?.agentVersionSummaries || json?.agentVersions || [];
  } catch (err) {
    discoveryErrors.push({
      resourceId: agentId,
      discoveryType: "bedrock-list-agent-versions",
      discoveryStatus: err.permissionDenied ? "permission_denied" : "error",
      error: sanitizeCloudError(err)
    });
    return [];
  }
}

/**
 * Pick best agent version for action-group / KB deep calls.
 * Prefer numeric/prepared version; fall back to DRAFT.
 */
export function pickBedrockAgentVersion(summary, versionSummaries = [], aliases = []) {
  const prepared = (versionSummaries || []).find((v) =>
    /PREPARED/i.test(String(v.agentStatus || v.status || ""))
  );
  if (prepared?.agentVersion) return String(prepared.agentVersion);

  const latest = summary?.latestAgentVersion || summary?.agentVersion;
  if (latest && String(latest).toUpperCase() !== "DRAFT") return String(latest);

  const aliasVer = (aliases || []).find((a) => a && String(a).toUpperCase() !== "DRAFT");
  if (aliasVer) return String(aliasVer);

  return "DRAFT";
}

/**
 * GetKnowledgeBase — enrich association rows with name/status/description.
 * GET /knowledgebases/{knowledgeBaseId}/
 */
export async function getBedrockKnowledgeBase(
  awsJson,
  conn,
  region,
  knowledgeBaseId,
  discoveryErrors = []
) {
  if (!knowledgeBaseId) return null;
  try {
    const json = await awsJson(
      {
        conn,
        service: "bedrock",
        hostname: `bedrock-agent.${region}.amazonaws.com`,
        path: `/knowledgebases/${encodeURIComponent(knowledgeBaseId)}/`,
        method: "GET"
      },
      true
    );
    if (json?.__error) {
      discoveryErrors.push({
        resourceId: knowledgeBaseId,
        discoveryType: "bedrock-get-knowledge-base",
        discoveryStatus: json.permissionDenied ? "permission_denied" : "error",
        error: json.message
      });
      return null;
    }
    return json?.knowledgeBase || json || null;
  } catch (err) {
    discoveryErrors.push({
      resourceId: knowledgeBaseId,
      discoveryType: "bedrock-get-knowledge-base",
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

function summarizeMemoryConfiguration(memory) {
  if (!memory || typeof memory !== "object") return null;
  return {
    enabled: Boolean(memory.enabledMemoryTypes?.length || memory.storageDays != null),
    enabledMemoryTypes: Array.isArray(memory.enabledMemoryTypes)
      ? memory.enabledMemoryTypes.slice(0, 8)
      : [],
    storageDays: memory.storageDays ?? null,
    sessionSummaryConfig: memory.sessionSummaryConfiguration
      ? { present: true }
      : null
  };
}

function summarizePromptOverride(promptOverride) {
  if (!promptOverride || typeof promptOverride !== "object") {
    return { present: false, overrideCount: 0 };
  }
  const configs = promptOverride.promptConfigurations || promptOverride.promptConfiguration || [];
  const list = Array.isArray(configs) ? configs : [];
  return {
    present: list.length > 0,
    overrideCount: list.length,
    promptTypes: list
      .map((c) => c.promptType || c.promptCreationMode || null)
      .filter(Boolean)
      .slice(0, 8)
  };
}

function summarizeGuardrails(guardrailConfiguration) {
  if (!guardrailConfiguration || typeof guardrailConfiguration !== "object") {
    return { present: false, guardrailIdentifier: null, guardrailVersion: null };
  }
  return {
    present: Boolean(
      guardrailConfiguration.guardrailIdentifier || guardrailConfiguration.guardrailId
    ),
    guardrailIdentifier:
      guardrailConfiguration.guardrailIdentifier || guardrailConfiguration.guardrailId || null,
    guardrailVersion: guardrailConfiguration.guardrailVersion || null
  };
}

/** Safe summary from GetAgent — no secrets; instructionFull is stripped before persist. */
export function summarizeBedrockAgentDetail(detail) {
  if (!detail || typeof detail !== "object") return null;
  const lifecycle = mapBedrockAgentLifecycleDeep(detail.agentStatus);
  const instruction = String(detail.instruction || "");
  const instructionHash = instruction
    ? crypto.createHash("sha256").update(instruction).digest("hex").slice(0, 16)
    : null;

  return {
    deepScan: "bedrock_get_agent",
    schemaVersion: "aws-deep.v2",
    agentId: detail.agentId || null,
    agentName: detail.agentName || null,
    agentArn: detail.agentArn || null,
    foundationModel: detail.foundationModel || null,
    agentStatus: detail.agentStatus || null,
    idleSessionTTLInSeconds: detail.idleSessionTTLInSeconds ?? null,
    agentResourceRoleArn: detail.agentResourceRoleArn || null,
    createdAt: detail.createdAt || null,
    preparedAt: detail.preparedAt || null,
    updatedAt: detail.updatedAt || null,
    description: detail.description ? String(detail.description).slice(0, 400) : null,
    instructionPreview: instruction ? instruction.slice(0, 240) : null,
    instructionLength: instruction ? instruction.length : 0,
    instructionHash,
    instructionFull: instruction || null,
    agentVersion: detail.agentVersion || detail.latestAgentVersion || "DRAFT",
    latestAgentVersion: detail.latestAgentVersion || detail.agentVersion || null,
    guardrailConfiguration: detail.guardrailConfiguration || null,
    guardrails: summarizeGuardrails(detail.guardrailConfiguration),
    customerEncryptionKeyArn: detail.customerEncryptionKeyArn ? "[present]" : null,
    memoryConfiguration: summarizeMemoryConfiguration(detail.memoryConfiguration),
    promptOverride: summarizePromptOverride(detail.promptOverrideConfiguration),
    agentCollaboration: detail.agentCollaboration || null,
    failureReasons: Array.isArray(detail.failureReasons)
      ? detail.failureReasons.slice(0, 5).map((r) => String(r).slice(0, 200))
      : [],
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

/** Normalize KB association (+ optional GetKnowledgeBase detail). */
export function normalizeAgentKnowledgeBase(raw = {}, detail = null) {
  const id = raw.knowledgeBaseId || detail?.knowledgeBaseId || raw.id || null;
  const name = detail?.name || raw.name || raw.knowledgeBaseName || id;
  const state =
    raw.knowledgeBaseState || detail?.status || raw.status || raw.state || null;
  const description = detail?.description
    ? String(detail.description).slice(0, 240)
    : raw.description
      ? String(raw.description).slice(0, 240)
      : null;
  return {
    id,
    knowledgeBaseId: id,
    name,
    state,
    description,
    updatedAt: detail?.updatedAt || raw.updatedAt || null,
    access_level: "read",
    sensitivity: inferNameSensitivity(`${name || ""} ${description || ""}`)
  };
}

export function summarizeActionGroup(summary = {}, detail = null) {
  const src = detail || summary;
  const executor = src.actionGroupExecutor || {};
  return {
    actionGroupId: src.actionGroupId || summary.actionGroupId || null,
    actionGroupName: src.actionGroupName || summary.actionGroupName || null,
    actionGroupState: src.actionGroupState || summary.actionGroupState || null,
    description: src.description ? String(src.description).slice(0, 200) : null,
    parentActionSignature:
      src.parentActionSignature || src.parentActionGroupSignature || null,
    lambdaExecutor: executor.lambda || null,
    hasFunctionSchema: Boolean(src.functionSchema?.functions?.length),
    hasApiSchema: Boolean(src.apiSchema),
    functionCount: Array.isArray(src.functionSchema?.functions)
      ? src.functionSchema.functions.length
      : 0
  };
}

export function inferNameSensitivity(blob = "") {
  const text = String(blob || "");
  if (PHI_NAME_RE.test(text)) return "phi";
  if (PII_NAME_RE.test(text)) return "pii";
  return "unknown";
}

export function seedDataClassHints({ knowledgeBases = [], tools = [], description = "" } = {}) {
  const classes = new Set();
  const evidence = [];
  const corpus = [
    description,
    ...knowledgeBases.map((k) => `${k.name || ""} ${k.description || ""}`),
    ...tools.map((t) => `${t.name || ""} ${t.description || ""}`)
  ].join(" ");

  if (PHI_NAME_RE.test(corpus)) {
    classes.add("phi");
    evidence.push({ source: "deep_scan_name", signal: "phi", detail: "Name/description suggests PHI reach" });
  }
  if (PII_NAME_RE.test(corpus)) {
    classes.add("pii");
    evidence.push({ source: "deep_scan_name", signal: "pii", detail: "Name/description suggests PII reach" });
  }
  for (const tool of tools) {
    if (tool?.risk_flags?.can_access_phi) classes.add("phi");
    if (tool?.risk_flags?.can_access_pii) classes.add("pii");
    if (tool?.risk_flags?.can_access_secrets) classes.add("secrets");
  }

  const list = [...classes];
  return {
    dataClasses: list,
    primaryDataClass: list.includes("phi") ? "phi" : list.includes("pii") ? "pii" : list[0] || null,
    evidence
  };
}

/**
 * Collect tools + KB associations + action-group summaries for a Bedrock agent.
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
  const actionGroups = [];
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
    actionGroups.push(summarizeActionGroup(summary, detail));
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

  const kbRaw = await listBedrockAgentKnowledgeBases(
    awsJson,
    conn,
    region,
    agentId,
    version,
    discoveryErrors
  );
  const knowledgeBases = [];
  for (const row of kbRaw) {
    let detail = null;
    if (knowledgeBases.length < DEEP_KB_DETAIL_LIMIT && row.knowledgeBaseId) {
      detail = await getBedrockKnowledgeBase(
        awsJson,
        conn,
        region,
        row.knowledgeBaseId,
        discoveryErrors
      );
    }
    knowledgeBases.push(normalizeAgentKnowledgeBase(row, detail));
  }

  return {
    tools,
    knowledgeBases,
    actionGroups,
    actionGroupCount: summaries.length,
    knowledgeBaseCount: knowledgeBases.length,
    agentVersionUsed: version
  };
}

/**
 * Build persisted metadata.deep profile (SIEM-friendly single blob).
 * Excludes instructionFull.
 */
export function buildBedrockDeepProfile(summary, attack = {}) {
  if (!summary) return null;
  const {
    instructionFull: _drop,
    guardrailConfiguration: _g,
    ...core
  } = summary;

  const instructions = buildInstructionsFromText(instructionFullSafe(summary), "bedrock_get_agent");

  return {
    ...core,
    agentVersionUsed: attack.agentVersionUsed || summary.agentVersion || "DRAFT",
    identity: {
      identity_type: "aws_iam_role",
      arn: summary.agentResourceRoleArn || null,
      name: roleNameFromArn(summary.agentResourceRoleArn)
    },
    instructions: {
      present: Boolean(summary.instructionLength),
      hash: summary.instructionHash,
      length: summary.instructionLength,
      preview: summary.instructionPreview,
      contains_tool_guidance: instructions.contains_tool_guidance,
      contains_safety_rules: instructions.contains_safety_rules
    },
    actionGroups: attack.actionGroups || [],
    actionGroupCount: attack.actionGroupCount ?? (attack.actionGroups || []).length,
    tools: (attack.tools || []).map((t) => ({
      name: t.name,
      description: t.description,
      parameters_schema: t.parameters_schema,
      permissions: t.permissions || [],
      risk_flags: t.risk_flags,
      source: t.source,
      confidence: t.confidence
    })),
    toolCount: (attack.tools || []).length,
    knowledgeBases: attack.knowledgeBases || [],
    knowledgeBaseCount: attack.knowledgeBaseCount ?? (attack.knowledgeBases || []).length
  };
}

function instructionFullSafe(summary) {
  // Prefer full text when still in memory during enrich; else preview
  return summary.instructionFull || summary.instructionPreview || "";
}

function roleNameFromArn(arn) {
  if (!arn) return null;
  const parts = String(arn).split("/");
  return parts[parts.length - 1] || null;
}

/** Safe summary from DescribeEndpoint. */
export function summarizeSageMakerEndpointDetail(detail) {
  if (!detail || typeof detail !== "object") return null;
  const variants = Array.isArray(detail.ProductionVariants)
    ? detail.ProductionVariants.slice(0, 8).map((v) => ({
        variantName: v.VariantName || null,
        currentInstanceCount: v.CurrentInstanceCount ?? null,
        currentWeight: v.CurrentWeight ?? null,
        currentServerlessConfig: v.CurrentServerlessConfig
          ? {
              memorySizeInMB: v.CurrentServerlessConfig.MemorySizeInMB ?? null,
              maxConcurrency: v.CurrentServerlessConfig.MaxConcurrency ?? null
            }
          : null
      }))
    : [];
  return {
    deepScan: "sagemaker_describe_endpoint",
    schemaVersion: "aws-deep.v2",
    endpointName: detail.EndpointName || null,
    endpointArn: detail.EndpointArn || null,
    endpointStatus: detail.EndpointStatus || null,
    endpointConfigName: detail.EndpointConfigName || null,
    failureReason: detail.FailureReason ? String(detail.FailureReason).slice(0, 240) : null,
    lastModifiedTime: detail.LastModifiedTime || null,
    creationTime: detail.CreationTime || null,
    dataCapturePresent: Boolean(detail.DataCaptureConfig),
    asyncInferencePresent: Boolean(detail.AsyncInferenceConfig),
    productionVariants: variants,
    runtimeStatus: mapSageMakerEndpointStatusDeep(detail.EndpointStatus)
  };
}

/** Safe summary from GetFunctionConfiguration — env names only. */
export function summarizeLambdaConfiguration(detail) {
  if (!detail || typeof detail !== "object") return null;
  const envNames = safeEnvNames(detail.Environment?.Variables || {});
  const vpc = detail.VpcConfig || {};
  return {
    deepScan: "lambda_get_configuration",
    schemaVersion: "aws-deep.v2",
    functionName: detail.FunctionName || null,
    functionArn: detail.FunctionArn || null,
    runtime: detail.Runtime || null,
    handler: detail.Handler || null,
    state: detail.State || null,
    lastUpdateStatus: detail.LastUpdateStatus || null,
    packageType: detail.PackageType || null,
    architectures: detail.Architectures || null,
    timeout: detail.Timeout ?? null,
    memorySize: detail.MemorySize ?? null,
    ephemeralStorageMb: detail.EphemeralStorage?.Size ?? null,
    lastModified: detail.LastModified || null,
    role: detail.Role || null,
    layers: Array.isArray(detail.Layers)
      ? detail.Layers.slice(0, 10).map((l) => l.Arn || l).filter(Boolean)
      : [],
    tracingMode: detail.TracingConfig?.Mode || null,
    vpcConfigured: Boolean(vpc.VpcId || (vpc.SubnetIds || []).length),
    envNames,
    envNameCount: envNames.length,
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
    const errorsBefore = discoveryErrors.length;
    const detail = await getBedrockAgent(awsJson, conn, region, obs.metadata.agentId, discoveryErrors);
    const summary = summarizeBedrockAgentDetail(detail);
    if (!summary) {
      const latest = discoveryErrors.slice(errorsBefore).find((e) => e.resourceId === obs.metadata.agentId);
      obs.metadata = {
        ...obs.metadata,
        deepScanStatus: latest?.discoveryStatus || "error",
        deepScanError: latest?.error || "GetAgent returned no detail",
        deepScanSchema: "aws-deep.v2"
      };
      Object.assign(obs, attachAdversarialSurface(obs));
      continue;
    }
    deepScanned += 1;
    obs.metadata = {
      ...obs.metadata,
      deepScanStatus: "ok"
    };

    const versions = await listBedrockAgentVersions(
      awsJson,
      conn,
      region,
      obs.metadata.agentId,
      discoveryErrors
    );
    const agentVersion = pickBedrockAgentVersion(
      summary,
      versions,
      obs.metadata.aliases || []
    );
    const attack = await collectBedrockAgentAttackSurface(
      awsJson,
      conn,
      region,
      obs.metadata.agentId,
      agentVersion,
      discoveryErrors
    );

    const deepProfile = buildBedrockDeepProfile(summary, attack);
    const dataHints = seedDataClassHints({
      knowledgeBases: attack.knowledgeBases,
      tools: attack.tools,
      description: `${summary.description || ""} ${obs.name || ""}`
    });

    obs.metadata = {
      ...obs.metadata,
      deepScan: summary.deepScan,
      deepScanSchema: "aws-deep.v2",
      foundationModel: summary.foundationModel || obs.model,
      deep: deepProfile,
      agentKnowledgeBases: attack.knowledgeBases,
      actionGroups: attack.actionGroups,
      actionGroupCount: attack.actionGroupCount,
      knowledgeBaseCount: attack.knowledgeBaseCount,
      agentVersionUsed: agentVersion,
      knowledgeSources: attack.knowledgeBases.map((k) => k.name || k.id).filter(Boolean),
      ...(dataHints.primaryDataClass
        ? {
            dataClasses: dataHints.dataClasses,
            primaryDataClass: dataHints.primaryDataClass
          }
        : {})
    };
    if (summary.foundationModel) obs.model = summary.foundationModel;
    if (summary.description && !obs.metadata.description) {
      obs.metadata.description = summary.description;
    }
    // Promote tools for inventory column + depth classifier
    obs.tools = (attack.tools || []).map((t) => ({
      name: t.name,
      description: t.description,
      parameters_schema: t.parameters_schema,
      risk_flags: t.risk_flags,
      source: t.source
    }));
    if (obs.agent) {
      obs.agent.deploymentStatus = summary.deploymentStatus || obs.agent.deploymentStatus;
      obs.agent.runtimeStatus = summary.agentRuntimeStatus || "unknown";
      obs.agent.lastSeenAt = summary.updatedAt || obs.agent.lastSeenAt;
      if (summary.agentName) obs.agent.agentName = summary.agentName;
    }
    obs.metadata.evidence = [
      ...(obs.metadata.evidence || []),
      "Deep scan: Bedrock GetAgent (lifecycle only; not continuous runtime)",
      `Deep scan: agent version used=${agentVersion}`,
      attack.tools.length
        ? `Deep scan: ${attack.tools.length} tool(s) from action groups`
        : "Deep scan: no action-group tools expanded",
      attack.knowledgeBases.length
        ? `Deep scan: ${attack.knowledgeBases.length} associated knowledge base(s)`
        : "Deep scan: no agent-associated knowledge bases",
      summary.guardrails?.present ? "Deep scan: guardrails configured" : "Deep scan: no guardrails detected"
    ];

    Object.assign(
      obs,
      attachAdversarialSurface(obs, {
        tools: attack.tools,
        knowledgeBases: attack.knowledgeBases,
        instructionText: summary.instructionFull || null,
        roleArn: summary.agentResourceRoleArn,
        guardrailConfiguration: summary.guardrailConfiguration,
        evidence: ["Adversarial surface built from Bedrock deep scan (aws-deep.v2)"]
      })
    );
  }

  const endpoints = observations.filter((o) => o.metadata?.awsType === "SageMakerEndpoint");
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
      deepScanSchema: "aws-deep.v2",
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
    const dataHints = seedDataClassHints({
      tools: [],
      description: `${name || ""} ${(summary.envNames || []).join(" ")}`
    });
    obs.metadata = {
      ...obs.metadata,
      deepScan: summary.deepScan,
      deepScanSchema: "aws-deep.v2",
      envNames: summary.envNames,
      runtime: summary.runtime,
      deep: { ...summary },
      ...(dataHints.primaryDataClass
        ? { dataClasses: dataHints.dataClasses, primaryDataClass: dataHints.primaryDataClass }
        : {})
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
        evidence: ["Lambda adversarial surface from configuration (candidate runtime)"]
      })
    );
  }

  for (const obs of observations) {
    if (!obs.metadata?.adversarial_surface) {
      Object.assign(obs, attachAdversarialSurface(obs));
    }
  }

  return { deepScanned, discoveryErrors };
}
