/**
 * Production-aware runtime configuration and boot validation.
 */

const DEV_JWT_FALLBACK = "agentradar-dev-secret-change-me";

export const NODE_ENV = process.env.NODE_ENV || "development";
export const IS_PROD = NODE_ENV === "production";

export function assertProductionConfig() {
  const errors = [];

  if (!process.env.POSTGRES_URL) {
    errors.push("POSTGRES_URL is required");
  }

  if (IS_PROD) {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEV_JWT_FALLBACK) {
      errors.push("JWT_SECRET must be set to a strong non-default value in production");
    }
    if (!process.env.ENCRYPTION_KEY || !/^[0-9a-fA-F]{64}$/.test(process.env.ENCRYPTION_KEY)) {
      errors.push("ENCRYPTION_KEY must be a 64-char hex string (openssl rand -hex 32) in production");
    }
    if (!process.env.CORS_ORIGIN || process.env.CORS_ORIGIN === "*") {
      errors.push("CORS_ORIGIN must be set to your web origin(s) in production (not *)");
    }
    if (!process.env.BOOTSTRAP_ADMIN_PASSWORD) {
      errors.push("BOOTSTRAP_ADMIN_PASSWORD is required for first-boot admin provisioning");
    }
  }

  if (errors.length) {
    const msg = `Production configuration invalid:\n- ${errors.join("\n- ")}`;
    throw new Error(msg);
  }
}

export function resolveJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (IS_PROD) throw new Error("JWT_SECRET is required in production");
  console.warn("[config] Using development JWT_SECRET fallback — do not use in production");
  return DEV_JWT_FALLBACK;
}

export function resolveCorsOrigin() {
  const raw = process.env.CORS_ORIGIN;
  if (!raw || raw === "*") {
    if (IS_PROD) throw new Error("CORS_ORIGIN=* is not allowed in production");
    return true; // reflect request origin in development
  }
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 1) return list[0];
  return (origin, cb) => {
    if (!origin || list.includes(origin)) cb(null, true);
    else cb(new Error(`CORS blocked for origin ${origin}`));
  };
}

export function allowDemoSeed() {
  if (process.env.SEED_ON_START === "true") {
    if (IS_PROD && process.env.ALLOW_DEMO_SEED !== "true") {
      console.warn("[config] Ignoring SEED_ON_START in production (set ALLOW_DEMO_SEED=true to force)");
      return false;
    }
    return true;
  }
  return false;
}

export function productionCollectors(defaultList) {
  if (!IS_PROD) return defaultList;
  return defaultList.filter((id) => id !== "demo" && id !== "k8s_stub");
}

export function sanitizeCollectors(requested, allowed) {
  const allow = new Set(allowed);
  if (IS_PROD) {
    allow.delete("demo");
  }
  const list = (requested || []).filter((id) => allow.has(id));
  return list.length ? list : productionCollectors([...allow]);
}

/** Simple in-memory login rate limiter */
export function createRateLimiter({ windowMs = 60_000, max = 20 } = {}) {
  const hits = new Map();
  return function rateLimit(req, res, next) {
    const key = `${req.ip || req.headers["x-forwarded-for"] || "unknown"}:${req.path}`;
    const now = Date.now();
    const bucket = hits.get(key) || [];
    const recent = bucket.filter((t) => now - t < windowMs);
    recent.push(now);
    hits.set(key, recent);
    if (recent.length > max) {
      return res.status(429).json({ error: { message: "Too many requests. Try again shortly." } });
    }
    next();
  };
}
