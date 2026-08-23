/**
 * Agent 365 deep enrichment + adversarial surface (AWS metadata.deep / adversarial_surface parity).
 *
 * Discovery lists catalog packages; this module enriches those observations only —
 * it never invents agents. Detail comes from:
 *   GET /v1.0|beta/copilot/admin/catalog/packages/{id}
 *
 * Graph does not expose Bedrock-style system prompts or IAM roles. We map what
 * the package detail actually returns (description, sensitivity, ACLs,
 * elementDetails / bot / declarativeAgent definitions) into aws-deep.v2-shaped
 * metadata.deep and schema 1.0.0 adversarial_surface.
 */

import { createHash } from "node:crypto";
import { ALLOW, safeFetch } from "../utils/http.js";
import {
  attachAdversarialSurface,
  buildInstructionsFromText,
  emptyTool,
  inferToolRiskFlags,
  instructionPreview,
} from "./adversarialInventory.js";

const DEEP_SCHEMA = "agent365-deep.v1";
const GRAPH_HOST = "https://graph.microsoft.com";

function truthyEnv(name, fallback = false) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function deepScanEnabled() {
  // Always-on by default (same product stance as AWS). Break-glass off only.
  const allowOff = truthyEnv("M365_AGENT365_DEEP_SCAN_ALLOW_OFF", false);
  const raw = String(process.env.M365_AGENT365_DEEP_SCAN ?? "").trim().toLowerCase();
  if (allowOff && raw === "false") return false;
  return true;
}

function deepScanLimit() {
  const n = Number(process.env.M365_AGENT365_DEEP_LIMIT || 40);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 200) : 40;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function uniqStrings(values) {
  return [...new Set(asArray(values).map((v) => String(v || "").trim()).filter(Boolean))];
}

