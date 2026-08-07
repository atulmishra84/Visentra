import bcrypt from "bcryptjs";
import crypto from "crypto";
import { pool } from "../db/postgres.js";
import { signToken } from "../lib/jwt.js";
import { writeAudit } from "../services/audit.js";
import { publicErrorMessage } from "../utils/http.js";
import { entraEnabled } from "../auth/entra.js";
import { resolveJwtSecret } from "../config.js";
import {
  buildOidcAuthorizeUrl,
  exchangeOidcCode,
  decodeIdToken as decodeOidcIdToken,
  mapClaimsToRole,
  extractIdentity,
  emailDomainAllowed,
  signSsoState,
  verifySsoState,
  newOidcState as newSsoNonce
} from "../auth/oidc.js";
import { listPublicSsoProviders, getRuntimeProvider } from "../services/ssoProviders.js";

const JWT_SECRET = resolveJwtSecret();

export async function login(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: { message: "email and password required" } });
  const result = await pool.query(
    `SELECT u.*, t.name AS tenant_name, t.slug AS tenant_slug
     FROM users u JOIN tenants t ON t.id = u.tenant_id
     WHERE lower(u.email)=lower($1) LIMIT 1`,
    [email]
  );
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: { message: "Invalid credentials" } });
  }
  await pool.query(`UPDATE users SET last_login=NOW() WHERE id=$1`, [user.id]);
  await writeAudit(pool, {
    tenantId: user.tenant_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "auth.login",
    resourceType: "user",
    resourceId: user.id,
    ip: req.ip
  });
  const token = signToken(user);
  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      roles: [user.role],
      tenant: user.tenant_slug,
      tenantId: user.tenant_id,
      authProvider: user.auth_provider || "local"
    }
  });
}

export async function ssoStatus(req, res) {
  try {
    const providers = await listPublicSsoProviders(pool);
    res.json({
      entraEnabled: providers.some((p) => p.preset === "entra" || p.key === "entra"),
      providers,
      localLoginEnabled: true
    });
  } catch (err) {
    res.status(500).json({ error: { message: publicErrorMessage(err, "Unable to load SSO status") } });
  }
}

async function completeOidcLogin(req, res, provider, { code, state, nonce }) {
  if (!code) return res.status(400).json({ error: { message: "code is required" } });
  if (provider.protocol === "saml") {
    return res.status(400).json({
      error: {
        message:
          "SAML ACS login is not enabled in this build. Use an OIDC app on the same IdP (Okta/Auth0/Entra/Ping/Keycloak)."
      }
    });
  }

  let statePayload = null;
  if (state) {
    try {
      statePayload = verifySsoState(state, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: { message: "Invalid or expired SSO state" } });
    }
    if (statePayload.pid && String(statePayload.pid) !== String(provider.id) && provider.id !== "env-entra") {
      if (!(provider.id === "env-entra" && statePayload.pid === "entra")) {
        return res.status(401).json({ error: { message: "SSO state provider mismatch" } });
      }
    }
  }

  const { tokens } = await exchangeOidcCode(provider, code);
  const claims = decodeOidcIdToken(tokens.id_token);
  const expectedNonce = nonce || statePayload?.nonce;
  if (expectedNonce && claims.nonce && claims.nonce !== expectedNonce) {
    return res.status(401).json({ error: { message: "Invalid OIDC nonce" } });
  }

  const identity = extractIdentity(claims, provider.claim_map || {});
  if (!identity.email) {
    return res.status(401).json({ error: { message: "OIDC token missing email claim" } });
  }
  if (!emailDomainAllowed(identity.email, provider.allowed_domains || [])) {
    return res.status(403).json({ error: { message: "Email domain is not allowed for this SSO provider" } });
  }

  const role = mapClaimsToRole(claims, provider.claim_map || {});
  const tenant = await pool.query(`SELECT id, slug FROM tenants ORDER BY created_at ASC LIMIT 1`);
  const tenantId = tenant.rows[0]?.id;
  if (!tenantId) return res.status(500).json({ error: { message: "No tenant provisioned" } });

  const unusable = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
  const authProvider = String(provider.preset || provider.key || "oidc").slice(0, 64);
  const upsert = await pool.query(
    `INSERT INTO users (tenant_id, email, name, role, password_hash, auth_provider, external_sub)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (tenant_id, email) DO UPDATE SET
       name = EXCLUDED.name,
       auth_provider = EXCLUDED.auth_provider,
       external_sub = COALESCE(EXCLUDED.external_sub, users.external_sub),
       last_login = NOW(),
       updated_at = NOW()
     RETURNING *`,
    [
      tenantId,
      String(identity.email).toLowerCase(),
      identity.name,
      role,
      unusable,
      authProvider,
      identity.externalSub || null
    ]
  );
  const user = upsert.rows[0];
  user.tenant_slug = tenant.rows[0].slug;
  await writeAudit(pool, {
    tenantId,
    actorId: user.id,
    actorEmail: user.email,
    action: `auth.sso.${authProvider}`,
    resourceType: "user",
    resourceId: user.id,
    details: { providerId: provider.id, externalSub: identity.externalSub || null },
    ip: req.ip
  });
  const token = signToken(user);
  return res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      roles: [user.role],
      tenant: user.tenant_slug,
      tenantId: user.tenant_id,
      authProvider
    }
  });
}

