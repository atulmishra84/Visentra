import { pool } from "../db/postgres.js";
import { writeAudit } from "../services/audit.js";
import { publicErrorMessage } from "../utils/http.js";
import {
  getSsoSchema,
  listSsoProviders,
  listPublicSsoProviders,
  createSsoProvider,
  updateSsoProvider,
  deleteSsoProvider,
  testSsoProvider
} from "../services/ssoProviders.js";

export function schema(req, res) {
  res.json(getSsoSchema());
}

export async function list(req, res) {
  try {
    const providers = await listSsoProviders(pool, req.tenantId, { includeDisabled: true });
    const publicProviders = await listPublicSsoProviders(pool);
    res.json({ providers, publicProviders, schema: getSsoSchema() });
  } catch (err) {
    res.status(500).json({ error: { message: publicErrorMessage(err, "Unable to list SSO providers") } });
  }
}

export async function create(req, res) {
  try {
    const provider = await createSsoProvider(pool, req.tenantId, req.body || {});
    await writeAudit(pool, {
      tenantId: req.tenantId,
      actorId: req.user.sub,
      actorEmail: req.user.email,
      action: "sso.create",
      resourceType: "sso_provider",
      resourceId: provider.id,
      details: { preset: provider.preset, protocol: provider.protocol },
      ip: req.ip
    });
    res.status(201).json({ provider });
  } catch (err) {
    res.status(err.status || 500).json({ error: { message: publicErrorMessage(err, "Unable to create SSO provider") } });
  }
}

export async function update(req, res) {
  try {
    const provider = await updateSsoProvider(pool, req.tenantId, req.params.id, req.body || {});
    await writeAudit(pool, {
      tenantId: req.tenantId,
      actorId: req.user.sub,
      actorEmail: req.user.email,
      action: "sso.update",
      resourceType: "sso_provider",
      resourceId: provider.id,
      ip: req.ip
    });
    res.json({ provider });
  } catch (err) {
    res.status(err.status || 500).json({ error: { message: publicErrorMessage(err, "Unable to update SSO provider") } });
  }
}

export async function remove(req, res) {
  try {
    const result = await deleteSsoProvider(pool, req.tenantId, req.params.id);
    await writeAudit(pool, {
      tenantId: req.tenantId,
      actorId: req.user.sub,
      actorEmail: req.user.email,
      action: "sso.delete",
      resourceType: "sso_provider",
      resourceId: req.params.id,
      ip: req.ip
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: { message: publicErrorMessage(err, "Unable to delete SSO provider") } });
  }
}

export async function test(req, res) {
  try {
    const result = await testSsoProvider(pool, req.tenantId, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: { message: publicErrorMessage(err, "SSO provider test failed") } });
  }
}
