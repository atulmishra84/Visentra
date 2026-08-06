'use strict';
const { Pool } = require('pg');
const config = require('../config/index.js');

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool(config.db);
    pool.on('error', (err) => {
      console.error('[db] Unexpected pool error:', err.message);
    });
  }
  return pool;
}

// Parameterized query wrapper — prevents SQL injection
async function query(text, params) {
  const client = await getPool().connect();
  try {
    const start = Date.now();
    const result = await client.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      console.warn(`[db] Slow query (${duration}ms):`, text.substring(0, 100));
    }
    return result;
  } finally {
    client.release();
  }
}

// Transaction wrapper
async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { query, withTransaction, getPool };
