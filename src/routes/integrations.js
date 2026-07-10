'use strict';

const express = require('express');
const { query } = require('../models/db');
const { encrypt, decrypt } = require('../utils/crypto');
const { logAudit } = require('../services/audit');
const { requireWriteAccess, requireRoles, ROLES } = require('../middleware/auth');

const router = express.Router();

router.get('/', async (req, res) => {
  const result = await query(
    `SELECT id, name, provider, created_at, updated_at
     FROM integration_credentials WHERE tenant_id = $1 ORDER BY name`,
    [req.tenantId]
  );
  res.json(result.rows);
});

router.get('/full', requireRoles(ROLES.PLATFORM_ADMIN, ROLES.CISO), async (req, res) => {
  const result = await query(
    `SELECT id, name, provider, ciphertext, iv, auth_tag, created_at, updated_at
     FROM integration_credentials WHERE tenant_id = $1`,
    [req.tenantId]
  );
  const out = {};
  for (const row of result.rows) {
    try {
      const secret = decrypt({
        ciphertext: row.ciphertext,
        iv: row.iv,
        authTag: row.auth_tag,
      });
      out[row.name] = {
        provider: row.provider,
        secret: JSON.parse(secret),
        updated_at: row.updated_at,
      };
    } catch {
      out[row.name] = { provider: row.provider, secret: null, error: 'decrypt_failed' };
    }
  }
  res.json(out);
});

router.post('/', requireWriteAccess, async (req, res) => {
  const name = String(req.body.name || req.body.provider || '').trim();
  const provider = String(req.body.provider || name).trim();
  const secretPayload = req.body.secret || req.body.credentials || req.body;
  if (!name) return res.status(400).json({ error: 'name/provider required' });
  const enc = encrypt(JSON.stringify(secretPayload));
  await query(
    `INSERT INTO integration_credentials (tenant_id, name, provider, ciphertext, iv, auth_tag)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tenant_id, name) DO UPDATE SET
       provider=EXCLUDED.provider, ciphertext=EXCLUDED.ciphertext, iv=EXCLUDED.iv,
       auth_tag=EXCLUDED.auth_tag, updated_at=NOW()`,
    [req.tenantId, name, provider, enc.ciphertext, enc.iv, enc.authTag]
  );
  await logAudit({
    tenantId: req.tenantId,
    actorId: req.user.sub,
    actorEmail: req.user.email,
    action: 'credential_stored',
    detail: { name, provider },
  });
  res.status(201).json({ ok: true, name, provider });
});

router.delete('/:provider', requireWriteAccess, async (req, res) => {
  await query(
    `DELETE FROM integration_credentials WHERE tenant_id = $1 AND (provider = $2 OR name = $2)`,
    [req.tenantId, req.params.provider]
  );
  res.json({ ok: true });
});

module.exports = router;
