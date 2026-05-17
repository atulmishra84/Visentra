-- Migration 003: Multi-tenant isolation with Row Level Security

-- Create tenants table
CREATE TABLE IF NOT EXISTS tenants (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(255) NOT NULL UNIQUE,
  domain      VARCHAR(255),
  plan        VARCHAR(50) DEFAULT 'trial',
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default tenant for existing data
INSERT INTO tenants (id, name, domain, plan)
VALUES ('00000000-0000-0000-0000-000000000001', 'Healthcare Global', 'healthcareglobal.com', 'enterprise')
ON CONFLICT DO NOTHING;

-- Add tenant_id to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE users SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;

-- Add tenant_id to agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE agents SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;

-- Add tenant_id to activity
ALTER TABLE activity ADD COLUMN IF NOT EXISTS tenant_id UUID;
UPDATE activity SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;

-- Add tenant_id to webhooks
ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS tenant_id UUID;
UPDATE webhooks SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;

-- Add tenant_id to risk_acceptances
ALTER TABLE risk_acceptances ADD COLUMN IF NOT EXISTS tenant_id UUID;
UPDATE risk_acceptances SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;

-- Admin audit log table (immutable - no RLS, only append)
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id    UUID,
  admin_email VARCHAR(255),
  action      VARCHAR(100) NOT NULL,
  tenant_id   UUID,
  resource    VARCHAR(100),
  details     JSONB DEFAULT '{}',
  ip_address  VARCHAR(50),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_tenant ON admin_audit_log(tenant_id, created_at DESC);

-- Enable Row Level Security
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_acceptances ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS tenant_isolation_agents ON agents;
DROP POLICY IF EXISTS tenant_isolation_activity ON activity;
DROP POLICY IF EXISTS tenant_isolation_webhooks ON webhooks;
DROP POLICY IF EXISTS tenant_isolation_risk ON risk_acceptances;

-- Create RLS policies - app sets tenant_id via set_config
CREATE POLICY tenant_isolation_agents ON agents
  USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

CREATE POLICY tenant_isolation_activity ON activity
  USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

CREATE POLICY tenant_isolation_webhooks ON webhooks
  USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

CREATE POLICY tenant_isolation_risk ON risk_acceptances
  USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_agents_tenant ON agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_activity_tenant ON activity(tenant_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_tenant ON webhooks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
