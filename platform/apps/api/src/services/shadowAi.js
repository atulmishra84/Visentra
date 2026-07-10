/**
 * Shadow AI identification (visibility only — no enforcement).
 *
 * Shadow AI = AI agents / AI-adjacent tools that appear outside known ownership,
 * sanctioned SaaS, or managed cloud posture. Classification is heuristic and
 * evidence-based for analyst triage.
 */

const CONSUMER_AI_PATTERNS = [
  /chatgpt|openai\.com\/chat|chat\.openai/i,
  /claude\.ai|anthropic\.com\/claude/i,
  /gemini\.google|bard\.google/i,
  /poe\.com|character\.ai|perplexity\.ai/i,
  /copilot\.microsoft\.com|bing\.com\/chat/i,
  /huggingface\.co\/chat/i
];

const SHADOW_RISK_TAGS = new Set([
  "saas_shadow",
  "unmanaged_saas",
  "shadow_ai",
  "unmanaged_ai",
  "consumer_ai",
  "ownerless",
  "personal_ai",
  "unsanctioned_model",
  "local_llm_unmanaged"
]);

const AI_CATEGORIES = new Set([
  "ide",
  "local",
  "local_llm",
  "framework",
  "mcp",
  "browser",
  "autonomous",
  "saas",
  "container"
]);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function textBlob(agent) {
  const meta = agent.metadata || {};
  const metaBits = [
    meta.azureType,
    meta.azureKind,
    meta.connectorName,
    meta.discoveryMode,
    meta.inventoryClass,
    meta.testMessage
  ];
  return [
    agent.name,
    agent.fingerprint,
    agent.category,
    agent.framework,
    agent.model,
    agent.provider,
    agent.cloud_provider,
    agent.ide,
    agent.endpoint,
    ...metaBits,
    ...(Array.isArray(agent.connected_applications) ? agent.connected_applications : []),
    ...(Array.isArray(agent.tools) ? agent.tools : [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isAiAsset(agent) {
  const category = String(agent.category || "").toLowerCase();
  if (AI_CATEGORIES.has(category)) return true;
  if (category === "cloud" && (agent.metadata?.aiRelevant === true || agent.model === "ai-relevant")) return true;
  if (agent.model && agent.model !== "ai-relevant") return true;
  if (agent.framework || agent.ide) return true;
  const blob = textBlob(agent);
  return /\b(llm|agent|copilot|openai|anthropic|ollama|langchain|crewai|mcp|gpt|claude|gemini|foundry)\b/.test(
    blob
  );
}

/**
 * Classify one inventory row / observation into Shadow AI signals.
 * @returns {{ isShadow: boolean, score: number, reasons: string[], tags: string[] }}
 */
export function classifyShadowAi(agent) {
  const reasons = [];
  const tags = [];
  let score = 0;

  if (!isAiAsset(agent)) {
    return { isShadow: false, score: 0, reasons: [], tags: [] };
  }

  const owner = String(agent.owner || "").trim();
  const risks = asArray(agent.risk_indicators).map(String);
  const blob = textBlob(agent);
  const category = String(agent.category || "").toLowerCase();
  const confidence = Number(agent.confidence_score ?? agent.confidence ?? 0.5);
  const meta = agent.metadata || {};

  for (const risk of risks) {
    if (SHADOW_RISK_TAGS.has(risk) || /shadow|unmanaged|unsanctioned/i.test(risk)) {
      score += 0.35;
      tags.push(risk);
      reasons.push(`Risk indicator: ${risk}`);
    }
  }

  if (!owner || /^unknown|n\/?a|none|null$/i.test(owner)) {
    score += 0.3;
    tags.push("ownerless");
    reasons.push("No attributed owner");
  } else if (/@(gmail|yahoo|outlook|hotmail|proton)\./i.test(owner)) {
    score += 0.25;
    tags.push("personal_identity");
    reasons.push("Owner looks like a personal identity");
  }

  if (CONSUMER_AI_PATTERNS.some((re) => re.test(blob))) {
    score += 0.4;
    tags.push("consumer_ai");
    reasons.push("Matches consumer / unsanctioned AI service patterns");
  }

  if (category === "browser") {
    score += 0.25;
    tags.push("browser_ai");
    reasons.push("Browser-based AI assistant / extension");
  }

  if (category === "local_llm" || /ollama|vllm|lmstudio|local.?llm/i.test(blob)) {
    score += 0.3;
    tags.push("local_llm_unmanaged");
    reasons.push("Local LLM runtime (often unmanaged Shadow AI)");
  }

  if (category === "ide" && (!agent.business_unit || !owner)) {
    score += 0.2;
    tags.push("ide_agent_unmanaged");
    reasons.push("IDE coding agent without clear business ownership");
  }

  if (category === "saas" && (risks.includes("unmanaged_saas") || risks.includes("saas_shadow") || !agent.business_unit)) {
    score += 0.2;
    tags.push("saas_shadow");
    reasons.push("SaaS AI without managed business context");
  }

  if (category === "mcp" && !owner) {
    score += 0.2;
    tags.push("mcp_unmanaged");
    reasons.push("MCP server/tooling without owner");
  }

  if (meta.aiRelevant && !owner && category === "cloud") {
    score += 0.25;
    tags.push("cloud_ai_ownerless");
    reasons.push("AI-relevant cloud resource without owner tag");
  }

  if (confidence > 0 && confidence < 0.55 && isAiAsset(agent)) {
    score += 0.15;
    tags.push("low_confidence_ai");
    reasons.push("Low discovery confidence on an AI asset");
  }

  if (meta.discoveryMode === "credentialed-connector-pending-live-adapter") {
    score += 0.1;
    tags.push("unverified_connector_ai");
    reasons.push("AI signal from unverified connector adapter");
  }

  // Cap and decide
  score = Math.min(1, Number(score.toFixed(3)));
  const isShadow = score >= 0.35 || tags.some((t) => SHADOW_RISK_TAGS.has(t) || t === "consumer_ai");

  return {
    isShadow,
    score,
    reasons: [...new Set(reasons)],
    tags: [...new Set(tags)]
  };
}

/** Enrich an observation before ingest */
export function applyShadowAiToObservation(obs) {
  const classification = classifyShadowAi(obs);
  if (!classification.isShadow && !classification.tags.length) return obs;

  const risks = new Set(asArray(obs.risk_indicators).map(String));
  if (classification.isShadow) risks.add("shadow_ai");
  for (const tag of classification.tags) risks.add(tag);

  return {
    ...obs,
    risk_indicators: [...risks],
    metadata: {
      ...(obs.metadata || {}),
      shadowAi: classification.isShadow,
      shadowAiScore: classification.score,
      shadowAiReasons: classification.reasons,
      shadowAiTags: classification.tags
    }
  };
}

export function summarizeShadowFindings(agents) {
  const findings = [];
  const byTag = {};
  for (const agent of agents) {
    const classification =
      agent.metadata?.shadowAi != null
        ? {
            isShadow: Boolean(agent.metadata.shadowAi),
            score: Number(agent.metadata.shadowAiScore || 0),
            reasons: agent.metadata.shadowAiReasons || [],
            tags: agent.metadata.shadowAiTags || asArray(agent.risk_indicators).filter((t) =>
              String(t).includes("shadow") || SHADOW_RISK_TAGS.has(String(t))
            )
          }
        : classifyShadowAi(agent);

    if (!classification.isShadow) continue;

    for (const tag of classification.tags) {
      byTag[tag] = (byTag[tag] || 0) + 1;
    }

    findings.push({
      ...agent,
      shadowAi: true,
      shadowAiScore: classification.score,
      shadowAiReasons: classification.reasons,
      shadowAiTags: classification.tags,
      queue: classification.tags[0] || "shadow_ai"
    });
  }

  findings.sort((a, b) => Number(b.shadowAiScore || 0) - Number(a.shadowAiScore || 0));
  return {
    total: findings.length,
    byTag,
    findings
  };
}
