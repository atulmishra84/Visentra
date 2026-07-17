/**
 * Generic OpenID Connect helpers for enterprise IAM / SSO.
 * Works with any OIDC-compliant IdP (Entra, Okta, Auth0, Ping, Keycloak, Google, …).
 */
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { safeFetch, ALLOW } from "../utils/http.js";

const DISCOVERY_CACHE = new Map();
const DISCOVERY_TTL_MS = 10 * 60 * 1000;

export const SSO_PRESETS = {
  entra: {
    key: "entra",
    label: "Microsoft Entra ID",
    protocol: "oidc",
    issuerTemplate: "https://login.microsoftonline.com/{tenantId}/v2.0",
    discoveryTemplate: "https://login.microsoftonline.com/{tenantId}/v2.0/.well-known/openid-configuration",
    authorizeTemplate: "https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/authorize",
    tokenTemplate: "https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token",
    defaultScopes: "openid profile email offline_access",
    fields: ["tenantId"],
    hostPolicy: ALLOW.microsoftLogin
  },
  okta: {
    key: "okta",
    label: "Okta",
    protocol: "oidc",
    issuerTemplate: "https://{domain}",
    discoveryTemplate: "https://{domain}/.well-known/openid-configuration",
    defaultScopes: "openid profile email offline_access",
    fields: ["domain"],
    hostPolicy: { allowHostSuffixes: [".okta.com", ".oktapreview.com", ".okta-emea.com"] }
  },
  auth0: {
    key: "auth0",
    label: "Auth0",
    protocol: "oidc",
    issuerTemplate: "https://{domain}/",
    discoveryTemplate: "https://{domain}/.well-known/openid-configuration",
    defaultScopes: "openid profile email offline_access",
    fields: ["domain"],
    hostPolicy: { allowHostSuffixes: [".auth0.com"] }
  },
  google: {
    key: "google",
    label: "Google Workspace",
    protocol: "oidc",
    issuer: "https://accounts.google.com",
    discoveryUrl: "https://accounts.google.com/.well-known/openid-configuration",
    defaultScopes: "openid profile email",
    fields: [],
    hostPolicy: {
      allowHosts: ["accounts.google.com", "oauth2.googleapis.com"],
      allowHostSuffixes: [".googleapis.com", ".google.com"]
    }
  },
  ping: {
    key: "ping",
    label: "PingFederate / PingOne",
    protocol: "oidc",
    defaultScopes: "openid profile email",
    fields: ["issuer"],
    hostPolicy: {
      allowHostSuffixes: [".pingidentity.com", ".pingone.com", ".pingone.eu", ".pingone.asia"]
    }
  },
  keycloak: {
    key: "keycloak",
    label: "Keycloak",
    protocol: "oidc",
    issuerTemplate: "{issuer}",
    discoveryTemplate: "{issuer}/.well-known/openid-configuration",
    defaultScopes: "openid profile email",
    fields: ["issuer"],
    // Self-hosted / custom domains: allow by issuer host at runtime
    hostPolicy: { allowPrivate: false }
  },
  onelogin: {
    key: "onelogin",
    label: "OneLogin",
    protocol: "oidc",
    issuerTemplate: "https://{domain}.onelogin.com/oidc/2",
    discoveryTemplate: "https://{domain}.onelogin.com/oidc/2/.well-known/openid-configuration",
    defaultScopes: "openid profile email",
    fields: ["domain"],
    hostPolicy: { allowHostSuffixes: [".onelogin.com"] }
  },
  generic_oidc: {
    key: "generic_oidc",
    label: "Generic OpenID Connect",
    protocol: "oidc",
    defaultScopes: "openid profile email",
    fields: ["issuer", "discoveryUrl", "authorizeUrl", "tokenUrl"],
    hostPolicy: null
  },
  saml: {
    key: "saml",
    label: "SAML 2.0 (via IdP metadata)",
    protocol: "saml",
    fields: ["entityId", "ssoUrl", "metadataUrl", "certificate"],
    hostPolicy: null
  }
};

export function listSsoPresets() {
  return Object.values(SSO_PRESETS).map((p) => ({
    key: p.key,
    label: p.label,
    protocol: p.protocol,
    fields: p.fields || [],
    defaultScopes: p.defaultScopes || "openid profile email"
  }));
}

function fillTemplate(template, vars = {}) {
  if (!template) return "";
  return String(template).replace(/\{(\w+)\}/g, (_, key) => {
    const value = vars[key];
    return value == null ? "" : String(value).replace(/\/$/, "");
  });
}

