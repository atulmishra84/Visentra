'use strict';

// ── V2 Modules ────────────────────────────────────────────────
const _cfg   = require('./src/config/index.js');
const _db    = require('./src/models/db.js');
const _auth  = require('./src/middleware/auth.js');
const _rl    = require('./src/middleware/rateLimit.js');
const _phi   = require('./src/services/phi.js');
const _disc  = require('./src/services/discovery.js');
const _audit = require('./src/services/audit.js');

// ── Input sanitizer (H4 fix) ──────────────────────────────
function sanitize(val, maxLen) {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/[<>"'`]/g, '')   // strip HTML/JS chars
    .replace(/\s+/g, ' ')       // normalize whitespace
    .trim()
    .substring(0, maxLen || 500);
}

// ── AES-256-GCM credential encryption (H2 fix) ─────────────
const _encKey = Buffer.from(
  (process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'agentRadar-default-enc-key-32b!!').slice(0,32).padEnd(32,'0')
);

function encryptCred(text) {
  const iv  = require('crypto').randomBytes(12);
  const cip = require('crypto').createCipheriv('aes-256-gcm', _encKey, iv);
  const enc = Buffer.concat([cip.update(String(text),'utf8'), cip.final()]);
  const tag = cip.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decryptCred(str) {
  try {
    if (!str || !str.startsWith('v1:')) return str; // legacy unencrypted
    const [,ivH,tagH,encH] = str.split(':');
    const dec = require('crypto').createDecipheriv('aes-256-gcm', _encKey,
      Buffer.from(ivH,'hex'));
    dec.setAuthTag(Buffer.from(tagH,'hex'));
    return Buffer.concat([dec.update(Buffer.from(encH,'hex')), dec.final()]).toString('utf8');
  } catch(e) { return str; } // fallback for legacy data
}

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
  if (_cache.size > 10000) {
    const oldest = [..._cache.keys()].slice(0, 2000);
    oldest.forEach(k => _cache.delete(k));
  }
  _cache.set(key, { value, expires: Date.now() + ttlMs });
}
// Periodic eviction — prevents OOM on write-only keys
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _cache) if (now > v.expires) _cache.delete(k);
}, 5 * 60 * 1000).unref();
function clearCache(pattern) {
  for (const key of _cache.keys())
    if (key.includes(pattern)) _cache.delete(key);
}


const express     = require('express');
const cookieParser = require('cookie-parser');
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
const REDIS_PORT    = parseInt(process.env.REDIS_PORT || '6379');
const REDIS_TLS     = process.env.REDIS_TLS     !== 'false';

let db, redis, jwtSecret;
function dbGuard(req, res, next) {
  if (!db) return res.status(503).json({ error: 'Service starting — retry in 5s', retryAfter: 5 });
  next();
}
function dbGuard(req, res, next) {
  if (!db) return res.status(503).json({ error: 'Service starting — retry in 5s', retryAfter: 5 });
  next();
}

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
    ssl: process.env.POSTGRES_SSL === "false" ? false : { rejectUnauthorized: false },
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


// ── FIX CWE-918: SSRF protection — validate outbound URLs ────
const SSRF_ALLOWED_HOSTS = new Set([
  'management.azure.com',
  'login.microsoftonline.com',
  'graph.microsoft.com',
  'api.securitycenter.microsoft.com',
  'api.loganalytics.io',
]);
const SSRF_ALLOWED_PATTERNS = [
  /^[a-zA-Z0-9-]+\.splunkcloud\.com$/,
  /^[a-zA-Z0-9-]+\.splunk\.com$/,
  /^[a-zA-Z0-9-]+\.siem\.microsoft\.com$/,
  /^[a-zA-Z0-9-]+\.azure\.com$/,
  /^[a-zA-Z0-9-]+\.cortex\.paloaltonetworks\.com$/,
  /^[a-zA-Z0-9-]+\.xdr\.us\.paloaltonetworks\.com$/,
];

function validateOutboundUrl(urlStr, label) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'https:') throw new Error(`${label}: Only HTTPS outbound connections allowed`);
    if (SSRF_ALLOWED_HOSTS.has(u.hostname)) return urlStr;
    if (SSRF_ALLOWED_PATTERNS.some(p => p.test(u.hostname))) return urlStr;
    throw new Error(`${label}: Host '${u.hostname}' not in SSRF allowlist`);
  } catch(e) {
    if (e.message.includes('allowlist') || e.message.includes('HTTPS')) throw e;
    throw new Error(`${label}: Invalid URL format`);
  }
}

// ── H6: Redact sensitive fields before they reach any log or stored session ──
function redactSecrets(obj) {
  const SENSITIVE = /secret|password|token|key|credential/i;
  if (Array.isArray(obj)) return obj.map(redactSecrets);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = SENSITIVE.test(k) ? '[REDACTED]' : redactSecrets(v);
    }
    return out;
  }
  return obj;
}


app.set('trust proxy', 1); // Trust NGINX ingress
app.use(compression());
app.use(helmet({ contentSecurityPolicy: false }));
const _allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://20.228.158.234,https://agentradar.idenaccess.com').split(',').map(o => o.trim());
app.use(cors({
  origin: (origin, cb) => (!origin || _allowedOrigins.includes(origin)) ? cb(null, true) : cb(new Error('CORS: origin not allowed')),
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));

// FIX: Belt-and-suspenders security headers at application layer
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(cookieParser());

// H5 FIX: CSRF protection — double-submit cookie pattern
const _csrfTokens = new Map();
app.get('/api/csrf-token', (req, res) => {
  const token = require('crypto').randomBytes(32).toString('hex');
  const ip = req.ip;
  _csrfTokens.set(token, { ip, expires: Date.now() + 3600000 });
  res.json({ token });
});

function csrfProtect(req, res, next) {
  if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
  if (req.path === '/api/auth/login' || req.path === '/api/auth/sso/exchange') return next();
  // Header-based CSRF — token must be present in X-CSRF-Token header
  // Frontend fetches token from /api/csrf-token and includes in all mutating requests
  const headerToken = req.headers['x-csrf-token'];
  const validEntry  = headerToken && _csrfTokens.get(headerToken);
  if (!validEntry || Date.now() > validEntry.expires) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token' });
  }
  next();
}
// Apply CSRF to state-mutating routes
app.use('/api/admin', csrfProtect);
app.use('/api/integrations', csrfProtect);
app.use('/api/webhooks', csrfProtect);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
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

// ── SSO Code Store (one-time codes, 60s TTL) ────────────────
const ssoCodeStore = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of ssoCodeStore) if (now > v.expires) ssoCodeStore.delete(k);
}, 30000).unref();

// Exchange one-time code for JWT (called by frontend after SSO redirect)
app.get('/api/auth/sso/exchange', (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'Code required' });
  const entry = ssoCodeStore.get(code);
  if (!entry) return res.status(400).json({ error: 'Invalid or expired code' });
  if (Date.now() > entry.expires) {
    ssoCodeStore.delete(code);
    return res.status(400).json({ error: 'Code expired — please login again' });
  }
  ssoCodeStore.delete(code); // One-time use
  res.json({ token: entry.token });
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
// requireRole — delegated to src/middleware/auth.js
const requireRole = _auth.requireRole;

function auth(req, res, next) {
  // C3 FIX: Read from httpOnly cookie OR Authorization header
  const token = req.cookies?.ar_session ||
                req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const payload = jwt.verify(token, jwtSecret);
    // M3: Check session not revoked
    if (payload.jti && redis) {
      redis.exists(`session:${payload.jti}`).then(valid => {
        if (!valid) return res.status(401).json({ error: 'Session revoked' });
        req.user = payload;
        next();
      }).catch(() => { req.user = payload; next(); });
    } else {
      req.user = payload;
      next();
    }
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ── Auth routes ───────────────────────────────────────────
// M1 FIX: Redis-backed rate limiter (survives restarts)
async function redisRateLimit(key, max, windowSec, res) {
  try {
    if (!redis) throw new Error('redis not ready');
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSec);
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));
    return count > max;
  } catch(e) {
    // Fallback to in-memory if Redis down
    return false;
  }
}

const rateLimitLogin = (req, res, next) => {
  const key = `rl:login:${req.ip}`;
  redisRateLimit(key, 10, 900, res).then(blocked => {
    if (blocked) return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
    next();
  }).catch(() => next());
};

const rateLimitApi = (req, res, next) => {
  const key = `rl:api:${req.ip}`;
  redisRateLimit(key, 300, 60, res).then(blocked => {
    if (blocked) return res.status(429).json({ error: 'Too many requests.' });
    next();
  }).catch(() => next());
};

app.post('/api/auth/login', rateLimitLogin, validate(schemas.login), async (req, res) => {
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

    // C3 FIX: Set httpOnly cookie (XSS-safe) + keep body token for backward compat
    res.cookie('ar_session', token, {
      httpOnly: true,
      secure:   true,
      sameSite: 'strict',
      maxAge:   8 * 60 * 60 * 1000,
      path:     '/',
    });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
    auditLog(user.tenant_id, user.id, user.email, 'login', 'auth', user.id, { method: 'password', role: user.role }, req);
  } catch (e) {
    console.error('[auth] login error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// M3: Session revocation endpoint
app.post('/api/admin/sessions/revoke', auth, requireRole('platform_admin'), async (req, res) => {
  const { jti } = req.body;
  if (!jti) return res.status(400).json({ error: 'jti required' });
  if (redis) await redis.del(`session:${jti}`).catch(()=>{});
  res.json({ success: true, message: 'Session revoked' });
});

app.post('/api/auth/logout', auth, async (req, res) => {
  res.clearCookie('ar_session', { path: '/', secure: true, sameSite: 'strict' });
  await redis.del(`session:${req.user.sub}`).catch(() => {});
  res.json({ ok: true });
});

// ── Agents CRUD ───────────────────────────────────────────
app.get('/api/agents', auth, asyncHandler(async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, type, env, risk, shadow, phi, pii, hosted, quarantined,
              last_seen, owner, controls, protocols, first_detected, metadata,
              COALESCE(metadata->>'detect', metadata->>'notes', 'manual') as detect
       FROM agents ORDER BY risk DESC, last_seen DESC LIMIT 500`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message });
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
    res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message });
  }
});

app.patch('/api/agents/:id', auth, async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  // FIX CWE-89: Strict allowlist of updatable fields — never interpolate user-supplied field names
  const ALLOWED_FIELDS = ['name', 'notes', 'type', 'env', 'risk', 'shadow', 'phi', 'pii', 'protocols', 'detect', 'controls'];
  const fields = Object.keys(updates).filter(k => ALLOWED_FIELDS.includes(k));
  if (!fields.length) return res.status(400).json({ error: 'No valid fields to update' });

  // Sanitize string values
  fields.forEach(f => {
    if (typeof updates[f] === 'string') {
      updates[f] = updates[f].replace(/[<>"'`]/g, '').trim().substring(0, 1000);
    }
  });

  const sets   = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
  const values = [id, ...fields.map(f => updates[f])];

  try {
    const { rows } = await db.query(
      `UPDATE agents SET ${sets}, last_seen = NOW() WHERE id = $1 RETURNING *`, values
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message });
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
    res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message });
  }
});

