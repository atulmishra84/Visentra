/**
 * AI agent evidence model — how Visentra classifies discoveries.
 *
 * Evidence classes (strong → weak):
 *   platform_agent   — registered SaaS/platform agents (Copilot, Agentforce, …)
 *   cloud_ai_runtime — cloud AI/agent runtimes (Bedrock Agents, OpenAI, bots, …)
 *   ide_agent        — IDE / coding agents with MCP or AI config evidence
 *   process_agent    — live process / EDR process evidence
 *   repo_candidate   — repo/CI/identity signals (candidates until runtime confirms)
 *
 * agentStatus:
 *   confirmed — platform ID, strong cloud type, MCP, or process evidence
 *   candidate — name/tag/heuristic only; needs correlation
 */

import { enrichObservationWithDepth } from "../services/agentDepth.js";

export const EVIDENCE_CLASSES = [
  "platform_agent",
  "cloud_ai_runtime",
  "ide_agent",
  "process_agent",
  "repo_candidate"
];

export const AGENT_STATUSES = ["confirmed", "candidate"];

const CONFIDENCE = {
  platform_agent_confirmed: 0.94,
  cloud_runtime_confirmed: 0.92,
  ide_confirmed: 0.9,
  process_confirmed: 0.88,
  cloud_runtime_candidate: 0.72,
  ide_candidate: 0.7,
  process_candidate: 0.68,
  repo_candidate: 0.62,
  identity_candidate: 0.6
};

const STRONG_CLOUD_TYPES = /BedrockAgent|SageMakerEndpoint|BotService|CognitiveServices|MachineLearning|OpenAI|Vertex|Foundry/i;
const STRONG_AZURE_TYPES =
  /Microsoft\.(CognitiveServices|MachineLearningServices|BotService|Search)\//i;

/**
 * Derive evidenceClass + agentStatus + confidence from an observation.
 * Preserves collector-provided values when already valid.
 */
