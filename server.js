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

const app = express();

app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true },
    frameguard: { action: 'deny' },
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
    const token = signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
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
      detail: { role: user.role },
      ...clientMeta(req),
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
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

app.post('/api/auth/logout', authenticate, csrfProtection, async (req, res) => {
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
  csrfProtection,
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
  csrfProtection,
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

// ── Module 1: Discovery / Inventory ─────────────────────
api.get('/agents', async (req, res) => {
  const { risk, phi } = req.query;
  const params = [req.tenantId];
  let sql = `SELECT * FROM agents WHERE tenant_id = $1`;
  if (risk) {
    params.push(risk);
    sql += ` AND risk_level = $${params.length}`;
  }
  if (phi === 'true') sql += ` AND phi_flagged = true`;
  sql += ` ORDER BY risk_score DESC, name`;
  const result = await query(sql, params);
  res.json({ agents: result.rows });
});

api.get('/agents/:id', async (req, res) => {
  const result = await query(`SELECT * FROM agents WHERE id = $1 AND tenant_id = $2`, [
    req.params.id,
    req.tenantId,
  ]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Agent not found' });
  res.json({ agent: result.rows[0] });
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