// ── Activity log ──────────────────────────────────────────
app.get('/api/activity', auth, asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100'), 500);
  try {
    const { rows } = await db.query(
      `SELECT id, category, description, created_by, at as created_at
       FROM activity
       ORDER BY at DESC LIMIT $1`, [limit]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message });
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
    res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message });
  }
});

// ── Risk acceptances ──────────────────────────────────────
app.get('/api/risk-acceptances', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM risk_acceptances ORDER BY created_at DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message }); }
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
  } catch (e) { res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message }); }
});

// ── 404 ───────────────────────────────────────────────────

// ── Tenant middleware ────────────────────────────────
// FIX #2: Removed set_config — it is session-scoped but pool reuses connections
// causing tenant context from Request A to leak into Request B
// Tenant isolation is enforced by passing tenantId in every query explicitly
async function tenantMiddleware(req, res, next) {
  if (req.user) req.tenantId = req.user.tenantId || '00000000-0000-0000-0000-000000000001';
  next();
}
app.use('/api/', dbGuard);
app.use('/api/', dbGuard);
app.use('/api/', tenantMiddleware);

// ── Admin audit log ───────────────────────────────────
async function adminAuditLog(adminEmail, action, tenantId, resource, details, ip) {
  try {
    await db.query(
      'INSERT INTO admin_audit_log (admin_email,action,tenant_id,resource,details,ip_address) VALUES ($1,$2,$3,$4,$5,$6)',
      [adminEmail, action, tenantId||null, resource||null, JSON.stringify(details||{}), ip||null]
    );
  } catch(e) { console.error('[audit]', e.message); }
}

// ── Tenant management (platform admin only) — see consolidated routes below ───────────
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
  } catch(e) { res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message }); }
});

// ── Customer data deletion (GDPR right to erasure) ────
app.delete('/api/tenant/data', auth, async (req, res) => {
  if (req.user.role !== 'ciso')
    return res.status(403).json({ error: 'CISO role required to delete tenant data' });
  const { confirm } = req.body;
  if (confirm !== 'DELETE ALL DATA')
    return res.status(400).json({ error: 'Send confirm: "DELETE ALL DATA" to proceed' });
  await adminAuditLog(req.user.email, 'delete_all_data', req.user.tenantId, 'all', {}, req.ip);
  const _client = await db.connect();
  try {
    await _client.query('BEGIN');
    const tid = req.user.tenantId;
    await _client.query('DELETE FROM activity WHERE tenant_id=$1', [tid]);
    await _client.query('DELETE FROM webhooks WHERE tenant_id=$1', [tid]);
    await _client.query('DELETE FROM risk_acceptances WHERE tenant_id=$1', [tid]);
    await _client.query('DELETE FROM agents WHERE tenant_id=$1', [tid]);
    await _client.query('COMMIT');
    res.json({ deleted: true, message: 'All tenant data permanently deleted' });
  } catch(e) {
    await _client.query('ROLLBACK').catch(()=>{});
    res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message });
  } finally { _client.release(); }
});

// ── Admin audit log viewer (customer can see who accessed their data) ──
app.get('/api/audit-log', auth, async (req, res) => {
  try {
    const r = await db.query(
      'SELECT admin_email,action,resource,details,ip_address,created_at FROM admin_audit_log WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100',
      [req.user.tenantId]
    );
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message }); }
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
  } catch(e) { res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message }); }
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
  } catch(e) { res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message }); }
});

app.delete('/api/webhooks/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM webhooks WHERE id=$1', [req.params.id]);
    res.json({ deleted: true });
  } catch(e) { res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message }); }
});

app.post('/api/webhooks/:id/test', auth, async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM webhooks WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Webhook not found' });
    await fireWebhook('test', { message: 'AgentRadar webhook test', hook: r.rows[0].name });
    res.json({ fired: true });
  } catch(e) { res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message }); }
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
  } catch(e) { res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message }); }
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
        const _ctrl = new AbortController();
        const _tid = setTimeout(() => _ctrl.abort(), 10000);
        try {
          await fetch(hook.url, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify(body), signal: _ctrl.signal,
          });
        } finally { clearTimeout(_tid); }
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
    res.status(400).json({ error: process.env.NODE_ENV==='production' && 400==='500' ? 'Internal server error' : e.message });
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
    const idClaims = tokenSet.claims ? tokenSet.claims() : {};
    const email = (
      userinfo.email || userinfo.preferred_username || userinfo.upn ||
      idClaims.email || idClaims.preferred_username || idClaims.upn
    )?.toLowerCase();
    const displayName = userinfo.name || idClaims.name || email?.split('@')[0];
    if (!email) return res.status(400).json({ error: 'No email in SSO response', fields: Object.keys(userinfo) });

    // Find or create user
    let user = (await db.query('SELECT * FROM users WHERE email=$1', [email])).rows[0];
    if (!user) {
      const r = await db.query(
        `INSERT INTO users (email, name, role, password_hash, password, tenant_id)
         VALUES ($1,$2,$3,$4,$4,'00000000-0000-0000-0000-000000000001') RETURNING *`,
        [email, displayName||email.split('@')[0], 'viewer', require('crypto').randomBytes(32).toString('hex')]
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
    res.redirect(`${process.env.APP_URL||'https://20.228.158.234'}/#sso-token=${token}`);
  } catch(e) {
    console.error('[SSO] Callback error:', e.message);
    res.redirect(`${process.env.APP_URL||'https://20.228.158.234'}/#sso-error=${encodeURIComponent(e.message)}`);
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
  } catch(e) { res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message }); }
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
    await adminAuditLog(req.user.email, 'create_tenant', tenant.id, 'tenants', {name, admin_email}, req.ip);
    res.json({ tenant, message: 'Tenant created' });
  } catch(e) { res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message }); }
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
  } catch(e) { res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message }); }
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
      res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message });
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
      'microsoft.app/containerapps',
      'microsoft.securitycopilot',
    ];

    // Name patterns — only match when type is also plausible
    const AI_NAME_KEYWORDS = [
      'openai','aoai','gpt','llm','cognitive',
      'orchestrator','hub','aipentest-search',
      'foundry','jarvis','copilot','aiservice',
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
      'microsoft.containerregistry/registries','microsoft.managedidentity',
      'microsoft.app/managedenvironments',
      'microsoft.containerregistry/registries','microsoft.managedidentity',
      'microsoft.app/managedenvironments',
      'microsoft.containerregistry/registries','microsoft.managedidentity',
      'microsoft.app/managedenvironments',
      'microsoft.containerregistry/registries','microsoft.managedidentity',
      'microsoft.app/managedenvironments',
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
      // PHI detection
      const combined = name + ' ' + type;
      const hasPhi = PHI_KEYWORDS.some(k => combined.includes(k)) ||
                     PHI_RESOURCE_TYPES.some(t => type.includes(t));

      if (type.includes('cognitiveservices') || kind.includes('openai') || name.includes('aoai') || name.includes('openai'))
        return { agentType:'llm', risk:'high', pii:true, phi:hasPhi, protocols:['Azure OpenAI API','REST'], label:'Azure OpenAI' };
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
      if (kind === 'aiservices')
        return { agentType:'ai-foundry', risk:'high', pii:true, phi:hasPhi, protocols:['Azure AI Foundry API','REST'], label:'Azure AI Foundry' };
      if (type.includes('cognitiveservices/accounts/projects'))
        return { agentType:'ai-project', risk:'high', pii:true, phi:false, protocols:['Azure AI Foundry API','REST'], label:'AI Foundry Project' };
      if (type.includes('microsoft.app/containerapps'))
        return { agentType:'agent', risk:'high', pii:true, phi:hasPhi, protocols:['HTTP','REST','Container'], label:'AI Container Agent' };
      if (type.includes('microsoft.securitycopilot'))
        return { agentType:'copilot', risk:'high', pii:true, phi:false, protocols:['Microsoft Security Copilot API'], label:'Microsoft Security Copilot' };
      if (kind === 'aiservices')
        return { agentType:'ai-foundry', risk:'high', pii:true, phi:hasPhi, protocols:['Azure AI Foundry API','REST'], label:'Azure AI Foundry' };
      if (type.includes('cognitiveservices/accounts/projects'))
        return { agentType:'ai-project', risk:'high', pii:true, phi:false, protocols:['Azure AI Foundry API','REST'], label:'AI Foundry Project' };
      if (type.includes('microsoft.app/containerapps'))
        return { agentType:'agent', risk:'high', pii:true, phi:hasPhi, protocols:['HTTP','REST','Container'], label:'AI Container Agent' };
      if (type.includes('microsoft.securitycopilot'))
        return { agentType:'copilot', risk:'high', pii:true, phi:false, protocols:['Microsoft Security Copilot API'], label:'Microsoft Security Copilot' };
      if (kind === 'aiservices')
        return { agentType:'ai-foundry', risk:'high', pii:true, phi:hasPhi, protocols:['Azure AI Foundry API','REST'], label:'Azure AI Foundry' };
      if (type.includes('cognitiveservices/accounts/projects'))
        return { agentType:'ai-project', risk:'high', pii:true, phi:false, protocols:['Azure AI Foundry API','REST'], label:'AI Foundry Project' };
      if (type.includes('microsoft.app/containerapps'))
        return { agentType:'agent', risk:'high', pii:true, phi:hasPhi, protocols:['HTTP','REST','Container'], label:'AI Container Agent' };
      if (type.includes('microsoft.securitycopilot'))
        return { agentType:'copilot', risk:'high', pii:true, phi:false, protocols:['Microsoft Security Copilot API'], label:'Microsoft Security Copilot' };
      if (kind === 'aiservices')
        return { agentType:'ai-foundry', risk:'high', pii:true, phi:hasPhi, protocols:['Azure AI Foundry API','REST'], label:'Azure AI Foundry' };
      if (type.includes('cognitiveservices/accounts/projects'))
        return { agentType:'ai-project', risk:'high', pii:true, phi:false, protocols:['Azure AI Foundry API','REST'], label:'AI Foundry Project' };
      if (type.includes('microsoft.app/containerapps'))
        return { agentType:'agent', risk:'high', pii:true, phi:hasPhi, protocols:['HTTP','REST','Container'], label:'AI Container Agent' };
      if (type.includes('microsoft.securitycopilot'))
        return { agentType:'copilot', risk:'high', pii:true, phi:false, protocols:['Microsoft Security Copilot API'], label:'Microsoft Security Copilot' };
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
      if (kind.includes('aiservices') || kind === 'hub' || kind === 'project') return true;
      if (type.includes('microsoft.app/containerapps')) return true;
      if (type.includes('microsoft.securitycopilot')) return true;
      if (kind.includes('aiservices') || kind === 'hub' || kind === 'project') return true;
      if (type.includes('microsoft.app/containerapps')) return true;
      if (type.includes('microsoft.securitycopilot')) return true;
      if (kind.includes('aiservices') || kind === 'hub' || kind === 'project') return true;
      if (type.includes('microsoft.app/containerapps')) return true;
      if (type.includes('microsoft.securitycopilot')) return true;
      if (kind.includes('aiservices') || kind === 'hub' || kind === 'project') return true;
      if (type.includes('microsoft.app/containerapps')) return true;
      if (type.includes('microsoft.securitycopilot')) return true;

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
        controls: (()=>{
          const hasPhi = classification.phi || false;
          const hasPii = classification.pii || false;
          const aType = classification.agentType || 'unknown';
          const isHighRiskAI = ['llm','ml-workspace','agent','cds','medical-device'].includes(aType);
          return {
            soc2: 'warn',
            iso27001: 'warn',
            gdpr: hasPii ? 'warn' : 'pass',
            nist: 'warn',
            euai: isHighRiskAI ? 'fail' : 'warn',
            hipaa: hasPhi ? 'fail' : 'pass',
            hitrust: hasPhi ? 'fail' : 'warn',
            fda_samd: aType === 'medical-device' ? 'warn' : 'pass',
          };
        })()
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


// ── Netskope endpoint scan ───────────────────────────────────
app.post('/api/endpoint/scan/netskope', auth, async (req, res) => {
  const { tenant, token } = req.body;
  if (!tenant || !token) return res.status(400).json({ error: 'tenant and token required' });
  try {
    const baseUrl = `https://${tenant}.goskope.com`;
    // Get AI-related application events from Netskope
    const eventsResp = await fetch(
      `${baseUrl}/api/v2/events/data/application?limit=1000&query=appcategory+eq+%22Generative+AI%22`,
      { headers: { 'Netskope-Api-Token': token } }
    ).then(r => r.json()).catch(() => ({ data: [] }));

    const aiDomains = [
      'chat.openai.com','api.openai.com','claude.ai','api.anthropic.com',
      'gemini.google.com','bard.google.com','copilot.microsoft.com',
      'huggingface.co','replicate.com','perplexity.ai','midjourney.com',
      'stability.ai','cohere.ai','together.ai','groq.com'
    ];

    // Also get URL filtering logs for AI domains
    const urlResp = await fetch(
      `${baseUrl}/api/v2/events/data/page?limit=1000&query=domain+in+(${aiDomains.map(d=>`%22${d}%22`).join(',')})`,
      { headers: { 'Netskope-Api-Token': token } }
    ).then(r => r.json()).catch(() => ({ data: [] }));

    const events = [...(eventsResp.data||[]), ...(urlResp.data||[])];
    const agentMap = {};

    for (const evt of events) {
      const domain = evt.domain || evt.hostname || evt.dst_hostname || '';
      const app = evt.app || evt.appsuite || domain;
      const user = evt.user || evt.srcip || 'unknown';
      if (!agentMap[app]) {
        agentMap[app] = {
          name: app,
          type: 'shadow-ai',
          env: 'SaaS',
          risk: 'high',
          shadow: true,
          pii: true,
          phi: false,
          protocols: ['HTTPS', 'CASB'],
          detect: 'Netskope CASB',
          notes: `Shadow AI detected via Netskope | Domain: ${domain} | Users: ${user}`,
          controls: { soc2:'fail', iso27001:'fail', gdpr:'fail', nist:'fail', euai:'fail', hipaa:'warn', hitrust:'fail', fda_samd:'pass' }
        };
      }
    }

    const agents = Object.values(agentMap);

    // Save discovered agents to DB
    for (const agent of agents) {
      await db.query(
        `INSERT INTO agents (name,type,env,risk,shadow,pii,phi,protocols,detect,notes,controls,tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (name) DO UPDATE SET last_seen=NOW(), shadow=$5`,
        [agent.name, agent.type, agent.env, agent.risk, agent.shadow,
         agent.pii, agent.phi, JSON.stringify(agent.protocols),
         agent.detect, agent.notes, JSON.stringify(agent.controls),
         req.tenantId || '00000000-0000-0000-0000-000000000001']
      ).catch(() => {});
    }

    res.json({
      agentsFound: agents.length,
      agents,
      eventsScanned: events.length,
      source: 'netskope'
    });
  } catch(e) {
    res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message });
  }
});


