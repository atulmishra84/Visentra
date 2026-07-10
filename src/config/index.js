'use strict';

const required = (key, fallback) => {
  const v = process.env[key];
  if (v !== undefined && v !== '') return v;
  if (fallback !== undefined) return fallback;
  return '';
};

module.exports = {
  env: required('NODE_ENV', 'development'),
  port: parseInt(required('PORT', '3000'), 10),
  appUrl: required('APP_URL', 'http://localhost:3000'),
  postgres: {
    host: required('POSTGRES_HOST', 'localhost'),
    port: parseInt(required('POSTGRES_PORT', '5432'), 10),
    database: required('POSTGRES_DB', 'agentradar'),
    user: required('POSTGRES_USER', 'agentradar'),
    password: required('POSTGRES_PASSWORD', 'agentradar'),
  },
  redis: {
    host: required('REDIS_HOST', 'localhost'),
    port: parseInt(required('REDIS_PORT', '6379'), 10),
  },
  jwtSecret: required('JWT_SECRET', 'dev-only-change-me'),
  encryptionKey: required(
    'ENCRYPTION_KEY',
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  ),
  cookieSecure: required('COOKIE_SECURE', 'false') === 'true',
  bootstrap: {
    email: required('BOOTSTRAP_ADMIN_EMAIL', 'admin@example.com'),
    password: required('BOOTSTRAP_ADMIN_PASSWORD', 'ChangeMeAdmin123!'),
    name: required('BOOTSTRAP_ADMIN_NAME', 'Platform Admin'),
  },
  azure: {
    tenantId: required('AZURE_TENANT_ID'),
    clientId: required('AZURE_CLIENT_ID'),
    clientSecret: required('AZURE_CLIENT_SECRET'),
    subscriptionId: required('AZURE_SUBSCRIPTION_ID'),
  },
  discovery: {
    intervalMs: parseInt(required('DISCOVERY_INTERVAL_MS', '3600000'), 10),
    demoMode: required('DISCOVERY_DEMO_MODE', 'true') === 'true',
  },
  logAnalytics: {
    workspaceId: required('LOG_ANALYTICS_WORKSPACE_ID'),
    key: required('LOG_ANALYTICS_KEY'),
  },
};