function sha256Hex(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function classifyHttpStatus(status) {
  if (status === 401 || status === 403) return "permission_denied";
  if (status === 404) return "not_found";
  if (status === 429) return "throttled";
  if (status >= 500) return "upstream_error";
  return "request_failed";
}

/**
 * Normalize Graph package detail payloads (camelCase / PascalCase).
 */
export function normalizeAgent365PackageDetail(raw) {
  const o = asObject(raw);
  const id = firstString(o.id, o.Id);
  const displayName = firstString(o.displayName, o.DisplayName, o.name, o.Name);
  const shortDescription = firstString(o.shortDescription, o.ShortDescription, o.description, o.Description);
  const longDescription = firstString(o.longDescription, o.LongDescription);
  const description = longDescription || shortDescription;
  const status = firstString(o.status, o.Status).toLowerCase() || "unknown";
  const type = firstString(o.type, o.Type).toLowerCase() || "unknown";
  const isBlocked = Boolean(o.isBlocked ?? o.IsBlocked);
  const supportedHosts = uniqStrings(o.supportedHosts ?? o.SupportedHosts);
  const availableTo = asArray(o.availableTo ?? o.AvailableTo).map((entry) => {
    const row = asObject(entry);
    return {
      id: firstString(row.id, row.Id) || null,
      displayName: firstString(row.displayName, row.DisplayName) || null,
    };
  }).filter((row) => row.id || row.displayName);
  const availableToGestures = uniqStrings(o.availableToGestures ?? o.AvailableToGestures);
  const deployedTo = asArray(o.deployedTo ?? o.DeployedTo).map((entry) => {
    const row = asObject(entry);
    return {
      id: firstString(row.id, row.Id) || null,
      displayName: firstString(row.displayName, row.DisplayName) || null,
    };
  }).filter((row) => row.id || row.displayName);
  const deployedToGestures = uniqStrings(o.deployedToGestures ?? o.DeployedToGestures);
  const sensitivityLabel = (() => {
    const label = o.sensitivityLabel ?? o.SensitivityLabel;
    if (typeof label === "string") return { displayName: label, id: null };
    const row = asObject(label);
    const name = firstString(row.displayName, row.DisplayName, row.name, row.Name);
    const labelId = firstString(row.id, row.Id);
    if (!name && !labelId) return null;
    return { id: labelId || null, displayName: name || null };
  })();
  const categories = uniqStrings(o.categories ?? o.Categories);
  const lastModifiedDateTime = firstString(o.lastModifiedDateTime, o.LastModifiedDateTime) || null;
  const elementDetails = asArray(o.elementDetails ?? o.ElementDetails).map((entry) => {
    const row = asObject(entry);
    return {
      elementId: firstString(row.elementId, row.ElementId) || null,
      elementType: firstString(row.elementType, row.ElementType).toLowerCase() || null,
      definition: typeof row.definition === "string"
        ? row.definition
        : (typeof row.Definition === "string" ? row.Definition : null),
    };
  }).filter((row) => row.elementId || row.elementType || row.definition);

  return {
    id,
    displayName,
    shortDescription,
    longDescription,
    description,
    status,
    type,
    isBlocked,
    supportedHosts,
    availableTo,
    availableToGestures,
    deployedTo,
    deployedToGestures,
    sensitivityLabel,
    categories,
    lastModifiedDateTime,
    elementDetails,
  };
}

function tryParseJson(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function walkCollect(node, visitor, depth = 0) {
  if (depth > 12 || node == null) return;
  visitor(node, depth);
  if (Array.isArray(node)) {
    for (const item of node) walkCollect(item, visitor, depth + 1);
    return;
  }
  if (typeof node === "object") {
    for (const value of Object.values(node)) walkCollect(value, visitor, depth + 1);
  }
}

/**
 * Extract tool / capability / KB hints from catalog element definitions.
 * Declarative agent / bot JSON shapes vary; we collect evidenced strings only.
 */
export function extractCapabilitiesFromElementDetails(elementDetails) {
  const tools = [];
  const knowledgeBases = [];
  const capabilities = [];
  const instructionSnippets = [];
  const seenTool = new Set();
  const seenKb = new Set();

  for (const element of asArray(elementDetails)) {
    const parsed = tryParseJson(element.definition);
    if (!parsed) {
      if (element.definition && element.definition.length > 40) {
        instructionSnippets.push(element.definition.slice(0, 4000));
      }
      continue;
    }

    walkCollect(parsed, (node) => {
      if (!node || typeof node !== "object" || Array.isArray(node)) return;
      const name = firstString(
        node.name,
        node.Name,
        node.title,
        node.Title,
        node.displayName,
        node.DisplayName,
        node.id,
        node.Id,
      );
      const typeHint = firstString(
        node.type,
        node.Type,
        node.kind,
        node.Kind,
        node["@odata.type"],
        node.capability,
        node.Capability,
      ).toLowerCase();
      const description = firstString(node.description, node.Description, node.instructions, node.Instructions);

      if (
        name &&
        /tool|action|function|plugin|api|connector|capability|skill/.test(`${typeHint} ${name}`.toLowerCase())
      ) {
        const key = `${typeHint}|${name}`.toLowerCase();
        if (!seenTool.has(key)) {
          seenTool.add(key);
          tools.push({
            name,
            description: description || null,
            type: typeHint || "capability",
            elementType: element.elementType || null,
            elementId: element.elementId || null,
          });
        }
      }

      if (
        name &&
        /knowledge|sharepoint|onedrive|graph.?connector|retrieval|grounding|datasource|data.?source|kb/.test(
          `${typeHint} ${name} ${description}`.toLowerCase(),
        )
      ) {
        const key = name.toLowerCase();
        if (!seenKb.has(key)) {
          seenKb.add(key);
          knowledgeBases.push({
            name,
            description: description || null,
            type: typeHint || "knowledge",
            elementType: element.elementType || null,
          });
        }
      }

      if (typeHint && /capability|plugin|action/.test(typeHint) && name) {
        capabilities.push({ name, type: typeHint });
      }

      for (const key of ["instructions", "Instructions", "systemPrompt", "SystemPrompt", "prompt", "Prompt"]) {
        if (typeof node[key] === "string" && node[key].trim().length > 20) {
          instructionSnippets.push(node[key].trim().slice(0, 8000));
        }
      }
    });
  }

  return {
    tools,
    knowledgeBases,
    capabilities: capabilities.slice(0, 40),
    instructionText: instructionSnippets[0] || "",
  };
}

function buildToolsForDeep(extractedTools) {
  return asArray(extractedTools).map((tool) => {
    const name = firstString(tool.name) || "unnamed_capability";
    const description = firstString(tool.description);
    const type = firstString(tool.type) || "capability";
    const source = "agent365_element_definition";
    const risk_flags = inferToolRiskFlags({ name, description, source: type });
    return emptyTool({
      name,
      description: description || null,
      parameters_schema: null,
      risk_flags,
      source,
      confidence: "medium",
      evidence: [
        tool.elementType ? `elementType=${tool.elementType}` : null,
        tool.elementId ? `elementId=${tool.elementId}` : null,
        type ? `capabilityType=${type}` : null,
      ].filter(Boolean),
      // Agent 365–specific annotations (UI / topology may use these)
      type,
      elementType: tool.elementType || null,
      elementId: tool.elementId || null,
    });
  });
}

function buildKnowledgeBases(extracted) {
  return asArray(extracted).map((kb) => ({
    id: null,
    name: firstString(kb.name) || null,
    description: firstString(kb.description) || null,
    type: firstString(kb.type) || "knowledge",
    elementType: kb.elementType || null,
    knowledgeBaseState: null,
    storageConfiguration: null,
  }));
}

function inferDataClasses(pkg, extracted) {
  const blob = [
    pkg.description,
    pkg.categories.join(" "),
    pkg.sensitivityLabel?.displayName || "",
    ...extracted.knowledgeBases.map((k) => `${k.name} ${k.description || ""}`),
    ...extracted.tools.map((t) => `${t.name} ${t.description || ""}`),
  ].join(" ").toLowerCase();

  const classes = [];
  if (/\bphi\b|hipaa|health|medical|patient/.test(blob)) classes.push("phi");
  if (/\bpii\b|personal|employee|hr\b|ssn|passport/.test(blob)) classes.push("pii");
  if (/finance|payment|pci|bank|salary/.test(blob)) classes.push("financial");
  if (/secret|credential|password|token|key vault/.test(blob)) classes.push("secrets");
  if (/customer|crm|sales/.test(blob)) classes.push("customer");
  if (pkg.sensitivityLabel?.displayName) classes.push("labeled");
  return uniqStrings(classes);
}

/**
 * Build aws-deep.v2-shaped deep profile from catalog detail + extracted capabilities.
 */
export function buildAgent365DeepProfile({ packageDetail, fetchedAt = null, apiVersion = "v1.0" }) {
  const pkg = normalizeAgent365PackageDetail(packageDetail);
  const extracted = extractCapabilitiesFromElementDetails(pkg.elementDetails);
  const tools = buildToolsForDeep(extracted.tools);
  const knowledgeBases = buildKnowledgeBases(extracted.knowledgeBases);
  const hasInstructionBody = Boolean(extracted.instructionText);
  const dataClasses = inferDataClasses(pkg, extracted);
  const fromInstructions = hasInstructionBody
    ? buildInstructionsFromText(extracted.instructionText, "agent365_element_definition")
    : null;

  const instructions = hasInstructionBody
    ? {
        present: true,
        hash: fromInstructions.hash || `sha256:${sha256Hex(extracted.instructionText)}`,
        length: extracted.instructionText.length,
        preview: instructionPreview(extracted.instructionText, 240),
        source: "element_definition",
        contains_tool_guidance: fromInstructions.contains_tool_guidance,
        contains_safety_rules: fromInstructions.contains_safety_rules,
      }
    : {
        present: false,
        hash: null,
        length: 0,
        preview: pkg.description ? instructionPreview(pkg.description, 240) : null,
        source: pkg.description ? "catalog_description_only" : "none",
        note: "Graph catalog detail does not expose full system instructions; description/element text only.",
      };

  const identity = {
    identity_type: "microsoft_entra",
    kind: "microsoft_entra",
    principalId: null,
    arn: null,
    roleArn: null,
    name: null,
    note: "Agent 365 catalog agents are not backed by an AWS-style execution role; ACL/deployment targets are recorded under access.",
  };

  const access = {
    availableTo: pkg.availableTo,
    availableToGestures: pkg.availableToGestures,
    deployedTo: pkg.deployedTo,
    deployedToGestures: pkg.deployedToGestures,
    isBlocked: pkg.isBlocked,
    status: pkg.status,
  };

  const guardrails = {
    present: Boolean(pkg.sensitivityLabel?.displayName || pkg.isBlocked),
    sensitivityLabel: pkg.sensitivityLabel,
    isBlocked: pkg.isBlocked,
    catalogStatus: pkg.status,
    note: "No Bedrock-equivalent guardrail config on Graph catalog; sensitivity label + blocked flag only.",
  };

  // Keep full instruction text out of persisted deep (AWS parity); pass via closure for adversarial only.
  const profile = {
    deepScan: "agent365_catalog_package_detail",
    schemaVersion: DEEP_SCHEMA,
    awsDeepCompatible: "aws-deep.v2",
    fetchedAt: fetchedAt || new Date().toISOString(),
    apiVersion,
    packageId: pkg.id || null,
    displayName: pkg.displayName || null,
    type: pkg.type || null,
    supportedHosts: pkg.supportedHosts,
    categories: pkg.categories,
    lastModifiedDateTime: pkg.lastModifiedDateTime,
    identity,
    access,
    instructions,
    instructionPreview: instructions.preview,
    instructionHash: instructions.hash,
    instructionLength: instructions.length || 0,
    description: pkg.description || null,
    foundationModel: null,
    idleSessionTtlSeconds: null,
    customerEncryptionKeyArn: null,
    guardrails,
    memory: null,
    collaboration: null,
    tools,
    toolCount: tools.length,
    actionGroups: tools.map((t) => ({
      actionGroupName: t.name,
      description: t.description,
      actionGroupState: pkg.isBlocked ? "DISABLED" : "ENABLED",
      source: "agent365_capability",
    })),
    actionGroupCount: tools.length,
    knowledgeBases,
    knowledgeBaseCount: knowledgeBases.length,
    codeInterpreter: tools.some((t) => t.risk_flags?.can_execute_code),
    userInput: true,
    promptOverrideCount: 0,
    versions: [],
    aliases: [],
    dataClasses,
    elementDetailCount: pkg.elementDetails.length,
    capabilityHints: extracted.capabilities,
    limitations: [
      "Graph copilot/admin/catalog/packages/{id} does not return foundation model or full system prompt like Bedrock GetAgent.",
      "Tools/KBs are inferred from elementDetails definitions when present; empty definitions yield empty tool lists.",
      "No AWS IAM roleArn equivalent — use access.availableTo / deployedTo for blast-radius clues.",
    ],
  };

  // Non-enumerable: used only while building adversarial_surface in this process.
  Object.defineProperty(profile, "_instructionFull", {
    value: hasInstructionBody ? extracted.instructionText : (pkg.description || ""),
    enumerable: false,
    writable: false,
  });

  return profile;
}

function adversarialExtrasFromDeep(deep) {
  const d = asObject(deep);
  const tools = asArray(d.tools);
  const kbs = asArray(d.knowledgeBases);
  const dataClasses = asArray(d.dataClasses).map((x) => String(x));
  const access = asObject(d.access);
  const instructionText =
    (typeof d._instructionFull === "string" && d._instructionFull) ||
    (typeof d.description === "string" ? d.description : "");

  return {
    tools,
    instructionText: instructionText || null,
    instructions: instructionText
      ? buildInstructionsFromText(
          instructionText,
          asObject(d.instructions).present ? "agent365_element_definition" : "agent365_catalog_description",
        )
      : undefined,
    roleArn: null,
    permissions: uniqStrings([
      ...asArray(access.availableToGestures).map((g) => `availableTo:${g}`),
      ...asArray(access.deployedToGestures).map((g) => `deployedTo:${g}`),
      access.isBlocked ? "catalog:blocked" : null,
      ...asArray(access.availableTo).map((p) => (p.id ? `availableToId:${p.id}` : null)),
      ...asArray(access.deployedTo).map((p) => (p.id ? `deployedToId:${p.id}` : null)),
    ]),
    knowledgeBases: kbs.map((kb) => ({
      id: kb.id,
      name: kb.name,
      description: kb.description,
      type: kb.type,
      knowledgeBaseState: kb.knowledgeBaseState || null,
    })),
    hasPii: dataClasses.includes("pii") || dataClasses.includes("labeled"),
    hasPhi: dataClasses.includes("phi"),
    dataClasses,
    // M365 Copilot hosts imply network egress for grounded chat; tighten when tool flags say otherwise.
    internetAccess: tools.length
      ? tools.some((t) => t.risk_flags?.can_call_external_apis)
      : true,
    codeExecution: Boolean(d.codeInterpreter) || tools.some((t) => t.risk_flags?.can_execute_code),
    inboundTriggers: uniqStrings([
      ...asArray(d.supportedHosts).map((h) => `host:${h}`),
      access.status ? `catalog_status:${access.status}` : null,
    ]),
    evidence: [
      "Adversarial surface built from Agent 365 catalog package detail (agent365-deep.v1)",
      d.packageId ? `packageId=${d.packageId}` : null,
      `elementDetails=${d.elementDetailCount || 0}`,
      `tools=${tools.length}`,
      `knowledgeBases=${kbs.length}`,
      asObject(d.instructions).present ? "instruction body from element definition" : "no full instruction body from Graph",
      asObject(d.guardrails).sensitivityLabel?.displayName
        ? `sensitivityLabel=${asObject(d.guardrails).sensitivityLabel.displayName}`
        : null,
    ].filter(Boolean),
  };
}

/**
 * Attach metadata.deep + metadata.adversarial_surface (+ deepScanStatus) onto a catalog observation.
 */
export function enrichAgent365Observation(observation, packageDetail, opts = {}) {
  const obs = observation && typeof observation === "object" ? { ...observation } : {};
  const metadata = { ...(asObject(obs.metadata)) };
  const deep = buildAgent365DeepProfile({
    packageDetail,
    fetchedAt: opts.fetchedAt,
    apiVersion: opts.apiVersion || "v1.0",
  });

  // Persist deep without non-enumerable helpers (JSON round-trip strips them anyway).
  const { _instructionFull: _drop, ...deepPersisted } = deep;
  metadata.deep = deepPersisted;
  metadata.deepScan = deep.deepScan || "agent365_catalog_package_detail";
  metadata.deepScanSchema = DEEP_SCHEMA;
  metadata.deepScanStatus = "ok";
  metadata.deepScanError = null;
  // Catalog list previously claimed hasInstructions without a body; deep corrects this.
  metadata.hasInstructions = Boolean(asObject(deep.instructions).present);
  metadata.instructionSource = asObject(deep.instructions).source || null;
  metadata.toolCount = asArray(deep.tools).length;
  metadata.knowledgeBaseCount = asArray(deep.knowledgeBases).length;
  metadata.sensitivityLabel = asObject(deep.guardrails).sensitivityLabel || null;
  metadata.accessGestures = {
    availableTo: asArray(asObject(deep.access).availableToGestures),
    deployedTo: asArray(asObject(deep.access).deployedToGestures),
  };
  metadata.evidence = [
    ...(asArray(metadata.evidence)),
    "Deep scan: Graph copilot/admin/catalog/packages/{id}",
    asArray(deep.tools).length
      ? `Deep scan: ${asArray(deep.tools).length} capability/tool hint(s) from elementDetails`
      : "Deep scan: no tools expanded from elementDetails",
    asArray(deep.knowledgeBases).length
      ? `Deep scan: ${asArray(deep.knowledgeBases).length} knowledge hint(s)`
      : "Deep scan: no knowledge bases inferred",
  ];

  obs.metadata = metadata;
  obs.tools = asArray(deep.tools).map((t) => ({
    name: t.name,
    description: t.description,
    parameters_schema: t.parameters_schema,
    risk_flags: t.risk_flags,
    source: t.source,
  }));

  return attachAdversarialSurface(obs, adversarialExtrasFromDeep(deep));
}

async function fetchPackageDetail(accessToken, packageId, fetchFn = safeFetch) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
  const attempts = [];
  for (const ver of ["v1.0", "beta"]) {
    const url = `${GRAPH_HOST}/${ver}/copilot/admin/catalog/packages/${encodeURIComponent(packageId)}`;
    const res = await fetchFn(url, { method: "GET", headers }, ALLOW.graphMicrosoft);
    const status = Number(res?.status || 0);
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    attempts.push({ apiVersion: ver, status, ok: Boolean(res?.ok) });
    if (res?.ok && json) {
      return { ok: true, detail: json, apiVersion: ver, attempts };
    }
    if (status === 401 || status === 403) {
      return {
        ok: false,
        error: {
          type: "permission_denied",
          message: `Graph catalog package detail denied (${status})`,
          status,
          apiVersion: ver,
        },
        attempts,
      };
    }
  }
  const last = attempts[attempts.length - 1] || {};
  return {
    ok: false,
    error: {
      type: classifyHttpStatus(last.status || 0),
      message: `Graph catalog package detail failed (${last.status || 0})`,
      status: last.status || 0,
      apiVersion: last.apiVersion || null,
    },
    attempts,
  };
}

function markDeepSkipped(observation, reason) {
  const obs = { ...observation, metadata: { ...asObject(observation.metadata) } };
  obs.metadata.deepScan = "agent365_catalog_package_detail";
  obs.metadata.deepScanSchema = DEEP_SCHEMA;
  obs.metadata.deepScanStatus = "skipped";
  obs.metadata.deepScanError = reason;
  return obs;
}

function markDeepError(observation, error) {
  const obs = { ...observation, metadata: { ...asObject(observation.metadata) } };
  const type = error?.type || "request_failed";
  obs.metadata.deepScan = "agent365_catalog_package_detail";
  obs.metadata.deepScanSchema = DEEP_SCHEMA;
  obs.metadata.deepScanStatus = type === "permission_denied" ? "permission_denied" : "error";
  obs.metadata.deepScanError = error?.message || "Agent 365 deep scan failed";
  obs.metadata.deepScanErrorDetail = {
    type,
    status: error?.status || null,
  };
  return attachAdversarialSurface(obs, {
    evidence: [`Deep scan failed: ${obs.metadata.deepScanError}`],
  });
}

/**
 * Enrich Agent 365 catalog observations with deep + adversarial_surface.
 * Non-catalog M365 observations are returned unchanged.
 */
export async function enrichAgent365WithDeepScan(observations, accessToken, opts = {}) {
  const list = asArray(observations);
  if (!list.length) return list;

  if (!deepScanEnabled()) {
    return list.map((obs) => {
      if (asObject(obs.metadata).source !== "graph-agent365-catalog") return obs;
      return markDeepSkipped(obs, "Agent 365 deep scan disabled via M365_AGENT365_DEEP_SCAN_ALLOW_OFF");
    });
  }

  if (!accessToken) {
    return list.map((obs) => {
      if (asObject(obs.metadata).source !== "graph-agent365-catalog") return obs;
      return markDeepError(obs, { type: "permission_denied", message: "Missing Graph access token for package detail" });
    });
  }

  const limit = opts.limit ?? deepScanLimit();
  const fetchFn = opts.fetchFn || safeFetch;
  let enriched = 0;
  const out = [];

  for (const obs of list) {
    const meta = asObject(obs.metadata);
    if (meta.source !== "graph-agent365-catalog") {
      out.push(obs);
      continue;
    }
    if (enriched >= limit) {
      out.push(markDeepSkipped(obs, `Agent 365 deep scan limit reached (${limit})`));
      continue;
    }

    const packageId = firstString(meta.agent365PackageId, obs.externalId);
    if (!packageId) {
      out.push(markDeepError(obs, { type: "not_found", message: "Missing agent365PackageId" }));
      continue;
    }

    try {
      const result = await fetchPackageDetail(accessToken, packageId, fetchFn);
      enriched += 1;
      if (!result.ok) {
        out.push(markDeepError(obs, result.error));
        continue;
      }
      out.push(enrichAgent365Observation(obs, result.detail, { apiVersion: result.apiVersion }));
    } catch (err) {
      enriched += 1;
      out.push(markDeepError(obs, {
        type: "request_failed",
        message: err?.message || "Agent 365 deep scan exception",
      }));
    }
  }

  return out;
}

export const __test = {
  deepScanEnabled,
  deepScanLimit,
  normalizeAgent365PackageDetail,
  extractCapabilitiesFromElementDetails,
  buildAgent365DeepProfile,
  enrichAgent365Observation,
  adversarialExtrasFromDeep,
};
