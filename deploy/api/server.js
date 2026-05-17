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
      { sub: user.id, email: user.email, name: user.name, role: user.role },
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
           JSON.stringify(agent.metadata||{}), scanner_id]
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
