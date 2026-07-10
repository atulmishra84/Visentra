'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

const ROLES = {
  PLATFORM_ADMIN: 'platform_admin',
  CISO: 'ciso',
  ANALYST: 'analyst',
  AUDITOR: 'auditor',
};

const MFA_REQUIRED_ROLES = new Set([ROLES.PLATFORM_ADMIN, ROLES.CISO]);

function signToken(payload, expiresIn = '8h') {
  return jwt.sign(payload, config.jwtSecret, { expiresIn });
}

function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

function authenticate(req, res, next) {
  try {
    const token = req.cookies?.ar_token;
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

/** Read-only roles for auditors; mutating routes exclude auditor by default */
function requireWriteAccess(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (req.user.role === ROLES.AUDITOR) {
    return res.status(403).json({ error: 'Auditors have read-only access' });
  }
  next();
}

module.exports = {
  ROLES,
  MFA_REQUIRED_ROLES,
  signToken,
  verifyToken,
  authenticate,
  requireRoles,
  requireWriteAccess,
};
