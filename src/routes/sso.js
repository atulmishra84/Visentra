'use strict';

const express = require('express');
const { query } = require('../models/db');
const { authenticate, requireRoles, ROLES } = require('../middleware/auth');
const config = require('../config');

const router = express.Router();

router.get('/providers', async (_req, res) => {
  res.json({
    providers: [
      {
        id: 'entra',
        name: 'Microsoft Entra ID',
        enabled: !!(config.azure && (process.env.AZURE_SSO_CLIENT_ID || '')),
      },
    ],
  });
});

router.get('/config', authenticate, async (req, res) => {
  const result = await query(
    `SELECT provider, enabled, client_id, tenant_azure, metadata, updated_at
     FROM sso_config WHERE tenant_id = $1`,
    [req.user.tenantId]
  );
  res.json({ configs: result.rows });
});

router.post('/config', authenticate, requireRoles(ROLES.PLATFORM_ADMIN, ROLES.CISO), async (req, res) => {
  const provider = req.body.provider || 'entra';
  await query(
    `INSERT INTO sso_config (tenant_id, provider, enabled, client_id, tenant_azure, metadata)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tenant_id, provider) DO UPDATE SET
       enabled=EXCLUDED.enabled, client_id=EXCLUDED.client_id,
       tenant_azure=EXCLUDED.tenant_azure, metadata=EXCLUDED.metadata, updated_at=NOW()`,
    [
      req.user.tenantId,
      provider,
      !!req.body.enabled,
      req.body.client_id || null,
      req.body.tenant_azure || null,
      JSON.stringify(req.body.metadata || {}),
    ]
  );
  res.json({ ok: true });
});

router.get('/:provider', (req, res) => {
  res.status(501).json({
    error: 'SSO redirect not configured',
    provider: req.params.provider,
    hint: 'Configure AZURE_SSO_CLIENT_ID / secret and enable via /api/auth/sso/config',
  });
});

router.get('/:provider/callback', (req, res) => {
  res.status(501).json({ error: 'SSO callback not configured', provider: req.params.provider });
});

module.exports = router;
