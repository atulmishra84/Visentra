'use strict';

const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { encrypt, decrypt } = require('../utils/crypto');
const { query } = require('../models/db');
const { MFA_REQUIRED_ROLES } = require('../middleware/auth');

authenticator.options = { window: 1 };

function roleRequiresMfa(role) {
  return MFA_REQUIRED_ROLES.has(role);
}

async function beginEnrollment(user) {
  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(user.email, 'AgentRadar', secret);
  const qrDataUrl = await QRCode.toDataURL(otpauth);
  const enc = encrypt(secret);
  // Store pending secret encrypted; not enabled until confirmed
  await query(
    `UPDATE users SET mfa_secret_enc = $1, mfa_enabled = false, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(enc), user.id]
  );
  return { qrDataUrl, secret, otpauth };
}

async function confirmEnrollment(userId, code) {
  const result = await query(`SELECT mfa_secret_enc FROM users WHERE id = $1`, [userId]);
  const row = result.rows[0];
  if (!row?.mfa_secret_enc) {
    throw new Error('MFA enrollment not started');
  }
  const enc = JSON.parse(row.mfa_secret_enc);
  const secret = decrypt(enc);
  if (!authenticator.verify({ token: String(code), secret })) {
    const err = new Error('Invalid MFA code');
    err.status = 400;
    throw err;
  }
  await query(`UPDATE users SET mfa_enabled = true, updated_at = NOW() WHERE id = $1`, [userId]);
  return true;
}

async function verifyLoginCode(user, code) {
  if (!user.mfa_secret_enc) return false;
  const enc = typeof user.mfa_secret_enc === 'string'
    ? JSON.parse(user.mfa_secret_enc)
    : user.mfa_secret_enc;
  const secret = decrypt(enc);
  return authenticator.verify({ token: String(code), secret });
}

module.exports = {
  roleRequiresMfa,
  beginEnrollment,
  confirmEnrollment,
  verifyLoginCode,
};