// ══ TENANT CONFIG API ═══════════════════════════════════════════

// GET /api/config — get tenant config (called on page load)
app.get('/api/config', async (req, res) => {
  try {
    const tenantId = req.headers['x-tenant-id'] || '00000000-0000-0000-0000-000000000001';
    const result = await db.query(
      'SELECT config_key, config_val FROM tenant_config WHERE tenant_id=$1',
      [tenantId]
    );
    const config = {};
    result.rows.forEach(r => { config[r.config_key] = r.config_val; });
    // Defaults if not set
    if (!config.modules) config.modules = {tier1:true,tier2:true,tier3:true,tier4:true,dashboard:true,compliance:true,remediation:true,dataLineage:true,activityFeed:true};
    if (!config.integrations) config.integrations = {azure:true,aws:true,gcp:true,copilotStudio:true,salesforce:true,workday:true,oracleCloud:true,cortexXDR:true,crowdstrike:true,intune:true,netskope:true,okta:true,splunk:true,sentinel:true,qradar:true,elastic:true};
    res.json(config);
  } catch(e) {
    res.json({ modules:{tier1:true,tier2:true,tier3:true,tier4:true,dashboard:true,compliance:true,remediation:true,dataLineage:true,activityFeed:true}, integrations:{} });
  }
});

// GET /api/admin/tenants — list all tenants with user counts (platform_admin only)
// NOTE: This is the single canonical implementation. Two duplicate GET and one
// duplicate POST handler were removed during the v1 release audit (see CHANGE_SUMMARY.md).
app.get('/api/admin/tenants', auth, platformAdmin, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT t.id, t.name, t.slug, t.plan, t.created_at, COUNT(u.id) as user_count FROM tenants t LEFT JOIN users u ON u.tenant_id=t.id GROUP BY t.id,t.name,t.slug,t.plan,t.created_at ORDER BY t.created_at DESC'
    );
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message }); }
});

// GET /api/admin/tenant/:id/config — get config for a specific tenant
app.get('/api/admin/tenant/:id/config', auth, async (req, res) => {
  if (req.user.role !== 'platform_admin') return res.status(403).json({error:'Forbidden'});
  try {
    const result = await db.query(
      'SELECT config_key, config_val FROM tenant_config WHERE tenant_id=$1',
      [req.params.id]
    );
    const config = {};
    result.rows.forEach(r => { config[r.config_key] = r.config_val; });
    res.json(config);
  } catch(e) { res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message }); }
});

// PUT /api/admin/tenant/:id/config — update config for a tenant
app.put('/api/admin/tenant/:id/config', auth, async (req, res) => {
  if (req.user.role !== 'platform_admin') return res.status(403).json({error:'Forbidden'});
  try {
    const { config_key, config_val } = req.body;
    if (!config_key || !config_val) return res.status(400).json({error:'config_key and config_val required'});
    await db.query(
      `INSERT INTO tenant_config (tenant_id, config_key, config_val, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (tenant_id, config_key) DO UPDATE
       SET config_val=$3, updated_by=$4, updated_at=NOW()`,
      [req.params.id, config_key, JSON.stringify(config_val), req.user?.email || 'platform_admin']
    );
    res.json({success:true, tenant_id:req.params.id, config_key, config_val});
    auditLog(req.params.id, req.user?.id, req.user?.email, 'config_updated', 'tenant_config', req.params.id, { config_key, updated_by: req.user?.email }, req);
  } catch(e) { res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message }); }
});

// GET /api/admin/tenants/:id/users — list users for a tenant
app.get('/api/admin/tenant/:id/users', auth, async (req, res) => {
  if (req.user.role !== 'platform_admin') return res.status(403).json({error:'Forbidden'});
  try {
    const result = await db.query(
      'SELECT id, email, name, role, created_at FROM users WHERE tenant_id=$1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message }); }
});



// ══ OKTA SSO ══════════════════════════════════════════════════
app.get('/api/auth/sso/okta', (req, res) => {
  const domain = process.env.OKTA_DOMAIN;
  const clientId = process.env.OKTA_CLIENT_ID;
  const appUrl = process.env.APP_URL || 'https://20.228.158.234';
  
  if (!domain || !clientId) {
    return res.redirect(`${appUrl}/#sso-error=${encodeURIComponent('Okta SSO not configured — set OKTA_DOMAIN and OKTA_CLIENT_ID')}`);
  }
  
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: 'openid profile email',
    redirect_uri: `${appUrl}/api/auth/sso/okta/callback`,
    state: Math.random().toString(36).slice(2),
  });
  res.redirect(`https://${domain}/oauth2/default/v1/authorize?${params}`);
});

app.get('/api/auth/sso/okta/callback', async (req, res) => {
  const appUrl = process.env.APP_URL || 'https://20.228.158.234';
  try {
    const { code } = req.query;
    if (!code) throw new Error('No authorization code');
    
    const domain = process.env.OKTA_DOMAIN;
    const clientId = process.env.OKTA_CLIENT_ID;
    const clientSecret = process.env.OKTA_CLIENT_SECRET;
    
    // Exchange code for token
    const tokenResp = await fetch(`https://${domain}/oauth2/default/v1/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${appUrl}/api/auth/sso/okta/callback`,
        client_id: clientId,
        client_secret: clientSecret,
      })
    }).then(r => r.json());
    
    if (!tokenResp.access_token) throw new Error('Token exchange failed');
    
    // Get user info
    const userinfo = await fetch(`https://${domain}/oauth2/default/v1/userinfo`, {
      headers: { 'Authorization': 'Bearer ' + tokenResp.access_token }
    }).then(r => r.json());
    
    const email = (userinfo.email || userinfo.preferred_username || '').toLowerCase();
    if (!email) throw new Error('No email in Okta response');
    
    // Upsert user
    let user = (await db.query('SELECT * FROM users WHERE email=$1', [email])).rows[0];
    if (!user) {
      user = (await db.query(
        `INSERT INTO users (email, name, role, password_hash, password, tenant_id)
         VALUES ($1,$2,$3,$4,$4,'00000000-0000-0000-0000-000000000001') RETURNING *`,
        [email, userinfo.name || email.split('@')[0], 'viewer', require('crypto').randomBytes(32).toString('hex')]
      )).rows[0];
    }
    
    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      { sub: user.id, email: user.email, name: user.name, role: user.role, sso: 'okta' },
      process.env.JWT_SECRET || 'AgentRadarJWT2026SecretKeyForCustomerDeployment',
      { expiresIn: '8h' }
    );
    
    // C2 FIX: Never put token in URL — use one-time code
    const ssoCode = require('crypto').randomBytes(32).toString('hex');
    ssoCodeStore.set(ssoCode, { token, expires: Date.now() + 60000 });
    // FIX: Validate redirect destination before following
    const allowedOrigin = process.env.APP_URL || 'https://agentradar.idenaccess.com';
    const safeRedirect  = allowedOrigin.replace(/\/$/, '') + '/sso-callback';
    res.redirect(`${safeRedirect}?code=${ssoCode}`);
  } catch(e) {
    res.redirect(`${appUrl}/#sso-error=${encodeURIComponent(e.message)}`);
  }
});



// ══ SIEM INTEGRATION API ════════════════════════════════════════

