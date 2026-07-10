-- AgentRadar V1 — Core Schema
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Module 8: Multi-Tenant
CREATE TABLE IF NOT EXISTS tenants (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'suspended', 'archived')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Module 4 + 5: Users / RBAC / MFA
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  name            TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'analyst'
                    CHECK (role IN ('platform_admin', 'ciso', 'analyst', 'auditor')),
  password_hash   TEXT NOT NULL,
  mfa_enabled     BOOLEAN NOT NULL DEFAULT false,
  mfa_secret_enc  TEXT,
  last_login      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Module 1: Discovered AI agents
CREATE TABLE IF NOT EXISTS agents (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  azure_resource_id TEXT,
  name              TEXT NOT NULL,
  resource_type     TEXT NOT NULL,
  subscription_id   TEXT,
  resource_group    TEXT,
  region            TEXT,
  tags              JSONB NOT NULL DEFAULT '{}',
  metadata          JSONB NOT NULL DEFAULT '{}',
  protocols         JSONB NOT NULL DEFAULT '[]',
  -- Module 2: PHI
  phi_flagged       BOOLEAN NOT NULL DEFAULT false,
  phi_vectors       JSONB NOT NULL DEFAULT '[]',
  hipaa_status      TEXT NOT NULL DEFAULT 'na'
                      CHECK (hipaa_status IN ('pass', 'fail', 'na', 'cleared')),
  phi_cleared_by    UUID REFERENCES users(id),
  phi_cleared_at    TIMESTAMPTZ,
  phi_clear_reason  TEXT,
  -- Module 3: Risk
  risk_score        INTEGER NOT NULL DEFAULT 0,
  risk_level        TEXT NOT NULL DEFAULT 'low'
                      CHECK (risk_level IN ('high', 'medium', 'low')),
  risk_factors      JSONB NOT NULL DEFAULT '[]',
  framework_scores  JSONB NOT NULL DEFAULT '{}',
  last_seen         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_discovered  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_tenant ON agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agents_phi ON agents(tenant_id, phi_flagged) WHERE phi_flagged = true;
CREATE INDEX IF NOT EXISTS idx_agents_risk ON agents(tenant_id, risk_level);
CREATE INDEX IF NOT EXISTS idx_agents_azure ON agents(tenant_id, azure_resource_id);

-- Discovery scan history
CREATE TABLE IF NOT EXISTS discovery_scans (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running', 'complete', 'error')),
  agents_found  INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  triggered_by  UUID REFERENCES users(id)
);

-- Module 6: Audit events
CREATE TABLE IF NOT EXISTS audit_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID REFERENCES tenants(id) ON DELETE SET NULL,
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email TEXT,
  action      TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}',
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_tenant_time ON audit_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_events(action);

-- Prevent mutation of audit trail
CREATE OR REPLACE RULE audit_events_no_update AS
  ON UPDATE TO audit_events DO INSTEAD NOTHING;
CREATE OR REPLACE RULE audit_events_no_delete AS
  ON DELETE TO audit_events DO INSTEAD NOTHING;

-- Encrypted integration credentials (Module 9)
CREATE TABLE IF NOT EXISTS integration_credentials (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  provider    TEXT NOT NULL,
  ciphertext  TEXT NOT NULL,
  iv          TEXT NOT NULL,
  auth_tag    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

-- MFA pending challenges (short-lived tokens tracked in Redis; DB backup optional)
CREATE TABLE IF NOT EXISTS mfa_challenges (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
