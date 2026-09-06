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

  // Abandoned jobs from a previous API process cannot complete; fail them on boot.
  await pool.query(`
    UPDATE discovery_jobs
    SET status='error', error='abandoned on API boot', finished_at=NOW()
    WHERE status='running'
  `);
  // At most one running discovery job per tenant (P1 concurrency)
  await pool.query(`
    UPDATE discovery_jobs SET status='error', error='superseded by concurrency guard', finished_at=NOW()
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY started_at DESC NULLS LAST, created_at DESC) AS rn
        FROM discovery_jobs WHERE status='running'
      ) ranked WHERE rn > 1
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS discovery_jobs_one_running_per_tenant
      ON discovery_jobs (tenant_id) WHERE (status = 'running')
  `);

  // Widen connectors.provider check for EDR integrations (idempotent)
  await pool.query(`
    DO $$
    BEGIN
      ALTER TABLE connectors DROP CONSTRAINT IF EXISTS connectors_provider_check;
      ALTER TABLE connectors ADD CONSTRAINT connectors_provider_check
        CHECK (provider IN (
          'azure', 'aws', 'gcp',
          'github', 'gitlab', 'entra_identity', 'kubernetes', 'kubernetes_identity',
          'crowdstrike', 'defender', 'intune', 'cortex', 'netskope',
          'm365_copilot', 'salesforce', 'workday', 'servicenow', 'openai',
          'jenkins'
        ));
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END $$;
  `);

  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'local'
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS external_sub TEXT
  `);
  // Allow any IdP key (entra, okta, auth0, generic_oidc, …)
  await pool.query(`
    DO $$
    BEGIN
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_auth_provider_check;
    EXCEPTION WHEN undefined_table OR undefined_object THEN
      NULL;
    END $$;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sso_providers (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      provider_key     TEXT NOT NULL,
      preset           TEXT NOT NULL DEFAULT 'generic_oidc',
      name             TEXT NOT NULL,
      protocol         TEXT NOT NULL DEFAULT 'oidc'
                         CHECK (protocol IN ('oidc', 'saml')),
      enabled          BOOLEAN NOT NULL DEFAULT TRUE,
      client_id        TEXT,
      config           JSONB NOT NULL DEFAULT '{}'::jsonb,
      secrets_enc      TEXT,
      claim_map        JSONB NOT NULL DEFAULT '{}'::jsonb,
      allowed_domains  JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, provider_key)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sso_providers_tenant ON sso_providers(tenant_id, enabled)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id              BIGSERIAL PRIMARY KEY,
      tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      actor_id        UUID,
      actor_email     TEXT,
      action          TEXT NOT NULL,
      resource_type   TEXT,
      resource_id     TEXT,
      details         JSONB NOT NULL DEFAULT '{}',
      ip              TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_events(tenant_id, created_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_bom_enrichments (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      fields          JSONB NOT NULL DEFAULT '{}'::jsonb,
      completeness    NUMERIC(5,2) NOT NULL DEFAULT 0,
      updated_by      TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, agent_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_bom_enrichments_tenant
      ON ai_bom_enrichments(tenant_id, updated_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_bom_snapshots (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      serial_number   TEXT NOT NULL,
      format          TEXT NOT NULL DEFAULT 'visentra'
                        CHECK (format IN ('visentra', 'cyclonedx')),
      label           TEXT,
      document        JSONB NOT NULL,
      summary         JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by      TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_bom_snapshots_tenant
      ON ai_bom_snapshots(tenant_id, created_at DESC)
  `);


  await pool.query(`
    CREATE TABLE IF NOT EXISTS outbound_integrations (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      provider        TEXT NOT NULL DEFAULT 'naxri'
                        CHECK (provider IN ('naxri')),
      name            TEXT NOT NULL DEFAULT 'NAXRI ASPM',
      enabled         BOOLEAN NOT NULL DEFAULT FALSE,
      auto_push       BOOLEAN NOT NULL DEFAULT TRUE,
      webhook_url     TEXT,
      config          JSONB NOT NULL DEFAULT '{}'::jsonb,
      secrets_enc     TEXT,
      last_sync_at    TIMESTAMPTZ,
      last_sync_status TEXT,
      last_sync_error TEXT,
      last_sync_count INT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, provider)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_outbound_integrations_tenant
      ON outbound_integrations(tenant_id, provider)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS compliance_custom_frameworks (
      tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      id            TEXT NOT NULL,
      name          TEXT NOT NULL,
      version       TEXT,
      description   TEXT NOT NULL DEFAULT '',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tenant_id, id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS compliance_custom_controls (
      tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      id              TEXT NOT NULL,
      framework       TEXT NOT NULL,
      code            TEXT NOT NULL,
      title           TEXT NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      family          TEXT,
      evidence_hints  JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tenant_id, id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_compliance_custom_controls_fw
      ON compliance_custom_controls(tenant_id, framework)
  `);

  const isProd = process.env.NODE_ENV === "production";
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL || "admin@agentradar.local";
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || (isProd ? null : "AgentRadar!dev");
  if (!password) {
    throw new Error("BOOTSTRAP_ADMIN_PASSWORD is required");
  }
  const hash = await bcrypt.hash(password, isProd ? 12 : 10);

  // Keep default slug stable across envs so redeploys do not create a second tenant.
  const tenantSettings = "{}";
  const tenantName = process.env.BOOTSTRAP_TENANT_NAME || "Acme Corporation";
  const tenantSlug = process.env.BOOTSTRAP_TENANT_SLUG || "acme";

  const tenant = await pool.query(
    `INSERT INTO tenants (name, slug, settings)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name,
       settings = tenants.settings || EXCLUDED.settings
     RETURNING id`,
    [tenantName, tenantSlug, tenantSettings]
  );
  const tenantId = tenant.rows[0].id;

  // Insert-only for password: never overwrite an existing admin hash on restart
  await pool.query(
    `INSERT INTO users (tenant_id, email, name, role, password_hash)
     VALUES ($1, $2, 'Platform Admin', 'platform_admin', $3)
     ON CONFLICT (tenant_id, email) DO UPDATE SET role = EXCLUDED.role`,
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
