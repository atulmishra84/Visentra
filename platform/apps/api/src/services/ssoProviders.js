/**
 * Tenant IAM / SSO identity provider registry (inbound login).
 * Separate from discovery connectors.
 */
import { encryptJson, decryptJson } from "../utils/crypto.js";
import {
  SSO_PRESETS,
  entraEnvProvider,
  listSsoPresets,
  buildProviderEndpoints,
  resolveOidcEndpoints
} from "../auth/oidc.js";

function rowToPublic(row, { includeSecrets = false } = {}) {
  if (!row) return null;
  let secrets = {};
  if (row.secrets_enc) {
    try {
      secrets = decryptJson(row.secrets_enc) || {};
    } catch {
      secrets = {};
    }
  }
  const config = row.config && typeof row.config === "object" ? { ...row.config } : {};
  const out = {
    id: row.id,
    key: row.provider_key,
    preset: row.preset,
    name: row.name,
    protocol: row.protocol,
    enabled: row.enabled,
    source: row.source || "db",
    clientId: row.client_id,
    hasClientSecret: Boolean(secrets.clientSecret),
    redirectUri: config.redirectUri || row.redirect_uri || "",
    config: {
      ...config,
      // never echo secret material
      clientSecret: undefined
    },
    claimMap: row.claim_map || {},
    allowedDomains: row.allowed_domains || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  if (includeSecrets) {
    out.clientSecret = secrets.clientSecret || "";
  }
  return out;
}

function toRuntimeProvider(row) {
  const secrets = row.secrets_enc ? decryptJson(row.secrets_enc) || {} : {};
  const config = row.config && typeof row.config === "object" ? { ...row.config } : {};
  return {
    id: row.id,
    key: row.provider_key,
    preset: row.preset,
    name: row.name,
    protocol: row.protocol,
    enabled: row.enabled,
    source: "db",
    client_id: row.client_id,
    client_secret: secrets.clientSecret || "",
    redirect_uri: config.redirectUri || "",
    config: { ...config, clientSecret: secrets.clientSecret || config.clientSecret },
    claim_map: row.claim_map || {},
    allowed_domains: row.allowed_domains || []
  };
}

export function getSsoSchema() {
  return {
    presets: listSsoPresets(),
    protocols: ["oidc", "saml"],
    notes: {
      oidc: "Works with any OpenID Connect IdP (Entra, Okta, Auth0, Ping, Keycloak, Google, OneLogin, custom).",
      saml:
        "Register SAML metadata for planning/config. Prefer OIDC when available; SAML ACS automation uses your IdP's OIDC app or federation bridge in this release."
    }
  };
}

export async function listSsoProviders(pool, tenantId, { includeDisabled = true } = {}) {
  const result = await pool.query(
    `SELECT * FROM sso_providers
     WHERE tenant_id = $1
     ${includeDisabled ? "" : "AND enabled = TRUE"}
     ORDER BY name ASC`,
    [tenantId]
  );
  return result.rows.map((row) => rowToPublic(row));
}

/** Public login buttons (no secrets). Merges env Entra when present. */
export async function listPublicSsoProviders(pool) {
  const env = entraEnvProvider();
  const result = await pool.query(
    `SELECT id, provider_key, preset, name, protocol, enabled, config, client_id, created_at
     FROM sso_providers
     WHERE enabled = TRUE
     ORDER BY name ASC`
  );
  const fromDb = result.rows.map((row) => ({
    id: row.id,
    key: row.provider_key,
    preset: row.preset,
    name: row.name,
    protocol: row.protocol,
    source: "db"
  }));
  const providers = [];
  if (env) {
    providers.push({
      id: env.id,
      key: env.key,
      preset: env.preset,
      name: env.name,
      protocol: env.protocol,
      source: "env"
    });
  }
  for (const p of fromDb) {
    if (env && p.preset === "entra") continue; // prefer env Entra when both exist
    providers.push(p);
  }
  return providers;
}

export async function getRuntimeProvider(pool, providerId) {
  if (!providerId) return null;
  if (providerId === "env-entra" || providerId === "entra") {
    return entraEnvProvider();
  }
  const result = await pool.query(`SELECT * FROM sso_providers WHERE id = $1 LIMIT 1`, [providerId]);
  const row = result.rows[0];
  if (!row || !row.enabled) return null;
  return toRuntimeProvider(row);
}

export async function getRuntimeProviderByKey(pool, key) {
  if (!key) return null;
  if (key === "entra") {
    const env = entraEnvProvider();
    if (env) return env;
  }
  const result = await pool.query(
    `SELECT * FROM sso_providers WHERE provider_key = $1 AND enabled = TRUE ORDER BY updated_at DESC LIMIT 1`,
    [key]
  );
  const row = result.rows[0];
  return row ? toRuntimeProvider(row) : null;
}

function normalizeKey(input, preset) {
  const raw = String(input || preset || "oidc")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return raw || "oidc";
}

export async function createSsoProvider(pool, tenantId, body = {}) {
  const preset = String(body.preset || "generic_oidc");
  if (!SSO_PRESETS[preset]) throw Object.assign(new Error(`Unknown SSO preset: ${preset}`), { status: 400 });
  const protocol = body.protocol || SSO_PRESETS[preset].protocol || "oidc";
  const name = String(body.name || SSO_PRESETS[preset].label).trim();
  if (!name) throw Object.assign(new Error("name is required"), { status: 400 });
  const key = normalizeKey(body.key, preset);
  const clientId = String(body.clientId || body.client_id || "").trim();
  if (protocol === "oidc" && !clientId) {
    throw Object.assign(new Error("clientId is required for OIDC providers"), { status: 400 });
  }
  const config = { ...(body.config || {}) };
  if (body.redirectUri) config.redirectUri = body.redirectUri;
  if (body.scopes) config.scopes = body.scopes;
  const secrets = {};
  if (body.clientSecret || body.client_secret) {
    secrets.clientSecret = String(body.clientSecret || body.client_secret);
  }
  const claimMap = body.claimMap || body.claim_map || {};
  const allowedDomains = body.allowedDomains || body.allowed_domains || [];
  const enabled = body.enabled !== false;

  const insert = await pool.query(
    `INSERT INTO sso_providers (
       tenant_id, provider_key, preset, name, protocol, enabled,
       client_id, config, secrets_enc, claim_map, allowed_domains
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11::jsonb)
     RETURNING *`,
    [
      tenantId,
      key,
      preset,
      name,
      protocol,
      enabled,
      clientId || null,
      JSON.stringify(config),
      Object.keys(secrets).length ? encryptJson(secrets) : null,
      JSON.stringify(claimMap),
      JSON.stringify(allowedDomains)
    ]
  );
  return rowToPublic(insert.rows[0]);
}

export async function updateSsoProvider(pool, tenantId, id, body = {}) {
  const existing = await pool.query(`SELECT * FROM sso_providers WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
  const row = existing.rows[0];
  if (!row) throw Object.assign(new Error("SSO provider not found"), { status: 404 });

  const preset = body.preset ? String(body.preset) : row.preset;
  if (body.preset && !SSO_PRESETS[preset]) {
    throw Object.assign(new Error(`Unknown SSO preset: ${preset}`), { status: 400 });
  }
  const name = body.name != null ? String(body.name).trim() : row.name;
  const protocol = body.protocol || row.protocol;
  const clientId =
    body.clientId != null || body.client_id != null
      ? String(body.clientId || body.client_id || "").trim()
      : row.client_id;
  const enabled = body.enabled != null ? Boolean(body.enabled) : row.enabled;
  const config = { ...(row.config || {}), ...(body.config || {}) };
  if (body.redirectUri != null) config.redirectUri = body.redirectUri;
  if (body.scopes != null) config.scopes = body.scopes;

  let secrets = {};
  if (row.secrets_enc) {
    try {
      secrets = decryptJson(row.secrets_enc) || {};
    } catch {
      secrets = {};
    }
  }
  if (body.clientSecret || body.client_secret) {
    secrets.clientSecret = String(body.clientSecret || body.client_secret);
  }

  const claimMap = body.claimMap || body.claim_map || row.claim_map || {};
  const allowedDomains = body.allowedDomains || body.allowed_domains || row.allowed_domains || [];

  const updated = await pool.query(
    `UPDATE sso_providers SET
       preset=$3, name=$4, protocol=$5, enabled=$6, client_id=$7,
       config=$8::jsonb, secrets_enc=$9, claim_map=$10::jsonb,
       allowed_domains=$11::jsonb, updated_at=NOW()
     WHERE id=$1 AND tenant_id=$2
     RETURNING *`,
    [
      id,
      tenantId,
      preset,
      name,
      protocol,
      enabled,
      clientId || null,
      JSON.stringify(config),
      Object.keys(secrets).length ? encryptJson(secrets) : null,
      JSON.stringify(claimMap),
      JSON.stringify(allowedDomains)
    ]
  );
  return rowToPublic(updated.rows[0]);
}

export async function deleteSsoProvider(pool, tenantId, id) {
  const result = await pool.query(`DELETE FROM sso_providers WHERE id=$1 AND tenant_id=$2 RETURNING id`, [
    id,
    tenantId
  ]);
  if (!result.rowCount) throw Object.assign(new Error("SSO provider not found"), { status: 404 });
  return { deleted: true, id };
}

export async function testSsoProvider(pool, tenantId, id) {
  const result = await pool.query(`SELECT * FROM sso_providers WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
  const row = result.rows[0];
  if (!row) throw Object.assign(new Error("SSO provider not found"), { status: 404 });
  const provider = toRuntimeProvider(row);
  if (provider.protocol === "saml") {
    const cfg = provider.config || {};
    if (!cfg.ssoUrl && !cfg.metadataUrl) {
      throw Object.assign(new Error("SAML provider needs ssoUrl or metadataUrl"), { status: 400 });
    }
    return {
      ok: true,
      protocol: "saml",
      message:
        "SAML metadata saved. Prefer enabling OIDC on this IdP for login; ACS automation uses OIDC in this release.",
      entityId: cfg.entityId || null,
      ssoUrl: cfg.ssoUrl || null
    };
  }
  const endpoints = await resolveOidcEndpoints(provider);
  return {
    ok: true,
    protocol: "oidc",
    issuer: endpoints.issuer,
    authorizeUrl: endpoints.authorizeUrl,
    tokenUrl: endpoints.tokenUrl,
    redirectUri: endpoints.redirectUri,
    message: "OIDC endpoints resolved successfully"
  };
}

export async function seedEntraFromEnv(pool, tenantId) {
  const env = entraEnvProvider();
  if (!env) return null;
  const existing = await pool.query(
    `SELECT id FROM sso_providers WHERE tenant_id=$1 AND provider_key='entra' LIMIT 1`,
    [tenantId]
  );
  if (existing.rows[0]) return rowToPublic(existing.rows[0]);
  return createSsoProvider(pool, tenantId, {
    key: "entra",
    preset: "entra",
    name: "Microsoft Entra ID",
    protocol: "oidc",
    clientId: env.client_id,
    clientSecret: env.client_secret,
    enabled: true,
    config: env.config
  });
}

export { buildProviderEndpoints, SSO_PRESETS };
