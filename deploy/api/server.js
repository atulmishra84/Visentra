'use strict';
// ── Async error wrapper ─────────────────────────────────
const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ── Simple in-memory cache (30s TTL) ─────────────────────
const _cache = new Map();
function getCache(key) {
  const item = _cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expires) { _cache.delete(key); return null; }
  return item.value;
}
function setCache(key, value, ttlMs=30000) {
  _cache.set(key, { value, expires: Date.now() + ttlMs });
}
function clearCache(pattern) {
  for (const key of _cache.keys())
    if (key.includes(pattern)) _cache.delete(key);
}


const express     = require('express');
const { z }       = require('zod');
const winston     = require('winston');

// ── Structured Logger ─────────────────────────────────────
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'agentradar-api' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({timestamp,level,message,...meta}) =>
          `${timestamp} [${level}] ${message} ${Object.keys(meta).length?JSON.stringify(meta):''}`)
      )
    })
  ]
});

// Replace console.log/error with structured logger
const origLog = console.log;
const origErr = console.error;
console.log = (...args) => logger.info(args.join(' '));
console.error = (...args) => logger.error(args.join(' '));

// ══ ZOD VALIDATION SCHEMAS ═════════════════════════════════
const schemas = {
  login: z.object({
    email: z.string().email('Invalid email format'),
    password: z.string().min(1, 'Password required'),
  }),

  agent: z.object({
    name: z.string().min(1).max(255),
    type: z.string().min(1).max(50),
    env: z.enum(['Cloud','On-Prem','Hybrid']).default('Cloud'),
    risk: z.enum(['critical','high','medium','low']).default('medium'),
    shadow: z.boolean().default(false),
    phi: z.boolean().default(false),
    pii: z.boolean().default(false),
    protocols: z.array(z.string()).default([]),
    notes: z.string().max(2000).optional(),
    owner: z.string().max(255).optional(),
    domain: z.string().max(255).optional(),
    detect: z.string().max(255).optional(),
  }),

  webhook: z.object({
    name: z.string().min(1).max(255),
    url: z.string().url('Invalid webhook URL'),
    type: z.enum(['slack','teams','generic']).default('generic'),
    events: z.array(z.string()).default(['agent.discovered','policy.violation']),
    secret: z.string().max(255).optional(),
  }),

  changePassword: z.object({
    current_password: z.string().min(1),
    new_password: z.string().min(12, 'Password must be at least 12 characters'),
  }),

  tenant: z.object({
    name: z.string().min(1).max(255),
    domain: z.string().max(255).optional(),
    plan: z.enum(['trial','starter','professional','enterprise']).default('trial'),
    admin_email: z.string().email(),
    admin_password: z.string().min(12),
  }),

  autodiscovery: z.object({
    azure: z.object({
      tenantId: z.string().min(1),
      clientId: z.string().min(1),
      clientSecret: z.string().min(1),
      subscriptionId: z.string().min(1),
    }).optional(),
    aws: z.object({
      accessKeyId: z.string().min(16).max(128),
      secretAccessKey: z.string().min(1),
      region: z.string().default('us-east-1'),
    }).optional(),
    gcp: z.object({
      projectId: z.string().min(1),
      serviceAccountKey: z.string().min(1),
    }).optional(),
    network: z.object({
      cidrRanges: z.array(z.string()).min(1),
    }).optional(),
  }).refine(data => Object.keys(data).length > 0, {
    message: 'At least one cloud provider must be specified'
  }),
};

// Validation middleware factory
function validate(schema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch(e) {
      if (e instanceof z.ZodError) {
        logger.warn('Validation error', { path: req.path, errors: e.errors });
        return res.status(400).json({
          error: 'Validation failed',
          details: e.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        });
      }
      next(e);
    }
  };
}

const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const morgan      = require('morgan');
const { Pool }    = require('pg');
const Redis       = require('ioredis');
const jwt         = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { DefaultAzureCredential } = require('@azure/identity');
const { SecretClient }           = require('@azure/keyvault-secrets');

// ── Config ────────────────────────────────────────────────
const PORT          = process.env.PORT          || 4000;
const KV_URI        = process.env.KEYVAULT_URI  || '';
const DB_HOST       = process.env.POSTGRES_HOST || 'localhost';
const DB_PORT       = parseInt(process.env.POSTGRES_PORT || '5432');
const DB_NAME       = process.env.POSTGRES_DB   || 'agentRadar';
const DB_USER       = process.env.POSTGRES_USER || 'agentRadar';
const REDIS_HOST    = process.env.REDIS_HOST    || 'localhost';
const REDIS_PORT    = parseInt(process.env.REDIS_PORT || '6380');
const REDIS_TLS     = process.env.REDIS_TLS     !== 'false';

let db, redis, jwtSecret;

// ── Load secrets from Azure Key Vault (Managed Identity) ─
async function loadSecrets() {
  if (!KV_URI) {
    // Local dev: read from env vars directly
    console.log('[secrets] KV_URI not set — using env vars (local dev mode)');
    return {
      dbPassword:    process.env.DB_PASSWORD     || 'localdev',
      jwtSecret:     process.env.JWT_SECRET      || 'localdev-jwt-secret-change-in-prod',
      encryptionKey: process.env.ENCRYPTION_KEY  || 'localdev-enc-key-32-chars-padded',
      redisPassword: process.env.REDIS_PASSWORD  || '',
    };
  }

  console.log(`[secrets] Loading from Key Vault: ${KV_URI}`);
  const cred   = new DefaultAzureCredential();
  const client = new SecretClient(KV_URI, cred);

  const [dbPassword, jwtSec, encKey, redisPwd] = await Promise.all([
    client.getSecret('db-password'),
    client.getSecret('jwt-secret'),
    client.getSecret('encryption-key'),
    client.getSecret('redis-password'),
  ]);

  return {
    dbPassword:    dbPassword.value,
    jwtSecret:     jwtSec.value,
    encryptionKey: encKey.value,
    redisPassword: redisPwd.value,
  };
}

// ── Database pool ─────────────────────────────────────────
function createDb(password) {
  return new Pool({
    host:     DB_HOST,
    port:     DB_PORT,
    database: DB_NAME,
    user:     DB_USER,
    password,
    ssl:      { rejectUnauthorized: false },
    max:      20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

// ── Redis client ──────────────────────────────────────────
function createRedis(password) {
  return new Redis({
    host:            REDIS_HOST,
    port:            REDIS_PORT,
    password:        password || undefined,
    tls:             REDIS_TLS ? {} : undefined,
    retryStrategy:   n => Math.min(n * 200, 5000),
    enableReadyCheck: true,
    lazyConnect:     true,
  });
}

// ── Express app ───────────────────────────────────────────
const app = express();

app.set('trust proxy', 1); // Trust NGINX ingress
app.use(compression());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.ALLOWED_ORIGINS || '*', credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', {
  stream: { write: msg => logger.http(msg.trim()) }
}));

// Log all API requests with structured data
app.use('/api/', (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info('API request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: Date.now()-start+'ms',
      ip: req.ip,
      user: req.user?.email || 'anonymous'
    });
  });
  next();
});

// Rate limiting
app.use('/api/', rateLimit({ windowMs: 60_000, max: 500, standardHeaders: true, legacyHeaders: false }));

// ── Health endpoint (no auth) ─────────────────────────────
// ── API Version info ─────────────────────────────────────
app.get('/api/version', (req, res) => {
  res.json({
    version: '1.0.0',
    api: 'v1',
    platform: 'AgentRadar',
    uptime: Math.floor(process.uptime()),
    node: process.version,
  });
});

