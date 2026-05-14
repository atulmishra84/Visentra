// webhook/package.json
// { "name":"agentRadar-webhook","version":"1.0.0","dependencies":{"express":"^4.19.2","ioredis":"^5.3.2","node-fetch":"^3.3.2","@azure/identity":"^4.2.0","@azure/keyvault-secrets":"^4.8.0"} }
'use strict';
const express  = require('express');
const Redis    = require('ioredis');
const fetch    = (...args) => import('node-fetch').then(({default:f}) => f(...args));

const PORT       = process.env.PORT        || 4002;
const REDIS_HOST = process.env.REDIS_HOST  || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6380');
const REDIS_TLS  = process.env.REDIS_TLS  !== 'false';
const REDIS_PWD  = process.env.REDIS_PASSWORD || '';

const redis = new Redis({
  host: REDIS_HOST, port: REDIS_PORT,
  password: REDIS_PWD || undefined,
  tls: REDIS_TLS ? {} : undefined,
  lazyConnect: true,
});

const app = express();
app.use(express.json({ limit: '512kb' }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Receive a webhook event, push to Redis queue for processing
app.post('/webhook/inbound', async (req, res) => {
  try {
    const event = { ...req.body, receivedAt: new Date().toISOString() };
    await redis.lpush('webhook:inbound', JSON.stringify(event));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Worker: pop outbound events and deliver
async function processOutbound() {
  while (true) {
    try {
      const raw = await redis.brpop('webhook:outbound', 5);
      if (!raw) continue;
      const { url, payload, attempt = 0 } = JSON.parse(raw[1]);
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'AgentRadar/1.0' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      } catch (err) {
        if (attempt < 3) {
          await redis.lpush('webhook:outbound', JSON.stringify({ url, payload, attempt: attempt + 1 }));
        } else {
          await redis.lpush('webhook:dlq', JSON.stringify({ url, payload, error: err.message }));
        }
      }
    } catch { await new Promise(r => setTimeout(r, 1000)); }
  }
}

async function start() {
  await redis.connect();
  app.listen(PORT, () => console.log(`[webhook] :${PORT}`));
  processOutbound();
}
start();
