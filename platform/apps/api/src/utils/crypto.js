import crypto from "crypto";

const DEV_JWT_FALLBACK = "agentradar-dev-secret-change-me";
const IS_PROD = process.env.NODE_ENV === "production";

function deriveKeyFromJwt(material) {
  return crypto.createHash("sha256").update(`agentradar-connectors:${material}`).digest();
}

function getKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) {
    return Buffer.from(hex, "hex");
  }
  const material = process.env.JWT_SECRET || (IS_PROD ? null : DEV_JWT_FALLBACK);
  if (!material) {
    throw new Error("ENCRYPTION_KEY (64-char hex) or JWT_SECRET is required in production");
  }
  if (IS_PROD) {
    console.warn(
      "[crypto] ENCRYPTION_KEY unset — deriving from JWT_SECRET. Set an explicit ENCRYPTION_KEY for production."
    );
  } else {
    console.warn("[crypto] ENCRYPTION_KEY unset — deriving from JWT_SECRET (dev only)");
  }
  return deriveKeyFromJwt(material);
}

export function encryptJson(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return JSON.stringify({
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64")
  });
}

export function decryptJson(payload) {
  const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(parsed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(parsed.authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsed.ciphertext, "base64")),
    decipher.final()
  ]);
  return JSON.parse(decrypted.toString("utf8"));
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
