'use strict';

const https = require('https');
const { query } = require('../models/db');
const config = require('../config');
const { detectPhi } = require('./phi');
const { scoreAgent } = require('./risk');
const { logAudit } = require('./audit');

const AI_TYPE_PATTERNS = [
  'Microsoft.CognitiveServices/accounts',
  'Microsoft.MachineLearningServices/workspaces',
  'Microsoft.App/containerApps',
  'Microsoft.Web/sites',
  'Microsoft.Search/searchServices',
  'Microsoft.BotService/botServices',
  'Microsoft.HealthcareApis/services',
  'Microsoft.HealthcareApis/workspaces',
  'Microsoft.DocumentDB/databaseAccounts',
  'Microsoft.ContainerService/managedClusters',
];

function isAiRelevant(resource) {
  const type = resource.type || '';
  const name = (resource.name || '').toLowerCase();
  if (AI_TYPE_PATTERNS.some((p) => type === p || type.startsWith(p))) return true;
  if (/openai|ai-|ml-|foundry|copilot|llm|gpt/i.test(name)) return true;
  if (/openai|ai|foundry/i.test(type)) return true;
  return false;
}

function demoResources() {
  return [
    {
      id: '/subscriptions/demo/resourceGroups/rg-ai/providers/Microsoft.CognitiveServices/accounts/prod-openai',
      name: 'prod-openai',
      type: 'Microsoft.CognitiveServices/accounts',
      location: 'eastus',
      tags: { env: 'prod', owner: 'platform' },
      properties: {},
    },
    {
      id: '/subscriptions/demo/resourceGroups/rg-ml/providers/Microsoft.MachineLearningServices/workspaces/clinical-ml',
      name: 'clinical-ml',
      type: 'Microsoft.MachineLearningServices/workspaces',
      location: 'westus2',
      tags: { project: 'ehr-assist' },
      properties: {},
    },
    {
      id: '/subscriptions/demo/resourceGroups/rg-health/providers/Microsoft.HealthcareApis/workspaces/fhir-ws/fhirservices/patient-fhir',
      name: 'patient-fhir',
      type: 'Microsoft.HealthcareApis/workspaces/fhirservices',
      location: 'eastus2',
      tags: { protocol: 'fhir' },
      properties: {},
    },
    {
      id: '/subscriptions/demo/resourceGroups/rg-apps/providers/Microsoft.App/containerApps/shadow-bot',
      name: 'shadow-bot',
      type: 'Microsoft.App/containerApps',
      location: 'centralus',
      tags: {},
      properties: {},
    },
    {
      id: '/subscriptions/demo/resourceGroups/rg-search/providers/Microsoft.Search/searchServices/corp-search-ai',
      name: 'corp-search-ai',
      type: 'Microsoft.Search/searchServices',
      location: 'eastus',
      tags: { owner: 'search-team' },
      properties: {},
    },
  ];
}

