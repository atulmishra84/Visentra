'use strict';
const db = require('../models/db');

const ACTIONS = {
  LOGIN:            'auth.login',
  LOGOUT:           'auth.logout',
  SSO_LOGIN:        'auth.sso_login',
  DISCOVERY_START:  'discovery.start',
  DISCOVERY_DONE:   'discovery.complete',
  CONFIG_UPDATE:    'admin.config_update',
  AGENT_VIEW:       'agent.view',
  AGENT_EXPORT:     'agent.export',
  SIEM_CONNECT:     'siem.connect',
  PHI_DETECTED:     'phi.detected',
};

async function log({ tenantId, userId, userEmail, action, resource, details, req }) {
  try {
    const ip = req?.ip || req?.connection?.remoteAddress || 'unknown';
    const detail = [
      userEmail || 'system',
      resource || 'platform',
      JSON.stringify(details || {}),
    ].join(' | ').substring(0, 1000);

    await db.query(
      `INSERT INTO activity_log 
       (tenant_id, user_id, action, detail, severity, ip_address, created_at)
       VALUES ($1, $2, $3, $4, 'info', $5, NOW())`,
      [tenantId, userId, action, detail, ip]
    );
  } catch (err) {
    // Never let audit failure break the request
    console.error('[audit] Failed to log:', err.message);
  }
}

module.exports = { log, ACTIONS };
