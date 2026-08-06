'use strict';
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const config = require('./config');

// Routes
const authRoutes   = require('./routes/auth');
const adminRoutes  = require('./routes/admin');

const app = express();

// ── Security middleware ────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // SPA needs flexibility
  crossOriginEmbedderPolicy: false,
}));

// ── CORS — whitelist only known origins ───────────────────────
app.use(cors({
  origin: [config.azure.appUrl, 'https://localhost', 'http://localhost:4000'],
  credentials: true,
}));

// ── Request parsing ───────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(compression());

// ── Request logging ───────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const user = req.user?.email || 'anonymous';
    const duration = Date.now() - start;
    console.log(JSON.stringify({
      level: 'info', service: 'agentradar-api',
      method: req.method, path: req.path,
      status: res.statusCode, duration, ip: req.ip, user,
    }));
  });
  next();
});

// ── Health check (unauthenticated) ───────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: process.env.npm_package_version || '1.0.0' });
});

// ── Routes ────────────────────────────────────────────────────
app.use('/api/auth',  authRoutes);
app.use('/api/admin', adminRoutes);

// ── 404 handler ───────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// ── Global error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(JSON.stringify({
    level: 'error', service: 'agentradar-api',
    message: err.message, path: req.path, stack: err.stack,
  }));
  
  const status = err.status || err.statusCode || 500;
  const message = config.nodeEnv === 'production' && status === 500
    ? 'Internal server error'
    : err.message;
    
  res.status(status).json({ error: message });
});

module.exports = app;
