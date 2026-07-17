/**
 * Core discovery depth — configuration, access/permissions, blast-radius,
 * and drift/change intelligence (visibility only; no runtime activity V2).
 */

import crypto from "crypto";
import {
  AGENT_PLANES,
  ENVIRONMENT_LANES,
  PLANE_LABELS,
  LANE_LABELS
} from "../meshConstants.js";

export { AGENT_PLANES, ENVIRONMENT_LANES, PLANE_LABELS, LANE_LABELS };

const ACCESS_KEYS = [
  "internet",
  "filesystem",
  "database",
  "github",
  "slack",
  "email",
  "calendar",
  "browser",
  "secrets",
  "identity",
  "sharepoint",
  "crm",
  "vectorStore",
  "mcp",
  "cloudAdmin"
];

function asList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [String(value)];
}

function uniq(list) {
  return [...new Set(list.filter(Boolean))];
}

/** Priority for primaryDataClass (higher = more sensitive). */
const DATA_CLASS_PRIORITY = {
  phi: 50,
  pii: 40,
  secrets: 30,
  financial: 20,
  none: 0,
  unknown: 0
};

const PII_PERMISSION_RE =
  /\b(mail\.read|mail\.readwrite|user\.read(\.all)?|contacts\.read|files\.read(\.all)?|chat\.read|people\.read|calendars\.read|directory\.read(\.all)?|sites\.read(\.all)?|mailboxsettings\.read)\b/i;
const PHI_PERMISSION_RE =
  /\b(fhir|ehr|hipaa|phi|health\.read|medical|patient|clinical|epic|cerner|healthcloud)\b/i;
const FINANCIAL_PERMISSION_RE =
  /\b(payroll|finance|banking|payment|invoice|stripe|quickbooks|sap\.?fi)\b/i;
const SECRETS_PERMISSION_RE =
  /\b(secrets?|keyvault|credential|api[_-]?key|password|token\.?read)\b/i;

const PII_KNOWLEDGE_RE =
  /\b(hr|payroll|employee|customer|contact|outlook|onedrive|sharepoint|crm|salesforce|workday|directory|pii|personal)\b/i;
const PHI_KNOWLEDGE_RE =
  /\b(patient|clinical|ehr|fhir|phi|hipaa|medical|health|epic|cerner|claims|diagnosis)\b/i;
const FINANCIAL_KNOWLEDGE_RE =
  /\b(finance|banking|payment|invoice|ledger|payroll|billing)\b/i;

const PII_APP_RE =
  /\b(salesforce|workday|dynamics|hubspot|zendesk|outlook|exchange|m365|microsoft 365|copilot|servicenow)\b/i;
const PHI_APP_RE = /\b(epic|cerner|athenahealth|healthcloud|fhir|ehr)\b/i;

const PII_SCOPES = new Set(["email", "crm", "sharepoint", "calendar"]);
const PHI_SCOPES = new Set(["phi", "healthcare", "ehr", "fhir"]);

function confidenceRank(c) {
  if (c === "high") return 3;
  if (c === "medium") return 2;
  if (c === "low") return 1;
  return 0;
}

function bumpConfidence(current, next) {
  return confidenceRank(next) > confidenceRank(current) ? next : current;
}

