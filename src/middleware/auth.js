'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

const ROLES = {
  PLATFORM_ADMIN: 'platform_admin',
  CISO: 'ciso',
  ANALYST: 'analyst',
  AUDITOR: 'auditor',
  VIEWER: 'viewer',
  ADMIN: 'admin',
};

const MFA_REQUIRED_ROLES = new Set([ROLES.PLATFORM_ADMIN, ROLES.CISO, ROLES.ADMIN]);

/** Map DB roles to UI-facing roles expected by production console */
function toUiRole(role) {
  if (role === ROLES.PLATFORM_ADMIN || role === ROLES.ADMIN) return ROLES.CISO;
  if (role === ROLES.VIEWER) return ROLES.AUDITOR;
  return role;
}

function signToken(payload, expiresIn = '8h') {
  return jwt.sign(payload, config.jwtSecret, { expiresIn });
}

function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    return { token: header.slice(7).trim(), via: 'bearer' };
  }
  if (req.cookies?.ar_token) {
    return { token: req.cookies.ar_token, via: 'cookie' };
  }
  return { token: null, via: null };
}

function authenticate(req, res, next) {
  try {
    const { token, via } = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const payload = verifyToken(token);
    req.user = payload;
    req.authVia = via;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

function requireRoles(...roles) {
  const expanded = new Set(roles);
  // Treat platform_admin/admin as satisfying ciso checks and vice versa for privileged ops
  if (roles.includes(ROLES.CISO) || roles.includes(ROLES.PLATFORM_ADMIN)) {
    expanded.add(ROLES.CISO);
    expanded.add(ROLES.PLATFORM_ADMIN);
    expanded.add(ROLES.ADMIN);
  }
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const role = req.user.role;
    const uiRole = req.user.uiRole || toUiRole(role);
    if (!expanded.has(role) && !expanded.has(uiRole)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

/** Read-only roles for auditors/viewers; mutating routes exclude them by default */
function requireWriteAccess(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const role = req.user.role;
  const uiRole = req.user.uiRole || toUiRole(role);
  if (role === ROLES.AUDITOR || role === ROLES.VIEWER || uiRole === ROLES.AUDITOR) {
    return res.status(403).json({ error: 'Auditors have read-only access' });
  }
  next();
}

module.exports = {
  ROLES,
  MFA_REQUIRED_ROLES,
  toUiRole,
  signToken,
  verifyToken,
  extractToken,
  authenticate,
  requireRoles,
  requireWriteAccess,
};
