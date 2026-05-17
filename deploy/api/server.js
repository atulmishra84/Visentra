'use strict';
const express     = require('express');
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

app.use(compression());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.ALLOWED_ORIGINS || '*', credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

// Rate limiting
app.use('/api/', rateLimit({ windowMs: 60_000, max: 500, standardHeaders: true, legacyHeaders: false }));

// ── Health endpoint (no auth) ─────────────────────────────
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
app.post('/api/auth/login', async (req, res) => {
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
app.get('/api/agents', auth, async (req, res) => {
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
});

app.post('/api/agents', auth, async (req, res) => {
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
app.get('/api/activity', auth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100'), 500);
  try {
    const { rows } = await db.query(
      'SELECT * FROM activity_log ORDER BY created_at DESC LIMIT $1', [limit]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

app.post('/api/webhooks', auth, async (req, res) => {
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
app.post('/api/auth/change-password', auth, async (req, res) => {
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
    issuerUrl: `https://identitycenter.amazonaws.com/ssooidc/${process.env.AWS_SSO_REGION||'us-east-1'}/${process.env.AWS_SSO_INSTANCE_ID||''}`,
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

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ── Error handler ─────────────────────────────────────────
app.use((err, req, res, next) => {
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