export function resolveRedirectUri(explicit) {
  if (explicit) return String(explicit).trim();
  const origin = process.env.CORS_ORIGIN ? String(process.env.CORS_ORIGIN).split(",")[0].trim() : "";
  return origin ? `${origin.replace(/\/$/, "")}/login` : "";
}

export function buildProviderEndpoints(provider) {
  const preset = SSO_PRESETS[provider.preset] || SSO_PRESETS.generic_oidc;
  const cfg = { ...(provider.config || {}) };
  const vars = {
    tenantId: cfg.tenantId || process.env.ENTRA_TENANT_ID || "",
    domain: String(cfg.domain || "").replace(/^https?:\/\//, "").replace(/\/$/, ""),
    issuer: String(cfg.issuer || "").replace(/\/$/, "")
  };

  const issuer =
    cfg.issuer ||
    (preset.issuer ? preset.issuer : fillTemplate(preset.issuerTemplate, vars)) ||
    "";
  const discoveryUrl =
    cfg.discoveryUrl ||
    (preset.discoveryUrl ? preset.discoveryUrl : fillTemplate(preset.discoveryTemplate, { ...vars, issuer })) ||
    (issuer ? `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration` : "");
  const authorizeUrl =
    cfg.authorizeUrl || fillTemplate(preset.authorizeTemplate, { ...vars, issuer }) || "";
  const tokenUrl = cfg.tokenUrl || fillTemplate(preset.tokenTemplate, { ...vars, issuer }) || "";

  return {
    preset,
    issuer: issuer.replace(/\/$/, ""),
    discoveryUrl,
    authorizeUrl,
    tokenUrl,
    scopes: cfg.scopes || preset.defaultScopes || "openid profile email",
    redirectUri: resolveRedirectUri(cfg.redirectUri || provider.redirect_uri),
    clientId: provider.client_id || cfg.clientId || "",
    clientSecret: provider.client_secret || cfg.clientSecret || ""
  };
}

function hostPolicyForUrl(urlString, presetPolicy) {
  let hostname;
  try {
    hostname = new URL(urlString).hostname.toLowerCase();
  } catch {
    throw new Error("Invalid IAM endpoint URL");
  }
  if (presetPolicy?.allowHosts || presetPolicy?.allowHostSuffixes || presetPolicy?.allowPrivate) {
    return {
      allowHosts: [...(presetPolicy.allowHosts || []), hostname],
      allowHostSuffixes: presetPolicy.allowHostSuffixes || [],
      allowPrivate: Boolean(presetPolicy.allowPrivate)
    };
  }
  return { allowHosts: [hostname] };
}

async function discoverOidc(discoveryUrl, policy) {
  const cached = DISCOVERY_CACHE.get(discoveryUrl);
  if (cached && cached.expires > Date.now()) return cached.doc;
  const res = await safeFetch(discoveryUrl, { method: "GET" }, policy);
  const doc = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(doc.error_description || doc.error || `OIDC discovery failed (${res.status})`);
  }
  if (!doc.authorization_endpoint || !doc.token_endpoint) {
    throw new Error("OIDC discovery document missing authorization/token endpoints");
  }
  DISCOVERY_CACHE.set(discoveryUrl, { doc, expires: Date.now() + DISCOVERY_TTL_MS });
  return doc;
}

export async function resolveOidcEndpoints(provider) {
  const built = buildProviderEndpoints(provider);
  if (!built.clientId) throw new Error("SSO provider is missing client_id");
  if (!built.redirectUri) throw new Error("SSO redirect URI is not configured (set redirect URI or CORS_ORIGIN)");

  let authorizeUrl = built.authorizeUrl;
  let tokenUrl = built.tokenUrl;
  let issuer = built.issuer;

  if (built.discoveryUrl && (!authorizeUrl || !tokenUrl || !issuer)) {
    const policy = hostPolicyForUrl(built.discoveryUrl, built.preset.hostPolicy);
    const doc = await discoverOidc(built.discoveryUrl, policy);
    authorizeUrl = authorizeUrl || doc.authorization_endpoint;
    tokenUrl = tokenUrl || doc.token_endpoint;
    issuer = issuer || String(doc.issuer || "").replace(/\/$/, "");
  }

  if (!authorizeUrl || !tokenUrl) {
    throw new Error("SSO provider is missing authorize/token endpoints (set discovery URL or explicit URLs)");
  }

  return {
    ...built,
    issuer,
    authorizeUrl,
    tokenUrl,
    authorizePolicy: hostPolicyForUrl(authorizeUrl, built.preset.hostPolicy),
    tokenPolicy: hostPolicyForUrl(tokenUrl, built.preset.hostPolicy)
  };
}

