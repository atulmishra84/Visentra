'use strict';

const express = require('express');
const { query } = require('../models/db');
const { requireWriteAccess } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

const router = express.Router();

router.get('/', async (req, res) => {
  const result = await query(
    `SELECT id, name, url, type, events, enabled, last_fired, created_at
     FROM webhooks WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [req.tenantId]
  );
  res.json(result.rows);
});

router.post('/', requireWriteAccess, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const url = String(req.body.url || '').trim();
  if (!name || !url) return res.status(400).json({ error: 'name and url required' });
  const result = await query(
    `INSERT INTO webhooks (tenant_id, name, url, type, events, secret)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, url, type, events, enabled, created_at`,
    [
      req.tenantId,
      name,
      url,
      req.body.type || 'generic',
      JSON.stringify(req.body.events || ['all']),
      req.body.secret || null,
    ]
  );
  await logAudit({
    tenantId: req.tenantId,
    actorId: req.user.sub,
    actorEmail: req.user.email,
    action: 'webhook_created',
    detail: { id: result.rows[0].id, name },
  });
  res.status(201).json(result.rows[0]);
});

router.delete('/:id', requireWriteAccess, async (req, res) => {
  await query(`DELETE FROM webhooks WHERE id = $1 AND tenant_id = $2`, [
    req.params.id,
    req.tenantId,
  ]);
  res.json({ ok: true });
});

router.post('/:id/test', requireWriteAccess, async (req, res) => {
  const wh = await query(`SELECT * FROM webhooks WHERE id = $1 AND tenant_id = $2`, [
    req.params.id,
    req.tenantId,
  ]);
  if (!wh.rows[0]) return res.status(404).json({ error: 'Webhook not found' });
  await query(`UPDATE webhooks SET last_fired = NOW() WHERE id = $1`, [req.params.id]);
  res.json({ ok: true, tested: true, url: wh.rows[0].url });
});

module.exports = router;