export function classifyAgentEvidence(obs = {}) {
  const meta = obs.metadata && typeof obs.metadata === "object" ? { ...obs.metadata } : {};
  const inventoryClass = String(meta.inventoryClass || "");
  const category = String(obs.category || "").toLowerCase();
  const collector = String(obs.collector_id || "");
  const framework = String(obs.framework || "");
  const model = String(obs.model || "");
  const azureType = String(meta.azureType || "");
  const awsType = String(meta.awsType || meta.service || "");
  const gcpType = String(meta.gcpType || meta.service || "");
  const mcpCount = Array.isArray(obs.mcp_connections)
    ? obs.mcp_connections.length
    : Array.isArray(meta.mcpConnections)
      ? meta.mcpConnections.length
      : Number(meta.mcpServerCount || 0);
  const hasProcessEvidence = Boolean(meta.processEvidence) || collector === "process";
  const managedPlatform = meta.managedPlatformAgent === true || inventoryClass === "platform_agent";

  // Never treat connector health / scan rows as agents
  if (
    /^(connector_scan|edr_connector|saas_connector|kubernetes_connector|source_connector|identity_connector)$/.test(
      inventoryClass
    )
  ) {
    return {
      evidenceClass: null,
      agentStatus: null,
      confidence_score: 0,
      ingestible: false,
      reason: "connector_meta"
    };
  }

  let evidenceClass =
    EVIDENCE_CLASSES.includes(meta.evidenceClass) ? meta.evidenceClass : null;
  let agentStatus = AGENT_STATUSES.includes(meta.agentStatus) ? meta.agentStatus : null;
  let confidence = Number(obs.confidence_score);
  if (!Number.isFinite(confidence)) confidence = null;

  // --- classify ---
  if (!evidenceClass) {
    if (managedPlatform || category === "saas" || collector === "saas_platform") {
      evidenceClass = "platform_agent";
    } else if (
      inventoryClass === "ide_ai_agent" ||
      inventoryClass === "mcp_server" ||
      category === "ide" ||
      category === "mcp" ||
      collector === "ide_filesystem" ||
      collector === "mcp"
    ) {
      evidenceClass = "ide_agent";
    } else if (
      inventoryClass === "process_ai_agent" ||
      inventoryClass === "endpoint_ai_agent" ||
      category === "local_llm" ||
      category === "framework" ||
      category === "local" ||
      collector === "process" ||
      collector === "edr"
    ) {
      evidenceClass = "process_agent";
    } else if (
      inventoryClass === "source_repository" ||
      inventoryClass === "identity_application" ||
      inventoryClass === "ci_ai_job" ||
      category === "repository" ||
      category === "ci" ||
      collector === "git_sources" ||
      collector === "identity_entra" ||
      collector === "ci_platform"
    ) {
      evidenceClass = "repo_candidate";
    } else if (
      inventoryClass === "ai_cloud_resource" ||
      inventoryClass === "kubernetes_workload" ||
      category === "cloud" ||
      category === "container" ||
      collector.startsWith("cloud_") ||
      collector === "k8s_api"
    ) {
      evidenceClass = "cloud_ai_runtime";
    }
  }

  if (!evidenceClass) {
    return {
      evidenceClass: null,
      agentStatus: null,
      confidence_score: confidence ?? 0.5,
      ingestible: false,
      reason: "no_evidence_class"
    };
  }

  // --- status ---
  if (!agentStatus) {
    if (evidenceClass === "platform_agent") {
      agentStatus = "confirmed";
    } else if (evidenceClass === "cloud_ai_runtime") {
      const strong =
        STRONG_CLOUD_TYPES.test(awsType) ||
        STRONG_CLOUD_TYPES.test(gcpType) ||
        STRONG_CLOUD_TYPES.test(framework) ||
        STRONG_AZURE_TYPES.test(azureType) ||
        /bedrock-agent|sagemaker|openai|bot/i.test(model) ||
        meta.managedCloudAgent === true;
      agentStatus = strong ? "confirmed" : "candidate";
    } else if (evidenceClass === "ide_agent") {
      agentStatus = mcpCount > 0 || inventoryClass === "mcp_server" ? "confirmed" : "candidate";
    } else if (evidenceClass === "process_agent") {
      agentStatus = hasProcessEvidence || collector === "process" ? "confirmed" : "candidate";
    } else {
      agentStatus = "candidate";
    }
  }

  // --- confidence floor by evidence ---
  const floor =
    evidenceClass === "platform_agent"
      ? CONFIDENCE.platform_agent_confirmed
      : evidenceClass === "cloud_ai_runtime"
        ? agentStatus === "confirmed"
          ? CONFIDENCE.cloud_runtime_confirmed
          : CONFIDENCE.cloud_runtime_candidate
        : evidenceClass === "ide_agent"
          ? agentStatus === "confirmed"
            ? CONFIDENCE.ide_confirmed
            : CONFIDENCE.ide_candidate
          : evidenceClass === "process_agent"
            ? agentStatus === "confirmed"
              ? CONFIDENCE.process_confirmed
              : CONFIDENCE.process_candidate
            : inventoryClass === "identity_application"
              ? CONFIDENCE.identity_candidate
              : CONFIDENCE.repo_candidate;

  const confidence_score = Math.max(confidence ?? 0, floor);

  return {
    evidenceClass,
    agentStatus,
    confidence_score,
    ingestible: true,
    reason: `${evidenceClass}:${agentStatus}`
  };
}

/**
 * Attach evidence metadata + normalized confidence onto an observation.
 */
export function enrichObservationWithEvidence(obs) {
  const classified = classifyAgentEvidence(obs);
  if (!classified.ingestible) {
    return { ...obs, __skipIngest: true, __skipReason: classified.reason };
  }

  const metadata = {
    ...(obs.metadata || {}),
    evidenceClass: classified.evidenceClass,
    agentStatus: classified.agentStatus,
    // Keep inventoryClass for backward compatibility / purge rules
    inventoryClass: (obs.metadata || {}).inventoryClass || classified.evidenceClass,
    aiRelevant: true,
    evidenceReason: classified.reason
  };

  const withEvidence = {
    ...obs,
    confidence_score: classified.confidence_score,
    metadata,
    __skipIngest: false
  };

  return enrichObservationWithDepth(withEvidence);
}

export function isIngestibleAgentObservation(obs) {
  const classified = classifyAgentEvidence(obs);
  return classified.ingestible;
}
