import crypto from "crypto";

function cortexAuthHeaders(apiKey, apiKeyId) {
  const nonce = crypto.randomBytes(16).toString("hex");
  const timestamp = Date.now().toString();
  const authHash = crypto.createHash("sha256").update(apiKey + nonce + timestamp).digest("hex");
  return {
    "x-xdr-auth-id": String(apiKeyId),
    "x-xdr-nonce": nonce,
    "x-xdr-timestamp": timestamp,
    "x-xdr-auth-hash": authHash,
    "Content-Type": "application/json"
  };
}

async function azureAppToken(tenantId, clientId, clientSecret, scope) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope
  });
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error_description || json.error || `Token request failed (${res.status})`);
  }
  return json.access_token;
}

export async function validateCrowdstrike({ config, secrets }) {
  const base = (config.baseUrl || "https://api.crowdstrike.com").replace(/\/$/, "");
  const clientId = config.clientId;
  const clientSecret = secrets.clientSecret;
  if (!clientId || !clientSecret) throw new Error("CrowdStrike clientId and clientSecret are required");

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret
  });
  const tokenRes = await fetch(`${base}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body
  });
  const tokenJson = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    throw new Error(tokenJson.errors?.[0]?.message || tokenJson.message || `CrowdStrike auth failed (${tokenRes.status})`);
  }

  const probe = await fetch(`${base}/devices/queries/devices/v1?limit=1`, {
    headers: { Authorization: `Bearer ${tokenJson.access_token}`, Accept: "application/json" }
  });
  if (!probe.ok && probe.status !== 403) {
    const err = await probe.json().catch(() => ({}));
    throw new Error(err.errors?.[0]?.message || `CrowdStrike device query failed (${probe.status})`);
  }
  if (probe.status === 403) {
    return {
      ok: true,
      message: "CrowdStrike OAuth succeeded. Grant Hosts:read (or equivalent) for device/process discovery."
    };
  }
  const data = await probe.json().catch(() => ({}));
  const count = Array.isArray(data.resources) ? data.resources.length : 0;
  return {
    ok: true,
    message: `CrowdStrike authenticated (${base}). Device query OK (sample ${count}).`
  };
}

export async function validateDefender({ config, secrets }) {
  const tenantId = config.tenantId;
  const clientId = config.clientId;
  const clientSecret = secrets.clientSecret;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Defender requires tenantId, clientId, and clientSecret");
  }
  const token = await azureAppToken(
    tenantId,
    clientId,
    clientSecret,
    "https://api.securitycenter.microsoft.com/.default"
  );
  const res = await fetch("https://api.securitycenter.microsoft.com/api/machines?$top=1", {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok && res.status !== 403) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Defender API failed (${res.status})`);
  }
  if (res.status === 403) {
    return {
      ok: true,
      message: "Defender token OK. Grant Machine.Read.All (application) for endpoint discovery."
    };
  }
  const json = await res.json().catch(() => ({}));
  const n = Array.isArray(json.value) ? json.value.length : 0;
  return { ok: true, message: `Microsoft Defender for Endpoint authenticated. Sample machines: ${n}.` };
}

export async function validateIntune({ config, secrets }) {
  const tenantId = config.tenantId;
  const clientId = config.clientId;
  const clientSecret = secrets.clientSecret;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Intune requires tenantId, clientId, and clientSecret");
  }
  const token = await azureAppToken(tenantId, clientId, clientSecret, "https://graph.microsoft.com/.default");
  const res = await fetch("https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$top=1", {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok && res.status !== 403) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Intune/Graph failed (${res.status})`);
  }
  if (res.status === 403) {
    return {
      ok: true,
      message: "Intune token OK. Grant DeviceManagementManagedDevices.Read.All for discovery."
    };
  }
  const json = await res.json().catch(() => ({}));
  const n = Array.isArray(json.value) ? json.value.length : 0;
  return { ok: true, message: `Microsoft Intune authenticated. Sample managed devices: ${n}.` };
}

export async function validateCortex({ config, secrets }) {
  const fqdn = config.fqdn;
  const apiKeyId = config.apiKeyId;
  const apiKey = secrets.apiKey;
  const region = config.region || "us";
  if (!fqdn || !apiKeyId || !apiKey) throw new Error("Cortex requires fqdn, apiKeyId, and apiKey");

  const baseUrl = `https://api-${fqdn}.xdr.${region}.paloaltonetworks.com/public_api/v1`;
  const res = await fetch(`${baseUrl}/endpoints/get_endpoints/`, {
    method: "POST",
    headers: cortexAuthHeaders(apiKey, apiKeyId),
    body: JSON.stringify({
      request_data: {
        filters: [{ field: "endpoint_status", operator: "in", value: ["CONNECTED", "connected"] }],
        search_from: 0,
        search_to: 1
      }
    })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.reply?.err_msg || json.err_msg || `Cortex XDR failed (${res.status})`);
  }
  const endpoints = json.reply?.endpoints || json.reply || [];
  const n = Array.isArray(endpoints) ? endpoints.length : 0;
  return { ok: true, message: `Cortex XDR authenticated for tenant ${fqdn}. Sample endpoints: ${n}.` };
}

export async function validateNetskope({ config, secrets }) {
  const tenant = String(config.tenant || "")
    .replace(/^https?:\/\//, "")
    .replace(/\.goskope\.com.*$/, "")
    .replace(/\/$/, "");
  const token = secrets.apiToken;
  if (!tenant || !token) throw new Error("Netskope requires tenant (e.g. acme) and apiToken");

  const base = `https://${tenant}.goskope.com`;
  // Prefer v2 token header; fall back to v1 token query used by many tenants
  const v2 = await fetch(`${base}/api/v2/services/npa/publishers`, {
    headers: { "Netskope-Api-Token": token, Accept: "application/json" }
  });
  if (v2.ok) {
    return { ok: true, message: `Netskope authenticated to ${tenant}.goskope.com (API v2).` };
  }

  const v1 = await fetch(`${base}/api/v1/clients?token=${encodeURIComponent(token)}&limit=1`, {
    headers: { Accept: "application/json" }
  });
  const v1Json = await v1.json().catch(() => ({}));
  if (!v1.ok) {
    const msg =
      v1Json.errors?.[0] ||
      v1Json.message ||
      `Netskope API failed (v2=${v2.status}, v1=${v1.status}). Check tenant name and API token.`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return { ok: true, message: `Netskope authenticated to ${tenant}.goskope.com (API v1 clients).` };
}

export const EDR_VALIDATORS = {
  crowdstrike: validateCrowdstrike,
  defender: validateDefender,
  intune: validateIntune,
  cortex: validateCortex,
  netskope: validateNetskope
};

export const EDR_PROVIDERS = Object.keys(EDR_VALIDATORS);
