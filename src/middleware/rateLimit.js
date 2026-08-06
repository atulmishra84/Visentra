'use strict';
const config = require('../config/index.js');

// In-memory rate limiter (upgrade to Redis for multi-instance)
const windows = new Map();

function createRateLimiter({ max, windowMs, keyFn }) {
  // Cleanup expired windows every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, data] of windows) {
      if (now - data.resetAt > windowMs) windows.delete(key);
    }
  }, 5 * 60 * 1000);

  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : (req.ip || 'unknown');
    const now = Date.now();
    
    let data = windows.get(key);
    if (!data || now > data.resetAt) {
      data = { count: 0, resetAt: now + windowMs };
      windows.set(key, data);
    }
    
    data.count++;
    
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - data.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(data.resetAt / 1000));
    
    if (data.count > max) {
      return res.status(429).json({
        error: 'Too many requests',
        retryAfter: Math.ceil((data.resetAt - now) / 1000),
      });
    }
    next();
  };
}

const loginLimiter = createRateLimiter({
  max: config.rateLimit.login.max,
  windowMs: config.rateLimit.login.windowMs,
  keyFn: (req) => `login:${req.ip}`,
});

const apiLimiter = createRateLimiter({
  max: config.rateLimit.api.max,
  windowMs: config.rateLimit.api.windowMs,
});

module.exports = { createRateLimiter, loginLimiter, apiLimiter };
