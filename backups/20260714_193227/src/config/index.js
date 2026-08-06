'use strict';
module.exports = {
  port: parseInt(process.env.PORT || '4000'),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '4h',
  },
  db: {
    host:     process.env.POSTGRES_HOST || 'localhost',
    port:     parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'agentradar',
    user:     process.env.POSTGRES_USER || 'agentradar',
    password: process.env.POSTGRES_PASSWORD || process.env.DB_PASSWORD || '',
    ssl:      process.env.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 2000,
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    tls:  process.env.REDIS_TLS === 'true',
  },
  azure: {
    tenantId:     process.env.TENANT_ID,
    clientId:     process.env.AZURE_SSO_CLIENT_ID,
    clientSecret: process.env.AZURE_SSO_CLIENT_SECRET,
    appUrl:       process.env.APP_URL || 'https://localhost',
  },
  okta: {
    domain:       process.env.OKTA_DOMAIN,
    clientId:     process.env.OKTA_CLIENT_ID,
    clientSecret: process.env.OKTA_CLIENT_SECRET,
  },
  rateLimit: {
    login: { max: 10, windowMs: 15 * 60 * 1000 },
    api:   { max: 300, windowMs: 60 * 1000 },
  },
};
