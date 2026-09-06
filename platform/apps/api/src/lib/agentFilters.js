export function agentFilters(query, startIdx = 2) {
  const clauses = [];
  const params = [];
  let i = startIdx;
  const map = {
    owner: "owner",
    model: "model",
    framework: "framework",
    cloud: "cloud_provider",
    department: "department",
    hostname: "hostname",
    language: "programming_language",
    repository: "repository",
    ide: "ide"
  };
  for (const [q, col] of Object.entries(map)) {
    if (query[q]) {
      clauses.push(`AND ${col} ILIKE $${i}`);
      params.push(`%${query[q]}%`);
      i += 1;
    }
  }
  // Inventory "Cloud" quick filter (surface=cloud) and legacy category=cloud must
  // include Azure Entra Agent ID / Copilot Studio rows stamped with cloud_provider
  // even when category is identity|saas (not literally "cloud").
  const surface = String(query.surface || "").toLowerCase();
  const category = String(query.category || "").toLowerCase();
  if (surface === "cloud" || (category === "cloud" && !query.surface)) {
    clauses.push(
      `AND (
         lower(COALESCE(category,'')) = 'cloud'
         OR (cloud_provider IS NOT NULL AND btrim(cloud_provider) <> '')
       )`
    );
  } else if (surface === "endpoint") {
    clauses.push(`AND lower(COALESCE(category,'')) IN ('endpoint','edr')`);
  } else if (query.category) {
    clauses.push(`AND category ILIKE $${i}`);
    params.push(`%${query.category}%`);
    i += 1;
  }
  if (query.q) {
    clauses.push(
      `AND (name ILIKE $${i} OR owner ILIKE $${i} OR hostname ILIKE $${i} OR model ILIKE $${i} OR framework ILIKE $${i} OR repository ILIKE $${i} OR category ILIKE $${i} OR provider ILIKE $${i} OR cloud_provider ILIKE $${i} OR device ILIKE $${i})`
    );
    params.push(`%${query.q}%`);
    i += 1;
  }
  if (query.risk) {
    clauses.push(`AND risk_indicators::text ILIKE $${i}`);
    params.push(`%${query.risk}%`);
    i += 1;
  }
  if (query.bu || query.business_unit) {
    clauses.push(`AND business_unit ILIKE $${i}`);
    params.push(`%${query.bu || query.business_unit}%`);
    i += 1;
  }
  if (query.tool) {
    clauses.push(`AND tools::text ILIKE $${i}`);
    params.push(`%${query.tool}%`);
    i += 1;
  }
  if (query.prompt) {
    clauses.push(`AND prompt_templates::text ILIKE $${i}`);
    params.push(`%${query.prompt}%`);
    i += 1;
  }
  if (query.shadow === "true" || query.shadow === true || query.shadowAi === "true") {
    clauses.push(
      `AND (
         risk_indicators::text ILIKE '%shadow%'
         OR risk_indicators::text ILIKE '%unmanaged%'
         OR metadata->>'shadowAi' = 'true'
         OR (owner IS NULL AND (
           category IN ('ide','local_llm','browser','saas','mcp','framework','autonomous')
           OR (category = 'cloud' AND (metadata->>'aiRelevant')::text = 'true')
         ))
       )`
    );
  }
  if (query.project) {
    clauses.push(`AND (repository ILIKE $${i} OR metadata::text ILIKE $${i})`);
    params.push(`%${query.project}%`);
    i += 1;
  }
  if (query.evidenceClass || query.evidence) {
    clauses.push(`AND metadata->>'evidenceClass' = $${i}`);
    params.push(String(query.evidenceClass || query.evidence));
    i += 1;
  }
  if (query.agentStatus || query.status) {
    clauses.push(`AND metadata->>'agentStatus' = $${i}`);
    params.push(String(query.agentStatus || query.status));
    i += 1;
  }
  if (query.access || query.canAccess) {
    clauses.push(`AND metadata->'agentAccess'->'granted' ? $${i}`);
    params.push(String(query.access || query.canAccess));
    i += 1;
  }
  if (query.accessSensitivity || query.sensitivity) {
    clauses.push(`AND metadata->>'accessSensitivity' = $${i}`);
    params.push(String(query.accessSensitivity || query.sensitivity));
    i += 1;
  }
  if (query.overPermissioned === "true" || query.overPermissioned === true) {
    clauses.push(`AND metadata->>'overPermissioned' = 'true'`);
  } else if (query.overPermissioned === "false" || query.overPermissioned === false) {
    clauses.push(`AND COALESCE(metadata->>'overPermissioned','false') <> 'true'`);
  }
  if (query.hasInstructions === "true" || query.hasInstructions === true) {
    clauses.push(`AND metadata->>'hasInstructions' = 'true'`);
  } else if (query.hasInstructions === "false" || query.hasInstructions === false) {
    clauses.push(`AND COALESCE(metadata->>'hasInstructions','false') <> 'true'`);
  }
  if (query.ownershipStatus === "owned") {
    clauses.push(`AND owner IS NOT NULL AND btrim(owner) <> ''`);
  } else if (query.ownershipStatus === "ownerless") {
    clauses.push(`AND (owner IS NULL OR btrim(owner)='')`);
  }
  if (query.dataClass || query.primaryDataClass) {
    const dc = String(query.dataClass || query.primaryDataClass).toLowerCase();
    clauses.push(
      `AND (
         LOWER(COALESCE(metadata->>'primaryDataClass','')) = $${i}
         OR LOWER(COALESCE(metadata->'dataAccessClassification'->>'primaryDataClass','')) = $${i}
         OR metadata->'dataClasses' @> to_jsonb(ARRAY[$${i}]::text[])
         OR metadata->'dataAccessClassification'->'dataClasses' @> to_jsonb(ARRAY[$${i}]::text[])
       )`
    );
    params.push(dc);
    i += 1;
  }
  if (query.hasPii === "true" || query.hasPii === true) {
    clauses.push(
      `AND (
         metadata->>'hasPii' = 'true'
         OR metadata->'dataAccessClassification'->>'hasPii' = 'true'
         OR LOWER(COALESCE(metadata->>'primaryDataClass','')) IN ('pii','phi')
         OR metadata->'dataClasses' @> '"pii"'::jsonb
         OR metadata->'dataClasses' @> '"phi"'::jsonb
         OR metadata->'dataAccessClassification'->'dataClasses' @> '"pii"'::jsonb
         OR metadata->'dataAccessClassification'->'dataClasses' @> '"phi"'::jsonb
       )`
    );
  }
  if (query.hasPhi === "true" || query.hasPhi === true) {
    clauses.push(
      `AND (
         metadata->>'hasPhi' = 'true'
         OR metadata->'dataAccessClassification'->>'hasPhi' = 'true'
         OR LOWER(COALESCE(metadata->>'primaryDataClass','')) = 'phi'
         OR metadata->'dataClasses' @> '"phi"'::jsonb
         OR metadata->'dataAccessClassification'->'dataClasses' @> '"phi"'::jsonb
       )`
    );
  }
  return { clauses: clauses.join(" "), params, nextIdx: i };
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}
