'use strict';

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const config = require('./src/config');
const { query } = require('./src/models/db');
const { ensureRedis } = require('./src/models/redis');
const {
  ROLES,
  signToken,
  authenticate,
  requireRoles,
  requireWriteAccess,
  toUiRole,
} = require('./src/middleware/auth');
const { attachTenant, allowTenantOverride } = require('./src/middleware/tenant');
const { rateLimitAuth, csrfProtection, issueCsrfCookie } = require('./src/middleware/rateLimit');
const { logAudit, listAuditEvents } = require('./src/services/audit');
const mfa = require('./src/services/mfa');
const { runDiscovery, startDiscoveryScheduler } = require('./src/services/discovery');
const { detectPhi } = require('./src/services/phi');
const { scoreAgent } = require('./src/services/risk');
const { generateReport, toCsv } = require('./src/services/reports');
const { encrypt } = require('./src/utils/crypto');
const { mapAgentToProd, defaultControlsForNew } = require('./src/services/agentMapper');

const app = express();

app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: [
          "'self'",
          'https://api.anthropic.com',
          'https://login.microsoftonline.com',
          'https://graph.microsoft.com',
        ],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true },
    frameguard: { action: 'deny' },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

function setAuthCookie(res, token) {
  res.cookie('ar_token', token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    path: '/',
    maxAge: 8 * 60 * 60 * 1000,
  });
}

function clearAuthCookie(res) {
  res.clearCookie('ar_token', { path: '/' });
}

function clientMeta(req) {
  return {
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  };
}

// ── Health ──────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ status: 'ok', service: 'agentradar', ts: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'degraded', error: err.message });
  }
});

app.get('/api/csrf', (req, res) => {
  const token = issueCsrfCookie(res);
  res.json({ csrfToken: token });
});

