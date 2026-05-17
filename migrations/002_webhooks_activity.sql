CREATE TABLE IF NOT EXISTS activity (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category    VARCHAR(50) NOT NULL DEFAULT 'info',
  description TEXT NOT NULL,
  agent_id    TEXT REFERENCES agents(id) ON DELETE SET NULL,
  created_by  VARCHAR(255),
  metadata    JSONB DEFAULT '{}',
  at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_at ON activity(at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_agent ON activity(agent_id);

CREATE TABLE IF NOT EXISTS webhooks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(255) NOT NULL,
  url         TEXT NOT NULL,
  type        VARCHAR(50) DEFAULT 'generic',
  events      JSONB DEFAULT '["agent.discovered","policy.violation"]',
  secret      VARCHAR(255),
  active      BOOLEAN DEFAULT true,
  fire_count  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scanner_runs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scanner_id   VARCHAR(100) NOT NULL,
  status       VARCHAR(50) DEFAULT 'completed',
  agents_found INTEGER DEFAULT 0,
  duration_ms  INTEGER,
  error        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS risk_acceptances (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id    TEXT REFERENCES agents(id) ON DELETE CASCADE,
  decision    VARCHAR(50) NOT NULL,
  note        TEXT,
  created_by  VARCHAR(255),
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE agents ADD COLUMN IF NOT EXISTS approved    BOOLEAN DEFAULT false;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS quarantined BOOLEAN DEFAULT false;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS hosted      BOOLEAN DEFAULT false;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS owner       VARCHAR(255);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS domain      VARCHAR(255);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS ip          VARCHAR(50);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS version     VARCHAR(50);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS data_access TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS detect      VARCHAR(255);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS notes       TEXT;