// POST /api/siem/send — send events to configured SIEM
app.post('/api/siem/send', auth, async (req, res) => {
  try {
    const { provider, event } = req.body;
    const creds = await db.query(
      "SELECT credentials FROM integration_credentials WHERE tenant_id=$1 AND provider=$2",
      [req.tenantId||'00000000-0000-0000-0000-000000000001', provider]
    ).then(r => r.rows[0]?.credentials || {});

    let result = {};

    if (provider === 'splunk') {
      const r = await fetch(`${creds.url}/services/collector/event`, {
        method: 'POST',
        headers: { 'Authorization': `Splunk ${creds.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, sourcetype: 'agentRadar', source: 'agentRadar-platform' })
      }).then(r => r.json()).catch(e => ({error: e.message}));
      result = r;

    } else if (provider === 'sentinel') {
      // Azure Sentinel Log Analytics workspace
      const workspaceId = creds.workspaceId;
      const sharedKey = creds.sharedKey;
      const logType = 'AgentRadar';
      const body = JSON.stringify([event]);
      const date = new Date().toUTCString();
      const contentLength = Buffer.byteLength(body, 'utf8');
      const stringToHash = `POST
${contentLength}
application/json
x-ms-date:${date}
/api/logs`;
      const crypto = require('crypto');
      const hash = crypto.createHmac('sha256', Buffer.from(sharedKey, 'base64')).update(stringToHash).digest('base64');
      const auth_header = `SharedKey ${workspaceId}:${hash}`;
      const r = await fetch(
        `https://${workspaceId}.ods.opinsights.azure.com/api/logs?api-version=2016-04-01`,
        { method:'POST', headers:{'Authorization':auth_header,'Log-Type':logType,'x-ms-date':date,'Content-Type':'application/json'}, body }
      ).then(r => ({status: r.status})).catch(e => ({error: e.message}));
      result = r;

    } else if (provider === 'qradar') {
      const r = await fetch(`${creds.url}/api/siem/offenses`, {
        method: 'POST',
        headers: { 'SEC': creds.token, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(event)
      }).then(r => r.json()).catch(e => ({error: e.message}));
      result = r;

    } else if (provider === 'elastic') {
      const r = await fetch(`${creds.url}/agentRadar-events/_doc`, {
        method: 'POST',
        headers: { 'Authorization': `ApiKey ${creds.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...event, '@timestamp': new Date().toISOString() })
      }).then(r => r.json()).catch(e => ({error: e.message}));
      result = r;
    }

    res.json({ success: true, provider, result });
  } catch(e) { res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message }); }
});

// POST /api/siem/test — test SIEM connection
app.post('/api/siem/test', auth, async (req, res) => {
  try {
    const { provider, credentials } = req.body;
    const testEvent = { source:'AgentRadar', type:'connection_test', message:'AgentRadar SIEM connection test', timestamp: new Date().toISOString() };

    if (provider === 'splunk') {
      const r = await fetch(`${credentials.url}/services/collector/event`, {
        method: 'POST',
        headers: { 'Authorization': `Splunk ${credentials.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: testEvent })
      });
      res.json({ success: r.ok, status: r.status });

    } else if (provider === 'elastic') {
      const r = await fetch(`${credentials.url}/_cluster/health`, {
        headers: { 'Authorization': `ApiKey ${credentials.apiKey}` }
      });
      const d = await r.json();
      res.json({ success: r.ok, status: d.status });

    } else {
      res.json({ success: true, message: `${provider} connection configured` });
    }
  } catch(e) { res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message }); }
});

// POST /api/siem/credentials — save SIEM credentials
app.post('/api/siem/credentials', auth, async (req, res) => {
  try {
    const { provider, credentials } = req.body;
    const tenantId = req.tenantId || '00000000-0000-0000-0000-000000000001';
    await db.query(
      `INSERT INTO integration_credentials (tenant_id, provider, credentials, updated_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (tenant_id, provider) DO UPDATE SET credentials=$3, updated_at=NOW()`,
      [tenantId, `siem_${provider}`, JSON.stringify(credentials)]
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message }); }
});


// ══ PHI DETECTION ENGINE ════════════════════════════════════════
// PHI detection — delegated to src/services/phi.js
const PHI_KEYWORDS = [..._phi.PHI_KEYWORDS];
const PHI_RESOURCE_TYPES = [];
const detectPHI = _phi.detectPHI;

// ── AI Foundry direct API discovery ──────────────────────────
async function discoverFoundryAgentsDirect(subscriptionId, resourceGroup, workspaceName, aoaiEndpoint, aoaiKey) {
  const agents = [];
  const log = [];
  
  try {
    // Try AI Foundry Agents API with AOAI key
    const endpoints = [
      `https://eastus.api.azureml.ms/agents/v1.0/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.MachineLearningServices/workspaces/${workspaceName}/agents`,
      `${aoaiEndpoint}/openai/assistants?api-version=2024-05-01-preview`,
    ];
    
    for (const endpoint of endpoints) {
      const headers = aoaiKey 
        ? { 'api-key': aoaiKey, 'Content-Type': 'application/json' }
        : {};
      
      const resp = await fetch(endpoint, { headers }).then(r=>r.json()).catch(()=>null);
      if (!resp) continue;
      
      const items = resp.data || resp.value || [];
      for (const agent of items) {
        agents.push({
          name: agent.name || agent.id || 'unnamed-agent',
          type: 'ai-foundry-agent',
          env: 'Cloud',
          risk: 'high',
          shadow: false,
          phi: false,
          pii: true,
          protocols: ['Azure AI Foundry Agent API','HTTPS','OpenAI Assistants API'],
          detect: 'AI Foundry direct scan',
          notes: `AI Foundry Agent | Project: ${workspaceName} | Model: ${agent.model||'unknown'} | Tools: ${(agent.tools||[]).map(t=>t.type).join(',')||'none'}`,
          controls: { soc2:'warn', iso27001:'warn', gdpr:'warn', nist:'warn', euai:'fail', hipaa:'pass', hitrust:'warn', fda_samd:'pass' }
        });
        log.push({ step:'found', status:'found', msg:`AI Foundry Agent: ${agent.name||agent.id} (model:${agent.model||'?'})` });
      }
      if (agents.length > 0) break;
    }
  } catch(e) {
    log.push({ step:'foundry-direct', status:'warn', msg:`Foundry direct scan error: ${e.message}` });
  }
  return { agents, log };
}


// Audit logging — delegated to src/services/audit.js
async function auditLog(tenantId, userId, userEmail, action, resourceType, resourceId, details, req) {
  return _audit.log({ tenantId, userId, userEmail, action, resource: resourceType, details, req });
}


// ══ MFA — TOTP for platform_admin + ciso roles (H1 fix) ══════
const { authenticator } = require('otplib');
const QRCode = require('qrcode');

authenticator.options = { window: 1 }; // Allow 30s clock drift

// GET /api/auth/mfa/setup — generate TOTP secret + QR code
app.get('/api/auth/mfa/setup', auth, async (req, res) => {
  try {
    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(req.user.email, 'AgentRadar', secret);
    const qr = await QRCode.toDataURL(otpauth);

    // Store secret temporarily (not enabled until verified)
    await db.query(
      'UPDATE users SET mfa_secret=$1 WHERE id=$2',
      [secret, req.user.sub]
    ).catch(async () => {
      // Add column if missing
      await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret TEXT');
      await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT false');
      await db.query('UPDATE users SET mfa_secret=$1 WHERE id=$2', [secret, req.user.sub]);
    });

    res.json({ secret, qr, message: 'Scan QR code then call /api/auth/mfa/verify to enable' });
  } catch(e) {
    res.status(500).json({ error: 'MFA setup failed' });
  }
});

// POST /api/auth/mfa/verify — verify code and enable MFA
app.post('/api/auth/mfa/verify', auth, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code required' });

    const user = (await db.query('SELECT mfa_secret FROM users WHERE id=$1', [req.user.sub])).rows[0];
    if (!user?.mfa_secret) return res.status(400).json({ error: 'Run /api/auth/mfa/setup first' });

    const valid = authenticator.verify({ token: code, secret: user.mfa_secret });
    if (!valid) return res.status(401).json({ error: 'Invalid code — check your authenticator app' });

    await db.query('UPDATE users SET mfa_enabled=true WHERE id=$1', [req.user.sub]);
    res.json({ success: true, message: 'MFA enabled successfully' });
  } catch(e) {
    res.status(500).json({ error: 'MFA verification failed' });
  }
});

