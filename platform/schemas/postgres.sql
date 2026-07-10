-- AgentRadar Discovery & Visibility — PostgreSQL schema
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE TABLE IF NOT EXISTS tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'suspended', 'archived')),
  settings    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  name            TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'viewer'
                    CHECK (role IN ('platform_admin', 'operator', 'viewer')),
  password_hash   TEXT NOT NULL,
  last_login      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, email)
);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

CREATE TABLE IF NOT EXISTS agents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fingerprint           TEXT NOT NULL,
  name                  TEXT NOT NULL,
  owner                 TEXT,
  device                TEXT,
  hostname              TEXT,
  ip                    INET,
  operating_system      TEXT,
  department            TEXT,
  business_unit         TEXT,
  location              TEXT,
  repository            TEXT,
  framework             TEXT,
  programming_language  TEXT,
  model                 TEXT,
  provider              TEXT,
  version               TEXT,
  deployment_type       TEXT,
  cloud_provider        TEXT,
  region                TEXT,
  container             TEXT,
  vm                    TEXT,
  endpoint              TEXT,
  ide                   TEXT,
  creation_time         TIMESTAMPTZ,
  last_modified         TIMESTAMPTZ,
  last_seen             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_discovered      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  running_status        TEXT NOT NULL DEFAULT 'unknown'
                          CHECK (running_status IN ('running', 'stopped', 'unknown', 'scheduled')),
  memory_usage_mb       NUMERIC,
  cpu_usage_pct         NUMERIC,
  api_keys_detected     BOOLEAN NOT NULL DEFAULT false,
  secrets_detected      BOOLEAN NOT NULL DEFAULT false,
  mcp_connections       JSONB NOT NULL DEFAULT '[]',
  tools                 JSONB NOT NULL DEFAULT '[]',
  prompt_templates      JSONB NOT NULL DEFAULT '[]',
  memory_store          TEXT,
  vector_database       TEXT,
  connected_applications JSONB NOT NULL DEFAULT '[]',
  identity_used         TEXT,
  permissions           JSONB NOT NULL DEFAULT '[]',
  internet_access       BOOLEAN NOT NULL DEFAULT false,
  filesystem_access     BOOLEAN NOT NULL DEFAULT false,
  database_access       BOOLEAN NOT NULL DEFAULT false,
  github_access         BOOLEAN NOT NULL DEFAULT false,
  slack_access          BOOLEAN NOT NULL DEFAULT false,
  email_access          BOOLEAN NOT NULL DEFAULT false,
  calendar_access       BOOLEAN NOT NULL DEFAULT false,
  browser_access        BOOLEAN NOT NULL DEFAULT false,
  execution_capability  TEXT,
  risk_indicators       JSONB NOT NULL DEFAULT '[]',
  confidence_score      NUMERIC(4,3) NOT NULL DEFAULT 0.5,
  category              TEXT NOT NULL DEFAULT 'unknown',
  metadata              JSONB NOT NULL DEFAULT '{}',
  source_collectors     TEXT[] NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_agents_tenant ON agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agents_last_seen ON agents(tenant_id, last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_agents_framework ON agents(tenant_id, framework);
CREATE INDEX IF NOT EXISTS idx_agents_model ON agents(tenant_id, model);
CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(tenant_id, owner);
CREATE INDEX IF NOT EXISTS idx_agents_hostname ON agents(tenant_id, hostname);
CREATE INDEX IF NOT EXISTS idx_agents_category ON agents(tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_agents_name_trgm ON agents USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_agents_tools ON agents USING gin (tools);
CREATE INDEX IF NOT EXISTS idx_agents_risk ON agents USING gin (risk_indicators);

CREATE TABLE IF NOT EXISTS assets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_type    TEXT NOT NULL,
  name          TEXT NOT NULL,
  external_key  TEXT NOT NULL,
  attributes    JSONB NOT NULL DEFAULT '{}',
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, asset_type, external_key)
);
CREATE INDEX IF NOT EXISTS idx_assets_tenant_type ON assets(tenant_id, asset_type);

CREATE TABLE IF NOT EXISTS relationships (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_type     TEXT NOT NULL,
  from_id       UUID NOT NULL,
  to_type       TEXT NOT NULL,
  to_id         UUID NOT NULL,
  rel_type      TEXT NOT NULL,
  confidence    NUMERIC(4,3) NOT NULL DEFAULT 0.5,
  evidence      JSONB NOT NULL DEFAULT '{}',
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, from_type, from_id, to_type, to_id, rel_type)
);
CREATE INDEX IF NOT EXISTS idx_rel_tenant ON relationships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rel_from ON relationships(tenant_id, from_type, from_id);
CREATE INDEX IF NOT EXISTS idx_rel_to ON relationships(tenant_id, to_type, to_id);

CREATE TABLE IF NOT EXISTS discovery_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  collector_ids   TEXT[] NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'running', 'complete', 'error')),
  triggered_by    TEXT,
  agents_found    INTEGER NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_jobs_tenant ON discovery_jobs(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_observations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  collector_id      TEXT NOT NULL,
  job_id            UUID REFERENCES discovery_jobs(id) ON DELETE SET NULL,
  observed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload           JSONB NOT NULL,
  fingerprint_hint  TEXT,
  agent_id          UUID REFERENCES agents(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_obs_tenant ON agent_observations(tenant_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_obs_agent ON agent_observations(agent_id);

CREATE TABLE IF NOT EXISTS discovery_events (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'info'
                CHECK (severity IN ('info', 'warn', 'error')),
  message     TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_tenant ON discovery_events(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS visibility_activity (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor         TEXT,
  action        TEXT NOT NULL,
  resource_type TEXT,
  resource_id   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_tenant ON visibility_activity(tenant_id, created_at DESC);

-- Cloud / environment connectors (encrypted credentials)
CREATE TABLE IF NOT EXISTS connectors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  provider        TEXT NOT NULL
                    CHECK (provider IN (
                      'azure', 'aws', 'gcp',
                      'crowdstrike', 'defender', 'intune', 'cortex', 'netskope'
                    )),
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'disabled', 'error')),
  environment     TEXT NOT NULL DEFAULT 'production',
  config          JSONB NOT NULL DEFAULT '{}',
  secrets_enc     TEXT NOT NULL,
  secret_fields   TEXT[] NOT NULL DEFAULT '{}',
  last_tested_at  TIMESTAMPTZ,
  last_error      TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_connectors_tenant ON connectors(tenant_id, provider);

