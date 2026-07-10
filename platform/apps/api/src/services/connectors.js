import { encryptJson, decryptJson, maskSecret } from "../utils/crypto.js";

export const PROVIDER_FIELDS = {
  azure: {
    category: "cloud",
    config: ["tenantId", "subscriptionId", "clientId"],
    secrets: ["clientSecret"],
    labels: {
      tenantId: "Azure AD Tenant ID",
      subscriptionId: "Subscription ID",
      clientId: "Application (client) ID",
      clientSecret: "Client secret"
    }
  },
  aws: {
    category: "cloud",
    config: ["accountId", "region", "accessKeyId"],
    secrets: ["secretAccessKey"],
    labels: {
      accountId: "AWS Account ID",
      region: "Default region",
      accessKeyId: "Access key ID",
      secretAccessKey: "Secret access key"
    }
  },
  gcp: {
    category: "cloud",
    config: ["projectId", "clientEmail"],
    secrets: ["privateKey"],
    labels: {
      projectId: "GCP Project ID",
      clientEmail: "Service account email",
      privateKey: "Service account private key"
    }
  },
  crowdstrike: {
    category: "edr",
    config: ["baseUrl", "clientId"],
    secrets: ["clientSecret"],
    labels: {
      baseUrl: "API base URL (e.g. https://api.crowdstrike.com)",
      clientId: "API client ID",
      clientSecret: "API client secret"
    }
  },
  defender: {
    category: "edr",
    config: ["tenantId", "clientId"],
    secrets: ["clientSecret"],
    labels: {
      tenantId: "Azure AD Tenant ID",
      clientId: "Application (client) ID",
      clientSecret: "Client secret"
    }
  },
  intune: {
    category: "edr",
    config: ["tenantId", "clientId"],
    secrets: ["clientSecret"],
    labels: {
      tenantId: "Azure AD Tenant ID",
      clientId: "Application (client) ID",
      clientSecret: "Client secret"
    }
  },
  cortex: {
    category: "edr",
    config: ["fqdn", "apiKeyId", "region"],
    secrets: ["apiKey"],
    labels: {
      fqdn: "Tenant FQDN prefix (e.g. acme)",
      apiKeyId: "API Key ID",
      region: "Region (us, eu, uk, …)",
      apiKey: "API Key"
    }
  },
  netskope: {
    category: "edr",
    config: ["tenant"],
    secrets: ["apiToken"],
    labels: {
      tenant: "Netskope tenant (e.g. acme for acme.goskope.com)",
      apiToken: "REST API token"
    }
  }
};

export const CLOUD_PROVIDERS = ["azure", "aws", "gcp"];
export const EDR_PROVIDERS = ["crowdstrike", "defender", "intune", "cortex", "netskope"];
export const ALL_PROVIDERS = [...CLOUD_PROVIDERS, ...EDR_PROVIDERS];