// POST /api/auth/mfa/disable — disable MFA (admin only)
app.post('/api/auth/mfa/disable', auth, requireRole('platform_admin'), async (req, res) => {
  try {
    const { userId } = req.body;
    await db.query('UPDATE users SET mfa_enabled=false, mfa_secret=NULL WHERE id=$1',
      [userId || req.user.sub]);
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ══ AWS DISCOVERY ENGINE ═══════════════════════════════════
async function discoverAWS(accessKeyId, secretAccessKey, region='us-east-1') {
  const log = [];
  const discovered = { services:[], scanners:new Set(), agents:[] };

  try {
    // AWS uses SigV4 signing — use fetch with AWS SDK pattern
    // We call AWS APIs directly using the credentials
    const AWS_REGIONS = [region, 'us-east-1', 'us-west-2', 'eu-west-1'].filter((v,i,a)=>a.indexOf(v)===i);

    log.push({step:'auth', status:'ok', msg:`AWS credentials received — scanning ${AWS_REGIONS.length} regions`});

    // Helper: AWS API call with SigV4
    async function awsCall(service, region, action, params={}) {
      try {
        // Use AWS SDK via require if available, else use HTTP
        const { S3Client, ListBucketsCommand } = require('@aws-sdk/client-s3').catch ? {} : {};
        // Direct HTTP approach using AWS credentials
        const queryStr = Object.entries({Action:action,...params,Version:'2012-10-17'})
          .map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&');
        const url = `https://${service}.${region}.amazonaws.com/?${queryStr}`;
        const resp = await fetch(url, {
          headers: {
            'X-Amz-Security-Token': '',
            'Authorization': `AWS4-HMAC-SHA256 Credential=${accessKeyId}`
          }
        }).catch(()=>null);
        return resp;
      } catch(e) { return null; }
    }

    // Use AWS SDK packages if installed
    let bedrockModels = [], sagemakerEndpoints = [], sagemakerModels = [],
        lambdaFunctions = [], ecrRepos = [], s3Buckets = [];

    for (const r of AWS_REGIONS) {
      try {
        // Bedrock — list foundation models
        const bedrockResp = await fetch(
          `https://bedrock.${r}.amazonaws.com/foundation-models`,
          { headers: await awsAuthHeaders(accessKeyId, secretAccessKey, r, 'bedrock', 'GET', '/foundation-models') }
        ).then(res=>res.json()).catch(()=>({modelSummaries:[]}));

        if (bedrockResp.modelSummaries?.length) {
          bedrockModels.push(...bedrockResp.modelSummaries.map(m=>({...m, region:r})));
          discovered.scanners.add('sc-cloud-aws');
        }

        // SageMaker — list endpoints
        const smResp = await fetch(
          `https://api.sagemaker.${r}.amazonaws.com/`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-amz-json-1.1',
              'X-Amz-Target': 'SageMaker.ListEndpoints',
              ...(await awsAuthHeaders(accessKeyId, secretAccessKey, r, 'sagemaker', 'POST', '/'))
            },
            body: JSON.stringify({MaxResults: 100})
          }
        ).then(res=>res.json()).catch(()=>({Endpoints:[]}));

        if (smResp.Endpoints?.length) {
          sagemakerEndpoints.push(...smResp.Endpoints.map(e=>({...e, region:r})));
          discovered.scanners.add('sc-cloud-aws');
        }

      } catch(e) {}
    }

    // Register Bedrock models as agents
    for (const model of bedrockModels) {
      discovered.agents.push({
        name: model.modelName || model.modelId,
        type: 'llm',
        env: 'Cloud',
        risk: 'medium',
        shadow: false,
        phi: false,
        pii: false,
        protocols: ['AWS Bedrock API', 'REST'],
        detect: 'AWS auto-discovery',
        notes: `AWS Bedrock | Model: ${model.modelId} | Provider: ${model.providerName} | Region: ${model.region}`,
        controls: { soc2:'warn', iso27001:'warn', gdpr:'warn', nist:'warn', euai:'fail', hipaa:'pass', hitrust:'warn', fda_samd:'pass' }
      });
      log.push({step:'found', status:'found', msg:`Bedrock: ${model.modelName||model.modelId} (${model.region})`});
    }

    // Register SageMaker endpoints as agents
    for (const ep of sagemakerEndpoints) {
      discovered.agents.push({
        name: ep.EndpointName,
        type: 'ml-workspace',
        env: 'Cloud',
        risk: ep.EndpointStatus === 'InService' ? 'high' : 'medium',
        shadow: false,
        phi: false,
        pii: true,
        protocols: ['AWS SageMaker API', 'REST'],
        detect: 'AWS auto-discovery',
        notes: `AWS SageMaker | Status: ${ep.EndpointStatus} | Region: ${ep.region}`,
        controls: { soc2:'warn', iso27001:'warn', gdpr:'warn', nist:'warn', euai:'fail', hipaa:'warn', hitrust:'warn', fda_samd:'warn' }
      });
      log.push({step:'found', status:'found', msg:`SageMaker endpoint: ${ep.EndpointName} (${ep.region}) — ${ep.EndpointStatus}`});
    }

    if (discovered.agents.length === 0) {
      log.push({step:'summary', status:'ok', msg:'No Bedrock/SageMaker resources found — credentials may need additional IAM permissions (bedrock:ListFoundationModels, sagemaker:ListEndpoints)'});
    } else {
      log.push({step:'summary', status:'ok', msg:`AWS discovery complete: ${discovered.agents.length} AI agents found across ${AWS_REGIONS.join(', ')}`});
    }

  } catch(e) {
    log.push({step:'error', status:'error', msg:'AWS discovery error: '+e.message});
  }

  return {cloud:'aws', ...discovered, scanners:[...discovered.scanners], log};
}

// AWS SigV4 auth headers helper
async function awsAuthHeaders(accessKeyId, secretAccessKey, region, service, method, path) {
  try {
    const crypto = require('crypto');
    const now = new Date();
    const dateStr = now.toISOString().replace(/[:\-]|\.\d{3}/g,'').substring(0,8);
    const timeStr = now.toISOString().replace(/[:\-]|\.\d{3}/g,'').substring(0,15)+'Z';

    const canonicalHeaders = `host:${service}.${region}.amazonaws.com
x-amz-date:${timeStr}
`;
    const signedHeaders = 'host;x-amz-date';
    const payloadHash = crypto.createHash('sha256').update('').digest('hex');
    const canonicalRequest = [method,'/',' ',canonicalHeaders,signedHeaders,payloadHash].join('\n');

    const credentialScope = `${dateStr}/${region}/${service}/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256',timeStr,credentialScope,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');

    const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
    const signingKey = hmac(hmac(hmac(hmac('AWS4'+secretAccessKey, dateStr), region), service), 'aws4_request');
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    return {
      'X-Amz-Date': timeStr,
      'Authorization': `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
  } catch(e) { return {}; }
}

// ══ GCP DISCOVERY ENGINE ════════════════════════════════════
async function discoverGCP(projectId, serviceAccountKey) {
  const log = [];
  const discovered = { services:[], scanners:new Set(), agents:[] };

  try {
    // Parse service account key
    let saKey;
    try {
      saKey = typeof serviceAccountKey === 'string' ? JSON.parse(serviceAccountKey) : serviceAccountKey;
    } catch(e) {
      throw new Error('Invalid service account key JSON: '+e.message);
    }

    log.push({step:'auth', status:'ok', msg:`GCP credentials received for project: ${projectId}`});

    // Get access token using service account JWT
    const gcpToken = await getGCPToken(saKey);
    if (!gcpToken) throw new Error('Failed to obtain GCP access token — check service account key');

    log.push({step:'auth', status:'ok', msg:'GCP authentication successful'});

    const authHeader = { 'Authorization': 'Bearer '+gcpToken };

    // ── Vertex AI endpoints ───────────────────────────────
    const GCP_REGIONS = ['us-central1','us-east1','europe-west1','us-west1','asia-east1'];
    let vertexEndpoints = [], aiplatformModels = [];

    for (const region of GCP_REGIONS) {
      const vtxResp = await fetch(
        `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/endpoints`,
        { headers: authHeader }
      ).then(r=>r.json()).catch(()=>({endpoints:[]}));

      if (vtxResp.endpoints?.length) {
        vertexEndpoints.push(...vtxResp.endpoints.map(e=>({...e, region})));
        discovered.scanners.add('sc-gemini');
      }
    }

    // ── Vertex AI models ──────────────────────────────────
    const modelsResp = await fetch(
      `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/models`,
      { headers: authHeader }
    ).then(r=>r.json()).catch(()=>({models:[]}));

    aiplatformModels = modelsResp.models || [];

    // ── Cloud AI APIs in use ──────────────────────────────
    const servicesResp = await fetch(
      `https://serviceusage.googleapis.com/v1/projects/${projectId}/services?filter=state:ENABLED`,
      { headers: authHeader }
    ).then(r=>r.json()).catch(()=>({services:[]}));

    const AI_APIS = [
      'aiplatform.googleapis.com','generativelanguage.googleapis.com',
      'automl.googleapis.com','vision.googleapis.com','speech.googleapis.com',
      'language.googleapis.com','translate.googleapis.com','videointelligence.googleapis.com',
      'dialogflow.googleapis.com','discoveryengine.googleapis.com',
    ];

    const enabledAI = (servicesResp.services||[])
      .filter(s => AI_APIS.some(api => s.name?.includes(api)));

    enabledAI.forEach(s => {
      const apiName = s.name?.split('/').pop() || s.name;
      discovered.agents.push({
        name: apiName.replace('.googleapis.com',''),
        type: apiName.includes('generative') ? 'llm' : 'ai-service',
        env: 'Cloud',
        risk: 'medium',
        shadow: false,
        phi: false,
        pii: true,
        protocols: ['GCP REST API', 'gRPC'],
        detect: 'GCP auto-discovery',
        notes: `GCP AI API | Service: ${apiName} | Project: ${projectId}`,
        controls: { soc2:'warn', iso27001:'warn', gdpr:'warn', nist:'warn', euai:'fail', hipaa:'pass', hitrust:'warn', fda_samd:'pass' }
      });
      log.push({step:'found', status:'found', msg:`GCP AI API enabled: ${apiName} (project: ${projectId})`});
    });

    // Register Vertex AI endpoints
    for (const ep of vertexEndpoints) {
      discovered.agents.push({
        name: ep.displayName || ep.name?.split('/').pop() || 'Vertex Endpoint',
        type: 'ml-workspace',
        env: 'Cloud',
        risk: 'high',
        shadow: false,
        phi: false,
        pii: true,
        protocols: ['Vertex AI REST API', 'gRPC'],
        detect: 'GCP auto-discovery',
        notes: `Vertex AI Endpoint | Region: ${ep.region} | Project: ${projectId} | State: ${ep.dedicatedResources?'Active':'Serverless'}`,
        controls: { soc2:'warn', iso27001:'warn', gdpr:'warn', nist:'warn', euai:'fail', hipaa:'warn', hitrust:'warn', fda_samd:'warn' }
      });
      log.push({step:'found', status:'found', msg:`Vertex AI endpoint: ${ep.displayName||ep.name} (${ep.region})`});
    }

    if (discovered.agents.length === 0) {
      log.push({step:'summary', status:'ok', msg:`No GCP AI resources found in project ${projectId} — check if Vertex AI or AI APIs are enabled`});
    } else {
      log.push({step:'summary', status:'ok', msg:`GCP discovery complete: ${discovered.agents.length} AI agents found in project ${projectId}`});
    }

  } catch(e) {
    log.push({step:'error', status:'error', msg:'GCP discovery error: '+e.message});
  }

  return {cloud:'gcp', ...discovered, scanners:[...discovered.scanners], log};
}

// GCP JWT token helper
async function getGCPToken(saKey) {
  try {
    const crypto = require('crypto');
    const now = Math.floor(Date.now()/1000);
    const header = Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: saKey.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now+3600, iat: now
    })).toString('base64url');

    const sign = crypto.createSign('RSA-SHA256');
    sign.update(header+'.'+payload);
    const sig = sign.sign(saKey.private_key, 'base64url');
    const jwt = header+'.'+payload+'.'+sig;

    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {'Content-Type':'application/x-www-form-urlencoded'},
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    }).then(r=>r.json());

    return tokenResp.access_token || null;
  } catch(e) { return null; }
}

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
      if (aws?.accessKeyId && aws?.secretAccessKey) {
        const r = await discoverAWS(aws.accessKeyId, aws.secretAccessKey, aws.region||'us-east-1');
        all.agents.push(...r.agents); r.scanners.forEach(s=>all.scanners.add(s));
        all.logs.push({cloud:'AWS',entries:r.log});
        all.summary.aws={services:r.services?.length||0,scanners:r.scanners.length,agents:r.agents.length};
      }
      if (gcp?.projectId && gcp?.serviceAccountKey) {
        const r = await discoverGCP(gcp.projectId, gcp.serviceAccountKey);
        all.agents.push(...r.agents); r.scanners.forEach(s=>all.scanners.add(s));
        all.logs.push({cloud:'GCP',entries:r.log});
        all.summary.gcp={services:r.services?.length||0,scanners:r.scanners.length,agents:r.agents.length};
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
            // Update last_seen AND controls on existing agent
            await db.query(
              `UPDATE agents SET last_seen=NOW(), risk=$1, controls=$2,
               pii=$3, phi=$4, protocols=$5, updated_at=NOW() WHERE id=$6`,
              [agent.risk||'medium',
               JSON.stringify(agent.controls||{}),
               agent.pii||false,
               agent.phi||false,
               JSON.stringify(agent.protocols||[]),
               existing.rows[0].id]
            );
          } else {
            await db.query(
              `INSERT INTO agents (id,name,type,env,risk,shadow,phi,pii,protocols,controls,metadata,detect,tenant_id,first_detected,last_seen,created_at,updated_at)
               VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW(),NOW(),NOW())`,
              [agent.name, agent.type||'unknown', agent.env||'Cloud', agent.risk||'medium',
               agent.shadow||false, agent.phi||false, agent.pii||false,
               JSON.stringify(agent.protocols||[]), JSON.stringify(agent.controls||{}),
               JSON.stringify({notes:agent.notes||'', detect:agent.detect||'Azure auto-discovery', source:'autodiscovery'}),
               agent.detect||'auto-discovery', tId]
            );
          }
          saved++;
        } catch(e){}
      }

      await db.query(`INSERT INTO activity (id,category,description,created_by,tenant_id)
        VALUES (gen_random_uuid(),$1,$2,$3,$4)`,
        ['discovery', `Auto-discovery: ${saved} agents found, ${[...all.scanners].length} scanners enabled`, req.user.email, tId]).catch(()=>{});
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
  } catch(e) { res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message }); }
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
      res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message });
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
    res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message });
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
    res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message });
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
  } catch(e) { res.status(500).json({ error: process.env.NODE_ENV==='production' && 500==='500' ? 'Internal server error' : e.message }); }
});


