/**
 * Microsoft Entra ID (Azure AD) OIDC helpers for enterprise SSO.
 * Enabled when ENTRA_TENANT_ID + ENTRA_CLIENT_ID are set.
 */
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { safeFetch, ALLOW } from "../utils/http.js";

export function entraEnabled() {
  return Boolean(process.env.ENTRA_TENANT_ID && process.env.ENTRA_CLIENT_ID);
}

export function entraConfig() {
  const tenantId = process.env.ENTRA_TENANT_ID;
  const clientId = process.env.ENTRA_CLIENT_ID;
  const clientSecret = process.env.ENTRA_CLIENT_SECRET || "";
  const redirectUri =
    process.env.ENTRA_REDIRECT_URI ||
    (process.env.CORS_ORIGIN ? `${String(process.env.CORS_ORIGIN).split(",")[0].trim()}/login` : "");
  return { tenantId, clientId, clientSecret, redirectUri };
}

export function buildAuthorizeUrl({ state, nonce }) {
  const { tenantId, clientId, redirectUri } = entraConfig();
  if (!tenantId || !clientId || !redirectUri) {
    throw new Error("Entra SSO is not fully configured (tenant, client, redirect)");
  }
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: "openid profile email offline_access",
    state,
    nonce
  });
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize?${params}`;
}

export async function exchangeCodeForTokens(code) {
  const { tenantId, clientId, clientSecret, redirectUri } = entraConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access"
  });
  const res = await safeFetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    },
    ALLOW.microsoftLogin
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error_description || json.error || `Entra token exchange failed (${res.status})`);
  }
  return json;
}

export function decodeIdToken(idToken) {
  // Signature is validated by obtaining the token from Entra's token endpoint over TLS.
  // For Stage 1 we decode claims; production hardening can add JWKS verification.
  const decoded = jwt.decode(idToken, { complete: false });
  if (!decoded || typeof decoded !== "object") {
    throw new Error("Invalid Entra id_token");
  }
  return decoded;
}

export function mapEntraRole(claims = {}) {
  const roles = []
    .concat(claims.roles || [])
    .concat(claims.wids || [])
    .map((r) => String(r).toLowerCase());
  if (roles.some((r) => r.includes("admin") || r.includes("platform"))) return "platform_admin";
  if (roles.some((r) => r.includes("operator") || r.includes("contributor"))) return "operator";
  return "viewer";
}

export function newOidcState() {
  return crypto.randomBytes(24).toString("hex");
}
