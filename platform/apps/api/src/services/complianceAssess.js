/**
 * Auto-assess discovered agents against Governance & Compliance controls.
 * Statuses are evidence-based from discovery/deep/adversarial metadata — not invented certifications.
 */

import { enrichAgentRow } from "./agentDepth.js";
import {
  COMPLIANCE_CONTROLS,
  listFrameworks,
  listControls
} from "./complianceCatalog.js";

const STATUSES = new Set(["pass", "fail", "partial", "unknown", "not_applicable"]);

function meta(agent) {
  return agent?.metadata && typeof agent.metadata === "object" ? agent.metadata : {};
}

function deep(agent) {
  const m = meta(agent);
  return m.deep && typeof m.deep === "object" ? m.deep : null;
}

function adversarial(agent) {
  const m = meta(agent);
  return m.adversarial_surface && typeof m.adversarial_surface === "object" ? m.adversarial_surface : null;
}

function asBool(v) {
  if (v === true || v === false) return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

function collectSignals(agent) {
  const m = meta(agent);
  const d = deep(agent);
  const adv = adversarial(agent);
  const access = agent.agentAccess || m.agentAccess || {};
  const ownership = agent.ownership || m.ownership || {};
  const dac = agent.dataAccessClassification || m.dataAccessClassification || {};
  const owasp = adv?.owasp_hints || {};
  const tools = Array.isArray(adv?.tools)
    ? adv.tools
    : Array.isArray(d?.tools)
      ? d.tools
      : Array.isArray(m.tools)
        ? m.tools
        : [];
  const riskIndicators = Array.isArray(agent.risk_indicators)
    ? agent.risk_indicators
    : Array.isArray(m.riskIndicators)
      ? m.riskIndicators
      : [];

  const hasPhi =
    asBool(dac.hasPhi) === true ||
    asBool(m.hasPhi) === true ||
    String(dac.primaryDataClass || m.primaryDataClass || "").toLowerCase() === "phi" ||
    riskIndicators.some((r) => /phi/i.test(String(r)));
  const hasPii =
    asBool(dac.hasPii) === true ||
    asBool(m.hasPii) === true ||
    ["pii", "phi"].includes(String(dac.primaryDataClass || m.primaryDataClass || "").toLowerCase()) ||
    riskIndicators.some((r) => /pii/i.test(String(r)));
  const overPermissioned =
    asBool(access.overPermissioned) === true ||
    asBool(m.overPermissioned) === true ||
    adv?.identity_and_access?.over_permissioned === true;
  const guardrails =
    asBool(m.hasGuardrails) === true ||
    adv?.observability?.guardrails_detected === true ||
    Boolean(d?.guardrails?.length);
  const guardrailsKnownFalse = adv?.observability?.guardrails_detected === false;
  const owner =
    agent.owner ||
    ownership.owner ||
    ownership.team ||
    m.owner ||
    null;
  const shadowAi =
    asBool(agent.shadowAi) === true ||
    asBool(m.shadowAi) === true ||
    adv?.ownership?.shadow_ai === true ||
    riskIndicators.some((r) => /shadow/i.test(String(r)));
  const internet =
    asBool(agent.internet_access) === true ||
    adv?.connectivity?.internet_access === true ||
    asBool(access.internet) === true;
  const codeExecution =
    asBool(agent.code_execution) === true ||
    adv?.connectivity?.code_execution === true ||
    tools.some((t) => t?.risk_flags?.can_execute_code);
  const instructionsPresent =
    adv?.instructions?.present === true || asBool(m.hasInstructions) === true;
  const safetyRules = adv?.instructions?.contains_safety_rules;
  const knowledgeBases =
    (adv?.memory_and_context?.knowledge_bases || d?.knowledgeBases || m.knowledgeBases || []).length >
    0;
  const hasMemory = adv?.memory_and_context?.has_memory === true;
  const deepPresent = Boolean(d) || Boolean(adv);
  const llmHints = new Set(owasp.llm_top10 || []);
  const identityPresent = Boolean(
    adv?.identity_and_access?.principal ||
      m.objectId ||
      m.appId ||
      agent.provider ||
      m.cloudProvider
  );

  return {
    hasPhi,
    hasPii,
    overPermissioned,
    guardrails,
    guardrailsKnownFalse,
    owner: owner ? String(owner) : null,
    shadowAi,
    internet,
    codeExecution,
    instructionsPresent,
    safetyRules,
    knowledgeBases,
    hasMemory,
    deepPresent,
    toolsCount: tools.length,
    llmHints,
    identityPresent,
    model: agent.model || m.model || null,
    framework: agent.framework || m.framework || null,
    environment: agent.environment || m.environment || ownership.environment || null,
    category: agent.category || null,
    agentStatus: m.agentStatus || null,
    evidenceClass: m.evidenceClass || null
  };
}

function finding(control, status, rationale, evidence = []) {
  const s = STATUSES.has(status) ? status : "unknown";
  return {
    controlId: control.id,
    framework: control.framework,
    code: control.code,
    title: control.title,
    family: control.family || null,
    status: s,
    rationale,
    evidence: evidence.filter(Boolean).slice(0, 12),
    reviewedAt: new Date().toISOString(),
    source: "auto"
  };
}

/**
 * Assess one control for one agent using discovery signals.
 */
export function assessControl(control, agent) {
  const s = collectSignals(agent);

  switch (control.id) {
    case "owasp_llm.LLM01": {
      if (s.guardrails && s.instructionsPresent && s.safetyRules !== false) {
        return finding(control, "partial", "Instructions/guardrails present; prompt-injection residual risk remains for tool-using agents.", [
          "guardrails",
          "instructions"
        ]);
      }
      if (s.llmHints.has("LLM01_PromptInjection") || (s.toolsCount > 0 && !s.guardrails)) {
        return finding(control, "fail", "Tool-using agent without clear injection mitigations/guardrails.", [
          "tools",
          s.guardrailsKnownFalse ? "guardrails_detected=false" : null
        ]);
      }
      if (!s.deepPresent) return finding(control, "unknown", "Insufficient deep-scan evidence for prompt-injection posture.");
      return finding(control, "partial", "Limited evidence of prompt-injection controls.", []);
    }
    case "owasp_llm.LLM02": {
      if ((s.hasPhi || s.hasPii) && !s.guardrails) {
        return finding(control, "fail", "Sensitive data reach without detected guardrails.", [
          s.hasPhi ? "phi" : "pii"
        ]);
      }
      if (s.hasPhi || s.hasPii) {
        return finding(control, "partial", "Sensitive data reach detected; disclosure controls need review.", [
          s.hasPhi ? "phi" : "pii",
          s.guardrails ? "guardrails" : null
        ]);
      }
      if (!s.deepPresent && !s.hasPii && !s.hasPhi) {
        return finding(control, "unknown", "No sensitive-data classification yet.");
      }
      return finding(control, "pass", "No PHI/PII reach signals on this agent.", ["dataAccess"]);
    }
    case "owasp_llm.LLM03": {
      if (s.model || s.framework || s.toolsCount >= 0) {
        const known = Boolean(s.model || s.framework);
        if (known && s.owner) {
          return finding(control, "pass", "Model/framework and owner are inventoried.", [
            s.model,
            s.framework,
            `owner:${s.owner}`
          ]);
        }
        if (known) {
          return finding(control, "partial", "Stack inventoried but owner missing for supply-chain accountability.", [
            s.model,
            s.framework
          ]);
        }
      }
      return finding(control, "unknown", "Model/framework supply-chain details incomplete.");
    }
    case "owasp_llm.LLM04": {
      if (!s.knowledgeBases && !s.hasMemory) {
        return finding(control, "not_applicable", "No knowledge-base/memory surface detected.", []);
      }
      if (s.knowledgeBases && !s.owner) {
        return finding(control, "fail", "RAG/memory present without accountable owner.", ["knowledgeBases"]);
      }
      return finding(control, "partial", "Memory/RAG present — verify corpus integrity and access controls.", [
        "knowledgeBases"
      ]);
    }
    case "owasp_llm.LLM05": {
      if (s.codeExecution && !s.guardrails) {
        return finding(control, "fail", "Code-execution capability without detected output/guardrail controls.", [
          "code_execution"
        ]);
      }
      if (s.codeExecution) {
        return finding(control, "partial", "Code execution available; treat model output as untrusted.", [
          "code_execution",
          "guardrails"
        ]);
      }
      return finding(control, "pass", "No code-execution tool path detected.", []);
    }
    case "owasp_llm.LLM06": {
      if (s.overPermissioned || (s.toolsCount > 0 && s.internet && s.codeExecution)) {
        return finding(control, "fail", "Excessive agency signals (over-permissioned and/or high-risk tool combo).", [
          s.overPermissioned ? "over_permissioned" : null,
          s.internet ? "internet" : null,
          s.codeExecution ? "code_execution" : null
        ]);
      }
      if (s.toolsCount > 3 || s.internet) {
        return finding(control, "partial", "Broad tool or internet reach — confirm least privilege.", [
          `tools:${s.toolsCount}`,
          s.internet ? "internet" : null
        ]);
      }
      if (!s.deepPresent && s.toolsCount === 0) {
        return finding(control, "unknown", "Agency/tool surface not deeply scanned.");
      }
      return finding(control, "pass", "No strong excessive-agency signals.", []);
    }
    case "owasp_llm.LLM07": {
      if (s.instructionsPresent && s.safetyRules === false) {
        return finding(control, "fail", "Instructions present without detected safety rules (leak/abuse risk).", [
          "instructions"
        ]);
      }
      if (s.instructionsPresent && s.guardrails) {
        return finding(control, "partial", "Instructions present with guardrails — verify anti-extraction controls.", [
          "instructions",
          "guardrails"
        ]);
      }
      if (!s.instructionsPresent) {
        return finding(control, "unknown", "No instruction payload observed.");
      }
      return finding(control, "partial", "Instructions observed; system-prompt protection not verified.", [
        "instructions"
      ]);
    }
    case "owasp_llm.LLM08": {
      if (!s.knowledgeBases) {
        return finding(control, "not_applicable", "No vector/RAG knowledge bases detected.", []);
      }
      return finding(control, "partial", "Knowledge bases present — verify embedding store ACLs and integrity.", [
        "knowledgeBases"
      ]);
    }
    case "owasp_llm.LLM09": {
      if (s.guardrailsKnownFalse) {
        return finding(control, "fail", "No guardrails detected for output integrity / misinformation controls.", [
          "guardrails_detected=false"
        ]);
      }
      if (s.guardrails) {
        return finding(control, "partial", "Guardrails detected; human review policy still recommended for high-impact outputs.", [
          "guardrails"
        ]);
      }
      return finding(control, "unknown", "Misinformation controls not evidenced.");
    }
    case "owasp_llm.LLM10": {
      if (s.owner && !s.shadowAi) {
        return finding(control, "partial", "Owned agent — confirm rate/cost/loop limits operationally.", [
          `owner:${s.owner}`
        ]);
      }
      if (s.shadowAi) {
        return finding(control, "fail", "Shadow/unmanaged agent — unbounded consumption controls unlikely.", [
          "shadow_ai"
        ]);
      }
      return finding(control, "unknown", "Consumption/limit controls not visible in discovery data.");
    }

    case "hipaa.AC": {
      if (!s.hasPhi) {
        return finding(control, "not_applicable", "No PHI reach signals — HIPAA access control N/A for ePHI path.", []);
      }
      if (s.overPermissioned || !s.identityPresent) {
        return finding(control, "fail", "PHI-capable agent lacks clear least-privilege identity posture.", [
          "phi",
          s.overPermissioned ? "over_permissioned" : "identity_unclear"
        ]);
      }
      return finding(control, "partial", "PHI reach with identity signals — verify unique IDs and RBAC.", [
        "phi",
        "identity"
      ]);
    }
    case "hipaa.AU": {
      if (!s.hasPhi) return finding(control, "not_applicable", "No PHI reach signals.", []);
      if (s.deepPresent) {
        return finding(control, "partial", "Discovery telemetry exists; confirm ePHI access audit logging in runtime.", [
          "deep_or_adversarial"
        ]);
      }
      return finding(control, "fail", "PHI-capable agent without observed audit/observability evidence.", ["phi"]);
    }
    case "hipaa.IA": {
      if (!s.hasPhi) return finding(control, "not_applicable", "No PHI reach signals.", []);
      if (s.identityPresent) {
        return finding(control, "partial", "Identity signals present — verify authentication before ePHI systems.", [
          "identity"
        ]);
      }
      return finding(control, "fail", "PHI-capable agent without clear authentication/identity evidence.", ["phi"]);
    }
    case "hipaa.TR": {
      if (!s.hasPhi) return finding(control, "not_applicable", "No PHI reach signals.", []);
      if (s.internet) {
        return finding(control, "partial", "Internet egress with PHI reach — verify TLS and approved channels.", [
          "phi",
          "internet"
        ]);
      }
      return finding(control, "partial", "PHI reach without clear egress map — verify transmission protections.", ["phi"]);
    }
    case "hipaa.PHI_MIN": {
      if (!s.hasPhi) return finding(control, "not_applicable", "No PHI reach signals.", []);
      if (s.toolsCount > 5 || s.overPermissioned) {
        return finding(control, "fail", "Broad tool/permission surface conflicts with minimum-necessary ePHI.", [
          "phi",
          `tools:${s.toolsCount}`
        ]);
      }
      return finding(control, "partial", "PHI reach — confirm tool scopes are minimum necessary.", ["phi"]);
    }
    case "hipaa.OWNER": {
      if (!s.hasPhi && !s.hasPii) {
        return finding(control, "not_applicable", "No health/sensitive data reach requiring HIPAA owner focus.", []);
      }
      if (s.owner && !s.shadowAi) {
        return finding(control, "pass", "Accountable owner present for sensitive-data agent.", [`owner:${s.owner}`]);
      }
      return finding(control, "fail", "Sensitive-data agent missing owner or flagged Shadow AI.", [
        s.owner ? null : "owner_missing",
        s.shadowAi ? "shadow_ai" : null
      ]);
    }
    case "hipaa.GUARD": {
      if (!s.hasPhi) return finding(control, "not_applicable", "No PHI reach signals.", []);
      if (s.guardrails) {
        return finding(control, "partial", "Guardrails detected — validate ePHI integrity/disclosure rules.", [
          "phi",
          "guardrails"
        ]);
      }
      return finding(control, "fail", "PHI-capable agent without detected guardrails.", ["phi"]);
    }
    case "hipaa.SHADOW": {
      if (!s.hasPhi) return finding(control, "not_applicable", "No PHI reach signals.", []);
      if (s.shadowAi) {
        return finding(control, "fail", "Unmanaged/Shadow AI agent with PHI reach.", ["shadow_ai", "phi"]);
      }
      return finding(control, "pass", "PHI-capable agent not classified as Shadow AI.", ["phi"]);
    }

    case "nist.GOVERN_1": {
      if (s.owner && !s.shadowAi) {
        return finding(control, "pass", "Owner assigned — basic accountability present.", [`owner:${s.owner}`]);
      }
      if (s.shadowAi || !s.owner) {
        return finding(control, "fail", "Missing owner or Shadow AI — governance accountability gap.", [
          s.owner ? null : "owner_missing",
          s.shadowAi ? "shadow_ai" : null
        ]);
      }
      return finding(control, "unknown", "Ownership unclear.");
    }
    case "nist.GOVERN_2": {
      if (s.guardrails && s.owner) {
        return finding(control, "partial", "Owner + guardrails suggest oversight path; confirm human approval gates.", [
          "owner",
          "guardrails"
        ]);
      }
      return finding(control, "unknown", "Human oversight workflow not evidenced in discovery.");
    }
    case "nist.MAP_1": {
      if (s.category || s.environment || s.evidenceClass) {
        return finding(control, "pass", "Agent context captured in inventory (category/environment/evidence).", [
          s.category,
          s.environment,
          s.evidenceClass
        ]);
      }
      return finding(control, "fail", "Insufficient context-of-use metadata.", []);
    }
    case "nist.MAP_2": {
      if (s.hasPhi || s.hasPii || s.toolsCount > 0 || s.overPermissioned) {
        return finding(control, "pass", "Risk-relevant signals categorized (data and/or tools).", [
          s.hasPhi ? "phi" : null,
          s.hasPii ? "pii" : null,
          s.toolsCount ? `tools:${s.toolsCount}` : null
        ]);
      }
      if (!s.deepPresent) {
        return finding(control, "unknown", "Risk categories incomplete without deep scan.");
      }
      return finding(control, "partial", "Deep scan present but few explicit risk categories.", []);
    }
    case "nist.MEASURE_1": {
      if (s.deepPresent) {
        return finding(control, "pass", "Deep/adversarial evaluation surface available.", ["deep_or_adversarial"]);
      }
      return finding(control, "fail", "No deep/adversarial scan evidence for measurement.", []);
    }
    case "nist.MEASURE_2": {
      if (s.guardrails || s.deepPresent) {
        return finding(control, "partial", "Some observability/guardrail signals — confirm continuous monitoring.", [
          s.guardrails ? "guardrails" : "deep"
        ]);
      }
      return finding(control, "unknown", "Monitoring posture not evidenced.");
    }
    case "nist.MANAGE_1": {
      const high =
        s.overPermissioned || s.hasPhi || s.shadowAi || (s.codeExecution && s.internet);
      if (high && !s.guardrails && !s.owner) {
        return finding(control, "fail", "High-risk signals without owner/guardrail treatment.", [
          s.overPermissioned ? "over_permissioned" : null,
          s.hasPhi ? "phi" : null,
          s.shadowAi ? "shadow_ai" : null
        ]);
      }
      if (high) {
        return finding(control, "partial", "High-risk signals present — verify prioritized remediation.", [
          "high_risk_signals"
        ]);
      }
      return finding(control, "pass", "No unresolved high-risk combo detected from inventory signals.", []);
    }
    case "nist.MANAGE_2": {
      if (s.owner) {
        return finding(control, "pass", "Owner linkage supports incident/change response.", [`owner:${s.owner}`]);
      }
      return finding(control, "fail", "No owner — incident response accountability gap.", ["owner_missing"]);
    }
    default:
      return finding(control, "unknown", "No automated rule for this control yet.");
  }
}

function summarizeFindings(findings) {
  const counts = { pass: 0, fail: 0, partial: 0, unknown: 0, not_applicable: 0 };
  for (const f of findings) {
    counts[f.status] = (counts[f.status] || 0) + 1;
  }
  const scored = findings.filter((f) => f.status === "pass" || f.status === "fail" || f.status === "partial");
  const weight = { pass: 1, partial: 0.5, fail: 0 };
  let score = null;
  if (scored.length) {
    const sum = scored.reduce((acc, f) => acc + (weight[f.status] ?? 0), 0);
    score = Math.round((sum / scored.length) * 100);
  }
  let posture = "unknown";
  if (counts.fail > 0) posture = "non_compliant";
  else if (counts.partial > 0) posture = "partial";
  else if (counts.pass > 0 && counts.unknown === 0) posture = "compliant";
  else if (counts.pass > 0) posture = "partial";
  return { counts, score, posture };
}

export function assessAgent(agent, { frameworks } = {}) {
  const frameworkFilter = frameworks?.length ? new Set(frameworks.map(String)) : null;
  const controls = COMPLIANCE_CONTROLS.filter((c) => !frameworkFilter || frameworkFilter.has(c.framework));
  const findings = controls.map((c) => assessControl(c, agent));
  const byFramework = {};
  for (const fw of listFrameworks()) {
    if (frameworkFilter && !frameworkFilter.has(fw.id)) continue;
    const fwFindings = findings.filter((f) => f.framework === fw.id);
    byFramework[fw.id] = {
      framework: fw,
      findings: fwFindings,
      summary: summarizeFindings(fwFindings)
    };
  }
  const summary = summarizeFindings(findings);
  return {
    agentId: agent.id,
    agentName: agent.name || agent.displayName || agent.id,
    category: agent.category || null,
    cloudProvider: agent.cloud_provider || meta(agent).cloudProvider || null,
    evidenceClass: meta(agent).evidenceClass || null,
    agentStatus: meta(agent).agentStatus || null,
    summary,
    byFramework,
    findings,
    assessedAt: new Date().toISOString(),
    source: "auto"
  };
}

export async function loadTenantAgents(pool, tenantId, { limit = 500, agentId = null } = {}) {
  const params = [tenantId];
  let sql = `SELECT * FROM agents WHERE tenant_id=$1`;
  if (agentId) {
    params.push(agentId);
    sql += ` AND id=$${params.length}`;
  }
  params.push(Math.min(Number(limit) || 500, 2000));
  sql += ` ORDER BY last_seen DESC NULLS LAST LIMIT $${params.length}`;
  const result = await pool.query(sql, params);
  return result.rows.map((row) => enrichAgentRow(row));
}

export async function buildComplianceReport(pool, tenantId, options = {}) {
  const framework = options.framework ? String(options.framework) : null;
  const agents = await loadTenantAgents(pool, tenantId, {
    limit: options.limit,
    agentId: options.agentId || null
  });
  const frameworks = framework ? [framework] : null;
  const assessments = agents.map((a) => assessAgent(a, { frameworks }));

  const rollup = {
    agentsAssessed: assessments.length,
    compliant: 0,
    partial: 0,
    nonCompliant: 0,
    unknown: 0,
    avgScore: null,
    byFramework: {}
  };
  let scoreSum = 0;
  let scoreN = 0;
  for (const a of assessments) {
    if (a.summary.posture === "compliant") rollup.compliant += 1;
    else if (a.summary.posture === "partial") rollup.partial += 1;
    else if (a.summary.posture === "non_compliant") rollup.nonCompliant += 1;
    else rollup.unknown += 1;
    if (a.summary.score != null) {
      scoreSum += a.summary.score;
      scoreN += 1;
    }
  }
  if (scoreN) rollup.avgScore = Math.round(scoreSum / scoreN);

  for (const fw of listFrameworks()) {
    if (framework && fw.id !== framework) continue;
    const counts = { pass: 0, fail: 0, partial: 0, unknown: 0, not_applicable: 0 };
    for (const a of assessments) {
      const block = a.byFramework[fw.id];
      if (!block) continue;
      for (const [k, v] of Object.entries(block.summary.counts || {})) {
        counts[k] = (counts[k] || 0) + v;
      }
    }
    rollup.byFramework[fw.id] = { framework: fw, counts };
  }

  return {
    spec: { name: "Visentra-Governance", version: "1.0.0" },
    frameworks: listFrameworks(),
    controls: listControls(framework),
    rollup,
    assessments,
    generatedAt: new Date().toISOString()
  };
}
