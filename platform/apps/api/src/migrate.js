import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import bcrypt from "bcryptjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function migrate(pool) {
  const schemaPath = path.join(__dirname, "../schemas/postgres.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  await pool.query(sql);

  // Widen connectors.provider check for EDR integrations (idempotent)
  await pool.query(`
    DO $$
    BEGIN
      ALTER TABLE connectors DROP CONSTRAINT IF EXISTS connectors_provider_check;
      ALTER TABLE connectors ADD CONSTRAINT connectors_provider_check
        CHECK (provider IN (
          'azure', 'aws', 'gcp',
          'crowdstrike', 'defender', 'intune', 'cortex', 'netskope'
        ));
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END $$;
  `);

  const email = process.env.BOOTSTRAP_ADMIN_EMAIL || "admin@agentradar.local";
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || "AgentRadar!dev";
  const hash = await bcrypt.hash(password, 10);

  const tenant = await pool.query(
    `INSERT INTO tenants (name, slug, settings)
     VALUES ('Acme Corporation', 'acme', '{"demo": true}')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  const tenantId = tenant.rows[0].id;

  await pool.query(
    `INSERT INTO users (tenant_id, email, name, role, password_hash)
     VALUES ($1, $2, 'Platform Admin', 'platform_admin', $3)
     ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
    [tenantId, email, hash]
  );

  return tenantId;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = new pg.Pool({ connectionString: process.env.POSTGRES_URL });
  migrate(pool)
    .then((id) => {
      console.log("Migrated. Tenant:", id);
      return pool.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
