/**
 * Microsoft Entra ID SSO — thin compatibility layer over generic OIDC.
 * Prefer apps/api/src/auth/oidc.js for new work.
 */
import {
  entraEnvProvider,
  buildOidcAuthorizeUrl,
  exchangeOidcCode,
  decodeIdToken,
  mapClaimsToRole,
  newOidcState
} from "./oidc.js";

export function entraEnabled() {
  return Boolean(entraEnvProvider());
}

export function entraConfig() {
  const env = entraEnvProvider();
  if (!env) return { tenantId: null, clientId: null, clientSecret: "", redirectUri: "" };
  return {
    tenantId: env.config.tenantId,
    clientId: env.client_id,
    clientSecret: env.client_secret,
    redirectUri: env.redirect_uri || env.config.redirectUri || ""
  };
}

export async function buildAuthorizeUrl({ state, nonce }) {
  const provider = entraEnvProvider();
  if (!provider) throw new Error("Entra SSO is not fully configured (tenant, client, redirect)");
  const { authorizeUrl } = await buildOidcAuthorizeUrl(provider, { state, nonce });
  return authorizeUrl;
}

export async function exchangeCodeForTokens(code) {
  const provider = entraEnvProvider();
  if (!provider) throw new Error("Entra SSO is not configured");
  const { tokens } = await exchangeOidcCode(provider, code);
  return tokens;
}

export { decodeIdToken, newOidcState };

export function mapEntraRole(claims = {}) {
  return mapClaimsToRole(claims, {
    roleClaim: "roles",
    adminValues: ["admin", "platform"],
    operatorValues: ["operator", "contributor"],
    defaultRole: "viewer"
  });
}