export async function buildOidcAuthorizeUrl(provider, { state, nonce }) {
  const endpoints = await resolveOidcEndpoints(provider);
  const params = new URLSearchParams({
    client_id: endpoints.clientId,
    response_type: "code",
    redirect_uri: endpoints.redirectUri,
    response_mode: "query",
    scope: endpoints.scopes,
    state,
    nonce
  });
  return {
    authorizeUrl: `${endpoints.authorizeUrl}${endpoints.authorizeUrl.includes("?") ? "&" : "?"}${params}`,
    endpoints
  };
}

export async function exchangeOidcCode(provider, code) {
  const endpoints = await resolveOidcEndpoints(provider);
  const body = new URLSearchParams({
    client_id: endpoints.clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: endpoints.redirectUri
  });
  if (endpoints.clientSecret) body.set("client_secret", endpoints.clientSecret);
  body.set("scope", endpoints.scopes);

  const res = await safeFetch(
    endpoints.tokenUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    },
    endpoints.tokenPolicy
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error_description || json.error || `OIDC token exchange failed (${res.status})`);
  }
  return { tokens: json, endpoints };
}

export function decodeIdToken(idToken) {
  const decoded = jwt.decode(idToken, { complete: false });
  if (!decoded || typeof decoded !== "object") {
    throw new Error("Invalid OIDC id_token");
  }
  return decoded;
}

export function mapClaimsToRole(claims = {}, claimMap = {}) {
  const roleClaim = claimMap.roleClaim || "roles";
  const raw = claims[roleClaim] ?? claims.roles ?? claims.groups ?? claims.wids ?? [];
  const roles = (Array.isArray(raw) ? raw : [raw]).map((r) => String(r).toLowerCase());
  const adminValues = (claimMap.adminValues || ["admin", "platform_admin", "platform"]).map((v) =>
    String(v).toLowerCase()
  );
  const operatorValues = (claimMap.operatorValues || ["operator", "contributor"]).map((v) =>
    String(v).toLowerCase()
  );
  if (roles.some((r) => adminValues.some((a) => r.includes(a)))) return "platform_admin";
  if (roles.some((r) => operatorValues.some((a) => r.includes(a)))) return "operator";
  return claimMap.defaultRole || "viewer";
}

export function extractIdentity(claims = {}, claimMap = {}) {
  const emailKeys = claimMap.emailClaims || ["email", "preferred_username", "upn", "unique_name"];
  let email = "";
  for (const key of emailKeys) {
    if (claims[key]) {
      email = String(claims[key]).trim();
      break;
    }
  }
  const name = String(claims[claimMap.nameClaim || "name"] || email || claims.sub || "").trim();
  const externalSub = String(claims.sub || claims.oid || claims.uid || "").trim();
  return { email, name, externalSub };
}

export function emailDomainAllowed(email, allowedDomains = []) {
  if (!allowedDomains?.length) return true;
  const domain = String(email).split("@")[1]?.toLowerCase();
  if (!domain) return false;
  return allowedDomains.map((d) => String(d).toLowerCase().replace(/^@/, "")).includes(domain);
}

export function newOidcState() {
  return crypto.randomBytes(24).toString("hex");
}

/** HMAC-signed state so multi-replica apps don't need shared session store. */
export function signSsoState(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySsoState(state, secret, maxAgeMs = 10 * 60 * 1000) {
  if (!state || typeof state !== "string" || !state.includes(".")) {
    throw new Error("Invalid SSO state");
  }
  const [body, sig] = state.split(".");
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("Invalid SSO state signature");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (!payload?.exp || Date.now() > Number(payload.exp)) {
    throw new Error("SSO state expired");
  }
  if (payload.iat && Date.now() - Number(payload.iat) > maxAgeMs) {
    throw new Error("SSO state expired");
  }
  return payload;
}

/** Env-based Entra bootstrap (backward compatible). */
export function entraEnvProvider() {
  const tenantId = process.env.ENTRA_TENANT_ID;
  const clientId = process.env.ENTRA_CLIENT_ID;
  if (!tenantId || !clientId) return null;
  return {
    id: "env-entra",
    key: "entra",
    preset: "entra",
    name: "Microsoft Entra ID",
    protocol: "oidc",
    enabled: true,
    source: "env",
    client_id: clientId,
    client_secret: process.env.ENTRA_CLIENT_SECRET || "",
    redirect_uri: process.env.ENTRA_REDIRECT_URI || "",
    config: {
      tenantId,
      scopes: "openid profile email offline_access",
      redirectUri: process.env.ENTRA_REDIRECT_URI || ""
    },
    claim_map: {},
    allowed_domains: []
  };
}
