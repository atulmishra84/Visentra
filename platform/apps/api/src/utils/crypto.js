import crypto from "crypto";

const DEV_JWT_FALLBACK = "agentradar-dev-secret-change-me";
const IS_PROD = process.env.NODE_ENV === "production";

function deriveKeyFromJwt(material) {
  return crypto.createHash("sha256").update(`agentradar-connectors:${material}`).digest();
}

function keysEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Primary key: ENCRYPTION_KEY (required in production). Dev may fall back to JWT-derived. */
export function getPrimaryKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) {
    return Buffer.from(hex, "hex");
  }
  if (IS_PROD) {
    throw new Error("ENCRYPTION_KEY (64-char hex) is required in production");
  }
  const material = process.env.JWT_SECRET || DEV_JWT_FALLBACK;
  console.warn("[crypto] ENCRYPTION_KEY unset — deriving from JWT_SECRET (dev only)");
  return deriveKeyFromJwt(material);
}

/** Legacy MVP key used before ENCRYPTION_KEY was required. */
export function getLegacyJwtKey() {
  const material = process.env.JWT_SECRET;
  if (!material) return null;
  return deriveKeyFromJwt(material);
}

function decryptWithKey(parsed, key) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parsed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(parsed.authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsed.ciphertext, "base64")),
    decipher.final()
  ]);
  return JSON.parse(decrypted.toString("utf8"));
}

function parsePayload(payload) {
  return typeof payload === "string" ? JSON.parse(payload) : payload;
}

export function encryptJson(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getPrimaryKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return JSON.stringify({
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64")
  });
}

/**
 * Decrypt connector secrets. Tries ENCRYPTION_KEY first, then legacy JWT-derived key
 * so redeploys that introduce ENCRYPTION_KEY do not break existing connectors.
 */
export function decryptJson(payload) {
  const parsed = parsePayload(payload);
  const primary = getPrimaryKey();
  try {
    return decryptWithKey(parsed, primary);
  } catch (primaryErr) {
    const legacy = getLegacyJwtKey();
    if (legacy && !keysEqual(legacy, primary)) {
      try {
        return decryptWithKey(parsed, legacy);
      } catch {
        /* fall through */
      }
    }
    throw primaryErr;
  }
}

/** True when payload decrypts with the primary key (already migrated). */
export function isEncryptedWithPrimaryKey(payload) {
  try {
    decryptWithKey(parsePayload(payload), getPrimaryKey());
    return true;
  } catch {
    return false;
  }
}

/**
 * Re-encrypt connector rows still using the legacy JWT-derived key onto ENCRYPTION_KEY.
 * Safe to run on every boot (no-op when already migrated).
 */
export async function migrateConnectorEncryption(pool) {
  if (!process.env.ENCRYPTION_KEY || !/^[0-9a-fA-F]{64}$/.test(process.env.ENCRYPTION_KEY)) {
    return { migrated: 0, skipped: 0, failed: 0 };
  }

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  const result = await pool.query(
    `SELECT id, name, secrets_enc FROM connectors WHERE secrets_enc IS NOT NULL AND secrets_enc <> ''`
  );

  for (const row of result.rows) {
    if (isEncryptedWithPrimaryKey(row.secrets_enc)) {
      skipped += 1;
      continue;
    }
    try {
      const plaintext = decryptJson(row.secrets_enc);
      const next = encryptJson(plaintext);
      await pool.query(
        `UPDATE connectors SET secrets_enc = $1, updated_at = NOW() WHERE id = $2`,
        [next, row.id]
      );
      migrated += 1;
      console.log(`[crypto] Re-encrypted connector secrets for "${row.name}" (${row.id})`);
    } catch (err) {
      failed += 1;
      console.error(
        `[crypto] Failed to migrate connector "${row.name}" (${row.id}):`,
        err.message || err
      );
    }
  }

  if (migrated || failed) {
    console.log(
      `[crypto] Connector encryption migration complete: migrated=${migrated} skipped=${skipped} failed=${failed}`
    );
  }

  return { migrated, skipped, failed };
}

export function maskSecret(value) {
  if (!value) return null;
  const s = String(value);
  if (s.length <= 4) return "••••";
  return `${"•".repeat(Math.min(12, s.length - 4))}${s.slice(-4)}`;
}

export function generateEncryptionKey() {
  return crypto.randomBytes(32).toString("hex");
}