function publicConnector(row) {
  const cfg = row.config || {};
  const masked = {};
  for (const field of row.secret_fields || []) {
    masked[field] = "••••••••";
  }
  // Also mask sensitive-looking config keys in response
  const safeConfig = { ...cfg };
  if (safeConfig.accessKeyId) safeConfig.accessKeyId = maskSecret(safeConfig.accessKeyId) || safeConfig.accessKeyId;
  if (safeConfig.clientId) safeConfig.clientIdMasked = maskSecret(safeConfig.clientId);

  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    category: PROVIDER_FIELDS[row.provider]?.category || "cloud",
    status: row.status,
    environment: row.environment,
    config: safeConfig,
    secretFields: row.secret_fields || [],
    secretsConfigured: (row.secret_fields || []).length > 0,
    lastTestedAt: row.last_tested_at,
    lastError: row.last_error,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listConnectors(pool, tenantId) {
  const res = await pool.query(
    `SELECT * FROM connectors WHERE tenant_id=$1 ORDER BY provider, name`,
    [tenantId]
  );
  return res.rows.map(publicConnector);
}

export async function getConnector(pool, tenantId, id) {
  const res = await pool.query(`SELECT * FROM connectors WHERE tenant_id=$1 AND id=$2`, [tenantId, id]);
  return res.rows[0] ? publicConnector(res.rows[0]) : null;
}

export async function getConnectorSecrets(pool, tenantId, id) {
  const res = await pool.query(`SELECT * FROM connectors WHERE tenant_id=$1 AND id=$2`, [tenantId, id]);
  const row = res.rows[0];
  if (!row) return null;
  return {
    row,
    secrets: decryptJson(row.secrets_enc),
    config: row.config || {}
  };
}

export async function createConnector(pool, tenantId, body, actor) {
  const provider = String(body.provider || "").toLowerCase();
  if (!PROVIDER_FIELDS[provider]) {
    const err = new Error(`provider must be one of: ${ALL_PROVIDERS.join(", ")}`);
    err.status = 400;
    throw err;
  }
  const name = String(body.name || "").trim();
  if (!name) {
    const err = new Error("name is required");
    err.status = 400;
    throw err;
  }

  const schema = PROVIDER_FIELDS[provider];
  const config = {};
  for (const key of schema.config) {
    if (body.config?.[key] != null && body.config[key] !== "") config[key] = String(body.config[key]);
    else if (body[key] != null && body[key] !== "") config[key] = String(body[key]);
  }
  const secrets = {};
  for (const key of schema.secrets) {
    const val = body.secrets?.[key] ?? body[key];
    if (val != null && val !== "") secrets[key] = String(val);
  }
  if (!Object.keys(secrets).length) {
    const err = new Error(`At least one secret is required (${schema.secrets.join(", ")})`);
    err.status = 400;
    throw err;
  }

  const res = await pool.query(
    `INSERT INTO connectors (
       tenant_id, name, provider, status, environment, config, secrets_enc, secret_fields, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
     RETURNING *`,
    [
      tenantId,
      name,
      provider,
      body.status === "disabled" ? "disabled" : "active",
      body.environment || "production",
      JSON.stringify(config),
      encryptJson(secrets),
      Object.keys(secrets),
      actor || null
    ]
  );
  return publicConnector(res.rows[0]);
}

export async function updateConnector(pool, tenantId, id, body) {
  const existing = await pool.query(`SELECT * FROM connectors WHERE tenant_id=$1 AND id=$2`, [tenantId, id]);
  const row = existing.rows[0];
  if (!row) return null;

  const schema = PROVIDER_FIELDS[row.provider];
  const config = { ...(row.config || {}) };
  for (const key of schema.config) {
    if (body.config && Object.prototype.hasOwnProperty.call(body.config, key)) {
      if (body.config[key] === "" || body.config[key] == null) delete config[key];
      else config[key] = String(body.config[key]);
    } else if (Object.prototype.hasOwnProperty.call(body, key) && !schema.secrets.includes(key)) {
      if (body[key] === "" || body[key] == null) delete config[key];
      else config[key] = String(body[key]);
    }
  }

  let secrets = decryptJson(row.secrets_enc);
  let secretFields = [...(row.secret_fields || [])];
  let secretsChanged = false;
  for (const key of schema.secrets) {
    const val = body.secrets?.[key] ?? (schema.secrets.includes(key) ? body[key] : undefined);
    if (val != null && val !== "" && !String(val).startsWith("•")) {
      secrets[key] = String(val);
      if (!secretFields.includes(key)) secretFields.push(key);
      secretsChanged = true;
    }
  }

  const res = await pool.query(
    `UPDATE connectors SET
       name = COALESCE($3, name),
       status = COALESCE($4, status),
       environment = COALESCE($5, environment),
       config = $6::jsonb,
       secrets_enc = $7,
       secret_fields = $8,
       updated_at = NOW(),
       last_error = CASE WHEN $9 THEN NULL ELSE last_error END
     WHERE tenant_id=$1 AND id=$2
     RETURNING *`,
    [
      tenantId,
      id,
      body.name ? String(body.name).trim() : null,
      body.status && ["active", "disabled", "error"].includes(body.status) ? body.status : null,
      body.environment ? String(body.environment) : null,
      JSON.stringify(config),
      secretsChanged ? encryptJson(secrets) : row.secrets_enc,
      secretFields,
      secretsChanged
    ]
  );
  return publicConnector(res.rows[0]);
}

export async function deleteConnector(pool, tenantId, id) {
  const res = await pool.query(`DELETE FROM connectors WHERE tenant_id=$1 AND id=$2 RETURNING id`, [
    tenantId,
    id
  ]);
  return Boolean(res.rows[0]);
}

export async function testConnector(pool, tenantId, id) {
  const packed = await getConnectorSecrets(pool, tenantId, id);
  if (!packed) return null;

  const { row, secrets, config } = packed;
  let ok = false;
  let message = "";

  try {
    if (row.provider === "azure") {
      const { validateAzureConnector } = await import("../discovery/azureArm.js");
      const result = await validateAzureConnector({
        id: row.id,
        name: row.name,
        config,
        secrets
      });
      ok = result.ok;
      message = result.message;
    } else if (EDR_PROVIDERS.includes(row.provider)) {
      const { EDR_VALIDATORS } = await import("../discovery/edrIntegrations.js");
      const validator = EDR_VALIDATORS[row.provider];
      const result = await validator({ config, secrets });
      ok = result.ok;
      message = result.message;
    } else if (row.provider === "aws") {
      ok = Boolean(config.accessKeyId && secrets.secretAccessKey);
      message = ok
        ? "AWS credentials present. Live discovery adapter is limited in this release."
        : "Missing AWS accessKeyId or secretAccessKey.";
    } else if (row.provider === "gcp") {
      ok = Boolean(config.projectId && (config.clientEmail || secrets.privateKey));
      message = ok
        ? "GCP credentials present. Live discovery adapter is limited in this release."
        : "Missing GCP projectId or service account material.";
    }
  } catch (err) {
    ok = false;
    message = err.message;
  }

  await pool.query(
    `UPDATE connectors SET status=$3, last_tested_at=NOW(), last_error=$4, updated_at=NOW()
     WHERE tenant_id=$1 AND id=$2`,
    [tenantId, id, ok ? "active" : "error", ok ? null : message]
  );

  return { ok, message, connector: await getConnector(pool, tenantId, id) };
}

export async function listActiveCloudConnectors(pool, tenantId) {
  const res = await pool.query(
    `SELECT * FROM connectors
     WHERE tenant_id=$1
       AND provider = ANY($2::text[])
       AND status IN ('active', 'error')`,
    [tenantId, CLOUD_PROVIDERS]
  );
  return res.rows.map((row) => ({
    id: row.id,
    name: row.name,
    provider: row.provider,
    environment: row.environment,
    status: row.status,
    config: row.config || {},
    secrets: decryptJson(row.secrets_enc)
  }));
}

export async function listActiveEdrConnectors(pool, tenantId) {
  const res = await pool.query(
    `SELECT * FROM connectors
     WHERE tenant_id=$1
       AND provider = ANY($2::text[])
       AND status IN ('active', 'error')`,
    [tenantId, EDR_PROVIDERS]
  );
  return res.rows.map((row) => ({
    id: row.id,
    name: row.name,
    provider: row.provider,
    environment: row.environment,
    status: row.status,
    config: row.config || {},
    secrets: decryptJson(row.secrets_enc)
  }));
}