// Auth routes: rate-limited; CSRF after login for mutations
app.post('/api/auth/login', rateLimitAuth, async (req, res) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    const password = String(req.body.password || '');
    const mfaCode = req.body.mfaCode;

    const result = await query(
      `SELECT * FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      await logAudit({
        action: 'login_failed',
        actorEmail: email,
        detail: { reason: 'invalid_credentials' },
        ...clientMeta(req),
      });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const needsMfa = mfa.roleRequiresMfa(user.role);
    if (needsMfa && user.mfa_enabled) {
      if (!mfaCode) {
        const challengeId = uuidv4();
        const redis = await ensureRedis();
        try {
          await redis.setex(`mfa:chal:${challengeId}`, 300, user.id);
        } catch {
          /* ignore */
        }
        return res.status(200).json({ mfaRequired: true, challengeId });
      }
      const ok = await mfa.verifyLoginCode(user, mfaCode);
      if (!ok) {
        return res.status(401).json({ error: 'Invalid MFA code' });
      }
    } else if (needsMfa && !user.mfa_enabled && mfaCode) {
      // allow password-only until enrolled; UI will prompt setup
    }

    await query(`UPDATE users SET last_login = NOW() WHERE id = $1`, [user.id]);
    const uiRole = toUiRole(user.role);
    const token = signToken({
      sub: user.id,
      email: user.email,
      role: uiRole,
      dbRole: user.role,
      uiRole,
      tenantId: user.tenant_id,
      name: user.name,
      mfaEnabled: user.mfa_enabled,
    });
    setAuthCookie(res, token);
    issueCsrfCookie(res);

    await logAudit({
      tenantId: user.tenant_id,
      actorId: user.id,
      actorEmail: user.email,
      action: 'login',
      detail: { role: user.role, uiRole },
      ...clientMeta(req),
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: uiRole,
        tenantId: user.tenant_id,
        mfaEnabled: user.mfa_enabled,
        mfaRequired: needsMfa,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/logout', authenticate, async (req, res) => {
  await logAudit({
    tenantId: req.user.tenantId,
    actorId: req.user.sub,
    actorEmail: req.user.email,
    action: 'logout',
    ...clientMeta(req),
  });
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', authenticate, async (req, res) => {
  const result = await query(
    `SELECT id, email, name, role, tenant_id, mfa_enabled, last_login FROM users WHERE id = $1`,
    [req.user.sub]
  );
  const u = result.rows[0];
  if (!u) return res.status(401).json({ error: 'User not found' });
  res.json({
    user: {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      tenantId: u.tenant_id,
      mfaEnabled: u.mfa_enabled,
      mfaRequired: mfa.roleRequiresMfa(u.role),
      lastLogin: u.last_login,
    },
  });
});

// MFA enrollment (Module 5)
app.post(
  '/api/mfa/setup',
  authenticate,
  requireRoles(ROLES.PLATFORM_ADMIN, ROLES.CISO),
  async (req, res) => {
    const result = await query(`SELECT id, email, role FROM users WHERE id = $1`, [req.user.sub]);
    const user = result.rows[0];
    const enrollment = await mfa.beginEnrollment(user);
    await logAudit({
      tenantId: req.user.tenantId,
      actorId: req.user.sub,
      actorEmail: req.user.email,
      action: 'mfa_setup_started',
      ...clientMeta(req),
    });
    res.json({ qrDataUrl: enrollment.qrDataUrl, secret: enrollment.secret });
  }
);

app.post(
  '/api/mfa/confirm',
  authenticate,
  requireRoles(ROLES.PLATFORM_ADMIN, ROLES.CISO),
  async (req, res) => {
    try {
      await mfa.confirmEnrollment(req.user.sub, req.body.code);
      await logAudit({
        tenantId: req.user.tenantId,
        actorId: req.user.sub,
        actorEmail: req.user.email,
        action: 'mfa_enabled',
        ...clientMeta(req),
      });
      res.json({ ok: true, mfaEnabled: true });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  }
);

// Protected API group
const api = express.Router();
api.use(authenticate);
api.use(attachTenant);
api.use(allowTenantOverride);
api.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // Bearer-authenticated SPA requests skip CSRF (production console)
  if (req.authVia === 'bearer') return next();
  return csrfProtection(req, res, next);
});

// ── Module 8: Tenants ───────────────────────────────────
api.get('/tenants', requireRoles(ROLES.PLATFORM_ADMIN), async (_req, res) => {
  const result = await query(`SELECT id, name, slug, status, created_at FROM tenants ORDER BY name`);
  res.json({ tenants: result.rows });
});

api.post('/tenants', requireRoles(ROLES.PLATFORM_ADMIN), async (req, res) => {
  const name = String(req.body.name || '').trim();
  const slug = String(req.body.slug || name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!name || !slug) return res.status(400).json({ error: 'name required' });
  const result = await query(
    `INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id, name, slug, status, created_at`,
    [name, slug]
  );
  await logAudit({
    tenantId: req.tenantId,
    actorId: req.user.sub,
    actorEmail: req.user.email,
    action: 'tenant_created',
    detail: { tenant: result.rows[0] },
    ...clientMeta(req),
  });
  res.status(201).json({ tenant: result.rows[0] });
});

// ── Module 4: Users / RBAC ──────────────────────────────
api.get(
  '/users',
  requireRoles(ROLES.PLATFORM_ADMIN, ROLES.CISO),
  async (req, res) => {
    const result = await query(
      `SELECT id, email, name, role, mfa_enabled, last_login, created_at
       FROM users WHERE tenant_id = $1 ORDER BY created_at`,
      [req.tenantId]
    );
    res.json({ users: result.rows });
  }
);

api.post('/users', requireRoles(ROLES.PLATFORM_ADMIN), requireWriteAccess, async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const name = String(req.body.name || '').trim();
  const role = String(req.body.role || 'analyst');
  const password = String(req.body.password || '');
  if (!email || !name || password.length < 12) {
    return res.status(400).json({ error: 'email, name, and password (12+) required' });
  }
  if (!Object.values(ROLES).includes(role)) {
    return res.status(400).json({ error: 'invalid role' });
  }
  const hash = await bcrypt.hash(password, 12);
  try {
    const result = await query(
      `INSERT INTO users (tenant_id, email, name, role, password_hash)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, email, name, role, mfa_enabled, created_at`,
      [req.tenantId, email, name, role, hash]
    );
    await logAudit({
      tenantId: req.tenantId,
      actorId: req.user.sub,
      actorEmail: req.user.email,
      action: 'user_provisioned',
      detail: { userId: result.rows[0].id, email, role },
      ...clientMeta(req),
    });
    res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'User already exists' });
    throw err;
  }
});

api.patch('/users/:id/role', requireRoles(ROLES.PLATFORM_ADMIN), async (req, res) => {
  const role = String(req.body.role || '');
  if (!Object.values(ROLES).includes(role)) {
    return res.status(400).json({ error: 'invalid role' });
  }
  const result = await query(
    `UPDATE users SET role = $1, updated_at = NOW()
     WHERE id = $2 AND tenant_id = $3
     RETURNING id, email, name, role`,
    [role, req.params.id, req.tenantId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
  await logAudit({
    tenantId: req.tenantId,
    actorId: req.user.sub,
    actorEmail: req.user.email,
    action: 'user_role_updated',
    detail: { userId: req.params.id, role },
    ...clientMeta(req),
  });
  res.json({ user: result.rows[0] });
});

// ── Module 1: Discovery / Inventory (production shape) ──
api.get('/agents', async (req, res) => {
  const { risk, phi } = req.query;
  const params = [req.tenantId];
  let sql = `SELECT * FROM agents WHERE tenant_id = $1`;
  if (risk) {
    params.push(risk);
    sql += ` AND (risk = $${params.length} OR risk_level = $${params.length})`;
  }
  if (phi === 'true') sql += ` AND (phi = true OR phi_flagged = true)`;
  sql += ` ORDER BY COALESCE(risk_score, 0) DESC, name LIMIT 500`;
  const result = await query(sql, params);
  // Production SPA expects a raw array
  res.json(result.rows.map(mapAgentToProd));
});

api.get('/agents/:id', async (req, res) => {
  const result = await query(`SELECT * FROM agents WHERE id = $1 AND tenant_id = $2`, [
    req.params.id,
    req.tenantId,
  ]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Agent not found' });
  res.json(mapAgentToProd(result.rows[0]));
});

api.post('/agents', requireWriteAccess, async (req, res) => {
  const a = req.body || {};
  const id = a.id || uuidv4();
  const name = String(a.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const type = a.type || a.resource_type || 'Manual';
  const risk = a.risk || 'medium';
  const risk_level = risk === 'critical' || risk === 'high' ? 'high' : risk === 'low' ? 'low' : 'medium';
  const phi = !!a.phi;
  const controls = a.controls || defaultControlsForNew();
  try {
    const result = await query(
      `INSERT INTO agents (
         id, tenant_id, name, resource_type, type, env, risk, risk_level, risk_score,
         shadow, phi, phi_flagged, pii, hosted, quarantined, approved, owner, detect,
         controls, protocols, metadata, notes, data_access, hipaa_status
       ) VALUES (
         $1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
         CASE WHEN $10 THEN 'fail' ELSE 'na' END
       )
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name, risk=EXCLUDED.risk, risk_level=EXCLUDED.risk_level,
         shadow=EXCLUDED.shadow, phi=EXCLUDED.phi, phi_flagged=EXCLUDED.phi_flagged,
         pii=EXCLUDED.pii, hosted=EXCLUDED.hosted, quarantined=EXCLUDED.quarantined,
         owner=EXCLUDED.owner, controls=EXCLUDED.controls, metadata=EXCLUDED.metadata,
         last_seen=NOW(), updated_at=NOW()
       RETURNING *`,
      [
        id,
        req.tenantId,
        name,
        type,
        a.env || 'Cloud',
        risk,
        risk_level,
        risk === 'critical' ? 90 : risk === 'high' ? 70 : risk === 'medium' ? 45 : 20,
        !!a.shadow,
        phi,
        !!a.pii || phi,
        a.hosted != null ? !!a.hosted : true,
        !!a.quarantined,
        !!a.approved,
        a.owner || null,
        a.detect || 'Manual registration',
        JSON.stringify(controls),
        JSON.stringify(a.protocols || []),
        JSON.stringify(a.metadata || {}),
        a.notes || null,
        a.data_access || null,
      ]
    );
    await logAudit({
      tenantId: req.tenantId,
      actorId: req.user.sub,
      actorEmail: req.user.email,
      action: 'agent_registered',
      detail: { agentId: id, name },
      ...clientMeta(req),
    });
    await query(
      `INSERT INTO activity_log (tenant_id, user_id, action, detail, agent_id, severity)
       VALUES ($1,$2,'agent.registered',$3,$4,'info')`,
      [req.tenantId, req.user.sub, `Registered ${name}`, id]
    );
    res.status(201).json(mapAgentToProd(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

api.patch('/agents/:id', requireWriteAccess, async (req, res) => {
  const updates = req.body || {};
  const allowed = [
    'name', 'type', 'env', 'risk', 'shadow', 'phi', 'pii', 'hosted', 'quarantined',
    'approved', 'owner', 'detect', 'notes', 'data_access', 'controls', 'protocols', 'metadata',
  ];
  const fields = Object.keys(updates).filter((k) => allowed.includes(k));
  if (!fields.length) return res.status(400).json({ error: 'No fields to update' });

  const sets = [];
  const params = [req.params.id, req.tenantId];
  for (const f of fields) {
    params.push(['controls', 'protocols', 'metadata'].includes(f) ? JSON.stringify(updates[f]) : updates[f]);
    sets.push(`${f} = $${params.length}`);
    if (f === 'phi') {
      params.push(!!updates.phi);
      sets.push(`phi_flagged = $${params.length}`);
    }
    if (f === 'risk') {
      const rl =
        updates.risk === 'critical' || updates.risk === 'high'
          ? 'high'
          : updates.risk === 'low'
            ? 'low'
            : 'medium';
      params.push(rl);
      sets.push(`risk_level = $${params.length}`);
    }
    if (f === 'type') {
      params.push(updates.type);
      sets.push(`resource_type = $${params.length}`);
    }
  }
  sets.push('updated_at = NOW()', 'last_seen = NOW()');
  const result = await query(
    `UPDATE agents SET ${sets.join(', ')} WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    params
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Agent not found' });
  await logAudit({
    tenantId: req.tenantId,
    actorId: req.user.sub,
    actorEmail: req.user.email,
    action: 'agent_updated',
    detail: { agentId: req.params.id, fields },
    ...clientMeta(req),
  });
  res.json(mapAgentToProd(result.rows[0]));
});

