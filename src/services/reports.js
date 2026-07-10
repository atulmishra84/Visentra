'use strict';

const { query } = require('../models/db');

/**
 * Module 10 — Compliance Reporting & Evidence Export
 */
async function generateReport(tenantId, { sinceDays = 90 } = {}) {
  const agents = await query(
    `SELECT risk_level, phi_flagged, hipaa_status, framework_scores, name, resource_type
     FROM agents WHERE tenant_id = $1`,
    [tenantId]
  );

  const byRisk = { high: 0, medium: 0, low: 0 };
  let phiFlagged = 0;
  let phiCleared = 0;
  const frameworkAgg = {};

  for (const a of agents.rows) {
    byRisk[a.risk_level] = (byRisk[a.risk_level] || 0) + 1;
    if (a.phi_flagged) phiFlagged += 1;
    if (a.hipaa_status === 'cleared') phiCleared += 1;
    const fw = typeof a.framework_scores === 'string'
      ? JSON.parse(a.framework_scores)
      : a.framework_scores || {};
    for (const [name, val] of Object.entries(fw)) {
      if (!frameworkAgg[name]) frameworkAgg[name] = { pass: 0, warn: 0, fail: 0 };
      const st = val.status || 'pass';
      frameworkAgg[name][st] = (frameworkAgg[name][st] || 0) + 1;
    }
  }

  const users = await query(
    `SELECT email, name, role, last_login FROM users WHERE tenant_id = $1 ORDER BY role, email`,
    [tenantId]
  );

  const audit = await query(
    `SELECT action, actor_email, detail, created_at
     FROM audit_events
     WHERE tenant_id = $1 AND created_at > NOW() - ($2 || ' days')::INTERVAL
     ORDER BY created_at DESC
     LIMIT 5000`,
    [tenantId, String(sinceDays)]
  );

  return {
    generated_at: new Date().toISOString(),
    tenant_id: tenantId,
    period_days: sinceDays,
    inventory: {
      total_agents: agents.rows.length,
      by_risk: byRisk,
      phi_flagged: phiFlagged,
      phi_cleared: phiCleared,
      phi_under_remediation: Math.max(0, phiFlagged - phiCleared),
    },
    compliance_posture: frameworkAgg,
    users: users.rows,
    governance_actions: audit.rows,
    agents: agents.rows,
  };
}

function toCsv(report) {
  const lines = ['section,key,value'];
  lines.push(`inventory,total_agents,${report.inventory.total_agents}`);
  lines.push(`inventory,high,${report.inventory.by_risk.high}`);
  lines.push(`inventory,medium,${report.inventory.by_risk.medium}`);
  lines.push(`inventory,low,${report.inventory.by_risk.low}`);
  lines.push(`inventory,phi_flagged,${report.inventory.phi_flagged}`);
  lines.push(`inventory,phi_under_remediation,${report.inventory.phi_under_remediation}`);
  for (const [fw, counts] of Object.entries(report.compliance_posture)) {
    lines.push(`framework,${fw}_pass,${counts.pass || 0}`);
    lines.push(`framework,${fw}_warn,${counts.warn || 0}`);
    lines.push(`framework,${fw}_fail,${counts.fail || 0}`);
  }
  for (const u of report.users) {
    lines.push(`user,"${u.email}",${u.role},${u.last_login || ''}`);
  }
  return lines.join('\n');
}

module.exports = { generateReport, toCsv };
