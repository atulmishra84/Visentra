/**
 * Append-only audit trail for connector/job/auth mutations.
 */

export async function writeAudit(pool, {
  tenantId,
  actorId = null,
  actorEmail = null,
  action,
  resourceType = null,
  resourceId = null,
  details = {},
  ip = null
}) {
  if (!pool || !tenantId || !action) return null;
  try {
    const res = await pool.query(
      `INSERT INTO audit_events (
         tenant_id, actor_id, actor_email, action, resource_type, resource_id, details, ip
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
       RETURNING id, created_at`,
      [
        tenantId,
        actorId,
        actorEmail,
        action,
        resourceType,
        resourceId,
        JSON.stringify(details || {}),
        ip
      ]
    );
    return res.rows[0];
  } catch (err) {
    console.warn("audit write failed:", err.message);
    return null;
  }
}

export async function listAuditEvents(pool, tenantId, { limit = 100 } = {}) {
  const res = await pool.query(
    `SELECT id, actor_id, actor_email, action, resource_type, resource_id, details, ip, created_at
     FROM audit_events
     WHERE tenant_id=$1
     ORDER BY created_at DESC
     LIMIT $2`,
    [tenantId, Math.min(Number(limit) || 100, 500)]
  );
  return res.rows;
}