api.post(
  '/discovery/run',
  requireRoles(ROLES.PLATFORM_ADMIN, ROLES.CISO, ROLES.ANALYST),
  requireWriteAccess,
  async (req, res) => {
    try {
      const result = await runDiscovery(req.tenantId, {
        userId: req.user.sub,
        actorEmail: req.user.email,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

api.get('/discovery/scans', async (req, res) => {
  const result = await query(
    `SELECT * FROM discovery_scans WHERE tenant_id = $1 ORDER BY started_at DESC LIMIT 50`,
    [req.tenantId]
  );
  res.json({ scans: result.rows });
});

// ── Module 2: PHI ───────────────────────────────────────
api.get('/phi', async (req, res) => {
  const result = await query(
    `SELECT * FROM agents WHERE tenant_id = $1 AND phi_flagged = true
     ORDER BY hipaa_status, name`,
    [req.tenantId]
  );
  res.json({ agents: result.rows });
});

api.post(
  '/phi/:id/clear',
  requireRoles(ROLES.PLATFORM_ADMIN, ROLES.CISO, ROLES.ANALYST),
  requireWriteAccess,
  async (req, res) => {
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 5) return res.status(400).json({ error: 'Clear reason required' });

    const existing = await query(`SELECT * FROM agents WHERE id = $1 AND tenant_id = $2`, [
      req.params.id,
      req.tenantId,
    ]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Agent not found' });

    const agent = existing.rows[0];
    const rescored = scoreAgent({ ...agent, hipaa_status: 'cleared', phi_flagged: true });

    const result = await query(
      `UPDATE agents SET hipaa_status='cleared', phi_cleared_by=$3, phi_cleared_at=NOW(),
        phi_clear_reason=$4, risk_score=$5, risk_level=$6, risk_factors=$7,
        framework_scores=$8, updated_at=NOW()
       WHERE id=$1 AND tenant_id=$2
       RETURNING *`,
      [
        req.params.id,
        req.tenantId,
        req.user.sub,
        reason,
        rescored.risk_score,
        rescored.risk_level,
        JSON.stringify(rescored.risk_factors),
        JSON.stringify(rescored.framework_scores),
      ]
    );

    await logAudit({
      tenantId: req.tenantId,
      actorId: req.user.sub,
      actorEmail: req.user.email,
      action: 'agent_flagged',
      detail: { agentId: req.params.id, action: 'phi_cleared', reason },
      ...clientMeta(req),
    });

    res.json({ agent: result.rows[0] });
  }
);

// ── Module 3: Risk ──────────────────────────────────────
api.get('/risk/register', async (req, res) => {
  const result = await query(
    `SELECT id, name, resource_type, risk_score, risk_level, risk_factors,
            framework_scores, phi_flagged, hipaa_status
     FROM agents WHERE tenant_id = $1
     ORDER BY risk_score DESC`,
    [req.tenantId]
  );
  const summary = { high: 0, medium: 0, low: 0 };
  for (const a of result.rows) summary[a.risk_level] += 1;
  res.json({ summary, agents: result.rows });
});

// ── Module 6: Audit ─────────────────────────────────────
api.get('/audit', async (req, res) => {
  const events = await listAuditEvents(req.tenantId, {
    limit: Math.min(parseInt(req.query.limit || '100', 10), 1000),
    offset: parseInt(req.query.offset || '0', 10),
    action: req.query.action,
  });
  res.json({ events });
});

api.get('/audit/export', async (req, res) => {
  const events = await listAuditEvents(req.tenantId, { limit: 10000 });
  await logAudit({
    tenantId: req.tenantId,
    actorId: req.user.sub,
    actorEmail: req.user.email,
    action: 'compliance_export',
    detail: { type: 'audit', count: events.length, format: req.query.format || 'json' },
    ...clientMeta(req),
  });
  if (req.query.format === 'csv') {
    const header = 'id,created_at,action,actor_email,detail\n';
    const rows = events
      .map(
        (e) =>
          `${e.id},${e.created_at},${e.action},"${e.actor_email || ''}","${JSON.stringify(e.detail).replace(/"/g, '""')}"`
      )
      .join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=audit-export.csv');
    return res.send(header + rows);
  }
  res.setHeader('Content-Disposition', 'attachment; filename=audit-export.json');
  res.json({ events });
});

// ── Module 9: encrypted credentials store ───────────────
api.post(
  '/credentials',
  requireRoles(ROLES.PLATFORM_ADMIN),
  async (req, res) => {
    const name = String(req.body.name || '').trim();
    const provider = String(req.body.provider || 'azure').trim();
    const secret = String(req.body.secret || '');
    if (!name || !secret) return res.status(400).json({ error: 'name and secret required' });
    const enc = encrypt(secret);
    await query(
      `INSERT INTO integration_credentials (tenant_id, name, provider, ciphertext, iv, auth_tag)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tenant_id, name) DO UPDATE SET
         ciphertext=EXCLUDED.ciphertext, iv=EXCLUDED.iv, auth_tag=EXCLUDED.auth_tag,
         provider=EXCLUDED.provider, updated_at=NOW()`,
      [req.tenantId, name, provider, enc.ciphertext, enc.iv, enc.authTag]
    );
    await logAudit({
      tenantId: req.tenantId,
      actorId: req.user.sub,
      actorEmail: req.user.email,
      action: 'credential_stored',
      detail: { name, provider },
      ...clientMeta(req),
    });
    res.status(201).json({ ok: true, name, provider });
  }
);

// ── Module 10: Reports ──────────────────────────────────
api.get(
  '/reports/compliance',
  requireRoles(ROLES.PLATFORM_ADMIN, ROLES.CISO, ROLES.AUDITOR, ROLES.ANALYST),
  async (req, res) => {
    const sinceDays = parseInt(req.query.days || '90', 10);
    const report = await generateReport(req.tenantId, { sinceDays });
    await logAudit({
      tenantId: req.tenantId,
      actorId: req.user.sub,
      actorEmail: req.user.email,
      action: 'compliance_export',
      detail: { type: 'compliance_report', format: req.query.format || 'json' },
      ...clientMeta(req),
    });
    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=compliance-report.csv');
      return res.send(toCsv(report));
    }
    res.json({ report });
  }
);

// ── Production console compatibility routes ─────────────
api.use('/activity', require('./src/routes/activity'));
api.use('/autodiscovery', require('./src/routes/autodiscovery'));
api.use('/integrations/credentials', require('./src/routes/integrations'));
api.use('/compliance', require('./src/routes/compliance'));
api.use('/risk-acceptances', require('./src/routes/riskAcceptances'));
api.use('/webhooks', require('./src/routes/webhooks'));
api.use('/endpoint', require('./src/routes/endpoint'));
api.use('/proxy', require('./src/routes/proxy'));
api.use('/', require('./src/routes/governance'));
api.use('/', require('./src/routes/exports'));

app.get('/api/version', (_req, res) => {
  res.json({ name: 'agentradar', version: '1.0.0', ui: 'production-console' });
});

app.use('/api/auth/sso', require('./src/routes/sso'));
app.use('/api', api);

// Static SPA
app.use(express.static(path.join(__dirname)));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

async function boot() {
  await ensureRedis().catch(() => {});
  app.listen(config.port, () => {
    console.log(`AgentRadar API listening on :${config.port}`);
  });

  startDiscoveryScheduler(async () => {
    const r = await query(`SELECT id FROM tenants WHERE status = 'active'`);
    return r.rows.map((row) => row.id);
  });
}

boot();

module.exports = app;
