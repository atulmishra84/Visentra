'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config/index.js');

// Verify JWT and attach user to request
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  
  if (!token) return res.status(401).json({ error: 'No token provided' });
  
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    req.user = {
      id:       payload.sub,
      email:    payload.email,
      name:     payload.name,
      role:     payload.role,
      tenantId: payload.tenantId || '00000000-0000-0000-0000-000000000001',
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Role-based access control
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        required: roles,
        current: req.user.role,
      });
    }
    next();
  };
}

const ROLE_PERMISSIONS = {
  platform_admin: ['all', 'admin', 'view', 'scan', 'export', 'configure'],
  ciso:           ['view', 'export', 'report'],
  analyst:        ['view', 'scan', 'export'],
  auditor:        ['view', 'export', 'report'],
  viewer:         ['view'],
};

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    const perms = ROLE_PERMISSIONS[req.user.role] || [];
    if (!perms.includes('all') && !perms.includes(permission)) {
      return res.status(403).json({ error: `Permission '${permission}' required` });
    }
    next();
  };
}

module.exports = { authenticate, requireRole, requirePermission };
