'use strict';

const Redis = require('ioredis');
const config = require('../config');

let client;
let unavailable = false;
let warned = false;

function getRedis() {
  if (unavailable) return null;
  if (!client) {
    client = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
      retryStrategy: () => null,
    });
    client.on('error', () => {
      unavailable = true;
      if (!warned) {
        warned = true;
        console.warn('Redis unavailable — rate limiting / MFA challenges will fail open');
      }
    });
  }
  return client;
}

async function ensureRedis() {
  if (unavailable) {
    const err = new Error('Redis unavailable');
    throw err;
  }
  const r = getRedis();
  if (!r) throw new Error('Redis unavailable');
  if (r.status === 'wait' || r.status === 'end') {
    try {
      await r.connect();
    } catch (err) {
      unavailable = true;
      throw err;
    }
  }
  return r;
}

module.exports = { getRedis, ensureRedis };
