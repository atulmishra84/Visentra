import crypto from "crypto";

function getKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) {
    return Buffer.from(hex, "hex");
  }
  // Dev/MVP fallback: derive stable 32-byte key from JWT_SECRET
  const material = process.env.JWT_SECRET || "agentradar-dev-secret-change-me";
  return crypto.createHash("sha256").update(`agentradar-connectors:${material}`).digest();
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