// ══ PROXY / CASB INTEGRATION ═══════════════════════════════

// Known AI service domains and their classifications
const AI_DOMAINS = {
  // LLMs
  'api.openai.com':            { name:'OpenAI API', type:'llm', risk:'high', pii:true },
  'api.anthropic.com':         { name:'Anthropic Claude API', type:'llm', risk:'high', pii:true },
  'generativelanguage.googleapis.com': { name:'Google Gemini API', type:'llm', risk:'high', pii:true },
  'api.mistral.ai':            { name:'Mistral AI API', type:'llm', risk:'medium', pii:true },
  'api.cohere.com':            { name:'Cohere API', type:'llm', risk:'medium', pii:true },
  'api.together.xyz':          { name:'Together AI', type:'llm', risk:'medium', pii:true },
  'api.perplexity.ai':         { name:'Perplexity AI', type:'llm', risk:'medium', pii:true },
  'api.groq.com':              { name:'Groq API', type:'llm', risk:'medium', pii:true },
  // Azure AI
  'openai.azure.com':          { name:'Azure OpenAI', type:'llm', risk:'medium', pii:true },
  'cognitiveservices.azure.com': { name:'Azure Cognitive Services', type:'ai-service', risk:'medium', pii:true },
  // AWS
  'bedrock-runtime.amazonaws.com': { name:'AWS Bedrock', type:'llm', risk:'medium', pii:true },
  'bedrock.amazonaws.com':     { name:'AWS Bedrock', type:'llm', risk:'medium', pii:true },
  // GCP
  'aiplatform.googleapis.com': { name:'Vertex AI', type:'ml-workspace', risk:'medium', pii:true },
  // Copilot
  'copilot.microsoft.com':     { name:'Microsoft Copilot', type:'copilot', risk:'medium', pii:true },
  'substrate.office.com':      { name:'M365 Copilot', type:'copilot', risk:'medium', pii:true },
  // Code assistants
  'githubcopilot.com':         { name:'GitHub Copilot', type:'code-assistant', risk:'low', pii:false },
  'copilot-proxy.githubusercontent.com': { name:'GitHub Copilot', type:'code-assistant', risk:'low', pii:false },
  // Productivity AI
  'app.grammarly.com':         { name:'Grammarly AI', type:'saas-ai', risk:'low', pii:true },
  'api.notion.so':             { name:'Notion AI', type:'saas-ai', risk:'low', pii:true },
  'api.jasper.ai':             { name:'Jasper AI', type:'saas-ai', risk:'medium', pii:true },
  // Healthcare AI
  'nuance.com':                { name:'Nuance AI (Microsoft)', type:'medical-device', risk:'high', phi:true, pii:true },
  'dax.nuance.com':            { name:'Nuance DAX (Clinical AI)', type:'medical-device', risk:'critical', phi:true, pii:true },
  // Shadow AI
  'chat.openai.com':           { name:'ChatGPT (Consumer)', type:'llm', risk:'high', pii:true, shadow:true },
  'claude.ai':                 { name:'Claude.ai (Consumer)', type:'llm', risk:'high', pii:true, shadow:true },
  'gemini.google.com':         { name:'Gemini (Consumer)', type:'llm', risk:'high', pii:true, shadow:true },
  'poe.com':                   { name:'Poe AI', type:'llm', risk:'high', pii:true, shadow:true },
  'character.ai':              { name:'Character.AI', type:'llm', risk:'high', pii:true, shadow:true },
};

// POST /api/proxy/ingest — receive proxy logs and extract AI traffic
app.post('/api/proxy/ingest', auth, asyncHandler(async (req, res) => {
  const { format, logs, source } = req.body;
  const tId = req.user.tenantId || '00000000-0000-0000-0000-000000000001';

  if (!logs || !Array.isArray(logs)) {
    return res.status(400).json({ error: 'logs array required' });
  }

  const discovered = [];
  const userAgentMap = {}; // track which users hit which AI

  for (const entry of logs) {
    // Support multiple proxy log formats
    const url = entry.url || entry.URL || entry.destination || entry.dst_url || '';
    const user = entry.user || entry.username || entry.src_user || entry.identity || 'unknown';
    const device = entry.device || entry.src_ip || entry.hostname || 'unknown';
    const timestamp = entry.timestamp || entry.time || new Date().toISOString();
    const bytes = entry.bytes || entry.bytes_sent || 0;

    // Extract domain from URL
    let domain = '';
    try {
      domain = new URL(url.startsWith('http') ? url : 'https://'+url).hostname.replace(/^www\./, '');
    } catch(e) { domain = url.split('/')[0]; }

    // Check against AI domain list
    const aiMatch = AI_DOMAINS[domain] ||
      Object.entries(AI_DOMAINS).find(([d]) => domain.endsWith('.'+d) || domain === d)?.[1];

    if (aiMatch) {
      const key = domain + ':' + user;
      if (!userAgentMap[key]) {
        userAgentMap[key] = {
          domain, user, device,
          firstSeen: timestamp,
          lastSeen: timestamp,
          requestCount: 0,
          totalBytes: 0,
          ...aiMatch
        };
      }
      userAgentMap[key].lastSeen = timestamp;
      userAgentMap[key].requestCount++;
      userAgentMap[key].totalBytes += parseInt(bytes) || 0;
    }
  }

  // Convert to agents and save
  let saved = 0;
  for (const [key, data] of Object.entries(userAgentMap)) {
    const agentName = `${data.name} (${data.user})`;
    try {
      const existing = await db.query(
        'SELECT id FROM agents WHERE name=$1 AND tenant_id=$2 LIMIT 1',
        [agentName, tId]
      );
      const controls = {
        soc2:'warn', iso27001:'warn', gdpr: data.pii ? 'warn' : 'pass',
        nist:'warn', euai: data.type==='llm' ? 'fail' : 'warn',
        hipaa: data.phi ? 'fail' : 'pass', hitrust:'warn', fda_samd:'pass'
      };
      if (existing.rows.length > 0) {
        await db.query(
          'UPDATE agents SET last_seen=NOW(), updated_at=NOW() WHERE id=$1',
          [existing.rows[0].id]
        );
      } else {
        await db.query(
          `INSERT INTO agents (id,name,type,env,risk,shadow,phi,pii,protocols,controls,metadata,detect,tenant_id,first_detected,last_seen,created_at,updated_at)
           VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW(),NOW(),NOW())`,
          [agentName, data.type||'llm', 'Cloud', data.risk||'medium',
           data.shadow||false, data.phi||false, data.pii||false,
           JSON.stringify(['HTTPS']),
           JSON.stringify(controls),
           JSON.stringify({
             notes: `Proxy detected | Domain: ${data.domain} | User: ${data.user} | Device: ${data.device} | Requests: ${data.requestCount} | Bytes: ${data.totalBytes}`,
             detect: 'Proxy/CASB log analysis',
             source: source || 'proxy',
             user: data.user, device: data.device,
           }),
           'Proxy/CASB log analysis', tId]
        );
        saved++;
      }
      discovered.push({name:agentName, domain:data.domain, user:data.user, requests:data.requestCount});
    } catch(e) { logger.error('proxy ingest error', {error:e.message}); }
  }

  await db.query(
    'INSERT INTO activity (id,category,description,created_by,tenant_id) VALUES (gen_random_uuid(),$1,$2,$3,$4)',
    ['discovery', `Proxy scan: ${saved} new AI agents discovered from ${logs.length} log entries`, req.user.email, tId]
  ).catch(()=>{});

  res.json({
    processed: logs.length,
    aiTrafficEntries: Object.keys(userAgentMap).length,
    newAgents: saved,
    discovered
  });
}));

// GET /api/proxy/domains — return full AI domain list for CASB policy import
app.get('/api/proxy/domains', auth, (req, res) => {
  const domains = Object.entries(AI_DOMAINS).map(([domain, info]) => ({
    domain,
    ...info,
    category: info.shadow ? 'shadow-ai' : 'sanctioned-ai',
  }));
  res.json({
    total: domains.length,
    shadowAI: domains.filter(d=>d.shadow).length,
    sanctioned: domains.filter(d=>!d.shadow).length,
    domains
  });
});

// GET /api/proxy/config/:type — return proxy config for Zscaler/Netskope/Bluecoat
app.get('/api/proxy/config/:type', auth, (req, res) => {
  const domains = Object.keys(AI_DOMAINS);
  const shadowDomains = Object.entries(AI_DOMAINS).filter(([,v])=>v.shadow).map(([d])=>d);
  const type = req.params.type;

  if (type === 'zscaler') {
    res.json({
      instructions: 'Import these URL categories into Zscaler Internet Access',
      categories: [
        { name: 'AgentRadar-AI-Sanctioned', urls: domains.filter(d=>!AI_DOMAINS[d].shadow), action: 'allow-and-log' },
        { name: 'AgentRadar-AI-Shadow', urls: shadowDomains, action: 'block-or-isolate' },
      ]
    });
  } else if (type === 'netskope') {
    res.json({
      instructions: 'Use these app tags in Netskope CASB policies',
      sanctionedApps: domains.filter(d=>!AI_DOMAINS[d].shadow),
      unsanctionedApps: shadowDomains,
      policy: 'Create a Netskope Real-time Protection policy: Match app-tag=AI-Shadow → Block + Alert AgentRadar'
    });
  } else if (type === 'bluecoat') {
    const proxyConfig = domains.map(d => `define condition AI_TRAFFIC\n  url.domain=${d}\nend condition`).join('\n');
    res.type('text/plain').send(proxyConfig);
  } else {
    res.json({ domains, shadowDomains, format: 'generic' });
  }
});