export async function ssoStart(req, res) {
  try {
    const provider = await getRuntimeProvider(pool, req.params.providerId);
    if (!provider) {
      return res.status(404).json({ error: { message: "SSO provider not found or disabled" } });
    }
    if (provider.protocol === "saml") {
      return res.status(400).json({
        error: {
          message:
            "SAML browser login is not enabled yet. Create an OIDC app on this IdP (or use Generic OpenID Connect)."
        }
      });
    }
    const nonce = newSsoNonce();
    const state = signSsoState(
      {
        pid: provider.id,
        nonce,
        iat: Date.now(),
        exp: Date.now() + 10 * 60 * 1000
      },
      JWT_SECRET
    );
    const { authorizeUrl } = await buildOidcAuthorizeUrl(provider, { state, nonce });
    res.json({
      authorizeUrl,
      state,
      nonce,
      provider: { id: provider.id, name: provider.name, preset: provider.preset, protocol: provider.protocol }
    });
  } catch (err) {
    res.status(500).json({ error: { message: publicErrorMessage(err, "Unable to start SSO") } });
  }
}

export async function ssoCallback(req, res) {
  try {
    const { code, state, nonce, providerId } = req.body || {};
    let resolvedProviderId = providerId;
    if (!resolvedProviderId && state) {
      try {
        resolvedProviderId = verifySsoState(state, JWT_SECRET).pid;
      } catch {
        return res.status(401).json({ error: { message: "Invalid or expired SSO state" } });
      }
    }
    if (!resolvedProviderId) {
      return res.status(400).json({ error: { message: "providerId or signed state is required" } });
    }
    const provider = await getRuntimeProvider(pool, resolvedProviderId);
    if (!provider) {
      return res.status(404).json({ error: { message: "SSO provider not found or disabled" } });
    }
    await completeOidcLogin(req, res, provider, { code, state, nonce });
  } catch (err) {
    res.status(401).json({ error: { message: publicErrorMessage(err, "SSO failed") } });
  }
}

export async function entraStart(req, res) {
  if (!entraEnabled()) {
    return res.status(404).json({ error: { message: "Entra SSO is not configured" } });
  }
  try {
    const provider = await getRuntimeProvider(pool, "env-entra");
    const nonce = newSsoNonce();
    const state = signSsoState(
      { pid: provider.id, nonce, iat: Date.now(), exp: Date.now() + 10 * 60 * 1000 },
      JWT_SECRET
    );
    const { authorizeUrl } = await buildOidcAuthorizeUrl(provider, { state, nonce });
    res.json({ authorizeUrl, state, nonce });
  } catch (err) {
    res.status(500).json({ error: { message: publicErrorMessage(err, "Unable to start Entra SSO") } });
  }
}

export async function entraCallback(req, res) {
  if (!entraEnabled()) {
    return res.status(404).json({ error: { message: "Entra SSO is not configured" } });
  }
  try {
    const provider = await getRuntimeProvider(pool, "env-entra");
    await completeOidcLogin(req, res, provider, {
      code: req.body?.code,
      state: req.body?.state,
      nonce: req.body?.nonce
    });
  } catch (err) {
    res.status(401).json({ error: { message: publicErrorMessage(err, "Entra SSO failed") } });
  }
}

export async function me(req, res) {
  const result = await pool.query(
    `SELECT u.id, u.email, u.name, u.role, u.tenant_id, t.slug AS tenant
     FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.id=$1`,
    [req.user.sub]
  );
  const user = result.rows[0];
  if (!user) return res.status(404).json({ error: { message: "User not found" } });
  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      roles: [user.role],
      tenant: user.tenant,
      tenantId: user.tenant_id
    }
  });
}
