'use strict';
const express = require('express');
const db = require('../models/db');
const { authenticate, requireRole } = require('../middleware/auth');
const audit = require('../services/audit');

const router = express.Router();
const isPlatformAdmin = [authenticate, requireRole('platform_admin')];

// GET /api/admin/tenants
router.get('/tenants', ...isPlatformAdmin, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT t.id, t.name, t.slug, t.plan, t.created_at,
              COUNT(u.id)::int as user_count
       FROM tenants t
       LEFT JOIN users u ON u.tenant_id = t.id
       GROUP BY t.id, t.name, t.slug, t.plan, t.created_at
       ORDER BY t.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// GET /api/admin/tenant/:id/config
router.get('/tenant/:id/config', ...isPlatformAdmin, async (req, res, next) => {
  try {
    const result = await db.query(
      'SELECT config_key, config_val FROM tenant_config WHERE tenant_id = $1',
      [req.params.id]
    );
    const config = {};
    result.rows.forEach(r => { config[r.config_key] = r.config_val; });
    res.json(config);
  } catch (err) { next(err); }
});

// PUT /api/admin/tenant/:id/config
router.put('/tenant/:id/config', ...isPlatformAdmin, async (req, res, next) => {
  try {
    const { config_key, config_val } = req.body;
    if (!config_key || config_val === undefined) {
      return res.status(400).json({ error: 'config_key and config_val required' });
    }

    await db.query(
      `INSERT INTO tenant_config (tenant_id, config_key, config_val, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (tenant_id, config_key)
       DO UPDATE SET config_val = $3, updated_by = $4, updated_at = NOW()`,
      [req.params.id, config_key, JSON.stringify(config_val), req.user.email]
    );

    await audit.log({
      tenantId: req.params.id, userId: req.user.id, userEmail: req.user.email,
      action: audit.ACTIONS.CONFIG_UPDATE,
      details: { config_key, updated_by: req.user.email }, req,
    });

    res.json({ success: true, tenant_id: req.params.id, config_key, config_val });
  } catch (err) { next(err); }
});

// GET /api/admin/tenant/:id/users
router.get('/tenant/:id/users', ...isPlatformAdmin, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, email, name, role, created_at
       FROM users WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

module.exports = router;