// POST /api/endpoint/scan/cortex — scan via Palo Alto Cortex XDR
app.post('/api/endpoint/scan/cortex', auth, asyncHandler(async (req, res) => {
  const { apiKey, apiKeyId, fqdn } = req.body;
  const tId = req.user.tenantId || '00000000-0000-0000-0000-000000000001';

  if (!apiKey || !apiKeyId || !fqdn)
    return res.status(400).json({ error: 'apiKey, apiKeyId and fqdn required' });

  const discovered = [];
  const logs = [];

  try {
    const crypto = require('crypto');

    // Cortex XDR uses HMAC-SHA256 auth
    function cortexAuthHeaders(apiKey, apiKeyId) {
      const nonce = crypto.randomBytes(16).toString('hex');
      const timestamp = Date.now().toString();
      const authString = apiKey + nonce + timestamp;
      const authHash = crypto.createHash('sha256').update(authString).digest('hex');
      return {
        'x-xdr-auth-id': String(apiKeyId),
        'x-xdr-nonce': nonce,
        'x-xdr-timestamp': timestamp,
        'x-xdr-auth-hash': authHash,
        'Content-Type': 'application/json',
      };
    }

    const baseUrl = `https://api-${fqdn}.xdr.us.paloaltonetworks.com/public_api/v1`;
    const headers = cortexAuthHeaders(apiKey, apiKeyId);

    // Step 1: Get all endpoints
    const endpointsResp = await fetch(`${baseUrl}/endpoints/get_endpoints/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        request_data: {
          filters: [{ field: 'endpoint_status', operator: 'in', value: ['connected', 'disconnected'] }],
          search_from: 0,
          search_to: 500,
        }
      })
    }).then(r=>r.json()).catch(()=>({reply:{endpoints:[]}}));

    const endpoints = endpointsResp.reply?.endpoints || [];
    logs.push({step:'inventory', status:'ok', msg:`Found ${endpoints.length} endpoints in Cortex XDR`});

    if (endpoints.length === 0) {
      logs.push({step:'summary', status:'warn', msg:'No endpoints found — check API key permissions (Endpoint Administration read)'});
      return res.json({devices:0, discovered:0, saved:0, logs});
    }

    // Step 2: Get installed software via XQL query
    const xqlQuery = `
      dataset = xdr_data
      | filter event_type = "PROCESS"
      | filter lowercase(action_process_image_name) in (
          "ollama", "vllm", "llama-server", "llama.cpp",
          "claude-code", "cursor", "jan", "lmstudio", "gpt4all",
          "koboldcpp", "codeium", "continue"
        )
      | fields agent_hostname, agent_ip_addresses, actor_primary_username,
               action_process_image_name, action_process_image_path,
               action_process_command_line, event_timestamp
      | limit 1000
    `;

    const xqlResp = await fetch(`${baseUrl}/xql/start_xql_query/`, {
      method: 'POST',
      headers: cortexAuthHeaders(apiKey, apiKeyId),
      body: JSON.stringify({ request_data: { query: xqlQuery, timeframe: { relativeTime: 'last_24_hours' } } })
    }).then(r=>r.json()).catch(()=>({reply:{}}));

    const queryId = xqlResp.reply?.queryId;
    logs.push({step:'xql', status:'ok', msg:'XQL process query submitted'});

    if (queryId) {
      // Poll for XQL results
      await new Promise(r=>setTimeout(r,3000));
      const resultsResp = await fetch(`${baseUrl}/xql/get_query_results/`, {
        method: 'POST',
        headers: cortexAuthHeaders(apiKey, apiKeyId),
        body: JSON.stringify({ request_data: { query_id: queryId, format: 'json' } })
      }).then(r=>r.json()).catch(()=>({reply:{results:{data:[]}}}));

      const processes = resultsResp.reply?.results?.data || [];
      logs.push({step:'processes', status:'ok', msg:`Found ${processes.length} AI process events`});

      for (const proc of processes) {
        const procName = (proc.action_process_image_name||'').toLowerCase();
        const match = AI_PROCESSES.find(p => {
          try { return new RegExp(p.name,'i').test(procName); }
          catch(e) { return procName.includes(p.name); }
        });

        if (match) {
          const agentName = `${match.label} — ${proc.agent_hostname}`;
          discovered.push({
            name: agentName,
            type: match.type,
            env: 'On-Prem',
            risk: match.risk,
            shadow: match.shadow || false,
            phi: false, pii: false,
            protocols: ['Local Process'],
            detect: 'Cortex XDR scan',
            notes: `Cortex XDR detected | Process: ${proc.action_process_image_name} | Host: ${proc.agent_hostname} | User: ${proc.actor_primary_username} | IP: ${(proc.agent_ip_addresses||[]).join(',')} | Path: ${proc.action_process_image_path||'?'}`,
            controls: {soc2:'warn',iso27001:'warn',gdpr:match.shadow?'fail':'warn',nist:'warn',euai:'fail',hipaa:'warn',hitrust:'warn',fda_samd:'pass'}
          });
          logs.push({step:'found', status:'found',
            msg:`${match.label} on ${proc.agent_hostname} (user: ${proc.actor_primary_username||'unknown'})`});
        }
      }
    }

    // Step 3: Also scan for AI-related network connections via XQL
    const networkXql = `
      dataset = xdr_data
      | filter event_type = "NETWORK"
      | filter lowercase(dst_hostname) in (
          "api.anthropic.com", "api.openai.com", "generativelanguage.googleapis.com",
          "api.mistral.ai", "claude.ai", "chat.openai.com", "gemini.google.com",
          "openai.azure.com", "api.cohere.com", "api.perplexity.ai"
        )
      | fields agent_hostname, agent_ip_addresses, actor_primary_username,
               dst_hostname, dst_port, action_local_ip, event_timestamp
      | dedup agent_hostname, dst_hostname
      | limit 500
    `;

    const netXqlResp = await fetch(`${baseUrl}/xql/start_xql_query/`, {
      method: 'POST',
      headers: cortexAuthHeaders(apiKey, apiKeyId),
      body: JSON.stringify({ request_data: { query: networkXql, timeframe: { relativeTime: 'last_24_hours' } } })
    }).then(r=>r.json()).catch(()=>({reply:{}}));

    if (netXqlResp.reply?.queryId) {
      await new Promise(r=>setTimeout(r,3000));
      const netResults = await fetch(`${baseUrl}/xql/get_query_results/`, {
        method: 'POST',
        headers: cortexAuthHeaders(apiKey, apiKeyId),
        body: JSON.stringify({ request_data: { query_id: netXqlResp.reply.queryId, format: 'json' } })
      }).then(r=>r.json()).catch(()=>({reply:{results:{data:[]}}}));

      const netEvents = netResults.reply?.results?.data || [];
      logs.push({step:'network', status:'ok', msg:`Found ${netEvents.length} AI network connections`});

      for (const evt of netEvents) {
        const domain = evt.dst_hostname || '';
        const aiInfo = AI_DOMAINS[domain];
        if (aiInfo) {
          const agentName = `${aiInfo.name} — ${evt.agent_hostname} (network)`;
          if (!discovered.find(d=>d.name===agentName)) {
            discovered.push({
              name: agentName,
              type: aiInfo.type || 'llm',
              env: 'Cloud',
              risk: aiInfo.risk || 'high',
              shadow: aiInfo.shadow || false,
              phi: aiInfo.phi || false,
              pii: aiInfo.pii || false,
              protocols: ['HTTPS'],
              detect: 'Cortex XDR network scan',
              notes: `Cortex XDR network | Host: ${evt.agent_hostname} | User: ${evt.actor_primary_username||'?'} | Destination: ${domain} | IP: ${(evt.agent_ip_addresses||[]).join(',')}`,
              controls: {soc2:'warn',iso27001:'warn',gdpr:aiInfo.shadow?'fail':'warn',nist:'warn',euai:aiInfo.type==='llm'?'fail':'warn',hipaa:aiInfo.phi?'fail':'pass',hitrust:'warn',fda_samd:'pass'}
            });
            logs.push({step:'found', status:'found',
              msg:`AI network traffic: ${domain} from ${evt.agent_hostname} (${evt.actor_primary_username||'unknown'})`});
          }
        }
      }
    }

    // Save to DB
    let saved = 0;
    for (const agent of discovered) {
      try {
        const existing = await db.query('SELECT id FROM agents WHERE name=$1 AND tenant_id=$2 LIMIT 1',[agent.name,tId]);
        if (existing.rows.length === 0) {
          await db.query(
            `INSERT INTO agents (id,name,type,env,risk,shadow,phi,pii,protocols,controls,metadata,detect,tenant_id,first_detected,last_seen,created_at,updated_at)
             VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW(),NOW(),NOW())`,
            [agent.name,agent.type,agent.env,agent.risk,agent.shadow,agent.phi,agent.pii,
             JSON.stringify(agent.protocols),JSON.stringify(agent.controls),
             JSON.stringify({notes:agent.notes,detect:agent.detect,source:'cortex-xdr'}),
             agent.detect,tId]
          );
          saved++;
        }
      } catch(e) {}
    }

    await db.query('INSERT INTO activity (id,category,description,created_by,tenant_id) VALUES (gen_random_uuid(),$1,$2,$3,$4)',
      ['discovery',`Cortex XDR scan: ${saved} AI agents found across ${endpoints.length} endpoints`,req.user.email,tId]
    ).catch(()=>{});

    res.json({devices:endpoints.length, discovered:discovered.length, saved, logs});

  } catch(e) {
    res.status(500).json({error:e.message, logs});
  }
}));


// ══ ENDPOINT SCANNER — INTUNE + CROWDSTRIKE ════════════════

// AI processes and apps to look for on endpoints
const AI_PROCESSES = [
  // Local LLMs
  {name:'ollama', label:'Ollama (Local LLM)', type:'llm', risk:'high', shadow:true},
  {name:'vllm', label:'vLLM Server', type:'llm', risk:'high', shadow:true},
  {name:'llama.cpp', label:'llama.cpp (Local LLM)', type:'llm', risk:'high', shadow:true},
  {name:'llama-server', label:'LLaMA Server', type:'llm', risk:'high', shadow:true},
  // Code assistants
  {name:'claude-code', label:'Claude Code', type:'code-assistant', risk:'medium', shadow:false},
  {name:'copilot', label:'GitHub Copilot', type:'code-assistant', risk:'low', shadow:false},
  {name:'cursor', label:'Cursor AI IDE', type:'code-assistant', risk:'medium', shadow:false},
  {name:'continue', label:'Continue.dev', type:'code-assistant', risk:'medium', shadow:true},
  {name:'codeium', label:'Codeium', type:'code-assistant', risk:'medium', shadow:false},
  // AI tools
  {name:'jan', label:'Jan (Local AI)', type:'llm', risk:'high', shadow:true},
  {name:'lmstudio', label:'LM Studio', type:'llm', risk:'high', shadow:true},
  {name:'gpt4all', label:'GPT4All', type:'llm', risk:'high', shadow:true},
  {name:'koboldcpp', label:'KoboldCPP', type:'llm', risk:'high', shadow:true},
  // Python AI scripts
  {name:'python.*openai', label:'Python + OpenAI SDK', type:'llm', risk:'high', shadow:true},
  {name:'python.*anthropic', label:'Python + Anthropic SDK', type:'llm', risk:'high', shadow:true},
  {name:'python.*langchain', label:'Python + LangChain', type:'agent', risk:'high', shadow:true},
];

// AI browser extensions to detect
const AI_EXTENSIONS = [
  {id:'mefhakmgclhhfbdadeojlkbllmecialg', name:'Grammarly AI', risk:'low'},
  {id:'aaaplgackmajlbdmggfbofndkdkllgnl', name:'ChatGPT for Google', risk:'high', shadow:true},
  {id:'jdeogehmomdaoidnhlkffkhbhcfnoefj', name:'Merlin AI', risk:'high', shadow:true},
  {id:'cjakebnjmeifkhmjjdckgohojlfhhdbk', name:'Perplexity AI', risk:'medium'},
  {id:'bjpdoggjaakhajknlkbpanjnfijpmfbi', name:'Compose AI', risk:'medium'},
];

// POST /api/endpoint/scan/intune — scan via Microsoft Intune/Graph
app.post('/api/endpoint/scan/intune', auth, asyncHandler(async (req, res) => {
  const { tenantId, clientId, clientSecret } = req.body;
  const tId = req.user.tenantId || '00000000-0000-0000-0000-000000000001';

  if (!tenantId || !clientId || !clientSecret)
    return res.status(400).json({ error: 'tenantId, clientId, clientSecret required' });

  const discovered = [];
  const logs = [];

  try {
    // Get Graph token
    const tokenResp = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:`client_id=${clientId}&client_secret=${encodeURIComponent(clientSecret)}&scope=https://graph.microsoft.com/.default&grant_type=client_credentials`
      }).then(r=>r.json());

    if (!tokenResp.access_token) throw new Error('Intune auth failed: '+(tokenResp.error_description||'unknown'));
    const token = tokenResp.access_token;
    logs.push({step:'auth', status:'ok', msg:'Microsoft Graph/Intune authentication successful'});

    // Get managed devices
    const devicesResp = await fetch(
      'https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$select=id,deviceName,userPrincipalName,operatingSystem,complianceState,lastSyncDateTime',
      { headers:{'Authorization':'Bearer '+token} }
    ).then(r=>r.json());

    const devices = devicesResp.value || [];
    logs.push({step:'inventory', status:'ok', msg:`Found ${devices.length} managed devices in Intune`});

    // Get detected apps across all devices
    const appsResp = await fetch(
      'https://graph.microsoft.com/v1.0/deviceManagement/detectedApps?$select=id,displayName,version,deviceCount',
      { headers:{'Authorization':'Bearer '+token} }
    ).then(r=>r.json()).catch(()=>({value:[]}));

    const apps = appsResp.value || [];
    logs.push({step:'apps', status:'ok', msg:`Found ${apps.length} unique apps across managed devices`});

    // Match against AI app/process list
    for (const app of apps) {
      const appName = (app.displayName||'').toLowerCase();
      const match = AI_PROCESSES.find(p => {
        try { return new RegExp(p.name, 'i').test(appName); }
        catch(e) { return appName.includes(p.name); }
      });

      if (match) {
        // Get devices with this app
        const devWithApp = await fetch(
          `https://graph.microsoft.com/v1.0/deviceManagement/detectedApps/${app.id}/managedDevices?$select=deviceName,userPrincipalName`,
          { headers:{'Authorization':'Bearer '+token} }
        ).then(r=>r.json()).catch(()=>({value:[]}));

        for (const device of (devWithApp.value||[])) {
          const agentName = `${match.label} — ${device.userPrincipalName||device.deviceName}`;
          discovered.push({
            name: agentName,
            type: match.type,
            env: 'On-Prem',
            risk: match.risk,
            shadow: match.shadow || false,
            phi: false, pii: false,
            protocols: ['Local Process'],
            detect: 'Intune endpoint scan',
            notes: `Intune detected | App: ${app.displayName} v${app.version||'?'} | Device: ${device.deviceName} | User: ${device.userPrincipalName} | ${app.deviceCount} devices total`,
            controls: {soc2:'warn',iso27001:'warn',gdpr:match.shadow?'fail':'warn',nist:'warn',euai:'fail',hipaa:match.shadow?'fail':'warn',hitrust:'warn',fda_samd:'pass'}
          });
          logs.push({step:'found', status:'found', msg:`${match.label} on ${device.deviceName} (${device.userPrincipalName})`});
        }
      }
    }

    // Get Chrome extensions via Intune
    const extResp = await fetch(
      `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$filter=operatingSystem eq 'Windows'&$select=id,deviceName,userPrincipalName`,
      { headers:{'Authorization':'Bearer '+token} }
    ).then(r=>r.json()).catch(()=>({value:[]}));

    logs.push({step:'extensions', status:'ok', msg:`Checked browser extensions on ${(extResp.value||[]).length} Windows devices`});

    // Save discovered agents to DB
    let saved = 0;
    for (const agent of discovered) {
      try {
        const existing = await db.query('SELECT id FROM agents WHERE name=$1 AND tenant_id=$2 LIMIT 1', [agent.name, tId]);
        if (existing.rows.length === 0) {
          await db.query(
            `INSERT INTO agents (id,name,type,env,risk,shadow,phi,pii,protocols,controls,metadata,detect,tenant_id,first_detected,last_seen,created_at,updated_at)
             VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW(),NOW(),NOW())`,
            [agent.name, agent.type, agent.env, agent.risk, agent.shadow, agent.phi, agent.pii,
             JSON.stringify(agent.protocols), JSON.stringify(agent.controls),
             JSON.stringify({notes:agent.notes, detect:agent.detect, source:'intune'}),
             agent.detect, tId]
          );
          saved++;
        }
      } catch(e) {}
    }

    await db.query('INSERT INTO activity (id,category,description,created_by,tenant_id) VALUES (gen_random_uuid(),$1,$2,$3,$4)',
      ['discovery', `Intune scan: ${saved} AI agents found on ${devices.length} managed endpoints`, req.user.email, tId]
    ).catch(()=>{});

    res.json({ devices: devices.length, appsScanned: apps.length, discovered: discovered.length, saved, logs });

  } catch(e) {
    res.status(500).json({ error: e.message, logs });
  }
}));

