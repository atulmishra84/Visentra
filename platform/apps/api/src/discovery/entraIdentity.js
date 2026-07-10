import { safeFetch, ALLOW } from "../utils/http.js";
import { isAiRelevantText } from "./aiRelevance.js";

const ENTRA_MAX_OBJECTS = Number(process.env.ENTRA_DISCOVERY_MAX_OBJECTS || 150);

function requireEntraConfig({ config = {}, secrets = {} }) {
  const tenantId = String(config.tenantId || "").trim();
  const clientId = String(config.clientId || "").trim();
  const clientSecret = String(secrets.clientSecret || "").trim();
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Entra ID requires tenantId, clientId, and clientSecret");
  }
  return { tenantId, clientId, clientSecret };
}

async function getGraphToken({ tenantId, clientId, clientSecret }) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default"
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
    throw new Error(json.error_description || json.error || `Entra token failed (${res.status})`);
  }
  return json.access_token;
}

async function graphJson(path, token, { optional = false } = {}) {
  const res = await safeFetch(
    `https://graph.microsoft.com/v1.0${path}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
    ALLOW.graphMicrosoft
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (optional && (res.status === 403 || res.status === 404)) return null;
    throw new Error(json.error?.message || `Microsoft Graph failed (${res.status})`);
  }
  return json;
}

function isAiIdentity(obj) {
  return isAiRelevantText(obj.displayName, obj.appId, ...(obj.tags || []));
}

function identityObservation({ conn, kind, obj, tenantId }) {
  const displayName = obj.displayName || obj.appId || obj.id;
  const owners = Array.isArray(obj.owners)
    ? obj.owners.map((o) => o.userPrincipalName || o.mail || o.displayName).filter(Boolean)
    : [];
  const owner = owners[0] || null;
  return {
    collector_id: "identity_entra",
    fingerprint: `entra:${kind}:${obj.id || obj.appId}`,
    name: `Entra ${kind} — ${displayName}`,
    category: "identity",
    provider: "entra_identity",
    deployment_type: "identity",
    identity_used: displayName,
    owner,
    running_status: obj.accountEnabled === false ? "disabled" : "unknown",
    confidence_score: 0.82,
    framework: kind,
    metadata: {
      connectorId: conn.id,
      connectorName: conn.name,
      discoveryMode: "entra-graph-live",
      inventoryClass: "identity_application",
      evidenceClass: "repo_candidate",
      agentStatus: "candidate",
      tenantId,
      objectKind: kind,
      objectId: obj.id || null,
      appId: obj.appId || null,
      identityProvider: "entra",
      owners,
      ownershipStatus: owner ? "owned" : "ownerless",
      ownership: {
        owner,
        identities: uniq([displayName, ...owners]),
        identityUsed: displayName,
        identityProvider: "entra",
        ownershipStatus: owner ? "owned" : "ownerless",
        objectId: obj.id || null,
        appId: obj.appId || null,
        tenantId
      },
      tags: obj.tags || [],
      aiRelevant: true,
      environment: conn.environment,
      howIdentified: `Entra ${kind} with AI-relevant name/tags`
    },
    relationships: [
      {
        rel_type: "OBSERVED_BY",
        to_type: "IdentityProvider",
        to_key: "entra-id",
        to_name: "Microsoft Entra ID"
      },
      {
        rel_type: "RUNS_IN",
        to_type: "EntraTenant",
        to_key: `entra-tenant-${tenantId}`,
        to_name: `Entra tenant ${tenantId}`
      },
      {
        rel_type: "USES_IDENTITY",
        to_type: kind,
        to_key: obj.id || obj.appId,
        to_name: displayName
      },
      ...owners.slice(0, 3).map((o) => ({
        rel_type: "OWNS",
        to_type: "Developer",
        to_key: String(o).toLowerCase(),
        to_name: o
      }))
    ]
  };
}

function uniq(list) {
  return [...new Set((list || []).filter(Boolean).map(String))];
}

export async function validateEntra(conn) {
  const cfg = requireEntraConfig(conn);
  const token = await getGraphToken(cfg);
  const org = await graphJson("/organization?$select=id,displayName&$top=1", token);
  const first = org.value?.[0];
  return {
    ok: true,
    message: `Authenticated to Entra tenant ${first?.displayName || cfg.tenantId}.`,
    accessToken: token,
    organization: first || null
  };
}

export async function discoverEntra(conn) {
  const cfg = requireEntraConfig(conn);
  const validation = await validateEntra(conn);
  const token = validation.accessToken;
  const observations = [
    {
      collector_id: "identity_entra",
      fingerprint: `entra-connector-scan:${conn.id}:${cfg.tenantId}`,
      name: `Entra ID scan — ${conn.name}`,
      category: "identity",
      provider: "entra_identity",
      deployment_type: "identity",
      running_status: "running",
      confidence_score: 0.92,
      framework: "tenant-scan",
      metadata: {
        connectorId: conn.id,
        connectorName: conn.name,
        discoveryMode: "entra-graph-live",
        inventoryClass: "identity_connector",
        tenantId: cfg.tenantId,
        organization: validation.organization,
        environment: conn.environment,
        maxObjects: ENTRA_MAX_OBJECTS
      },
      relationships: [
        {
          rel_type: "OBSERVED_BY",
          to_type: "IdentityProvider",
          to_key: "entra-id",
          to_name: "Microsoft Entra ID"
        }
      ]
    }
  ];

  const [spJson, appJson] = await Promise.all([
    graphJson(
      `/servicePrincipals?$top=${Math.min(100, ENTRA_MAX_OBJECTS)}&$select=id,displayName,appId,servicePrincipalType,tags,accountEnabled,appOwnerOrganizationId`,
      token,
      { optional: true }
    ).catch(() => null),
    graphJson(
      `/applications?$top=${Math.min(100, ENTRA_MAX_OBJECTS)}&$select=id,displayName,appId,tags,createdDateTime,signInAudience`,
      token,
      { optional: true }
    ).catch(() => null)
  ]);

  let servicePrincipalsScanned = 0;
  let applicationsScanned = 0;
  const aiObjects = [];
  for (const sp of spJson?.value || []) {
    servicePrincipalsScanned += 1;
    if (!isAiIdentity(sp)) continue;
    aiObjects.push({ kind: "ServicePrincipal", obj: sp });
  }
  for (const app of appJson?.value || []) {
    applicationsScanned += 1;
    if (!isAiIdentity(app)) continue;
    aiObjects.push({ kind: "Application", obj: app });
  }

  // Best-effort owner enrichment for a small set of AI identities
  for (const item of aiObjects.slice(0, 25)) {
    const id = item.obj.id;
    if (!id) {
      observations.push(identityObservation({ conn, kind: item.kind, obj: item.obj, tenantId: cfg.tenantId }));
      continue;
    }
    const path =
      item.kind === "ServicePrincipal"
        ? `/servicePrincipals/${encodeURIComponent(id)}/owners?$select=id,displayName,userPrincipalName,mail&$top=5`
        : `/applications/${encodeURIComponent(id)}/owners?$select=id,displayName,userPrincipalName,mail&$top=5`;
    const ownersJson = await graphJson(path, token, { optional: true }).catch(() => null);
    const owners = ownersJson?.value || [];
    observations.push(
      identityObservation({
        conn,
        kind: item.kind,
        obj: { ...item.obj, owners },
        tenantId: cfg.tenantId
      })
    );
  }

  return {
    observations: observations.slice(0, ENTRA_MAX_OBJECTS + 1),
    stats: {
      servicePrincipalsScanned,
      applicationsScanned,
      identitiesIngested: Math.max(0, observations.length - 1)
    }
  };
}
