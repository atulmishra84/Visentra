-- Production console compatibility columns + governance tables
-- Safe to re-run

-- Allow production UI roles on users
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('platform_admin', 'ciso', 'analyst', 'auditor', 'viewer', 'admin'));

-- Agent fields expected by agentRadarLaunch.html
ALTER TABLE agents ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS env TEXT DEFAULT 'Cloud';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS risk TEXT DEFAULT 'medium';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS shadow BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS phi BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS pii BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS hosted BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS quarantined BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS owner TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS detect TEXT DEFAULT 'Azure ARM Discovery';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS controls JSONB NOT NULL DEFAULT '{}';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS data_access TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS first_detected DATE DEFAULT CURRENT_DATE;

-- Backfill from V1 columns
UPDATE agents SET type = COALESCE(type, resource_type) WHERE type IS NULL;
UPDATE agents SET phi = phi_flagged WHERE phi IS DISTINCT FROM phi_flagged;
UPDATE agents SET risk = CASE
  WHEN risk_level = 'high' AND risk_score >= 85 THEN 'critical'
  WHEN risk_level = 'high' THEN 'high'
  WHEN risk_level = 'medium' THEN 'medium'
  ELSE 'low'
END
WHERE risk IS NULL OR risk = 'medium';

CREATE INDEX IF NOT EXISTS idx_agents_shadow ON agents(tenant_id, shadow) WHERE shadow = true;
CREATE INDEX IF NOT EXISTS idx_agents_quarantined ON agents(tenant_id, quarantined) WHERE quarantined = true;

-- Activity feed (UI /api/activity)
CREATE TABLE IF NOT EXISTS activity_log (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  detail     TEXT,
  agent_id   TEXT,
  severity   TEXT DEFAULT 'info',
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_tenant_time ON activity_log(tenant_id, created_at DESC);

-- Autodiscovery sessions
CREATE TABLE IF NOT EXISTS autodiscovery_sessions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'running',
  config       JSONB NOT NULL DEFAULT '{}',
  progress     JSONB NOT NULL DEFAULT '{}',
  agents_found INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  started_by   UUID REFERENCES users(id),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ
);

-- Compliance results per agent/framework
CREATE TABLE IF NOT EXISTS compliance_results (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  framework   TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('pass','warn','fail','na')),
  score       INTEGER,
  findings    JSONB DEFAULT '[]',
  assessed_at TIMESTAMPTZ DEFAULT NOW(),
  assessed_by TEXT DEFAULT 'auto'
);
CREATE INDEX IF NOT EXISTS idx_compliance_agent ON compliance_results(agent_id);

-- Risk acceptances
CREATE TABLE IF NOT EXISTS risk_acceptances (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id      UUID REFERENCES agents(id) ON DELETE CASCADE,
  framework     TEXT,
  justification TEXT NOT NULL,
  expires_at    DATE,
  accepted_by   UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Webhooks
CREATE TABLE IF NOT EXISTS webhooks (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  url        TEXT NOT NULL,
  type       TEXT DEFAULT 'generic',
  events     JSONB DEFAULT '["all"]',
  secret     TEXT,
  enabled    BOOLEAN DEFAULT true,
  last_fired TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Policy engine
CREATE TABLE IF NOT EXISTS policies (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  condition   TEXT NOT NULL,
  action      TEXT NOT NULL DEFAULT 'alert',
  description TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS policy_violations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  policy_id   UUID REFERENCES policies(id) ON DELETE SET NULL,
  agent_id    UUID REFERENCES agents(id) ON DELETE CASCADE,
  detail      TEXT,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Approvals queue
CREATE TABLE IF NOT EXISTS approvals (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id    UUID REFERENCES agents(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected')),
  requested_by UUID REFERENCES users(id),
  decided_by  UUID REFERENCES users(id),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at  TIMESTAMPTZ
);

-- Remediation playbooks
CREATE TABLE IF NOT EXISTS playbooks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  steps       JSONB NOT NULL DEFAULT '[]',
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS playbook_runs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  playbook_id UUID REFERENCES playbooks(id) ON DELETE CASCADE,
  agent_id    UUID REFERENCES agents(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'running',
  result      JSONB DEFAULT '{}',
  started_by  UUID REFERENCES users(id),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

-- SSO config (Entra stub)
CREATE TABLE IF NOT EXISTS sso_config (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL DEFAULT 'entra',
  enabled       BOOLEAN NOT NULL DEFAULT false,
  client_id     TEXT,
  tenant_azure  TEXT,
  metadata      JSONB DEFAULT '{}',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, provider)
);
