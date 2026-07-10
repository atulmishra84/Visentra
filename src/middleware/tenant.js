'use strict';

/** Attach tenant scope from authenticated user; reject cross-tenant access */
function attachTenant(req, res, next) {
  if (!req.user?.tenantId) {
    return res.status(403).json({ error: 'Tenant context required' });
  }
  req.tenantId = req.user.tenantId;
  next();
}

/** Optional override for platform_admin switching tenants via header */
function allowTenantOverride(req, res, next) {
  const headerTenant = req.headers['x-tenant-id'];
  if (headerTenant && req.user?.role === 'platform_admin') {
    req.tenantId = headerTenant;
  }
  next();
}

module.exports = { attachTenant, allowTenantOverride };