async function getAzureToken() {
  const { tenantId, clientId, clientSecret } = config.azure;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Azure credentials not configured');
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    resource: 'https://management.azure.com/',
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'login.microsoftonline.com',
        path: `/${tenantId}/oauth2/token`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (!json.access_token) reject(new Error(json.error_description || 'No access token'));
            else resolve(json.access_token);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function listAzureResources(token, subscriptionId) {
  const path = `/subscriptions/${subscriptionId}/resources?api-version=2021-04-01`;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'management.azure.com',
        path,
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json.value || []);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function normalizeResource(r) {
  const parts = (r.id || '').split('/');
  const rgIdx = parts.findIndex((p) => p.toLowerCase() === 'resourcegroups');
  const protocols = [];
  const tagProtocol = (r.tags && (r.tags.protocol || r.tags.Protocol)) || '';
  if (tagProtocol) protocols.push(String(tagProtocol).toLowerCase());
  if (/fhir/i.test(r.name || '') || /fhir/i.test(r.type || '')) protocols.push('fhir');

  return {
    azure_resource_id: r.id,
    name: r.name,
    resource_type: r.type,
    subscription_id: parts[2] || null,
    resource_group: rgIdx >= 0 ? parts[rgIdx + 1] : null,
    region: r.location || null,
    tags: r.tags || {},
    metadata: { kind: r.kind || null },
    protocols: [...new Set(protocols)],
  };
}

async function upsertAgent(tenantId, resource) {
  const phi = detectPhi(resource);
  const scored = scoreAgent({ ...resource, ...phi });

  const existing = await query(
    `SELECT id, hipaa_status, phi_cleared_by, phi_cleared_at, phi_clear_reason
     FROM agents WHERE tenant_id = $1 AND azure_resource_id = $2`,
    [tenantId, resource.azure_resource_id]
  );

  let hipaa_status = phi.hipaa_status;
  let phi_flagged = phi.phi_flagged;
  let phi_vectors = phi.phi_vectors;
  let cleared = {};

  if (existing.rows[0]?.hipaa_status === 'cleared') {
    hipaa_status = 'cleared';
    cleared = {
      phi_cleared_by: existing.rows[0].phi_cleared_by,
      phi_cleared_at: existing.rows[0].phi_cleared_at,
      phi_clear_reason: existing.rows[0].phi_clear_reason,
    };
    // Re-score with cleared status
    Object.assign(scored, scoreAgent({ ...resource, ...phi, hipaa_status: 'cleared', phi_flagged }));
  }

  if (existing.rows[0]) {
    await query(
      `UPDATE agents SET
        name=$3, resource_type=$4, subscription_id=$5, resource_group=$6, region=$7,
        tags=$8, metadata=$9, protocols=$10, phi_flagged=$11, phi_vectors=$12,
        hipaa_status=$13, risk_score=$14, risk_level=$15, risk_factors=$16,
        framework_scores=$17, last_seen=NOW(), updated_at=NOW()
       WHERE id=$1 AND tenant_id=$2`,
      [
        existing.rows[0].id,
        tenantId,
        resource.name,
        resource.resource_type,
        resource.subscription_id,
        resource.resource_group,
        resource.region,
        JSON.stringify(resource.tags),
        JSON.stringify(resource.metadata),
        JSON.stringify(resource.protocols),
        phi_flagged,
        JSON.stringify(phi_vectors),
        hipaa_status,
        scored.risk_score,
        scored.risk_level,
        JSON.stringify(scored.risk_factors),
        JSON.stringify(scored.framework_scores),
      ]
    );
    return existing.rows[0].id;
  }

  const inserted = await query(
    `INSERT INTO agents (
      tenant_id, azure_resource_id, name, resource_type, subscription_id, resource_group,
      region, tags, metadata, protocols, phi_flagged, phi_vectors, hipaa_status,
      risk_score, risk_level, risk_factors, framework_scores
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    RETURNING id`,
    [
      tenantId,
      resource.azure_resource_id,
      resource.name,
      resource.resource_type,
      resource.subscription_id,
      resource.resource_group,
      resource.region,
      JSON.stringify(resource.tags),
      JSON.stringify(resource.metadata),
      JSON.stringify(resource.protocols),
      phi_flagged,
      JSON.stringify(phi_vectors),
      hipaa_status,
      scored.risk_score,
      scored.risk_level,
      JSON.stringify(scored.risk_factors),
      JSON.stringify(scored.framework_scores),
    ]
  );
  return inserted.rows[0].id;
}

/**
 * Module 1 — Continuous AI Agent Discovery
 */
async function runDiscovery(tenantId, { userId = null, actorEmail = null } = {}) {
  const scan = await query(
    `INSERT INTO discovery_scans (tenant_id, status, triggered_by) VALUES ($1,'running',$2) RETURNING id`,
    [tenantId, userId]
  );
  const scanId = scan.rows[0].id;
  let found = 0;

  try {
    let resources;
    const useDemo =
      config.discovery.demoMode ||
      !config.azure.clientId ||
      !config.azure.subscriptionId;

    if (useDemo) {
      resources = demoResources();
    } else {
      const token = await getAzureToken();
      const raw = await listAzureResources(token, config.azure.subscriptionId);
      resources = raw.filter(isAiRelevant);
    }

    for (const r of resources) {
      const normalized = normalizeResource(r);
      await upsertAgent(tenantId, normalized);
      found += 1;
    }

    await query(
      `UPDATE discovery_scans SET status='complete', agents_found=$2, finished_at=NOW() WHERE id=$1`,
      [scanId, found]
    );

    await logAudit({
      tenantId,
      actorId: userId,
      actorEmail,
      action: 'discovery_scan',
      detail: { scanId, agents_found: found, demo: useDemo },
    });

    return { scanId, agents_found: found, demo: useDemo };
  } catch (err) {
    await query(
      `UPDATE discovery_scans SET status='error', error=$2, finished_at=NOW() WHERE id=$1`,
      [scanId, err.message]
    );
    throw err;
  }
}

function startDiscoveryScheduler(getTenantIds) {
  const interval = config.discovery.intervalMs;
  if (!interval || interval < 60000) return;
  setInterval(async () => {
    try {
      const tenants = await getTenantIds();
      for (const id of tenants) {
        await runDiscovery(id, { actorEmail: 'scheduler' });
      }
    } catch (err) {
      console.error('Scheduled discovery failed:', err.message);
    }
  }, interval).unref();
  console.log(`Discovery scheduler started (every ${interval}ms)`);
}

module.exports = {
  runDiscovery,
  startDiscoveryScheduler,
  isAiRelevant,
  demoResources,
  AI_TYPE_PATTERNS,
};
