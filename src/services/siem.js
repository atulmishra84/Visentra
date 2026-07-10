'use strict';

const https = require('https');
const crypto = require('crypto');
const config = require('../config');

/**
 * Module 7 — SIEM & Observability Integration
 * Forwards audit events to Azure Monitor Log Analytics.
 */
async function forwardToLogAnalytics(event) {
  const workspaceId = config.logAnalytics.workspaceId;
  const sharedKey = config.logAnalytics.key;
  if (!workspaceId || !sharedKey) {
    return { skipped: true, reason: 'Log Analytics not configured' };
  }

  const logType = 'AgentRadarAudit';
  const body = JSON.stringify([
    {
      TimeGenerated: event.TimeGenerated || new Date().toISOString(),
      action_s: event.action,
      actor_email_s: event.actor_email || '',
      tenant_id_g: event.tenant_id || '',
      detail_s: JSON.stringify(event.detail || {}),
      ip_address_s: event.ip_address || '',
      event_id_g: event.id || '',
    },
  ]);

  const contentLength = Buffer.byteLength(body, 'utf8');
  const rfc1123Date = new Date().toUTCString();
  const stringToSign =
    'POST\n' +
    contentLength +
    '\napplication/json\nx-ms-date:' +
    rfc1123Date +
    '\n/api/logs';
  const signature = crypto
    .createHmac('sha256', Buffer.from(sharedKey, 'base64'))
    .update(stringToSign, 'utf8')
    .digest('base64');
  const authorization = `SharedKey ${workspaceId}:${signature}`;

  const path = `/api/logs?api-version=2016-04-01`;
  const options = {
    hostname: `${workspaceId}.ods.opinsights.azure.com`,
    path,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authorization,
      'Log-Type': logType,
      'x-ms-date': rfc1123Date,
      'Content-Length': contentLength,
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, status: res.statusCode });
        } else {
          reject(new Error(`Log Analytics HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { forwardToLogAnalytics };