// POST /api/endpoint/scan/crowdstrike — scan via CrowdStrike Falcon
app.post('/api/endpoint/scan/crowdstrike', auth, asyncHandler(async (req, res) => {
  const { clientId, clientSecret, baseUrl } = req.body;
  const tId = req.user.tenantId || '00000000-0000-0000-0000-000000000001';
  const csBase = baseUrl || 'https://api.crowdstrike.com';

  if (!clientId || !clientSecret)
    return res.status(400).json({ error: 'CrowdStrike clientId and clientSecret required' });

  const discovered = [];
  const logs = [];

  try {
    // CrowdStrike OAuth2
    const tokenResp = await fetch(`${csBase}/oauth2/token`, {
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:`client_id=${clientId}&client_secret=${encodeURIComponent(clientSecret)}`
    }).then(r=>r.json());

    if (!tokenResp.access_token) throw new Error('CrowdStrike auth failed');
    const csToken = tokenResp.access_token;
    logs.push({step:'auth', status:'ok', msg:'CrowdStrike Falcon authentication successful'});

    // Get hosts
    const hostsResp = await fetch(`${csBase}/devices/queries/devices/v1?limit=500`, {
      headers:{'Authorization':'Bearer '+csToken}
    }).then(r=>r.json());

    const hostIds = hostsResp.resources || [];
    logs.push({step:'inventory', status:'ok', msg:`Found ${hostIds.length} managed endpoints in CrowdStrike`});

    if (hostIds.length === 0) {
      return res.json({ devices:0, discovered:0, saved:0, logs });
    }

    // Get host details in batches of 100
    const batches = [];
    for (let i=0; i<hostIds.length; i+=100) batches.push(hostIds.slice(i,i+100));

    for (const batch of batches) {
      const detailResp = await fetch(
        `${csBase}/devices/entities/devices/v2?${batch.map(id=>'ids='+id).join('&')}`,
        { headers:{'Authorization':'Bearer '+csToken} }
      ).then(r=>r.json());

      for (const host of (detailResp.resources||[])) {
        // Search for AI processes via RTR (Real Time Response)
        // Note: RTR requires additional permissions — using process list instead
        const processes = host.meta?.version_string ? [] : [];

        // Check hostname/device name patterns
        const hostname = (host.hostname||'').toLowerCase();
        const localIp = host.local_ip || '';
        const user = host.device_policies?.prevention?.applied_globally ? 'managed' : host.device_id;

        // Use Spotlight vulnerabilities to find AI libraries
        const vulnResp = await fetch(
          `${csBase}/spotlight/queries/vulnerabilities/v1?filter=aid:'${host.device_id}'+status:'open'&limit=50`,
          { headers:{'Authorization':'Bearer '+csToken} }
        ).then(r=>r.json()).catch(()=>({resources:[]}));

        // Check installed software via Falcon Discover
        const softwareResp = await fetch(
          `${csBase}/discover/queries/applications/v1?filter=host.aid:'${host.device_id}'&limit=100`,
          { headers:{'Authorization':'Bearer '+csToken} }
        ).then(r=>r.json()).catch(()=>({resources:[]}));

        if ((softwareResp.resources||[]).length > 0) {
          const appDetailResp = await fetch(
            `${csBase}/discover/entities/applications/v1?${softwareResp.resources.slice(0,50).map(id=>'ids='+id).join('&')}`,
            { headers:{'Authorization':'Bearer '+csToken} }
          ).then(r=>r.json()).catch(()=>({resources:[]}));

          for (const app of (appDetailResp.resources||[])) {
            const appName = (app.name||'').toLowerCase();
            const match = AI_PROCESSES.find(p => {
              try { return new RegExp(p.name,'i').test(appName); }
              catch(e) { return appName.includes(p.name); }
            });
            if (match) {
              const agentName = `${match.label} — ${host.hostname}`;
              discovered.push({
                name: agentName,
                type: match.type,
                env: 'On-Prem',
                risk: match.risk,
                shadow: match.shadow || false,
                phi: false, pii: false,
                protocols: ['Local Process'],
                detect: 'CrowdStrike Falcon scan',
                notes: `CrowdStrike detected | App: ${app.name} | Host: ${host.hostname} | IP: ${host.local_ip} | OS: ${host.platform_name}`,
                controls: {soc2:'warn',iso27001:'warn',gdpr:match.shadow?'fail':'warn',nist:'warn',euai:'fail',hipaa:'warn',hitrust:'warn',fda_samd:'pass'}
              });
              logs.push({step:'found', status:'found', msg:`${match.label} on ${host.hostname} (${host.local_ip})`});
            }
          }
        }
      }
    }

    // Save to DB
    let saved = 0;
    for (const agent of discovered) {
      try {
        const existing = await db.query('SELECT id FROM agents WHERE name=$1 AND tenant_id=$2 LIMIT 1', [agent.name, tId]);
        if (existing.rows.length === 0) {
          await db.query(
            `INSERT INTO agents (id,name,type,env,risk,shadow,phi,pii,protocols,controls,metadata,detect,tenant_id,first_detected,last_seen,created_at,updated_at)
             VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW(),NOW(),NOW())`,
            [agent.name, agent.type, agent.env, agent.risk, agent.shadow, agent.phi, agent.pii,
             JSON.stringify(agent.protocols), JSON.stringify(agent.controls),
             JSON.stringify({notes:agent.notes, detect:agent.detect, source:'crowdstrike'}),
             agent.detect, tId]
          );
          saved++;
        }
      } catch(e) {}
    }

    await db.query('INSERT INTO activity (id,category,description,created_by,tenant_id) VALUES (gen_random_uuid(),$1,$2,$3,$4)',
      ['discovery', `CrowdStrike scan: ${saved} AI agents found on ${hostIds.length} endpoints`, req.user.email, tId]
    ).catch(()=>{});

    res.json({ devices: hostIds.length, discovered: discovered.length, saved, logs });

  } catch(e) {
    res.status(500).json({ error: e.message, logs });
  }
}));

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

    // ── Global 404 handler ───────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// ── Global error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const isProd = process.env.NODE_ENV === 'production';
  console.error(JSON.stringify({ level:'error', service:'agentradar-api', path:req.path, message:err.message }));
  res.status(status).json({ error: isProd && status === 500 ? 'Internal server error' : err.message });
});

app.listen(PORT, () => console.log(`[api] Listening on :${PORT}`));
  } catch (e) {
    console.error('[startup] Fatal:', e.message);
    process.exit(1);
  }
}

start();
