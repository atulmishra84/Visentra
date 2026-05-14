-- AgentRadar — Database Schema
-- Run once after first deploy: scripts/migrate.sh
-- Safe to re-run (IF NOT EXISTS throughout)

BEGIN;

-- ── Extensions ────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- fast text search on agent names

-- ── Users ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer'
                  CHECK (role IN ('ciso','admin','analyst','viewer','auditor')),
  password_hash TEXT NOT NULL,
  mfa_enabled   BOOLEAN DEFAULT false,
  last_login    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Agents ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agents (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  type            TEXT,
  env             TEXT,
  risk            TEXT DEFAULT 'medium'
                    CHECK (risk IN ('critical','high','medium','low','info')),
  shadow          BOOLEAN DEFAULT false,
  phi             BOOLEAN DEFAULT false,
  pii             BOOLEAN DEFAULT false,
  hosted          BOOLEAN DEFAULT false,
  quarantined     BOOLEAN DEFAULT false,
  approved        BOOLEAN DEFAULT false,
  owner           TEXT,
  domain          TEXT,
  ip              TEXT,
  version         TEXT,
  protocols       JSONB DEFAULT '[]',
  controls        JSONB DEFAULT '{}',
  metadata        JSONB DEFAULT '{}',
  detect          TEXT,
  data_access     TEXT,
  notes           TEXT,
  first_detected  DATE DEFAULT CURRENT_DATE,
  last_seen       TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_risk        ON agents(risk);
CREATE INDEX IF NOT EXISTS idx_agents_shadow      ON agents(shadow) WHERE shadow = true;
CREATE INDEX IF NOT EXISTS idx_agents_phi         ON agents(phi)    WHERE phi    = true;
CREATE INDEX IF NOT EXISTS idx_agents_quarantined ON agents(quarantined);
CREATE INDEX IF NOT EXISTS idx_agents_name_trgm   ON agents USING GIN (name gin_trgm_ops);

-- ── Compliance results ────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance_results (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  framework   TEXT NOT NULL,   -- soc2, hipaa, gdpr, nist, euai, hitrust, fda_samd, iso27001
  status      TEXT NOT NULL CHECK (status IN ('pass','warn','fail','na')),
  score       INTEGER,
  findings    JSONB DEFAULT '[]',
  assessed_at TIMESTAMPTZ DEFAULT NOW(),
  assessed_by TEXT DEFAULT 'auto'
);

CREATE INDEX IF NOT EXISTS idx_compliance_agent     ON compliance_results(agent_id);
CREATE INDEX IF NOT EXISTS idx_compliance_framework ON compliance_results(framework);
CREATE INDEX IF NOT EXISTS idx_compliance_status    ON compliance_results(status);

-- ── Risk acceptances ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS risk_acceptances (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id      TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  framework     TEXT,
  justification TEXT NOT NULL,
  expires_at    DATE,
  accepted_by   UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── SLA items ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sla_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id    TEXT REFERENCES agents(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  due_date    DATE NOT NULL,
  priority    TEXT DEFAULT 'medium' CHECK (priority IN ('critical','high','medium','low')),
  status      TEXT DEFAULT 'open'   CHECK (status  IN ('open','in_progress','done','overdue')),
  owner       TEXT,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Scan history ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scan_history (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scanner_id   TEXT NOT NULL,
  scanner_name TEXT,
  started_at   TIMESTAMPTZ DEFAULT NOW(),
  finished_at  TIMESTAMPTZ,
  status       TEXT DEFAULT 'running' CHECK (status IN ('running','complete','error')),
  agents_found INTEGER DEFAULT 0,
  findings     JSONB DEFAULT '{}',
  error        TEXT
);

-- ── Activity log (append-only — row-level security) ───────
CREATE TABLE IF NOT EXISTS activity_log (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID REFERENCES users(id),
  action     TEXT NOT NULL,
  detail     TEXT,
  agent_id   TEXT,
  severity   TEXT DEFAULT 'info' CHECK (severity IN ('critical','high','medium','low','info')),
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Prevent UPDATE and DELETE on activity_log (immutable audit trail)
CREATE OR REPLACE RULE activity_log_no_update AS
  ON UPDATE TO activity_log DO INSTEAD NOTHING;
CREATE OR REPLACE RULE activity_log_no_delete AS
  ON DELETE TO activity_log DO INSTEAD NOTHING;

CREATE INDEX IF NOT EXISTS idx_activity_created  ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_agent    ON activity_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_activity_severity ON activity_log(severity);

-- ── Webhooks ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhooks (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL,
  url        TEXT NOT NULL,
  events     JSONB DEFAULT '["all"]',
  secret     TEXT,
  enabled    BOOLEAN DEFAULT true,
  last_fired TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── IR rules ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ir_rules (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name      TEXT NOT NULL,
  trigger   JSONB NOT NULL,
  actions   JSONB NOT NULL DEFAULT '[]',
  enabled   BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Scheduled reports ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS scheduled_reports (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  recipients  JSONB DEFAULT '[]',
  schedule    TEXT,   -- cron expression
  last_sent   TIMESTAMPTZ,
  enabled     BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Playbooks ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS playbooks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  description TEXT,
  steps       JSONB DEFAULT '[]',
  tags        JSONB DEFAULT '[]',
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Saved views ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saved_views (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  filters    JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── updated_at auto-trigger ───────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DO $$ DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['agents','users','sla_items','playbooks'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_updated_at ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_updated_at BEFORE UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION update_updated_at()', t);
  END LOOP;
END $$;

-- ── Default admin user (change password immediately) ──────
INSERT INTO users (email, name, role, password_hash)
VALUES (
  'admin@agentRadar.local',
  'Admin',
  'ciso',
  -- bcrypt hash of 'ChangeMe123!' — CHANGE THIS IMMEDIATELY
  '$2b$10$rOzJqQzQbQzQbQzQbQzQbOzJqQzQbQzQbQzQbQzQbQzQbQzQbQ'
)
ON CONFLICT (email) DO NOTHING;

COMMIT;
