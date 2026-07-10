'use strict';

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool, query } = require('../src/models/db');
const config = require('../src/config');

async function migrate() {
  const schemaPath = path.join(__dirname, '..', 'sql', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(sql);
  console.log('Schema applied.');

  const tenants = await query(`SELECT id FROM tenants LIMIT 1`);
  let tenantId;
  if (!tenants.rows.length) {
    const t = await query(
      `INSERT INTO tenants (name, slug) VALUES ('Default Organization', 'default') RETURNING id`
    );
    tenantId = t.rows[0].id;
    console.log('Created default tenant.');
  } else {
    tenantId = tenants.rows[0].id;
  }

  const users = await query(`SELECT id FROM users LIMIT 1`);
  if (!users.rows.length) {
    const hash = await bcrypt.hash(config.bootstrap.password, 12);
    await query(
      `INSERT INTO users (tenant_id, email, name, role, password_hash)
       VALUES ($1, $2, $3, 'platform_admin', $4)`,
      [tenantId, config.bootstrap.email.toLowerCase(), config.bootstrap.name, hash]
    );
    console.log(`Bootstrap admin created: ${config.bootstrap.email}`);
  }

  console.log('Migration complete.');
  await pool.end();
}

migrate().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
