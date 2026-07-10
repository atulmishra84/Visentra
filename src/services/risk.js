'use strict';

/**
 * Module 3 — Automated Risk & Compliance Scoring
 */
const HIGH_RISK_TYPES = [
  'Microsoft.CognitiveServices/accounts',
  'Microsoft.MachineLearningServices/workspaces',
  'Microsoft.App/containerApps',
  'Microsoft.Web/sites',
  'Microsoft.Search/searchServices',
];

const FRAMEWORKS = ['HIPAA', 'HITRUST', 'SOC2', 'ISO27001', 'GDPR', 'NIST_AI_RMF', 'EU_AI_ACT'];

function scoreAgent(agent) {
  const factors = [];
  let score = 10;

  const rt = agent.resource_type || '';
  if (HIGH_RISK_TYPES.some((t) => rt.includes(t.split('/')[1]) || rt === t)) {
    score += 25;
    factors.push({ code: 'resource_type', weight: 25, detail: `Elevated baseline for ${rt}` });
  }
  if (/openai|cognitive|ml|foundry|ai/i.test(rt + ' ' + (agent.name || ''))) {
    score += 15;
    factors.push({ code: 'ai_workload', weight: 15, detail: 'AI/LLM-related resource' });
  }
  if (agent.phi_flagged) {
    score += 35;
    factors.push({ code: 'phi_exposure', weight: 35, detail: 'PHI flagged — elevated sensitivity' });
  }
  if (agent.hipaa_status === 'fail') {
    score += 10;
    factors.push({ code: 'hipaa_fail', weight: 10, detail: 'HIPAA status fail pending review' });
  }
  if (agent.hipaa_status === 'cleared') {
    score -= 5;
    factors.push({ code: 'hipaa_cleared', weight: -5, detail: 'PHI cleared by analyst' });
  }

  const tags = agent.tags || {};
  if (!tags.owner && !tags.Owner) {
    score += 8;
    factors.push({ code: 'missing_owner', weight: 8, detail: 'No owner tag — weak access posture' });
  }

  score = Math.max(0, Math.min(100, score));
  const risk_level = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';

  const framework_scores = {};
  for (const fw of FRAMEWORKS) {
    let status = 'pass';
    let fwScore = Math.max(0, 100 - score);
    if (agent.phi_flagged && ['HIPAA', 'HITRUST'].includes(fw) && agent.hipaa_status !== 'cleared') {
      status = 'fail';
      fwScore = Math.min(fwScore, 40);
    } else if (risk_level === 'high') {
      status = 'warn';
    }
    if (fw === 'EU_AI_ACT' && /openai|cognitive|ml|foundry/i.test(rt)) {
      if (risk_level === 'high') status = 'warn';
    }
    framework_scores[fw] = { status, score: fwScore };
  }

  return { risk_score: score, risk_level, risk_factors: factors, framework_scores };
}

module.exports = { scoreAgent, FRAMEWORKS, HIGH_RISK_TYPES };
