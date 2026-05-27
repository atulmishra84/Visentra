CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(50) PRIMARY KEY,
  applied_at  TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO schema_migrations (version) VALUES
  ('001_schema'),('002_webhooks_activity'),('003_tenant_isolation')
ON CONFLICT DO NOTHING;
