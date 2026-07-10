'use strict';

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool, query } = require('../src/models/db');
const config = require('../src/config');

async function migrate() {
  const sqlDir = path.join(__dirname, '..', 'sql');
  const files = ['schema.sql', '002_prod_compat.sql'];
  for (const file of files) {
    const full = path.join(sqlDir, file);
    if (!fs.existsSync(full)) continue;
    const sql = fs.readFileSync(full, 'utf8');
    await pool.query(sql);
    console.log(`Applied ${file}`);
  }

  let tenantId;
  const tenantRows = await query(`SELECT id FROM tenants LIMIT 1`);
  if (!tenantRows.rows.length) {
    const t = await query(
      `INSERT INTO tenants (name, slug) VALUES ('Default Organization', 'default') RETURNING id`
    );
    tenantId = t.rows[0].id;
    console.log('Created default tenant.');
  } else {
    tenantId = tenantRows.rows[0].id;
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

  // Seed default policies / playbooks per tenant if empty
  const tenants = await query(`SELECT id FROM tenants`);
  for (const t of tenants.rows) {
    const pol = await query(`SELECT id FROM policies WHERE tenant_id = $1 LIMIT 1`, [t.id]);
    if (!pol.rows.length) {
      await query(
        `INSERT INTO policies (tenant_id, name, condition, action, description) VALUES
         ($1, 'Block Shadow PHI', 'shadow=true AND phi=true', 'quarantine', 'Quarantine shadow agents with PHI exposure'),
         ($1, 'Require Owner Tag', 'owner IS NULL', 'alert', 'Flag agents missing ownership'),
         ($1, 'Critical Risk Review', 'risk=critical', 'approve', 'Require approval for critical-risk agents')`,
        [t.id]
      );
    }
    const pb = await query(`SELECT id FROM playbooks WHERE tenant_id = $1 LIMIT 1`, [t.id]);
    if (!pb.rows.length) {
      await query(
        `INSERT INTO playbooks (tenant_id, name, description, steps) VALUES
         ($1, 'Quarantine Shadow Agent', 'Isolate unauthorized AI workload', '["Flag shadow","Notify owner","Quarantine","Verify"]'::jsonb),
         ($1, 'PHI Remediation', 'Clear or contain PHI exposure', '["Confirm PHI vectors","Apply controls","Document BAA","Clear HIPAA fail"]'::jsonb)`,
        [t.id]
      );
    }
  }

  console.log('Migration complete.');
  await pool.end();
}

migrate().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