app.get('/health', async (req, res) => {
  const checks = { api: 'ok', db: 'unknown', redis: 'unknown' };
  try {
    await db.query('SELECT 1');
    checks.db = 'ok';
  } catch { checks.db = 'error'; }
  try {
    await redis.ping();
    checks.redis = 'ok';
  } catch { checks.redis = 'error'; }

  const allOk = Object.values(checks).every(v => v === 'ok');
  res.status(allOk ? 200 : 503).json({ status: allOk ? 'healthy' : 'degraded', checks, uptime: process.uptime() });
});

// ── Auth middleware ───────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ── Auth routes ───────────────────────────────────────────
app.post('/api/auth/login', validate(schemas.login), async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const result = await db.query(
      'SELECT id, email, name, role, password_hash FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const bcrypt = require('bcryptjs');
    const valid  = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { sub: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenant_id },
      jwtSecret,
      { expiresIn: '8h' }
    );

    // Store session in Redis (15 min inactivity timeout)
    await redis.setex(`session:${user.id}`, 900, token);

    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (e) {
    console.error('[auth] login error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/logout', auth, async (req, res) => {
  await redis.del(`session:${req.user.sub}`).catch(() => {});
  res.json({ ok: true });
});

// ── Agents CRUD ───────────────────────────────────────────
app.get('/api/agents', auth, asyncHandler(async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, type, env, risk, shadow, phi, pii, hosted, quarantined,
              last_seen, owner, controls, first_detected, metadata
       FROM agents ORDER BY risk DESC, last_seen DESC LIMIT 500`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}));

app.post('/api/agents', auth, validate(schemas.agent), async (req, res) => {
  const a = req.body;
  try {
    const { rows } = await db.query(
      `INSERT INTO agents (id, name, type, env, risk, shadow, phi, pii, hosted,
                           quarantined, owner, controls, metadata, first_detected)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
       ON CONFLICT (id) DO UPDATE SET
         name=$2, risk=$5, shadow=$6, phi=$7, pii=$8, hosted=$9,
         quarantined=$10, owner=$11, controls=$12, metadata=$13, last_seen=NOW()
       RETURNING *`,
      [a.id || uuidv4(), a.name, a.type, a.env, a.risk || 'medium',
       !!a.shadow, !!a.phi, !!a.pii, !!a.hosted, !!a.quarantined,
       a.owner, JSON.stringify(a.controls || {}), JSON.stringify(a.metadata || {})]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/agents/:id', auth, async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const fields  = Object.keys(updates).filter(k => !['id'].includes(k));
  if (!fields.length) return res.status(400).json({ error: 'No fields to update' });

  const sets   = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
  const values = [id, ...fields.map(f => updates[f])];

  try {
    const { rows } = await db.query(
      `UPDATE agents SET ${sets}, last_seen = NOW() WHERE id = $1 RETURNING *`, values
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Compliance results ────────────────────────────────────
app.get('/api/compliance/:agentId', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM compliance_results WHERE agent_id = $1 ORDER BY assessed_at DESC',
      [req.params.agentId]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Activity log ──────────────────────────────────────────
app.get('/api/activity', auth, asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100'), 500);
  try {
    const { rows } = await db.query(
      'SELECT * FROM activity_log ORDER BY created_at DESC LIMIT $1', [limit]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}));

app.post('/api/activity', auth, async (req, res) => {
  const { action, detail, agent_id, severity } = req.body;
  try {
    const { rows } = await db.query(
      `INSERT INTO activity_log (id, user_id, action, detail, agent_id, severity)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [uuidv4(), req.user.sub, action, detail, agent_id, severity || 'info']
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Risk acceptances ──────────────────────────────────────
app.get('/api/risk-acceptances', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM risk_acceptances ORDER BY created_at DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/risk-acceptances', auth, async (req, res) => {
  const { agent_id, framework, justification, expires_at } = req.body;
  try {
    const { rows } = await db.query(
      `INSERT INTO risk_acceptances (id, agent_id, framework, justification, expires_at, accepted_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [uuidv4(), agent_id, framework, justification, expires_at, req.user.sub]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 404 ───────────────────────────────────────────────────

// ── Tenant middleware ────────────────────────────────
async function setTenantContext(tenantId) {
  if (tenantId) {
    await db.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId.toString()]);
  }
}

async function tenantMiddleware(req, res, next) {
  if (req.user?.tenantId) {
    try { await setTenantContext(req.user.tenantId); } catch(e) {}
  }
  next();
}
app.use('/api/', tenantMiddleware);

// ── Admin audit log ───────────────────────────────────
async function auditLog(adminEmail, action, tenantId, resource, details, ip) {
  try {
    await db.query(
      'INSERT INTO admin_audit_log (admin_email,action,tenant_id,resource,details,ip_address) VALUES ($1,$2,$3,$4,$5,$6)',
      [adminEmail, action, tenantId||null, resource||null, JSON.stringify(details||{}), ip||null]
    );
  } catch(e) { console.error('[audit]', e.message); }
}

// ── Tenant management (platform admin only) ───────────
app.get('/api/admin/tenants', auth, async (req, res) => {
  if (req.user.role !== 'platform_admin')
    return res.status(403).json({ error: 'Platform admin access required' });
  await auditLog(req.user.email, 'list_tenants', null, 'tenants', {}, req.ip);
  try {
    const r = await db.query('SELECT id,name,domain,plan,active,created_at FROM tenants ORDER BY created_at DESC');
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/tenants', auth, async (req, res) => {
  if (req.user.role !== 'platform_admin')
    return res.status(403).json({ error: 'Platform admin access required' });
  const { name, domain, plan, admin_email, admin_password } = req.body;
  if (!name || !admin_email || !admin_password)
    return res.status(400).json({ error: 'name, admin_email and admin_password required' });
  try {
    // Create tenant
    const t = await db.query(
      'INSERT INTO tenants (name,domain,plan) VALUES ($1,$2,$3) RETURNING *',
      [name, domain||null, plan||'trial']
    );
    const tenant = t.rows[0];
    // Create tenant admin user
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(admin_password, 12);
    await db.query(
      'INSERT INTO users (email,name,role,password_hash,tenant_id) VALUES ($1,$2,$3,$4,$5)',
      [admin_email.toLowerCase(), name+' Admin', 'ciso', hash, tenant.id]
    );
    await auditLog(req.user.email, 'create_tenant', tenant.id, 'tenants', {name, admin_email}, req.ip);
    res.json({ tenant, message: 'Tenant created with admin user' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Customer data export ──────────────────────────────
app.get('/api/export', auth, async (req, res) => {
  await setTenantContext(req.user.tenantId);
  await auditLog(req.user.email, 'data_export', req.user.tenantId, 'all', {}, req.ip);
  try {
    const [agents, acts, hooks] = await Promise.all([
      db.query('SELECT * FROM agents WHERE tenant_id=$1', [req.user.tenantId]),
      db.query('SELECT * FROM activity WHERE tenant_id=$1', [req.user.tenantId]),
      db.query('SELECT id,name,url,type,events,active,created_at FROM webhooks WHERE tenant_id=$1', [req.user.tenantId])
    ]);
    res.json({
      exported_at: new Date().toISOString(),
      tenant_id: req.user.tenantId,
      agents: agents.rows,
      activity: acts.rows,
      webhooks: hooks.rows
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Customer data deletion (GDPR right to erasure) ────
app.delete('/api/tenant/data', auth, async (req, res) => {
  if (req.user.role !== 'ciso')
    return res.status(403).json({ error: 'CISO role required to delete tenant data' });
  const { confirm } = req.body;
  if (confirm !== 'DELETE ALL DATA')
    return res.status(400).json({ error: 'Send confirm: "DELETE ALL DATA" to proceed' });
  await auditLog(req.user.email, 'delete_all_data', req.user.tenantId, 'all', {}, req.ip);
  try {
    await db.query('DELETE FROM activity WHERE tenant_id=$1', [req.user.tenantId]);
    await db.query('DELETE FROM webhooks WHERE tenant_id=$1', [req.user.tenantId]);
    await db.query('DELETE FROM risk_acceptances WHERE tenant_id=$1', [req.user.tenantId]);
    await db.query('DELETE FROM agents WHERE tenant_id=$1', [req.user.tenantId]);
    res.json({ deleted: true, message: 'All tenant data permanently deleted' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Admin audit log viewer (customer can see who accessed their data) ──
app.get('/api/audit-log', auth, async (req, res) => {
  try {
    const r = await db.query(
      'SELECT admin_email,action,resource,details,ip_address,created_at FROM admin_audit_log WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100',
      [req.user.tenantId]
    );
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Scanner results ──────────────────────────────────
app.post('/api/scan/result', auth, async (req, res) => {
  const { scanner_id, agents: discovered } = req.body;
  if (!scanner_id || !Array.isArray(discovered)) {
    return res.status(400).json({ error: 'scanner_id and agents array required' });
  }
  const results = [];
  for (const agent of discovered) {
    try {
      const existing = await db.query(
        'SELECT id FROM agents WHERE name=$1', [agent.name]
      );
      if (existing.rows.length > 0) {
        await db.query('UPDATE agents SET last_seen=NOW(),updated_at=NOW() WHERE id=$1',
          [existing.rows[0].id]);
        results.push({ id: existing.rows[0].id, action: 'updated' });
      } else {
        const r = await db.query(
          `INSERT INTO agents (id,name,type,env,risk,shadow,phi,pii,protocols,controls,metadata,detect,first_detected,last_seen,created_at,updated_at)
           VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW(),NOW(),NOW()) RETURNING id`,
          [agent.name, agent.type||'unknown', agent.env||'Cloud', agent.risk||'medium',
           agent.shadow||false, agent.phi||false, agent.pii||false,
           JSON.stringify(agent.protocols||[]), JSON.stringify(agent.controls||{}),
           JSON.stringify(agent.metadata||{}), scanner_id,
           req.user?.tenantId||'00000000-0000-0000-0000-000000000001']
        );
        const newId = r.rows[0].id;
        await db.query(
          'INSERT INTO activity (category,description,agent_id,created_by) VALUES ($1,$2,$3,$4)',
          ['discovery', scanner_id+' discovered: '+agent.name, newId, 'scanner']
        );
        if (agent.shadow || agent.risk==='critical' || agent.risk==='high') {
          fireWebhook('agent.discovered', { agent, scanner_id });
        }
        results.push({ id: newId, action: 'created' });
      }
    } catch(e) { console.error('[scan] Error:', e.message); }
  }
  res.json({ saved: results.length, results });
});

// ── Webhooks ──────────────────────────────────────────
app.get('/api/webhooks', auth, async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM webhooks ORDER BY created_at DESC');
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/webhooks', auth, validate(schemas.webhook), async (req, res) => {
  const { name, url, type, events, secret } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'name and url required' });
  try {
    const r = await db.query(
      'INSERT INTO webhooks (name,url,type,events,secret) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [name, url, type||'generic', JSON.stringify(events||['agent.discovered','policy.violation']), secret||null]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/webhooks/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM webhooks WHERE id=$1', [req.params.id]);
    res.json({ deleted: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/webhooks/:id/test', auth, async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM webhooks WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Webhook not found' });
    await fireWebhook('test', { message: 'AgentRadar webhook test', hook: r.rows[0].name });
    res.json({ fired: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Password change ───────────────────────────────────
app.post('/api/auth/change-password', auth, validate(schemas.changePassword), async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password)
    return res.status(400).json({ error: 'current_password and new_password required' });
  if (new_password.length < 12)
    return res.status(400).json({ error: 'Password must be at least 12 characters' });
  try {
    const r = await db.query('SELECT id,password_hash FROM users WHERE id=$1', [req.user.sub]);
    const user = r.rows[0];
    const bcrypt = require('bcryptjs');
    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password incorrect' });
    const newHash = await bcrypt.hash(new_password, 12);
    await db.query('UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2', [newHash, user.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Webhook fire function ─────────────────────────────
async function fireWebhook(event, payload) {
  try {
    const hooks = await db.query(
      "SELECT * FROM webhooks WHERE active=true AND events::text LIKE $1",
      ['%'+event+'%']
    );
    for (const hook of hooks.rows) {
      try {
        const body = hook.type==='slack'
          ? { text: '*AgentRadar*: '+event+' — '+(payload.agent?.name||payload.message||'') }
          : hook.type==='teams'
          ? { '@type':'MessageCard','@context':'http://schema.org/extensions',
              summary:'AgentRadar: '+event,
              sections:[{activityTitle:'AgentRadar — '+event,
                activityText:'Agent: **'+(payload.agent?.name||'')+'** | Risk: '+(payload.agent?.risk||'')+' | Scanner: '+(payload.scanner_id||'')}] }
          : { event, payload, timestamp: new Date().toISOString(), source:'AgentRadar' };
        await fetch(hook.url, {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify(body)
        });
        await db.query('UPDATE webhooks SET fire_count=fire_count+1 WHERE id=$1', [hook.id]);
      } catch(e) { console.error('[webhook] Fire failed:', e.message); }
    }
  } catch(e) { console.error('[webhook] DB error:', e.message); }
}


// ══════════════════════════════════════════════════════
// SSO / OIDC — Azure AD, Okta, Google, AWS SSO
// ══════════════════════════════════════════════════════
const { Issuer, generators } = require('openid-client');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

// Session store in PostgreSQL
app.use(session({
  store: new pgSession({ pool: db, tableName: 'user_sessions', createTableIfMissing: true }),
  secret: process.env.JWT_SECRET || 'agentRadar-session-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: true, httpOnly: true, maxAge: 8 * 60 * 60 * 1000 }
}));

// SSO provider configs (loaded from env)
const SSO_PROVIDERS = {
  azure: {
    name: 'Azure AD',
    issuerUrl: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID||'common'}/v2.0`,
    clientId: process.env.AZURE_SSO_CLIENT_ID,
    clientSecret: process.env.AZURE_SSO_CLIENT_SECRET,
    scope: 'openid profile email',
    enabled: !!(process.env.AZURE_SSO_CLIENT_ID)
  },
  okta: {
    name: 'Okta',
    issuerUrl: `https://${process.env.OKTA_DOMAIN||''}`,
    clientId: process.env.OKTA_CLIENT_ID,
    clientSecret: process.env.OKTA_CLIENT_SECRET,
    scope: 'openid profile email',
    enabled: !!(process.env.OKTA_CLIENT_ID && process.env.OKTA_DOMAIN)
  },
  google: {
    name: 'Google',
    issuerUrl: 'https://accounts.google.com',
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    scope: 'openid profile email',
    enabled: !!(process.env.GOOGLE_CLIENT_ID)
  },
  aws: {
    name: 'AWS SSO',
    issuerUrl: `https://oidc.${process.env.AWS_SSO_REGION||'us-east-1'}.amazonaws.com`,
    clientId: process.env.AWS_SSO_CLIENT_ID,
    clientSecret: process.env.AWS_SSO_CLIENT_SECRET,
    scope: 'openid profile email',
    enabled: !!(process.env.AWS_SSO_CLIENT_ID && process.env.AWS_SSO_INSTANCE_ID)
  }
};

const oidcClients = {};

async function getOIDCClient(provider) {
  if (oidcClients[provider]) return oidcClients[provider];
  const cfg = SSO_PROVIDERS[provider];
  if (!cfg || !cfg.enabled) throw new Error(`SSO provider ${provider} not configured`);
  try {
    const issuer = await Issuer.discover(cfg.issuerUrl);
    oidcClients[provider] = new issuer.Client({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uris: [`${process.env.APP_URL||'https://agentradar.idenaccess.com'}/api/auth/sso/${provider}/callback`],
      response_types: ['code']
    });
    return oidcClients[provider];
  } catch(e) {
    throw new Error(`Failed to init OIDC for ${provider}: ${e.message}`);
  }
}

// GET /api/auth/sso/providers — list enabled SSO providers
app.get('/api/auth/sso/providers', (req, res) => {
  const enabled = Object.entries(SSO_PROVIDERS)
    .filter(([,v]) => v.enabled)
    .map(([k,v]) => ({ id: k, name: v.name }));
  res.json({ providers: enabled });
});

// GET /api/auth/sso/:provider — initiate SSO login
app.get('/api/auth/sso/:provider', async (req, res) => {
  const { provider } = req.params;
  try {
    const client = await getOIDCClient(provider);
    const state = generators.state();
    const nonce = generators.nonce();
    req.session.sso = { state, nonce, provider };
    const url = client.authorizationUrl({
      scope: SSO_PROVIDERS[provider].scope,
      state, nonce
    });
    res.redirect(url);
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/auth/sso/:provider/callback — SSO callback
app.get('/api/auth/sso/:provider/callback', async (req, res) => {
  const { provider } = req.params;
  try {
    const client = await getOIDCClient(provider);
    const { state, nonce } = req.session.sso || {};
    const params = client.callbackParams(req);
    const tokenSet = await client.callback(
      `${process.env.APP_URL||'https://agentradar.idenaccess.com'}/api/auth/sso/${provider}/callback`,
      params, { state, nonce }
    );
    const userinfo = await client.userinfo(tokenSet);
    const email = userinfo.email?.toLowerCase();
    if (!email) return res.status(400).json({ error: 'No email in SSO response' });

    // Find or create user
    let user = (await db.query('SELECT * FROM users WHERE email=$1', [email])).rows[0];
    if (!user) {
      const r = await db.query(
        `INSERT INTO users (email, name, role, password_hash)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [email, userinfo.name||email.split('@')[0], 'viewer', 'SSO_USER']
      );
      user = r.rows[0];
      await db.query(
        'INSERT INTO activity (category,description,created_by) VALUES ($1,$2,$3)',
        ['registration', `New SSO user: ${email} via ${provider}`, 'sso']
      );
    }

    // Issue JWT
    const token = jwt.sign(
      { sub: user.id, email: user.email, name: user.name, role: user.role, sso: provider },
      jwtSecret, { expiresIn: '8h' }
    );
    await redis.setex(`session:${user.id}`, 28800, token);

    // Redirect to frontend with token
    res.redirect(`https://agentradar.idenaccess.com/#sso-token=${token}`);
  } catch(e) {
    console.error('[SSO] Callback error:', e.message);
    res.redirect(`https://agentradar.idenaccess.com/#sso-error=${encodeURIComponent(e.message)}`);
  }
});


// ══ ADMIN DOWNLOAD PORTAL ══════════════════════════════════
const archiver = require('archiver');

function platformAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role !== 'platform_admin')
    return res.status(403).json({ error: 'Platform admin access required' });
  auditLog(req.user.email, 'admin_portal_access', null, req.path, {ip: req.ip}, req.ip).catch(()=>{});
  next();
}

app.get('/api/admin/stats', auth, platformAdmin, async (req, res) => {
  try {
    const [t,u,a,d] = await Promise.all([
      db.query('SELECT COUNT(*) FROM tenants WHERE active=true'),
      db.query('SELECT COUNT(*) FROM users'),
      db.query('SELECT COUNT(*) FROM agents'),
      db.query("SELECT COUNT(*) FROM admin_audit_log WHERE action='download_package'"),
    ]);
    res.json({ tenants:+t.rows[0].count, users:+u.rows[0].count, agents:+a.rows[0].count, downloads:+d.rows[0].count });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/tenants', auth, platformAdmin, async (req, res) => {
  await auditLog(req.user.email, 'list_tenants', null, 'tenants', {}, req.ip);
  try {
    const r = await db.query('SELECT id,name,domain,plan,active,created_at FROM tenants ORDER BY created_at DESC');
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/tenants', auth, platformAdmin, async (req, res) => {
  const { name, domain, plan, admin_email, admin_password } = req.body;
  if (!name || !admin_email || !admin_password)
    return res.status(400).json({ error: 'name, admin_email and admin_password required' });
  try {
    const t = await db.query('INSERT INTO tenants (name,domain,plan) VALUES ($1,$2,$3) RETURNING *',
      [name, domain||null, plan||'trial']);
    const tenant = t.rows[0];
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(admin_password, 12);
    await db.query('INSERT INTO users (email,name,role,password_hash,tenant_id) VALUES ($1,$2,$3,$4,$5)',
      [admin_email.toLowerCase(), name+' Admin', 'ciso', hash, tenant.id]);
    await auditLog(req.user.email, 'create_tenant', tenant.id, 'tenants', {name, admin_email}, req.ip);
    res.json({ tenant, message: 'Tenant created' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/download/:pkg', auth, platformAdmin, async (req, res) => {
  const pkg = req.params.pkg;
  const allowed = ['azure','gcp','aws','onprem','auth-guide','integration-guide'];
  if (!allowed.includes(pkg)) return res.status(400).json({ error: 'Invalid package' });
  await auditLog(req.user.email, 'download_package', null, pkg, {ip: req.ip}, req.ip);

  const scripts = {
    azure: `#!/bin/bash\n# AgentRadar Azure BYOC Deployment\n# Run: DOMAIN=agentradar.yourdomain.com bash deploy.sh\nset -e\nRG=\${RESOURCE_GROUP:-rg-agentradar}\nLOC=\${LOCATION:-westeurope}\nDOMAIN=\${DOMAIN:-agentradar.yourdomain.com}\necho "Deploying AgentRadar to Azure..."\naz group create --name $RG --location $LOC --output none\naz aks create --resource-group $RG --name aks-agentradar --node-count 2 --node-vm-size Standard_D4s_v3 --enable-managed-identity --network-plugin azure --generate-ssh-keys --output none\naz aks get-credentials --resource-group $RG --name aks-agentradar\nDB_PASS=$(openssl rand -base64 24 | tr -d '=/+' | head -c 32)\nJWT=$(openssl rand -base64 48)\necho "✅ Next: install nginx, cert-manager, then helm deploy"\necho "See full guide at https://agentradar.idenaccess.com/docs"`,
    gcp: `#!/bin/bash\n# AgentRadar GCP BYOC Deployment\n# Run: PROJECT_ID=myproject DOMAIN=agentradar.yourdomain.com bash deploy-gcp.sh\nset -e\nPROJECT=\${PROJECT_ID:-$(gcloud config get-value project)}\nREGION=\${REGION:-us-central1}\nDOMAIN=\${DOMAIN:-agentradar.yourdomain.com}\necho "Deploying AgentRadar to GCP project: $PROJECT"\ngcloud services enable container.googleapis.com sqladmin.googleapis.com redis.googleapis.com --project=$PROJECT --quiet\ngcloud container clusters create agentradar-prod --project=$PROJECT --region=$REGION --num-nodes=2 --machine-type=e2-standard-4 --quiet\necho "✅ GKE cluster created. Next: Cloud SQL + Memorystore + Helm deploy"\necho "See full guide at https://agentradar.idenaccess.com/docs"`,
    aws: `#!/bin/bash\n# AgentRadar AWS BYOC Deployment\n# Run: AWS_REGION=us-east-1 DOMAIN=agentradar.yourdomain.com bash deploy-aws.sh\nset -e\nREGION=\${AWS_REGION:-us-east-1}\nDOMAIN=\${DOMAIN:-agentradar.yourdomain.com}\nACCOUNT=$(aws sts get-caller-identity --query Account --output text)\necho "Deploying AgentRadar to AWS account: $ACCOUNT"\neksctl create cluster --name agentradar-prod --region $REGION --nodes 2 --node-type m5.xlarge --managed\necho "✅ EKS cluster created. Next: RDS + ElastiCache + Helm deploy"\necho "See full guide at https://agentradar.idenaccess.com/docs"`,
    onprem: `version: '3.8'\nservices:\n  frontend:\n    image: ghcr.io/agentradar/agentradar-frontend:latest\n    ports: ["80:80"]\n  api:\n    image: ghcr.io/agentradar/agentradar-api:latest\n    environment:\n      POSTGRES_HOST: postgres\n      POSTGRES_USER: agentradar\n      POSTGRES_DB: agentradar\n      DB_PASSWORD: \${DB_PASSWORD}\n      JWT_SECRET: \${JWT_SECRET}\n      LDAP_URL: \${LDAP_URL:-}\n  postgres:\n    image: postgres:15-alpine\n    environment:\n      POSTGRES_USER: agentradar\n      POSTGRES_PASSWORD: \${DB_PASSWORD}\n      POSTGRES_DB: agentradar\n    volumes: [pgdata:/var/lib/postgresql/data]\n  redis:\n    image: redis:7-alpine\nvolumes:\n  pgdata:`,
  };

  if (pkg === 'auth-guide' || pkg === 'integration-guide') {
    res.setHeader('Content-Type','text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="agentradar-${pkg}.txt"`);
    return res.send(pkg === 'auth-guide'
      ? 'AgentRadar Auth Guide\n\nSupports: LDAP/AD, SAML 2.0, Azure AD, Okta, Google, AWS SSO, Keycloak, Auth0, Ping, OneLogin\n\nSee https://agentradar.idenaccess.com/docs for full setup instructions.'
      : 'AgentRadar Integration Guide\n\nAPI Base: https://agentradar.yourdomain.com/api\nAuth: Bearer token from POST /api/auth/login\n\nEndpoints:\n  GET  /api/agents\n  POST /api/agents\n  POST /api/scan/result\n  GET  /api/webhooks\n  POST /api/webhooks\n  GET  /api/activity\n  GET  /api/export\n  GET  /health'
    );
  }

  res.setHeader('Content-Type','application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="agentradar-${pkg}-deploy.zip"`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(res);
  const fname = pkg === 'onprem' ? 'docker-compose.yml' : `deploy-${pkg === 'azure' ? '' : pkg+'-'}${'sh'}`;
  archive.append(scripts[pkg] || '# Package not found', { name: pkg === 'onprem' ? 'docker-compose.yml' : `deploy${pkg==='azure'?'':'-'+pkg}.sh` });
  archive.append('See https://agentradar.idenaccess.com/docs for full deployment guide.', { name: 'README.md' });
  archive.finalize();
});


// ── SSO Configuration (CISO can configure without CLI) ────────
app.get('/api/auth/sso/config', auth, async (req, res) => {
  if (req.user.role !== 'ciso' && req.user.role !== 'platform_admin')
    return res.status(403).json({ error: 'CISO access required' });
  try {
    // Return current config (secrets masked)
    const cfg = {
      azure: {
        enabled: !!(process.env.AZURE_SSO_CLIENT_ID),
        clientId: process.env.AZURE_SSO_CLIENT_ID || '',
        tenantId: process.env.AZURE_TENANT_ID || '',
        configured: !!(process.env.AZURE_SSO_CLIENT_ID)
      },
      google: {
        enabled: !!(process.env.GOOGLE_CLIENT_ID),
        clientId: process.env.GOOGLE_CLIENT_ID || '',
        configured: !!(process.env.GOOGLE_CLIENT_ID)
      },
      okta: {
        enabled: !!(process.env.OKTA_CLIENT_ID),
        domain: process.env.OKTA_DOMAIN || '',
        clientId: process.env.OKTA_CLIENT_ID || '',
        configured: !!(process.env.OKTA_CLIENT_ID)
      },
      aws: {
        enabled: !!(process.env.AWS_SSO_CLIENT_ID),
        region: process.env.AWS_SSO_REGION || 'us-east-1',
        instanceId: process.env.AWS_SSO_INSTANCE_ID || '',
        configured: !!(process.env.AWS_SSO_CLIENT_ID)
      },
      ldap: {
        enabled: !!(process.env.LDAP_URL),
        url: process.env.LDAP_URL || '',
        searchBase: process.env.LDAP_SEARCH_BASE || '',
        configured: !!(process.env.LDAP_URL)
      },
      saml: {
        enabled: !!(process.env.SAML_ENTRY_POINT),
        entryPoint: process.env.SAML_ENTRY_POINT || '',
        metadataUrl: (process.env.APP_URL || '') + '/api/auth/saml/metadata',
        callbackUrl: (process.env.APP_URL || '') + '/api/auth/saml/callback',
        configured: !!(process.env.SAML_ENTRY_POINT)
      }
    };
    res.json(cfg);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/sso/config', auth, async (req, res) => {
  if (req.user.role !== 'ciso' && req.user.role !== 'platform_admin')
    return res.status(403).json({ error: 'CISO access required' });

  const { provider, config } = req.body;
  if (!provider || !config) return res.status(400).json({ error: 'provider and config required' });

  try {
    // Store SSO config in DB (encrypted at rest by PostgreSQL)
    await db.query(
      `INSERT INTO sso_config (provider, config, updated_by, tenant_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (provider, tenant_id) DO UPDATE
       SET config=$2, updated_by=$3, updated_at=NOW()`,
      [provider, JSON.stringify(config), req.user.email, req.user.tenantId || '00000000-0000-0000-0000-000000000001']
    );
    await auditLog(req.user.email, 'sso_config_update', req.user.tenantId, provider, { provider }, req.ip);
    res.json({ success: true, message: `${provider} SSO configuration saved. Restart required to apply.` });
  } catch(e) {
    // Table might not exist yet - create it
    if (e.message.includes('does not exist')) {
      await db.query(`
        CREATE TABLE IF NOT EXISTS sso_config (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          provider VARCHAR(50) NOT NULL,
          config JSONB NOT NULL,
          tenant_id UUID,
          updated_by VARCHAR(255),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(provider, tenant_id)
        )
      `);
      await db.query(
        `INSERT INTO sso_config (provider, config, updated_by, tenant_id) VALUES ($1,$2,$3,$4)`,
        [provider, JSON.stringify(config), req.user.email, req.user.tenantId || '00000000-0000-0000-0000-000000000001']
      );
      res.json({ success: true, message: `${provider} SSO configuration saved.` });
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});


// ══ AUTO-DISCOVERY ENGINE ══════════════════════════════════════
const CLOUD_SERVICE_SCANNER_MAP = {
  azure: {
    'Microsoft.CognitiveServices':['sc-cloud-azure','sc-purview'],
    'Microsoft.MachineLearningServices':['sc-cloud-azure'],
    'Microsoft.MachineLearning':['sc-cloud-azure'],
    'Microsoft.BotService':['sc-m365-copilot-ext'],
    'Microsoft.ContainerService':['sc-k8s'],
    'Microsoft.ContainerRegistry':['sc-container-reg'],
    'Microsoft.KeyVault':['sc-shadow-apikey'],
    'Microsoft.Storage':['sc-model-artifact'],
    'Microsoft.Search':['sc-cloud-azure'],
    'Microsoft.ApiManagement':['sc-cloud-azure'],
    'Microsoft.DocumentDB':['sc-cloud-azure'],
    'Microsoft.Web':['sc-cloud-azure'],
    'Microsoft.Insights':['sc-cloud-azure'],
  },
  aws: { bedrock:['sc-cloud-aws'], sagemaker:['sc-cloud-aws'], eks:['sc-k8s'], ecr:['sc-container-reg'], s3:['sc-model-artifact'] },
  gcp: { aiplatform:['sc-gemini'], container:['sc-k8s'], artifactregistry:['sc-container-reg'], secretmanager:['sc-shadow-apikey'] },
  network: { '11434':'sc-network','8000':'sc-network','7860':'sc-network','2575':'sc-hl7','104':'sc-dicom','4317':'sc-agent-to-agent' }
};

async function discoverAzure(tenantId, clientId, clientSecret, subscriptionId) {
  const log = [];
  const discovered = { services:[], scanners:new Set(), agents:[] };

  try {
    // ── Step 1: Authenticate ─────────────────────────────────
    const tokenResp = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:`client_id=${clientId}&client_secret=${encodeURIComponent(clientSecret)}&scope=https://management.azure.com/.default&grant_type=client_credentials`
      }).then(r=>r.json());

    if (!tokenResp.access_token)
      throw new Error('Azure auth failed: '+(tokenResp.error_description||tokenResp.error));

    const token = tokenResp.access_token;
    log.push({step:'auth', status:'ok', msg:'Azure authentication successful'});

    // ── Step 2: Get ALL resources across ALL resource groups and regions ──
    let allResources = [];
    let nextLink = `https://management.azure.com/subscriptions/${subscriptionId}/resources?api-version=2021-04-01&$top=1000`;

    while (nextLink) {
      const page = await fetch(nextLink, {headers:{'Authorization':'Bearer '+token}}).then(r=>r.json()).catch(()=>({value:[]}));
      allResources = allResources.concat(page.value||[]);
      nextLink = page.nextLink || null;
    }

    log.push({step:'inventory', status:'ok', msg:`Found ${allResources.length} resources across all resource groups and regions`});

    // ── Step 3: Classify ALL resources — not just known types ─
    // Any resource could be AI-related. Cast wide net.
    // Strict AI/ML resource type filter — only genuine AI services
    const AI_TYPE_KEYWORDS = [
      'microsoft.cognitiveservices',
      'microsoft.machinelearningservices',
      'microsoft.machinelearning',
      'microsoft.search/searchservices',
      'microsoft.botservice',
      'microsoft.synapse',
      'microsoft.databricks',
    ];

    // Name patterns — only match when type is also plausible
    const AI_NAME_KEYWORDS = [
      'openai','aoai','gpt','llm','cognitive',
      'orchestrator','hub','aipentest-search',
    ];

    // Exclude infrastructure resources even if name matches
    const EXCLUDE_TYPES = [
      'microsoft.network/','microsoft.compute/disks',
      'microsoft.compute/virtualmachines/extensions',
      'microsoft.operationsmanagement','microsoft.insights/actiongroups',
      'microsoft.cache/redis','microsoft.network/natgateways',
      'microsoft.network/publicipaddresses','microsoft.network/networkinterfaces',
      'microsoft.network/networksecuritygroups','microsoft.network/virtualnetworks',
      'microsoft.network/privatednszones','microsoft.network/bastionhosts',
      'microsoft.operationalinsights','microsoft.dbforpostgresql',
      'microsoft.storage/storageaccounts','microsoft.keyvault/vaults',
    ];

    // Map resource types to scanner IDs
    const TYPE_SCANNER_MAP = {
      'microsoft.cognitiveservices': ['sc-cloud-azure','sc-purview'],
      'microsoft.machinelearningservices': ['sc-cloud-azure'],
      'microsoft.machinelearning': ['sc-cloud-azure'],
      'microsoft.search': ['sc-cloud-azure'],
      'microsoft.botservice': ['sc-m365-copilot-ext'],
      'microsoft.containerservice': ['sc-k8s'],
      'microsoft.containerregistry': ['sc-container-reg'],
      'microsoft.keyvault': ['sc-shadow-apikey'],
      'microsoft.storage': ['sc-model-artifact'],
      'microsoft.apimanagement': ['sc-cloud-azure'],
      'microsoft.documentdb': ['sc-cloud-azure'],
      'microsoft.web': ['sc-cloud-azure'],
      'microsoft.synapse': ['sc-cloud-azure'],
      'microsoft.databricks': ['sc-cloud-azure'],
    };

    // Determine agent type and risk from resource
    function classifyResource(res) {
      const type = (res.type||'').toLowerCase();
      const name = (res.name||'').toLowerCase();
      const kind = (res.kind||'').toLowerCase();

      if (type.includes('cognitiveservices') || kind.includes('openai') || name.includes('aoai') || name.includes('openai'))
        return { agentType:'llm', risk:'high', pii:true, phi:false, protocols:['Azure OpenAI API','REST'], label:'Azure OpenAI' };
      if (type.includes('search') || name.includes('search'))
        return { agentType:'ai-search', risk:'medium', pii:true, phi:false, protocols:['Azure AI Search REST API'], label:'Azure AI Search' };
      if (type.includes('botservice') || name.includes('bot'))
        return { agentType:'chatbot', risk:'high', pii:true, phi:false, protocols:['Bot Framework','REST'], label:'Azure Bot Service' };
      if (type.includes('apimanagement') || name.includes('apim'))
        return { agentType:'api-gateway', risk:'medium', pii:true, phi:false, protocols:['REST','APIM'], label:'Azure API Management' };
      if (type.includes('documentdb') || name.includes('cosmos'))
        return { agentType:'data-store', risk:'high', pii:true, phi:false, protocols:['CosmosDB API','REST'], label:'Azure Cosmos DB' };
      if (type.includes('machinelearning') || name.includes('mlworkspace'))
        return { agentType:'ml-workspace', risk:'high', pii:true, phi:false, protocols:['Azure ML REST API'], label:'Azure ML Workspace' };
      if (type.includes('containerservice') || name.includes('aks'))
        return { agentType:'container-platform', risk:'medium', pii:false, phi:false, protocols:['Kubernetes API'], label:'AKS Cluster' };
      if (type.includes('synapse') || name.includes('synapse'))
        return { agentType:'data-platform', risk:'high', pii:true, phi:false, protocols:['Synapse REST API'], label:'Azure Synapse' };
      if (name.includes('hub') || name.includes('orchestrator') || name.includes('foundry'))
        return { agentType:'agent', risk:'high', pii:true, phi:false, protocols:['Azure AI Foundry','REST'], label:'AI Orchestrator' };
      if (type.includes('web/sites') || name.includes('func') || name.includes('function'))
        return { agentType:'serverless', risk:'medium', pii:false, phi:false, protocols:['HTTP','REST'], label:'Azure Function/Web App' };
      return { agentType:'azure-service', risk:'low', pii:false, phi:false, protocols:['Azure REST API'], label:res.type };
    }

    // Filter for AI-related resources
    const aiResources = allResources.filter(res => {
      const type = (res.type||'').toLowerCase();
      const name = (res.name||'').toLowerCase();
      const kind = (res.kind||'').toLowerCase();

      // Skip pure infrastructure resources
      if (EXCLUDE_TYPES.some(e => type.startsWith(e))) return false;

      // Include if type matches AI service types
      if (AI_TYPE_KEYWORDS.some(k => type.includes(k))) return true;

      // Include if name matches AI keywords AND type is plausible (not pure infra)
      const isPlausibleAI = !type.includes('microsoft.network') &&
                            !type.includes('microsoft.compute/disk') &&
                            !type.includes('microsoft.storage') &&
                            !type.includes('microsoft.keyvault');
      if (isPlausibleAI && AI_NAME_KEYWORDS.some(k => name.includes(k))) return true;

      // Include if kind explicitly says openai or ai
      if (kind.includes('openai') || kind.includes('cognitiveservices')) return true;

      return false;
    });

    // Enable scanners based on resource types found
    allResources.forEach(res => {
      const typePrefix = (res.type||'').split('/')[0].toLowerCase();
      const scanners = TYPE_SCANNER_MAP[typePrefix] || [];
      scanners.forEach(s => discovered.scanners.add(s));
    });

    log.push({step:'ai-resources', status:'ok',
      msg:`Found ${aiResources.length} AI-related resources across ${new Set(aiResources.map(r=>r.resourceGroup||r.id?.split('/')[4]||'unknown')).size} resource groups`});

    // ── Step 4: Register each AI resource as an agent ─────────
    for (const res of aiResources) {
      const rg = res.resourceGroup || res.id?.split('/')[4] || 'unknown';
      const region = res.location || 'unknown';
      const classification = classifyResource(res);

      discovered.agents.push({
        name: res.name,
        type: classification.agentType,
        env: 'Cloud',
        risk: classification.risk,
        shadow: false,
        phi: classification.phi,
        pii: classification.pii,
        protocols: classification.protocols,
        detect: 'Azure auto-discovery',
        notes: `${classification.label} | Resource Group: ${rg} | Region: ${region} | Type: ${res.type}`,
        controls: {soc2:'warn',gdpr:'warn',hipaa:'warn',nist:'warn',euai:'warn',iso27001:'warn'}
      });

      log.push({step:'found', status:'found',
        msg:`Discovered: ${res.name} (${classification.label}) in ${rg} / ${region}`});
    }

    // ── Step 5: Check M365/Graph access ───────────────────────
    const graphToken = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:`client_id=${clientId}&client_secret=${encodeURIComponent(clientSecret)}&scope=https://graph.microsoft.com/.default&grant_type=client_credentials`
      }).then(r=>r.json()).catch(()=>({}));

    if (graphToken.access_token) {
      ['sc-m365-copilot-ext','sc-browser-ext','sc-email-ai'].forEach(s=>discovered.scanners.add(s));
      log.push({step:'m365', status:'ok', msg:'M365/Graph access confirmed — Copilot, browser, email scanners enabled'});
    } else {
      log.push({step:'m365', status:'warn', msg:'M365/Graph not accessible — Copilot scanners not enabled'});
    }

    // ── Step 6: Summary ───────────────────────────────────────
    const regions = [...new Set(aiResources.map(r=>r.location||'unknown'))];
    const rgs = [...new Set(aiResources.map(r=>r.resourceGroup||r.id?.split('/')[4]||'unknown'))];
    log.push({step:'summary', status:'ok',
      msg:`Discovery complete: ${aiResources.length} AI agents found across ${rgs.length} resource groups in ${regions.join(', ')}`});

  } catch(e) {
    log.push({step:'error', status:'error', msg:e.message});
  }

  return {cloud:'azure', ...discovered, scanners:[...discovered.scanners], log};}

async function discoverNetwork(cidrRanges) {
  const net = require('net');
  const log = []; const discovered = {services:[],scanners:new Set(),agents:[],liveHosts:[]};
  const AI_PORTS = [11434,8000,8001,7860,2575,104,1883,4317,6006,3000,5000];

  function expandCIDR(cidr) {
    const [base,prefix] = cidr.split('/');
    const parts = base.split('.').map(Number);
    const hosts = Math.min(Math.pow(2,32-parseInt(prefix)),254);
    return Array.from({length:Math.min(hosts,254)},(_,i)=>`${parts[0]}.${parts[1]}.${parts[2]}.${parts[3]+i+1}`).filter(ip=>!ip.endsWith('.0')&&!ip.endsWith('.255'));
  }

  function probePort(ip,port) {
    return new Promise(resolve=>{
      const sock = new net.Socket();
      sock.setTimeout(800);
      sock.connect(port,ip,()=>{sock.destroy();resolve({ip,port,open:true});});
      sock.on('error',()=>resolve({ip,port,open:false}));
      sock.on('timeout',()=>{sock.destroy();resolve({ip,port,open:false});});
    });
  }

  for (const cidr of cidrRanges) {
    const ips = expandCIDR(cidr.trim());
    log.push({step:'scan',status:'ok',msg:`Scanning ${ips.length} IPs in ${cidr}`});
    for (let i=0;i<Math.min(ips.length,50);i+=10) {
      const batch = ips.slice(i,i+10);
      const results = await Promise.all(batch.flatMap(ip=>AI_PORTS.map(port=>probePort(ip,port))));
      for (const r of results.filter(r=>r.open)) {
        discovered.liveHosts.push(r);
        const sc = CLOUD_SERVICE_SCANNER_MAP.network[String(r.port)];
        if (sc) discovered.scanners.add(sc);
        const names = {11434:'Ollama LLM',8000:'AI API',7860:'Gradio UI',2575:'HL7 MLLP',104:'DICOM',4317:'OTLP'};
        discovered.agents.push({name:`${names[r.port]||'AI Service'} @ ${r.ip}:${r.port}`,
          type:r.port===2575?'hl7':r.port===104?'dicom':'local-llm',env:'On-Prem',
          risk:'high',ip:r.ip,shadow:true,protocols:[names[r.port]||'TCP'],detect:'Network port scan'});
        log.push({step:'port',status:'found',msg:`${r.ip}:${r.port} open — ${names[r.port]||'AI service'}`});
      }
    }
  }
  return {cloud:'network',...discovered,scanners:[...discovered.scanners],log};
}

app.post('/api/autodiscovery/start', auth, validate(schemas.autodiscovery), async (req, res) => {
  const {azure,aws,gcp,network} = req.body;
  const tId = req.user?.tenantId||'00000000-0000-0000-0000-000000000001';
  await auditLog(req.user.email,'autodiscovery_start',tId,'all',{clouds:Object.keys(req.body).filter(k=>req.body[k])},req.ip);
  const sessionId = require('crypto').randomUUID();
  await db.query('INSERT INTO scanner_runs (id,scanner_id,status,created_at) VALUES ($1,$2,$3,NOW())',[sessionId,'autodiscovery','running']).catch(()=>{});
  res.json({sessionId,status:'started'});

  (async()=>{
    const all = {agents:[],scanners:new Set(),logs:[],summary:{}};
    try {
      if (azure?.tenantId&&azure?.clientId&&azure?.clientSecret&&azure?.subscriptionId) {
        const r = await discoverAzure(azure.tenantId,azure.clientId,azure.clientSecret,azure.subscriptionId);
        all.agents.push(...r.agents); r.scanners.forEach(s=>all.scanners.add(s));
        all.logs.push({cloud:'Azure',entries:r.log});
        all.summary.azure={services:r.services.length,scanners:r.scanners.length,agents:r.agents.length};
      }
      if (network?.cidrRanges?.length>0) {
        const r = await discoverNetwork(network.cidrRanges);
        all.agents.push(...r.agents); r.scanners.forEach(s=>all.scanners.add(s));
        all.logs.push({cloud:'Network',entries:r.log});
        all.summary.network={hosts:r.liveHosts?.length,scanners:r.scanners.length,agents:r.agents.length};
      }

      let saved=0;
      for (const agent of all.agents) {
        try {
          // Check if agent already exists (avoid duplicates)
          const existing = await db.query(
            'SELECT id FROM agents WHERE name=$1 AND tenant_id=$2 LIMIT 1',
            [agent.name, tId]
          );
          if (existing.rows.length > 0) {
            // Update last_seen on existing agent
            await db.query(
              'UPDATE agents SET last_seen=NOW(), risk=$1, updated_at=NOW() WHERE id=$2',
              [agent.risk||'medium', existing.rows[0].id]
            );
          } else {
            await db.query(
              `INSERT INTO agents (id,name,type,env,risk,shadow,phi,pii,protocols,controls,metadata,detect,tenant_id,first_detected,last_seen,created_at,updated_at)
               VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW(),NOW(),NOW())`,
              [agent.name, agent.type||'unknown', agent.env||'Cloud', agent.risk||'medium',
               agent.shadow||false, agent.phi||false, agent.pii||false,
               JSON.stringify(agent.protocols||[]), JSON.stringify(agent.controls||{}),
               JSON.stringify({notes:agent.notes||''}),
               agent.detect||'auto-discovery', tId]
            );
          }
          saved++;
        } catch(e){}
      }

      await db.query('INSERT INTO activity (category,description,created_by,tenant_id) VALUES ($1,$2,$3,$4)',
        ['discovery',`Auto-discovery: ${saved} agents found, ${[...all.scanners].length} scanners enabled`,req.user.email,tId]).catch(()=>{});
      await db.query('UPDATE scanner_runs SET status=$1,agents_found=$2 WHERE id=$3',['completed',saved,sessionId]).catch(()=>{});

      global.autodiscoveryResults=global.autodiscoveryResults||{};
      global.autodiscoveryResults[sessionId]={status:'completed',summary:all.summary,scanners:[...all.scanners],agentCount:saved,logs:all.logs,completedAt:new Date().toISOString()};
    } catch(e) {
      global.autodiscoveryResults=global.autodiscoveryResults||{};
      global.autodiscoveryResults[sessionId]={status:'error',error:e.message};
      await db.query('UPDATE scanner_runs SET status=$1,error=$2 WHERE id=$3',['failed',e.message,sessionId]).catch(()=>{});
    }
  })();
});

app.get('/api/autodiscovery/status/:sessionId', auth, (req, res) => {
  const result = (global.autodiscoveryResults||{})[req.params.sessionId];
  if (!result) return res.json({status:'running',message:'Discovery in progress...'});
  res.json(result);
});

app.get('/api/autodiscovery/history', auth, async (req, res) => {
  try {
    const r = await db.query("SELECT * FROM scanner_runs WHERE scanner_id='autodiscovery' ORDER BY created_at DESC LIMIT 10");
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});




// ── Integration credentials (encrypted in DB per tenant) ─
app.post('/api/integrations/credentials', auth, async (req, res) => {
  const { provider, credentials } = req.body;
  if (!provider || !credentials) return res.status(400).json({ error: 'provider and credentials required' });
  const tId = req.user.tenantId || '00000000-0000-0000-0000-000000000001';
  try {
    // Mask secret values before storing — store reference only
    const masked = { ...credentials };
    if (masked.clientSecret) masked.clientSecret = '***SAVED***';
    if (masked.secretAccessKey) masked.secretAccessKey = '***SAVED***';
    if (masked.serviceAccountKey) masked.serviceAccountKey = '***SAVED***';

    await db.query(`
      INSERT INTO integration_credentials (provider, credentials, tenant_id, updated_by, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (provider, tenant_id) DO UPDATE
      SET credentials=$2, updated_by=$4, updated_at=NOW()
    `, [provider, JSON.stringify(credentials), tId, req.user.email]);

    await auditLog(req.user.email, 'save_integration_credentials', tId, provider, { provider }, req.ip);
    res.json({ saved: true, provider, masked });
  } catch(e) {
    // Table might not exist yet
    if (e.message.includes('does not exist')) {
      await db.query(`
        CREATE TABLE IF NOT EXISTS integration_credentials (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          provider VARCHAR(50) NOT NULL,
          credentials JSONB NOT NULL,
          tenant_id UUID,
          updated_by VARCHAR(255),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(provider, tenant_id)
        )
      `);
      await db.query(`
        INSERT INTO integration_credentials (provider, credentials, tenant_id, updated_by)
        VALUES ($1, $2, $3, $4)
      `, [provider, JSON.stringify(credentials), tId, req.user.email]);
      res.json({ saved: true, provider });
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});

app.get('/api/integrations/credentials/full', auth, async (req, res) => {
  const tId = req.user.tenantId || '00000000-0000-0000-0000-000000000001';
  try {
    const r = await db.query(
      'SELECT provider, credentials, updated_at FROM integration_credentials WHERE tenant_id=$1',
      [tId]
    );
    const result = {};
    r.rows.forEach(row => {
      result[row.provider] = { ...row.credentials, _saved: true, _updatedAt: row.updated_at };
    });
    res.json(result);
  } catch(e) {
    if (e.message.includes('does not exist')) return res.json({});
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/integrations/credentials', auth, async (req, res) => {
  const tId = req.user.tenantId || '00000000-0000-0000-0000-000000000001';
  try {
    const r = await db.query(
      'SELECT provider, credentials, updated_at FROM integration_credentials WHERE tenant_id=$1',
      [tId]
    );
    // Return credentials with secrets masked for display
    const result = {};
    r.rows.forEach(row => {
      const creds = row.credentials;
      result[row.provider] = {
        ...creds,
        clientSecret: creds.clientSecret ? '••••••••' : '',
        secretAccessKey: creds.secretAccessKey ? '••••••••' : '',
        serviceAccountKey: creds.serviceAccountKey ? '••••••••' : '',
        _saved: true,
        _updatedAt: row.updated_at
      };
    });
    res.json(result);
  } catch(e) {
    if (e.message.includes('does not exist')) return res.json({});
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/integrations/credentials/:provider', auth, async (req, res) => {
  const tId = req.user.tenantId || '00000000-0000-0000-0000-000000000001';
  try {
    await db.query(
      'DELETE FROM integration_credentials WHERE provider=$1 AND tenant_id=$2',
      [req.params.provider, tId]
    );
    await auditLog(req.user.email, 'delete_integration_credentials', tId, req.params.provider, {}, req.ip);
    res.json({ deleted: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ── Error handler ─────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    user: req.user?.email
  });
  console.error('[error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────
async function start() {
  try {
    const secrets = await loadSecrets();
    jwtSecret = secrets.jwtSecret;
    db        = createDb(secrets.dbPassword);
    redis     = createRedis(secrets.redisPassword);

    await db.query('SELECT 1');
    console.log('[db] Connected');

    await redis.connect();
    console.log('[redis] Connected');

    app.listen(PORT, () => console.log(`[api] Listening on :${PORT}`));
  } catch (e) {
    console.error('[startup] Fatal:', e.message);
    process.exit(1);
  }
}

start();
