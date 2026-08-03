'use strict';

/**
 * Map DB agent rows to the shape expected by agentRadarLaunch.html loadLiveAgents()
 */
function frameworkControlsFromScores(frameworkScores) {
  const defaults = {
    soc2: 'warn',
    iso27001: 'warn',
    gdpr: 'warn',
    nist: 'warn',
    euai: 'warn',
    hipaa: 'warn',
    hitrust: 'warn',
    fda_samd: 'warn',
  };
  const fw =
    typeof frameworkScores === 'string'
      ? JSON.parse(frameworkScores || '{}')
      : frameworkScores || {};
  const mapKey = {
    SOC2: 'soc2',
    ISO27001: 'iso27001',
    GDPR: 'gdpr',
    NIST_AI_RMF: 'nist',
    EU_AI_ACT: 'euai',
    HIPAA: 'hipaa',
    HITRUST: 'hitrust',
  };
  const out = { ...defaults };
  for (const [k, v] of Object.entries(fw)) {
    const key = mapKey[k] || k.toLowerCase();
    if (out[key] !== undefined && v && v.status) out[key] = v.status;
  }
  return out;
}

function toProdRisk(row) {
  if (row.risk && ['critical', 'high', 'medium', 'low', 'info'].includes(row.risk)) {
    return row.risk;
  }
  const level = row.risk_level || 'low';
  const score = row.risk_score || 0;
  if (level === 'high' && score >= 85) return 'critical';
  if (level === 'high') return 'high';
  if (level === 'medium') return 'medium';
  return 'low';
}

function mapAgentToProd(row) {
  const protocols =
    typeof row.protocols === 'string' ? JSON.parse(row.protocols || '[]') : row.protocols || [];
  const metadata =
    typeof row.metadata === 'string' ? JSON.parse(row.metadata || '{}') : row.metadata || {};
  let controls =
    typeof row.controls === 'string' ? JSON.parse(row.controls || '{}') : row.controls || {};
  if (!controls || Object.keys(controls).length === 0) {
    controls = frameworkControlsFromScores(row.framework_scores);
  }

  const phi = row.phi != null ? !!row.phi : !!row.phi_flagged;
  const shadow = !!row.shadow || (!row.owner && !row.tags?.owner && !row.tags?.Owner);

  return {
    id: row.id,
    name: row.name,
    type: row.type || row.resource_type || 'Unknown',
    env: row.env || 'Cloud',
    risk: toProdRisk(row),
    shadow,
    phi,
    pii: !!row.pii || phi,
    hosted: row.hosted != null ? !!row.hosted : true,
    quarantined: !!row.quarantined,
    approved: !!row.approved,
    owner: row.owner || row.tags?.owner || row.tags?.Owner || null,
    domain: row.resource_group || null,
    protocols,
    controls,
    metadata: {
      ...metadata,
      notes:
        metadata.notes ||
        [
          row.resource_group ? `Resource Group: ${row.resource_group}` : null,
          row.region ? `Region: ${row.region}` : null,
          row.azure_resource_id ? `Azure ID: ${row.azure_resource_id}` : null,
        ]
          .filter(Boolean)
          .join(' | '),
    },
    detect: row.detect || 'Azure ARM Discovery',
    data_access: row.data_access || null,
    notes: row.notes || null,
    first_detected: row.first_detected || row.first_discovered,
    last_seen: row.last_seen,
    // Extra fields retained for V1 modules
    phi_flagged: phi,
    risk_score: row.risk_score,
    risk_level: row.risk_level,
    hipaa_status: row.hipaa_status,
    resource_type: row.resource_type,
    region: row.region,
  };
}

function defaultControlsForNew() {
  return {
    soc2: 'warn',
    iso27001: 'warn',
    gdpr: 'warn',
    nist: 'warn',
    euai: 'warn',
    hipaa: 'warn',
    hitrust: 'warn',
    fda_samd: 'warn',
  };
}

module.exports = { mapAgentToProd, frameworkControlsFromScores, toProdRisk, defaultControlsForNew };
