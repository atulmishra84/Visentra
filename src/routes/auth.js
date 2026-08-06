'use strict';
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../models/db');
const config = require('../config/index.js');
const { loginLimiter } = require('../middleware/rateLimit');
const { authenticate } = require('../middleware/auth');
const audit = require('../services/audit');

const router = express.Router();

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const result = await db.query(
      'SELECT * FROM users WHERE email = $1 LIMIT 1',
      [email.toLowerCase()]
    );
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Support both bcrypt and plain (legacy migration)
    const valid = user.password_hash?.startsWith('$2b$')
      ? await bcrypt.compare(password, user.password_hash)
      : user.password === password;

    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { sub: user.id, email: user.email, name: user.name, role: user.role },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    await audit.log({
      tenantId: user.tenant_id, userId: user.id, userEmail: user.email,
      action: audit.ACTIONS.LOGIN, resource: 'auth',
      details: { role: user.role, method: 'password' }, req,
    });

    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me — get current user
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const result = await db.query(
      'SELECT id, email, name, role, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    res.json(result.rows[0] || req.user);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', authenticate, async (req, res) => {
  await audit.log({
    tenantId: req.user.tenantId, userId: req.user.id,
    userEmail: req.user.email, action: audit.ACTIONS.LOGOUT,
    resource: 'auth', req,
  });
  res.json({ success: true });
});

module.exports = router;