function pickPrimaryDataClass(classes) {
  let best = "none";
  let bestScore = -1;
  for (const c of classes) {
    const score = DATA_CLASS_PRIORITY[c] ?? 0;
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Classify sensitive data reach (PII/PHI/secrets/financial) from agentless signals.
 * Does not inspect prompts, responses, or file contents.
 */
export function buildDataAccessClassification(obs = {}, agentAccess = null, agentConfig = null) {
  const meta = obs.metadata && typeof obs.metadata === "object" ? obs.metadata : {};
  const existing =
    meta.dataAccessClassification && typeof meta.dataAccessClassification === "object"
      ? meta.dataAccessClassification
      : {};
  const access = agentAccess || buildAgentAccess(obs);
  const config = agentConfig || buildAgentConfig(obs);

  const classes = new Set();
  const evidence = [];
  let confidence = "low";

  // Explicit collector / seed overrides (strong)
  const explicitClasses = uniq([
    ...asList(existing.dataClasses),
    ...asList(meta.dataClasses),
    ...asList(meta.dataClass),
    meta.primaryDataClass,
    existing.primaryDataClass
  ]).map((c) => String(c).toLowerCase());
  for (const c of explicitClasses) {
    if (["pii", "phi", "secrets", "financial", "none", "unknown"].includes(c) && c !== "none" && c !== "unknown") {
      classes.add(c);
      evidence.push({
        source: "explicit",
        signal: c,
        detail: `Collector labeled data class: ${c}`
      });
      confidence = bumpConfidence(confidence, "high");
    }
  }

  const permissions = uniq([
    ...asList(access.permissions),
    ...asList(obs.permissions),
    ...asList(meta.permissions),
    ...asList(existing.permissions)
  ]);

  for (const perm of permissions) {
    const p = String(perm);
    if (PHI_PERMISSION_RE.test(p)) {
      classes.add("phi");
      evidence.push({ source: "entitlement", signal: p, detail: `PHI-related entitlement: ${p}` });
      confidence = bumpConfidence(confidence, "high");
    } else if (PII_PERMISSION_RE.test(p)) {
      classes.add("pii");
      evidence.push({ source: "entitlement", signal: p, detail: `PII-related entitlement: ${p}` });
      confidence = bumpConfidence(confidence, "high");
    }
    if (FINANCIAL_PERMISSION_RE.test(p)) {
      classes.add("financial");
      evidence.push({ source: "entitlement", signal: p, detail: `Financial entitlement: ${p}` });
      confidence = bumpConfidence(confidence, "medium");
    }
    if (SECRETS_PERMISSION_RE.test(p)) {
      classes.add("secrets");
      evidence.push({ source: "entitlement", signal: p, detail: `Secrets-related entitlement: ${p}` });
      confidence = bumpConfidence(confidence, "high");
    }
  }

  const granted = access.granted || [];
  for (const scope of granted) {
    if (PHI_SCOPES.has(scope) || PHI_PERMISSION_RE.test(scope)) {
      classes.add("phi");
      evidence.push({ source: "scope", signal: scope, detail: `Access scope indicates PHI: ${scope}` });
      confidence = bumpConfidence(confidence, "medium");
    } else if (PII_SCOPES.has(scope)) {
      classes.add("pii");
      evidence.push({ source: "scope", signal: scope, detail: `Access scope indicates PII: ${scope}` });
      confidence = bumpConfidence(confidence, "medium");
    }
    if (scope === "secrets" || scope === "cloudAdmin") {
      classes.add("secrets");
      evidence.push({ source: "scope", signal: scope, detail: `Access scope indicates secrets: ${scope}` });
      confidence = bumpConfidence(confidence, "high");
    }
  }

  const knowledge = uniq([
    ...asList(config.knowledgeSources),
    ...asList(access.dataStores),
    ...asList(config.vectorStores),
    ...asList(config.memoryStores)
  ]);
  for (const ks of knowledge) {
    const k = String(ks);
    if (PHI_KNOWLEDGE_RE.test(k)) {
      classes.add("phi");
      evidence.push({ source: "knowledge", signal: k, detail: `Knowledge/data store suggests PHI: ${k}` });
      confidence = bumpConfidence(confidence, "medium");
    } else if (PII_KNOWLEDGE_RE.test(k)) {
      classes.add("pii");
      evidence.push({ source: "knowledge", signal: k, detail: `Knowledge/data store suggests PII: ${k}` });
      confidence = bumpConfidence(confidence, "medium");
    }
    if (FINANCIAL_KNOWLEDGE_RE.test(k)) {
      classes.add("financial");
      evidence.push({ source: "knowledge", signal: k, detail: `Knowledge/data store suggests financial data: ${k}` });
      confidence = bumpConfidence(confidence, "medium");
    }
  }

  const appsAndTools = uniq([
    ...asList(access.connectedApps),
    ...asList(config.tools),
    ...asList(config.mcpServers),
    ...asList(config.channels),
    obs.provider,
    config.platform,
    obs.framework
  ]);
  for (const app of appsAndTools) {
    const a = String(app);
    if (PHI_APP_RE.test(a)) {
      classes.add("phi");
      evidence.push({ source: "app", signal: a, detail: `Connected app/tool suggests PHI: ${a}` });
      confidence = bumpConfidence(confidence, "low");
    } else if (PII_APP_RE.test(a)) {
      classes.add("pii");
      evidence.push({ source: "app", signal: a, detail: `Connected app/tool suggests PII: ${a}` });
      confidence = bumpConfidence(confidence, "low");
    }
  }

  // Dedupe evidence by signal+source
  const seenEv = new Set();
  const uniqueEvidence = [];
  for (const e of evidence) {
    const key = `${e.source}:${e.signal}`;
    if (seenEv.has(key)) continue;
    seenEv.add(key);
    uniqueEvidence.push(e);
  }

  let dataClasses = [...classes];
  if (!dataClasses.length) {
    dataClasses = explicitClasses.includes("unknown") ? ["unknown"] : ["none"];
    confidence = dataClasses[0] === "none" ? "low" : confidence;
  }

  // Prefer explicit primary when provided and still in set
  const explicitPrimary = existing.primaryDataClass || meta.primaryDataClass;
  const primaryDataClass =
    explicitPrimary && dataClasses.includes(String(explicitPrimary).toLowerCase())
      ? String(explicitPrimary).toLowerCase()
      : pickPrimaryDataClass(dataClasses);

  if (existing.confidence && confidenceRank(existing.confidence) > confidenceRank(confidence)) {
    confidence = existing.confidence;
  }
  if (meta.dataAccessConfidence && confidenceRank(meta.dataAccessConfidence) > confidenceRank(confidence)) {
    confidence = meta.dataAccessConfidence;
  }

  // Merge explicit evidence from collectors
  const priorEvidence = Array.isArray(existing.evidence)
    ? existing.evidence
    : Array.isArray(meta.dataAccessEvidence)
      ? meta.dataAccessEvidence
      : [];
  for (const e of priorEvidence) {
    if (!e || typeof e !== "object") continue;
    const key = `${e.source || "explicit"}:${e.signal || e.detail || ""}`;
    if (seenEv.has(key)) continue;
    seenEv.add(key);
    uniqueEvidence.push({
      source: e.source || "explicit",
      signal: e.signal || "",
      detail: e.detail || String(e.signal || "labeled")
    });
  }

  return {
    dataClasses,
    primaryDataClass,
    confidence,
    evidence: uniqueEvidence.slice(0, 25),
    hasPii: dataClasses.includes("pii") || dataClasses.includes("phi"),
    hasPhi: dataClasses.includes("phi")
  };
}

/**
 * Normalize agentConfig from observation fields + metadata.
 */
export function buildAgentConfig(obs = {}) {
  const meta = obs.metadata && typeof obs.metadata === "object" ? obs.metadata : {};
  const existing = meta.agentConfig && typeof meta.agentConfig === "object" ? meta.agentConfig : {};

  const tools = uniq([...asList(obs.tools), ...asList(existing.tools), ...asList(meta.tools)]);
  const mcpServers = uniq([
    ...asList(obs.mcp_connections),
    ...asList(existing.mcpServers),
    ...asList(meta.mcpConnections),
    ...asList(meta.mcpNames)
  ]);
  const knowledgeSources = uniq([
    ...asList(existing.knowledgeSources),
    ...asList(meta.knowledgeSources),
    ...asList(meta.knowledge),
    ...asList(meta.dataSources)
  ]);
  const triggers = uniq([...asList(existing.triggers), ...asList(meta.triggers), ...asList(meta.automations)]);
  const memoryStores = uniq(
    [obs.memory_store, meta.memoryStore, existing.memoryStore, ...(asList(existing.memoryStores) || [])].filter(Boolean)
  );
  const vectorStores = uniq(
    [obs.vector_database, meta.vectorDatabase, existing.vectorStore, ...(asList(existing.vectorStores) || [])].filter(
      Boolean
    )
  );
  const models = uniq([obs.model, meta.model, ...(asList(existing.models) || [])].filter(Boolean));
  const instructionsPresent =
    existing.instructionsPresent === true ||
    Boolean(meta.hasInstructions) ||
    Boolean(meta.instructions) ||
    asList(obs.prompt_templates).length > 0 ||
    asList(existing.promptTemplates).length > 0;

  const instructionSource =
    existing.instructionSource ||
    meta.instructionSource ||
    (asList(obs.prompt_templates).length ? "prompt_templates" : instructionsPresent ? "platform_config" : null);

  let instructionsHash = existing.instructionsHash || meta.instructionsHash || null;
  if (!instructionsHash && (meta.instructions || asList(obs.prompt_templates).length)) {
    const raw = String(meta.instructions || JSON.stringify(obs.prompt_templates));
    instructionsHash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
  }

  const howConfigured =
    existing.howConfigured ||
    meta.howConfigured ||
    meta.howIdentified ||
    meta.discoveryMode ||
    null;

  const channels = uniq([
    ...asList(existing.channels),
    ...asList(meta.channels),
    ...asList(extraChannels(meta))
  ]);
  const authMode =
    existing.authMode || meta.authMode || meta.authenticationMode || meta.authType || null;
  const platform = existing.platform || meta.platform || meta.platformLabel || obs.provider || null;

  return {
    tools,
    mcpServers,
    knowledgeSources,
    triggers,
    memoryStores,
    vectorStores,
    models,
    channels,
    authMode,
    platform,
    instructionsPresent,
    instructionsHash,
    instructionSource,
    howConfigured,
    framework: obs.framework || existing.framework || null,
    version: obs.version || existing.version || meta.version || null
  };
}

function extraChannels(meta) {
  if (!meta || typeof meta !== "object") return [];
  if (Array.isArray(meta.channel)) return meta.channel;
  return [];
}

/**
 * Normalize ownership / identity attribution for discovery visibility.
 */
export function buildOwnership(obs = {}) {
  const meta = obs.metadata && typeof obs.metadata === "object" ? obs.metadata : {};
  const existing = meta.ownership && typeof meta.ownership === "object" ? meta.ownership : {};
  const owner = obs.owner || existing.owner || meta.owner || null;
  const identityUsed = obs.identity_used || existing.identityUsed || meta.identityUsed || null;
  const identities = uniq([
    identityUsed,
    owner,
    ...(asList(existing.identities) || []),
    ...(asList(meta.identities) || []),
    ...(asList(meta.owners) || [])
  ]);
  const team =
    obs.department ||
    obs.business_unit ||
    existing.team ||
    meta.team ||
    meta.department ||
    meta.businessUnit ||
    null;
  const identityProvider =
    existing.identityProvider ||
    meta.identityProvider ||
    (meta.tenantId ? "entra" : null) ||
    (String(obs.provider || "").includes("entra") ? "entra" : null);
  const ownershipStatus = owner && String(owner).trim() ? "owned" : "ownerless";

  return {
    owner: owner ? String(owner) : null,
    previousOwner: existing.previousOwner || meta.previousOwner || null,
    identities,
    identityUsed: identityUsed ? String(identityUsed) : null,
    team: team ? String(team) : null,
    department: obs.department || meta.department || null,
    businessUnit: obs.business_unit || meta.businessUnit || null,
    identityProvider,
    ownershipStatus,
    objectId: meta.objectId || existing.objectId || null,
    appId: meta.appId || existing.appId || null,
    tenantId: meta.tenantId || existing.tenantId || null
  };
}

/**
 * Normalize agentAccess / permissions map from observation booleans + metadata.
 */
export function buildAgentAccess(obs = {}) {
  const meta = obs.metadata && typeof obs.metadata === "object" ? obs.metadata : {};
  const existing = meta.agentAccess && typeof meta.agentAccess === "object" ? meta.agentAccess : {};
  const scopes = {};

  const set = (key, value) => {
    if (value === true || value === "true") scopes[key] = true;
    else if (value === false || value === "false") scopes[key] = false;
  };

  set("internet", obs.internet_access ?? existing.scopes?.internet ?? meta.internetAccess);
  set("filesystem", obs.filesystem_access ?? existing.scopes?.filesystem ?? meta.filesystemAccess);
  set("database", obs.database_access ?? existing.scopes?.database ?? meta.databaseAccess);
  set("github", obs.github_access ?? existing.scopes?.github ?? meta.githubAccess);
  set("slack", obs.slack_access ?? existing.scopes?.slack ?? meta.slackAccess);
  set("email", obs.email_access ?? existing.scopes?.email ?? meta.emailAccess);
  set("calendar", obs.calendar_access ?? existing.scopes?.calendar ?? meta.calendarAccess);
  set("browser", obs.browser_access ?? existing.scopes?.browser ?? meta.browserAccess);
  set("secrets", obs.secrets_detected || obs.api_keys_detected || existing.scopes?.secrets);
  set("identity", Boolean(obs.identity_used || meta.identityUsed || existing.scopes?.identity));
  set("mcp", asList(obs.mcp_connections).length > 0 || existing.scopes?.mcp);
  set("vectorStore", Boolean(obs.vector_database || existing.scopes?.vectorStore));
  set("sharepoint", existing.scopes?.sharepoint ?? meta.sharepointAccess);
  set("crm", existing.scopes?.crm ?? meta.crmAccess);
  set("cloudAdmin", existing.scopes?.cloudAdmin ?? meta.cloudAdmin);

  // Merge any explicit scopes from collectors
  const explicitScopes = {
    ...(meta.scopes && typeof meta.scopes === "object" ? meta.scopes : {}),
    ...(existing.scopes && typeof existing.scopes === "object" ? existing.scopes : {})
  };
  for (const [k, v] of Object.entries(explicitScopes)) {
    if (ACCESS_KEYS.includes(k) || typeof v === "boolean") set(k, v);
  }

  const granted = Object.entries(scopes)
    .filter(([, v]) => v === true)
    .map(([k]) => k);

  const identities = uniq([
    obs.identity_used,
    meta.identityUsed,
    ...(asList(existing.identities) || []),
    ...(asList(meta.identities) || [])
  ]);

  const dataStores = uniq([
    obs.vector_database,
    obs.memory_store,
    ...(asList(existing.dataStores) || []),
    ...(asList(meta.dataStores) || [])
  ]);

  const connectedApps = uniq([
    ...asList(obs.connected_applications),
    ...asList(existing.connectedApps),
    ...asList(meta.connectedApps)
  ]);

  const permissions = uniq([...asList(obs.permissions), ...asList(existing.permissions), ...asList(meta.permissions)]);

  const sensitivity =
    existing.sensitivity ||
    (granted.includes("secrets") || granted.includes("cloudAdmin")
      ? "high"
      : granted.includes("database") || granted.includes("crm") || granted.includes("sharepoint")
        ? "medium"
        : granted.length
          ? "low"
          : "unknown");

  return {
    scopes,
    granted,
    grantCount: granted.length,
    identities,
    dataStores,
    connectedApps,
    permissions,
    sensitivity,
    overPermissioned:
      existing.overPermissioned === true ||
      (granted.length >= 5 && (!obs.owner || String(obs.owner).trim() === "")) ||
      (granted.includes("secrets") && granted.includes("internet"))
  };
}

/** True when agent/metadata carries shadow or unmanaged signals. */
export function isShadowSignal(rowOrObs = {}, meta = {}) {
  const m =
    meta && typeof meta === "object"
      ? meta
      : rowOrObs.metadata && typeof rowOrObs.metadata === "object"
        ? rowOrObs.metadata
        : {};
  if (m.shadowAi === true) return true;
  if (m.mesh && m.mesh.shadowOverlay === true) return true;
  const indicators = rowOrObs.risk_indicators || m.risk_indicators;
  return Array.isArray(indicators) && indicators.some((x) => /shadow|unmanaged/i.test(String(x)));
}

function textBlob(obs = {}, meta = {}) {
  return [
    obs.name,
    obs.category,
    obs.deployment_type,
    obs.framework,
    obs.provider,
    obs.cloud_provider,
    obs.container,
    obs.hostname,
    obs.ide,
    meta.environment,
    meta.env,
    meta.stage,
    meta.inventoryClass,
    meta.platform,
    meta.platformLabel,
    ...(asList(meta.tags) || [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Normalize deployment plane + environment lane for Global Agent Mesh.
 * Shadow AI is an overlay, not a plane.
 */
export function buildAgentMeshPlacement(obs = {}) {
  const meta = obs.metadata && typeof obs.metadata === "object" ? obs.metadata : {};
  const existing = meta.mesh && typeof meta.mesh === "object" ? meta.mesh : {};
  const blob = textBlob(obs, meta);
  const category = String(obs.category || meta.inventoryClass || "").toLowerCase();
  const deployment = String(obs.deployment_type || meta.deploymentType || "").toLowerCase();

  let agentPlane =
    existing.agentPlane ||
    meta.agentPlane ||
    null;

  if (!agentPlane) {
    if (
      /saas|browser/.test(category) ||
      deployment === "saas" ||
      /m365|copilot|salesforce|workday|servicenow|slack|chatgpt|openai enterprise/.test(blob)
    ) {
      agentPlane = "saas_third_party";
    } else if (
      /ide|local_llm|browser/.test(category) ||
      /ide|local|desktop/.test(deployment) ||
      Boolean(obs.ide) ||
      /cursor|ollama|laptop|endpoint|edr/.test(blob)
    ) {
      agentPlane = "endpoint";
    } else if (
      /serverless|function|lambda|cloud.run|bedrock agent/.test(blob) ||
      deployment === "serverless"
    ) {
      agentPlane = "serverless";
    } else if (
      /container|k8s|kubernetes|eks|aks|gke|pod|docker/.test(blob) ||
      deployment === "container" ||
      Boolean(obs.container) ||
      category === "cloud" ||
      category === "framework" ||
      category === "autonomous" ||
      category === "mcp"
    ) {
      agentPlane = "containerized";
    } else {
      agentPlane = "endpoint";
    }
  }

  if (!AGENT_PLANES.includes(agentPlane)) agentPlane = "endpoint";

  let environmentLane = existing.environmentLane || meta.environmentLane || null;
  const envHint = String(meta.environment || meta.env || meta.stage || obs.environment || "").toLowerCase();

  if (!environmentLane) {
    if (/stag|uat|preprod|pre-prod|qa/.test(envHint) || /stag|uat|preprod/.test(blob)) {
      environmentLane = "staging";
    } else if (/dev|develop|sandbox|test/.test(envHint) || (/dev|sandbox/.test(blob) && !/prod/.test(envHint))) {
      environmentLane = "development";
    } else if (agentPlane === "saas_third_party") {
      environmentLane = "saas";
    } else if (agentPlane === "endpoint") {
      // IDE/local workspace → development; device edge → endpoints
      environmentLane = /ide|cursor|workspace|repo_candidate|agents\.md/.test(blob) || category === "ide"
        ? "development"
        : "endpoints";
    } else if (/prod|production|live/.test(envHint) || /prod|production/.test(blob)) {
      environmentLane = "production";
    } else if (category === "cloud" || category === "framework" || category === "autonomous" || category === "mcp") {
      environmentLane = "production";
    } else {
      environmentLane = "production";
    }
  }

  if (!ENVIRONMENT_LANES.includes(environmentLane)) environmentLane = "production";

  const confidence =
    existing.confidence ||
    meta.meshConfidence ||
    (meta.agentPlane && meta.environmentLane ? "high" : envHint ? "medium" : "low");

  return {
    agentPlane,
    environmentLane,
    planeLabel: PLANE_LABELS[agentPlane] || agentPlane,
    laneLabel: LANE_LABELS[environmentLane] || environmentLane,
    confidence,
    shadowOverlay: isShadowSignal(obs, meta)
  };
}

/**
 * Aggregate Global Agent Mesh matrix for a tenant.
 */
function meshNodeStatus(row, meta, isShadow, dac, depth) {
  const running = String(row.running_status || meta.runningStatus || "").toLowerCase();
  const sensitivity = depth.agentAccess?.sensitivity || meta.accessSensitivity;
  const flagged =
    isShadow ||
    meta.overPermissioned === true ||
    depth.agentAccess?.overPermissioned === true ||
    dac.hasPhi ||
    meta.hasPhi ||
    sensitivity === "high" ||
    (Array.isArray(row.risk_indicators) &&
      row.risk_indicators.some((x) => /critical|high|flagged|over.?permission/i.test(String(x))));
  if (isShadow) return "shadow";
  if (flagged) return "flagged";
  if (running === "stopped" || running === "unknown" || running === "idle") return "inactive";
  return "active";
}

function meshCategoryLabel(row, meta) {
  return (
    row.department ||
    meta.team ||
    meta.function ||
    row.business_unit ||
    row.category ||
    meta.inventoryClass ||
    "General"
  );
}

export async function computeAgentMesh(pool, tenantId, { shadowOnly = false } = {}) {
  const result = await pool.query(`SELECT * FROM agents WHERE tenant_id=$1`, [tenantId]);
  const planes = AGENT_PLANES.map((id) => ({ id, label: PLANE_LABELS[id] }));
  const lanes = ENVIRONMENT_LANES.map((id) => ({ id, label: LANE_LABELS[id] }));
  // Aggregate counts only — constellation nodes live on clusters (avoid dual agent lists).
  const cells = {};
  for (const p of AGENT_PLANES) {
    cells[p] = {};
    for (const l of ENVIRONMENT_LANES) {
      cells[p][l] = { count: 0, shadowCount: 0, piiCount: 0, phiCount: 0, flaggedCount: 0 };
    }
  }

  let total = 0;
  let shadowTotal = 0;
  let flaggedTotal = 0;
  const planeTotals = Object.fromEntries(AGENT_PLANES.map((p) => [p, 0]));
  const laneTotals = Object.fromEntries(ENVIRONMENT_LANES.map((l) => [l, 0]));
  const clusterBuckets = Object.fromEntries(
    ENVIRONMENT_LANES.map((l) => [
      l,
      {
        lane: l,
        label: LANE_LABELS[l],
        agents: [],
        categories: new Map(),
        count: 0,
        flaggedCount: 0,
        shadowCount: 0,
        deviceCount: 0
      }
    ])
  );

  for (const row of result.rows) {
    const depth = summarizeAgentDepth(row);
    const mesh = depth.mesh || buildAgentMeshPlacement({ ...row, metadata: row.metadata || {} });
    const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const isShadow = Boolean(mesh.shadowOverlay) || isShadowSignal(row, meta);
    if (shadowOnly && !isShadow) continue;

    const plane = AGENT_PLANES.includes(mesh.agentPlane) ? mesh.agentPlane : "endpoint";
    const lane = ENVIRONMENT_LANES.includes(mesh.environmentLane) ? mesh.environmentLane : "production";
    const cell = cells[plane][lane];
    const dac = depth.dataAccessClassification || {};
    const status = meshNodeStatus(row, meta, isShadow, dac, depth);
    const category = String(meshCategoryLabel(row, meta));
    const node = {
      id: row.id,
      name: row.name,
      owner: row.owner,
      category,
      plane,
      lane,
      status,
      kind: lane === "endpoints" ? "device" : "agent",
      shadow: isShadow,
      flagged: status === "flagged",
      primaryDataClass: meta.primaryDataClass || dac.primaryDataClass || "none",
      model: row.model || null,
      framework: row.framework || null,
      href: `/agents/${row.id}`,
      relationshipsHref: `/relationships?agentId=${row.id}`
    };

    cell.count += 1;
    if (isShadow) {
      cell.shadowCount += 1;
      shadowTotal += 1;
    }
    if (status === "flagged" || status === "shadow") {
      cell.flaggedCount += 1;
      flaggedTotal += 1;
    }
    if (dac.hasPii || meta.hasPii) cell.piiCount += 1;
    if (dac.hasPhi || meta.hasPhi) cell.phiCount += 1;

    const bucket = clusterBuckets[lane];
    bucket.count += 1;
    if (isShadow) bucket.shadowCount += 1;
    if (status === "flagged" || status === "shadow") bucket.flaggedCount += 1;
    if (node.kind === "device") bucket.deviceCount += 1;
    if (bucket.agents.length < 48) bucket.agents.push(node);
    bucket.categories.set(category, (bucket.categories.get(category) || 0) + 1);

    total += 1;
    planeTotals[plane] += 1;
    laneTotals[lane] += 1;
  }

  const matrix = planes.map((plane) => ({
    plane: plane.id,
    label: plane.label,
    cells: lanes.map((lane) => ({
      lane: lane.id,
      label: lane.label,
      ...cells[plane.id][lane.id],
      href: `/inventory?agentPlane=${plane.id}&environmentLane=${lane.id}${shadowOnly ? "&shadow=true" : ""}`
    }))
  }));

  const clusters = ENVIRONMENT_LANES.map((laneId) => {
    const bucket = clusterBuckets[laneId];
    const categories = [...bucket.categories.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));
    return {
      lane: bucket.lane,
      label: bucket.label,
      count: bucket.count,
      flaggedCount: bucket.flaggedCount,
      shadowCount: bucket.shadowCount,
      deviceCount: bucket.deviceCount,
      categories,
      nodes: bucket.agents,
      href: `/inventory?environmentLane=${laneId}${shadowOnly ? "&shadow=true" : ""}`
    };
  }).filter((c) => c.count > 0 || c.lane === "production" || c.lane === "saas");

  return {
    planes,
    lanes,
    matrix,
    clusters,
    totals: {
      agents: total,
      shadow: shadowTotal,
      flagged: flaggedTotal,
      byPlane: planeTotals,
      byLane: laneTotals
    },
    shadowOnly: Boolean(shadowOnly),
    generatedAt: new Date().toISOString()
  };
}

/**
 * Flatten depth objects onto metadata for list/detail API consumers.
 */
export function flattenDepthMetadata(meta = {}, depth = {}) {
  const agentConfig = depth.agentConfig || meta.agentConfig || {};
  const agentAccess = depth.agentAccess || meta.agentAccess || {};
  const ownership = depth.ownership || meta.ownership || {};
  const dac = depth.dataAccessClassification || meta.dataAccessClassification || {};
  const mesh = depth.mesh || meta.mesh || {};
  return {
    ...meta,
    agentConfig: meta.agentConfig || depth.agentConfig,
    agentAccess: meta.agentAccess || depth.agentAccess,
    ownership: meta.ownership || depth.ownership,
    dataAccessClassification: meta.dataAccessClassification || depth.dataAccessClassification,
    mesh: meta.mesh || depth.mesh,
    howIdentified: meta.howIdentified || depth.howIdentified || null,
    evidenceClass: meta.evidenceClass || depth.evidenceClass || null,
    agentStatus: meta.agentStatus || depth.agentStatus || null,
    accessGrantCount: meta.accessGrantCount ?? agentAccess.grantCount,
    accessSensitivity: meta.accessSensitivity || agentAccess.sensitivity,
    ownershipStatus: meta.ownershipStatus || ownership.ownershipStatus,
    configToolCount: meta.configToolCount ?? (agentConfig.tools || []).length,
    configMcpCount: meta.configMcpCount ?? (agentConfig.mcpServers || []).length,
    hasInstructions: meta.hasInstructions ?? agentConfig.instructionsPresent,
    overPermissioned: meta.overPermissioned ?? agentAccess.overPermissioned,
    identityCount: meta.identityCount ?? (ownership.identities || []).length,
    authMode: meta.authMode || agentConfig.authMode,
    channels: meta.channels || agentConfig.channels,
    primaryDataClass: meta.primaryDataClass || dac.primaryDataClass || "none",
    dataClasses: meta.dataClasses || dac.dataClasses || ["none"],
    dataAccessConfidence: meta.dataAccessConfidence || dac.confidence || "low",
    hasPii: meta.hasPii ?? dac.hasPii ?? false,
    hasPhi: meta.hasPhi ?? dac.hasPhi ?? false,
    agentPlane: meta.agentPlane || mesh.agentPlane || null,
    environmentLane: meta.environmentLane || mesh.environmentLane || null,
    meshConfidence: meta.meshConfidence || mesh.confidence || "low"
  };
}

/**
 * Enrich observation with normalized agentConfig + agentAccess before ingest.
 */
export function enrichObservationWithDepth(obs) {
  const agentConfig = buildAgentConfig(obs);
  const agentAccess = buildAgentAccess(obs);
  const ownership = buildOwnership(obs);
  const dataAccessClassification = buildDataAccessClassification(obs, agentAccess, agentConfig);
  const mesh = buildAgentMeshPlacement(obs);
  const howIdentified =
    (obs.metadata && obs.metadata.howIdentified) ||
    agentConfig.howConfigured ||
    `${obs.collector_id || "collector"}:${(obs.metadata && obs.metadata.evidenceClass) || "unknown"}`;

  const depth = {
    agentConfig,
    agentAccess,
    ownership,
    dataAccessClassification,
    mesh,
    howIdentified
  };

  return {
    ...obs,
    metadata: flattenDepthMetadata(obs.metadata || {}, depth)
  };
}

/**
 * Summaries for API detail responses.
 */
export function summarizeAgentDepth(agent) {
  const meta = agent.metadata && typeof agent.metadata === "object" ? agent.metadata : {};
  const agentConfig = meta.agentConfig || buildAgentConfig({ ...agent, metadata: meta });
  const agentAccess = meta.agentAccess || buildAgentAccess({ ...agent, metadata: meta });
  const ownership = meta.ownership || buildOwnership({ ...agent, metadata: meta });
  const dataAccessClassification =
    meta.dataAccessClassification ||
    buildDataAccessClassification({ ...agent, metadata: meta }, agentAccess, agentConfig);
  const mesh =
    meta.mesh ||
    buildAgentMeshPlacement({
      ...agent,
      metadata: {
        ...meta,
        agentPlane: meta.agentPlane,
        environmentLane: meta.environmentLane
      }
    });
  return {
    agentConfig,
    agentAccess,
    ownership,
    dataAccessClassification,
    mesh,
    howIdentified: meta.howIdentified || null,
    evidenceClass: meta.evidenceClass || null,
    agentStatus: meta.agentStatus || null,
    evidenceReason: meta.evidenceReason || null
  };
}

/** Attach depth summaries to an agent row for list APIs. */
export function enrichAgentRow(row) {
  const depth = summarizeAgentDepth(row);
  const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return {
    ...row,
    metadata: flattenDepthMetadata(meta, depth),
    ...depth
  };
}

/**
 * Blast-radius / attack-path scoring from SQL relationships + access metadata.
 */
export async function computeBlastRadius(pool, tenantId, { agentId = null, limit = 25 } = {}) {
  const params = [tenantId];
  let agentClause = "";
  if (agentId) {
    params.push(agentId);
    agentClause = ` AND a.id = $${params.length}`;
  }

  const agents = await pool.query(
    `SELECT a.*,
            (SELECT COUNT(*)::int FROM relationships r WHERE r.tenant_id=a.tenant_id AND r.from_id=a.id) AS edge_count
     FROM agents a
     WHERE a.tenant_id=$1 ${agentClause}
     ORDER BY a.last_seen DESC
     LIMIT ${agentId ? 1 : 500}`,
    params
  );

  const scored = [];
  for (const agent of agents.rows) {
    const depth = summarizeAgentDepth(agent);
    const rels = await pool.query(
      `SELECT r.rel_type, s.asset_type, s.name, s.external_key, s.attributes
       FROM relationships r
       JOIN assets s ON s.id = r.to_id
       WHERE r.tenant_id=$1 AND r.from_id=$2
       LIMIT 100`,
      [tenantId, agent.id]
    );

    const paths = rels.rows.map((r) => ({
      relType: r.rel_type,
      toType: r.asset_type,
      toName: r.name,
      toKey: r.external_key,
      riskHint: riskHintForTarget(r.asset_type, r.rel_type, depth.agentAccess)
    }));

    const accessScore = Math.min(40, (depth.agentAccess.grantCount || 0) * 6);
    const edgeScore = Math.min(25, (agent.edge_count || 0) * 3);
    const sensitivityScore =
      depth.agentAccess.sensitivity === "high" ? 20 : depth.agentAccess.sensitivity === "medium" ? 12 : 4;
    const dac = depth.dataAccessClassification || {};
    const dataClassScore =
      dac.primaryDataClass === "phi" ? 18 : dac.primaryDataClass === "pii" ? 12 : dac.primaryDataClass === "secrets" ? 10 : 0;
    const shadowScore = isShadowSignal(agent) ? 15 : 0;
    const ownerlessScore = !agent.owner || !String(agent.owner).trim() ? 10 : 0;
    const internetExternal =
      depth.agentAccess.scopes?.internet && paths.some((p) => /ExternalService|API|SaaS/i.test(p.toType)) ? 10 : 0;

    const score = Math.min(
      100,
      accessScore + edgeScore + sensitivityScore + dataClassScore + shadowScore + ownerlessScore + internetExternal
    );

    const reasons = [];
    if (depth.agentAccess.grantCount) reasons.push(`${depth.agentAccess.grantCount} access scopes`);
    if (depth.agentAccess.sensitivity === "high") reasons.push("high-sensitivity access");
    if (dac.hasPhi) reasons.push("PHI data access");
    else if (dac.hasPii) reasons.push("PII data access");
    if (ownerlessScore) reasons.push("ownerless");
    if (shadowScore) reasons.push("shadow/unmanaged");
    if (agent.edge_count) reasons.push(`${agent.edge_count} graph edges`);
    if (internetExternal) reasons.push("internet + external service path");

    scored.push({
      agentId: agent.id,
      name: agent.name,
      category: agent.category,
      owner: agent.owner,
      score,
      tier: score >= 70 ? "critical" : score >= 45 ? "elevated" : score >= 25 ? "moderate" : "low",
      reasons,
      paths,
      pathCount: paths.length,
      access: depth.agentAccess,
      config: {
        toolCount: depth.agentConfig.tools.length,
        mcpCount: depth.agentConfig.mcpServers.length,
        instructionsPresent: depth.agentConfig.instructionsPresent
      },
      href: `/agents/${agent.id}`
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return {
    items: scored.slice(0, limit),
    total: scored.length,
    generatedAt: new Date().toISOString()
  };
}

function riskHintForTarget(assetType, relType, access) {
  const t = String(assetType || "");
  if (/Database|Vector/i.test(t)) return "data_store";
  if (/ExternalService|API|SaaS/i.test(t)) return "external";
  if (/MCPServer|Tool/i.test(t)) return "tooling";
  if (/CloudResource|Container|Cluster/i.test(t)) return "infrastructure";
  if (/Repository/i.test(t)) return "source";
  if (/Identity|Developer/i.test(t)) return "identity";
  if (access?.scopes?.secrets) return "secrets_adjacent";
  return relType ? String(relType).toLowerCase() : "related";
}

function anatomyNode(id, label, kind, detail = null, href = null) {
  return {
    id: String(id),
    label: String(label || id),
    kind: String(kind || "item"),
    detail: detail ? String(detail) : null,
    href: href || null
  };
}

function dedupeAnatomyNodes(nodes) {
  const seen = new Set();
  const out = [];
  for (const node of nodes) {
    const key = String(node.label || node.id)
      .toLowerCase()
      .trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(node);
  }
  return out;
}

function inferModelProvider(model, provider) {
  const blob = `${model || ""} ${provider || ""}`.toLowerCase();
  if (/azure/.test(blob)) return "azure";
  if (/anthropic|claude/.test(blob)) return "anthropic";
  if (/openai|gpt|chatgpt/.test(blob)) return "openai";
  if (/gemini|google/.test(blob)) return "google";
  if (/bedrock|amazon|aws/.test(blob)) return "aws";
  if (/ollama|llama|mistral/.test(blob)) return "local";
  if (/copilot|microsoft/.test(blob)) return "microsoft";
  if (provider) return String(provider).toLowerCase();
  return "llm";
}

/**
 * Build agent relationship anatomy: center agent+LLM with satellite groups
 * (users/inputs, channels, actions, data) plus inherent risk profiling.
 */
export function buildAgentAnatomy(agent, relationships = [], blast = null) {
  const depth = summarizeAgentDepth(agent);
  const meta = agent.metadata && typeof agent.metadata === "object" ? agent.metadata : {};
  const config = depth.agentConfig || {};
  const access = depth.agentAccess || {};
  const ownership = depth.ownership || {};
  const dac = depth.dataAccessClassification || {};
  const shadow = isShadowSignal(agent, meta);

  const modelName =
    (Array.isArray(config.models) && config.models[0]) ||
    agent.model ||
    meta.model ||
    null;
  const provider = agent.provider || meta.provider || null;
  const modelProvider = inferModelProvider(modelName, provider);

  const usersInputs = [];
  if (agent.owner) {
    usersInputs.push(anatomyNode(`owner:${agent.owner}`, agent.owner, "owner", "Owner"));
  }
  for (const id of asList(ownership.identities).concat(asList(access.identities))) {
    usersInputs.push(anatomyNode(`identity:${id}`, id, "identity", "Identity / principal"));
  }
  for (const trigger of asList(config.triggers)) {
    usersInputs.push(anatomyNode(`trigger:${trigger}`, trigger, "input", "Trigger / input"));
  }

  const channels = [];
  for (const ch of asList(config.channels).concat(asList(meta.channels))) {
    channels.push(anatomyNode(`channel:${ch}`, ch, "channel", "Communication channel"));
  }

  const actions = [];
  for (const tool of asList(config.tools)) {
    actions.push(anatomyNode(`tool:${tool}`, tool, "action", "Tool / capability"));
  }
  for (const mcp of asList(config.mcpServers)) {
    actions.push(anatomyNode(`mcp:${mcp}`, mcp, "mcp", "MCP server"));
  }

  const data = [];
  for (const store of asList(access.dataStores)) {
    data.push(anatomyNode(`store:${store}`, store, "data", "Data store"));
  }
  for (const ks of asList(config.knowledgeSources)) {
    data.push(anatomyNode(`knowledge:${ks}`, ks, "knowledge", "Knowledge source"));
  }
  for (const vs of asList(config.vectorStores)) {
    data.push(anatomyNode(`vector:${vs}`, vs, "vector", "Vector store"));
  }
  for (const ms of asList(config.memoryStores)) {
    data.push(anatomyNode(`memory:${ms}`, ms, "memory", "Memory store"));
  }
  for (const cls of asList(dac.dataClasses || meta.dataClasses)) {
    if (cls && cls !== "none") {
      data.push(anatomyNode(`class:${cls}`, String(cls).toUpperCase(), "data_class", "Data classification"));
    }
  }

  for (const rel of relationships || []) {
    const relType = String(rel.rel_type || rel.relType || "").toUpperCase();
    const toType = String(rel.asset_type || rel.toType || rel.to_type || "");
    const toName = rel.to_name || rel.toName || rel.name || rel.external_key || rel.toKey || "related";
    const nodeId = rel.to_id || rel.toId || `${relType}:${toName}`;

    if (/OWNS|USES_IDENTITY/.test(relType) || /Developer|Identity|ServicePrincipal|User/i.test(toType)) {
      usersInputs.push(anatomyNode(nodeId, toName, /identity|serviceprincipal/i.test(toType) ? "identity" : "user", relType || toType));
    } else if (/USES_TOOL|EXPOSES_TOOL|CONNECTS_MCP/.test(relType) || /Tool|MCP/i.test(toType)) {
      actions.push(anatomyNode(nodeId, toName, /mcp/i.test(toType) ? "mcp" : "action", relType || toType));
    } else if (
      /ACCESSES|READS|WRITES/.test(relType) ||
      /Database|Vector|Knowledge|SharePoint|File|Data/i.test(toType)
    ) {
      data.push(anatomyNode(nodeId, toName, "data", relType || toType));
    } else if (/ExternalService|SaaS|Channel|IDE/i.test(toType) && !/Model/i.test(toType)) {
      // Prefer channels/comms for SaaS/external that aren't models
      if (/slack|teams|outlook|email|word|web|channel/i.test(toName) || /channel/i.test(relType)) {
        channels.push(anatomyNode(nodeId, toName, "channel", relType || toType));
      } else {
        channels.push(anatomyNode(nodeId, toName, "app", "Connected app"));
      }
    }
  }

  for (const app of asList(access.connectedApps)) {
    if (/slack|teams|outlook|email|word|web|channel|workday/i.test(app)) {
      channels.push(anatomyNode(`app:${app}`, app, "channel", "Connected channel/app"));
    }
  }

  const usersDeduped = dedupeAnatomyNodes(usersInputs).slice(0, 12);
  const channelsDeduped = dedupeAnatomyNodes(channels).slice(0, 12);
  const actionsDeduped = dedupeAnatomyNodes(actions).slice(0, 16);
  const dataDeduped = dedupeAnatomyNodes(data).slice(0, 16);

  const risk = blast
    ? {
        score: blast.score,
        tier: blast.tier,
        reasons: blast.reasons || [],
        paths: (blast.paths || []).slice(0, 8),
        pathCount: blast.pathCount ?? (blast.paths || []).length
      }
    : {
        score: 0,
        tier: "low",
        reasons: [],
        paths: [],
        pathCount: 0
      };

  const mesh = depth.mesh || buildAgentMeshPlacement(agent);
  const flagged =
    Boolean(shadow) ||
    Boolean(access.overPermissioned || meta.overPermissioned) ||
    Boolean(dac.hasPhi || meta.hasPhi) ||
    access.sensitivity === "high" ||
    (risk.tier && ["critical", "elevated"].includes(String(risk.tier)));

  return {
    center: {
      agentId: agent.id,
      name: agent.name,
      category: agent.category || null,
      framework: agent.framework || config.framework || null,
      owner: agent.owner || ownership.owner || null,
      model: {
        name: modelName || "Unknown model",
        provider: modelProvider,
        label: modelName ? `${modelProvider !== "llm" ? modelProvider + " · " : ""}${modelName}` : "No model detected"
      }
    },
    profile: {
      function: agent.department || agent.business_unit || meta.function || agent.category || "General",
      summary:
        meta.howIdentified ||
        meta.summary ||
        `Discovered ${agent.category || "agent"} using ${agent.framework || modelName || "unknown runtime"}.`,
      owner: agent.owner || ownership.owner || null,
      ownershipStatus: ownership.ownershipStatus || meta.ownershipStatus || null,
      agentType: agent.deployment_type || meta.deploymentType || agent.category || "unknown",
      infraType: agent.cloud_provider || meta.platform || mesh.agentPlane || "unknown",
      environment: mesh.laneLabel || mesh.environmentLane || meta.environment || "unknown",
      location: agent.region || meta.region || agent.hostname || "—",
      created: agent.first_discovered || agent.created_at || null,
      registered: agent.last_seen || null,
      mode: Array.isArray(config.channels) && config.channels.length ? "Chat" : "Agent",
      plane: mesh.planeLabel || mesh.agentPlane,
      flagged,
      shadowAi: Boolean(shadow)
    },
    groups: {
      usersInputs: {
        id: "usersInputs",
        label: "Users & Input",
        description: "Who can access this agent",
        items: usersDeduped
      },
      channels: {
        id: "channels",
        label: "Channels",
        description: "Who the agent can communicate with",
        items: channelsDeduped
      },
      actions: {
        id: "actions",
        label: "Actions",
        description: "What this agent can do",
        items: actionsDeduped
      },
      data: {
        id: "data",
        label: "Data",
        description: "What this agent can access",
        items: dataDeduped
      }
    },
    counts: {
      usersInputs: usersDeduped.length,
      channels: channelsDeduped.length,
      actions: actionsDeduped.length,
      data: dataDeduped.length
    },
    risk: {
      ...risk,
      sensitivity: access.sensitivity || meta.accessSensitivity || "unknown",
      overPermissioned: Boolean(access.overPermissioned || meta.overPermissioned),
      primaryDataClass: dac.primaryDataClass || meta.primaryDataClass || "none",
      dataClasses: dac.dataClasses || meta.dataClasses || [],
      hasPii: Boolean(dac.hasPii || meta.hasPii),
      hasPhi: Boolean(dac.hasPhi || meta.hasPhi),
      shadowAi: Boolean(shadow),
      ownershipStatus: ownership.ownershipStatus || meta.ownershipStatus || null,
      grantCount: access.grantCount || 0,
      flagged
    },
    generatedAt: new Date().toISOString()
  };
}

/**
 * Load anatomy for one agent (relationships + blast radius).
 */
export async function computeAgentAnatomy(pool, tenantId, agentId) {
  const agentResult = await pool.query(`SELECT * FROM agents WHERE tenant_id=$1 AND id=$2`, [
    tenantId,
    agentId
  ]);
  if (!agentResult.rows[0]) return null;

  const agent = agentResult.rows[0];
  const rels = await pool.query(
    `SELECT r.*, s.name AS to_name, s.asset_type, s.external_key, s.attributes
     FROM relationships r
     JOIN assets s ON s.id = r.to_id
     WHERE r.tenant_id=$1 AND r.from_id=$2
     LIMIT 200`,
    [tenantId, agent.id]
  );

  let blast = null;
  try {
    const radius = await computeBlastRadius(pool, tenantId, { agentId: agent.id, limit: 1 });
    blast = radius.items[0] || null;
  } catch {
    blast = null;
  }

  return buildAgentAnatomy(agent, rels.rows, blast);
}

/**
 * Drift / change intelligence from agent_observations + first_discovered window.
 */
export async function computeDiscoveryChanges(pool, tenantId, { sinceHours = 168, agentId = null, limit = 100 } = {}) {
  const hours = Math.min(720, Math.max(1, Number(sinceHours) || 168));
  const params = [tenantId, hours];
  let agentClause = "";
  if (agentId) {
    params.push(agentId);
    agentClause = ` AND a.id = $${params.length}`;
  }

  const newlyDiscovered = await pool.query(
    `SELECT a.id, a.name, a.category, a.owner, a.framework, a.model, a.first_discovered, a.confidence_score,
            a.metadata->>'evidenceClass' AS evidence_class,
            a.metadata->>'agentStatus' AS agent_status,
            a.metadata->>'howIdentified' AS how_identified
     FROM agents a
     WHERE a.tenant_id=$1
       AND a.first_discovered >= NOW() - ($2::int * INTERVAL '1 hour')
       ${agentClause}
     ORDER BY a.first_discovered DESC
     LIMIT ${Math.min(limit, 200)}`,
    params
  );

  const recentlyUpdated = await pool.query(
    `SELECT a.id, a.name, a.category, a.owner, a.updated_at, a.last_seen, a.first_discovered,
            a.metadata->>'evidenceClass' AS evidence_class,
            a.metadata->>'accessGrantCount' AS access_grant_count,
            a.metadata->>'configToolCount' AS config_tool_count
     FROM agents a
     WHERE a.tenant_id=$1
       AND (
         a.updated_at >= NOW() - ($2::int * INTERVAL '1 hour')
         OR a.last_seen >= NOW() - ($2::int * INTERVAL '1 hour')
       )
       AND a.first_discovered < NOW() - ($2::int * INTERVAL '1 hour')
       ${agentClause}
     ORDER BY COALESCE(a.updated_at, a.last_seen) DESC
     LIMIT ${Math.min(limit, 200)}`,
    params
  );

  // Disappeared / stale: previously known agents not re-observed in the window
  const disappeared = await pool.query(
    `SELECT a.id, a.name, a.category, a.owner, a.last_seen, a.first_discovered, a.framework, a.model,
            a.metadata->>'evidenceClass' AS evidence_class,
            a.metadata->>'agentStatus' AS agent_status,
            a.metadata->>'howIdentified' AS how_identified
     FROM agents a
     WHERE a.tenant_id=$1
       AND a.last_seen < NOW() - ($2::int * INTERVAL '1 hour')
       ${agentClause}
     ORDER BY a.last_seen ASC
     LIMIT ${Math.min(limit, 200)}`,
    params
  );

  // Config/access drift: compare last two observation payloads when available
  const driftParams = [tenantId, hours];
  let driftAgent = "";
  if (agentId) {
    driftParams.push(agentId);
    driftAgent = ` AND o.agent_id = $${driftParams.length}`;
  }
  const observationPairs = await pool.query(
    `WITH ranked AS (
       SELECT o.agent_id, o.payload, o.observed_at, o.collector_id,
              ROW_NUMBER() OVER (PARTITION BY o.agent_id ORDER BY o.observed_at DESC) AS rn
       FROM agent_observations o
       WHERE o.tenant_id=$1
         AND o.observed_at >= NOW() - ($2::int * INTERVAL '1 hour')
         ${driftAgent}
     )
     SELECT a.id, a.name, a.category, a.owner,
            cur.payload AS current_payload,
            prev.payload AS previous_payload,
            cur.observed_at AS current_at,
            prev.observed_at AS previous_at
     FROM ranked cur
     JOIN ranked prev ON prev.agent_id = cur.agent_id AND prev.rn = 2
     JOIN agents a ON a.id = cur.agent_id
     WHERE cur.rn = 1
     LIMIT ${Math.min(limit, 100)}`,
    driftParams
  );

  const configDrift = [];
  const ownerChanges = [];
  const dataClassEscalations = [];
  for (const row of observationPairs.rows) {
    const cur = summarizeFromPayload(row.current_payload);
    const prev = summarizeFromPayload(row.previous_payload);
    const changes = diffDepth(prev, cur);
    if (changes.length) {
      configDrift.push({
        agentId: row.id,
        name: row.name,
        category: row.category,
        owner: row.owner,
        changedAt: row.current_at,
        previousAt: row.previous_at,
        changes,
        href: `/agents/${row.id}`
      });
    }
    const prevOwner = (prev.ownership?.owner || "").trim();
    const curOwner = (cur.ownership?.owner || row.owner || "").trim();
    if (prevOwner !== curOwner && (prevOwner || curOwner)) {
      ownerChanges.push({
        agentId: row.id,
        id: row.id,
        name: row.name,
        category: row.category,
        owner: curOwner || null,
        previousOwner: prevOwner || null,
        changedAt: row.current_at,
        changeType: "owner_changed",
        summary: `${prevOwner || "(none)"} → ${curOwner || "(none)"}`,
        href: `/agents/${row.id}`
      });
    }
    const prevPrimary = prev.dataAccess?.primaryDataClass || "none";
    const curPrimary = cur.dataAccess?.primaryDataClass || "none";
    const prevRank = DATA_CLASS_PRIORITY[prevPrimary] ?? 0;
    const curRank = DATA_CLASS_PRIORITY[curPrimary] ?? 0;
    const newlySensitive =
      (cur.dataAccess?.hasPii && !prev.dataAccess?.hasPii) ||
      (cur.dataAccess?.hasPhi && !prev.dataAccess?.hasPhi) ||
      curRank > prevRank;
    if (newlySensitive && curPrimary !== "none" && curPrimary !== "unknown") {
      dataClassEscalations.push({
        agentId: row.id,
        id: row.id,
        name: row.name,
        category: row.category,
        owner: row.owner,
        previousDataClass: prevPrimary,
        primaryDataClass: curPrimary,
        dataClasses: cur.dataAccess?.dataClasses || [curPrimary],
        confidence: cur.dataAccess?.confidence || "low",
        changedAt: row.current_at,
        changeType: "data_class_escalated",
        summary: `${prevPrimary} → ${curPrimary}`,
        evidence: (cur.dataAccess?.evidence || []).slice(0, 5),
        href: `/agents/${row.id}`
      });
    }
  }

  // Relationship edge churn in window
  const edgeChanges = await pool.query(
    `SELECT COUNT(*)::int AS c
     FROM relationships
     WHERE tenant_id=$1 AND last_seen >= NOW() - ($2::int * INTERVAL '1 hour')`,
    [tenantId, hours]
  );

  return {
    sinceHours: hours,
    newlyDiscovered: newlyDiscovered.rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      owner: r.owner,
      framework: r.framework,
      model: r.model,
      firstDiscovered: r.first_discovered,
      confidence: r.confidence_score,
      evidenceClass: r.evidence_class,
      agentStatus: r.agent_status,
      howIdentified: r.how_identified,
      changeType: "new",
      href: `/agents/${r.id}`
    })),
    recentlyUpdated: recentlyUpdated.rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      owner: r.owner,
      updatedAt: r.updated_at,
      lastSeen: r.last_seen,
      evidenceClass: r.evidence_class,
      accessGrantCount: Number(r.access_grant_count || 0),
      configToolCount: Number(r.config_tool_count || 0),
      changeType: "updated",
      href: `/agents/${r.id}`
    })),
    disappeared: disappeared.rows.map((r) => ({
      id: r.id,
      agentId: r.id,
      name: r.name,
      category: r.category,
      owner: r.owner,
      framework: r.framework,
      model: r.model,
      lastSeen: r.last_seen,
      firstDiscovered: r.first_discovered,
      evidenceClass: r.evidence_class,
      agentStatus: r.agent_status,
      howIdentified: r.how_identified,
      changeType: "disappeared",
      summary: "Not re-observed in the selected window",
      href: `/agents/${r.id}`
    })),
    ownerChanges,
    dataClassEscalations,
    configDrift,
    changedRelationships: edgeChanges.rows[0]?.c || 0,
    summary: {
      newAgents: newlyDiscovered.rows.length,
      updatedAgents: recentlyUpdated.rows.length,
      disappearedAgents: disappeared.rows.length,
      ownerChanges: ownerChanges.length,
      dataClassEscalations: dataClassEscalations.length,
      configDrift: configDrift.length,
      changedRelationships: edgeChanges.rows[0]?.c || 0
    },
    generatedAt: new Date().toISOString()
  };
}

function summarizeFromPayload(payload) {
  const obs = payload && typeof payload === "object" ? payload : {};
  const config = buildAgentConfig(obs);
  const access = buildAgentAccess(obs);
  return {
    config,
    access,
    ownership: buildOwnership(obs),
    dataAccess: buildDataAccessClassification(obs, access, config)
  };
}

function diffDepth(prev, cur) {
  const changes = [];
  const prevTools = new Set(prev.config.tools || []);
  const curTools = new Set(cur.config.tools || []);
  for (const t of curTools) if (!prevTools.has(t)) changes.push({ field: "tools", op: "added", value: t });
  for (const t of prevTools) if (!curTools.has(t)) changes.push({ field: "tools", op: "removed", value: t });

  const prevMcp = new Set(prev.config.mcpServers || []);
  const curMcp = new Set(cur.config.mcpServers || []);
  for (const t of curMcp) if (!prevMcp.has(t)) changes.push({ field: "mcpServers", op: "added", value: t });
  for (const t of prevMcp) if (!curMcp.has(t)) changes.push({ field: "mcpServers", op: "removed", value: t });

  const prevChannels = new Set(prev.config.channels || []);
  const curChannels = new Set(cur.config.channels || []);
  for (const t of curChannels) if (!prevChannels.has(t)) changes.push({ field: "channels", op: "added", value: t });
  for (const t of prevChannels) if (!curChannels.has(t)) changes.push({ field: "channels", op: "removed", value: t });

  const prevGranted = new Set(prev.access.granted || []);
  const curGranted = new Set(cur.access.granted || []);
  for (const t of curGranted) if (!prevGranted.has(t)) changes.push({ field: "access", op: "granted", value: t });
  for (const t of prevGranted) if (!curGranted.has(t)) changes.push({ field: "access", op: "revoked", value: t });

  if ((prev.config.authMode || null) !== (cur.config.authMode || null) && (prev.config.authMode || cur.config.authMode)) {
    changes.push({ field: "authMode", op: "changed", value: String(cur.config.authMode || "") });
  }

  if (Boolean(prev.config.instructionsPresent) !== Boolean(cur.config.instructionsPresent)) {
    changes.push({
      field: "instructionsPresent",
      op: "changed",
      value: String(cur.config.instructionsPresent)
    });
  }
  if (
    prev.config.instructionsHash &&
    cur.config.instructionsHash &&
    prev.config.instructionsHash !== cur.config.instructionsHash
  ) {
    changes.push({ field: "instructionsHash", op: "changed", value: cur.config.instructionsHash });
  }

  const prevIds = new Set(prev.access.identities || prev.ownership?.identities || []);
  const curIds = new Set(cur.access.identities || cur.ownership?.identities || []);
  for (const t of curIds) if (!prevIds.has(t)) changes.push({ field: "identities", op: "added", value: t });
  for (const t of prevIds) if (!curIds.has(t)) changes.push({ field: "identities", op: "removed", value: t });

  const prevClasses = new Set(prev.dataAccess?.dataClasses || []);
  const curClasses = new Set(cur.dataAccess?.dataClasses || []);
  for (const t of curClasses) {
    if (!prevClasses.has(t) && t !== "none" && t !== "unknown") {
      changes.push({ field: "dataClass", op: "added", value: t });
    }
  }
  for (const t of prevClasses) {
    if (!curClasses.has(t) && t !== "none" && t !== "unknown") {
      changes.push({ field: "dataClass", op: "removed", value: t });
    }
  }
  const prevPrimary = prev.dataAccess?.primaryDataClass || "none";
  const curPrimary = cur.dataAccess?.primaryDataClass || "none";
  if (prevPrimary !== curPrimary) {
    changes.push({ field: "primaryDataClass", op: "changed", value: `${prevPrimary}→${curPrimary}` });
  }

  return changes;
}

export { ACCESS_KEYS, DATA_CLASS_PRIORITY };
