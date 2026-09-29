/**
 * Control assurance: compare intended requirements, effective capability,
 * and observed runtime behavior. Unknown is never promoted to effective.
 */

export const ASSURANCE_STATUSES = [
  "effective",
  "ineffective",
  "violated",
  "blocked_violation",
  "unknown",
  "not_tested"
];

export const ASSURANCE_CONTROLS = [
  {
    id: "C-001",
    code: "C-001",
    name: "No PHI access",
    framework: "HIPAA",
    requirement: { kind: "data_class", dataClass: "phi", access: "deny" },
    planes: ["authorization", "runtime"]
  },
  {
    id: "C-002",
    code: "C-002",
    name: "No database write",
    framework: "Internal",
    requirement: { kind: "database_write", access: "deny" },
    planes: ["database", "runtime"]
  },
  {
    id: "C-003",
    code: "C-003",
    name: "Approved APIs only",
    framework: "Internal",
    requirement: { kind: "api_allowlist", access: "allowlist" },
    planes: ["api", "runtime"]
  },
  {
    id: "C-004",
    code: "C-004",
    name: "No destructive operations",
    framework: "Internal",
    requirement: { kind: "destructive", access: "deny" },
    planes: ["authorization", "runtime"]
  }
];

const CONTROL_BY_ID = new Map(ASSURANCE_CONTROLS.map((control) => [control.id, control]));

export function getAssuranceControl(controlId) {
  return CONTROL_BY_ID.get(String(controlId || "")) || null;
}

function norm(value) {
  return String(value || "").trim().toLowerCase();
}

function isDatabaseWrite(entry) {
  const operation = norm(entry.operation || entry.action);
  const kind = norm(entry.kind);
  const resource = norm(entry.resource);
  const write = /^(update|insert|write|merge|upsert|put|patch|delete)$/.test(operation) ||
    /\b(update|insert|write)\b/.test(operation);
  const database = kind === "database" || /patient db|database|sql\b/.test(resource);
  return write && (database || kind === "database");
}

function isDestructive(entry) {
  if (entry.destructive === true) return true;
  return /^(delete|drop|destroy|purge|truncate)$/.test(norm(entry.operation || entry.action));
}

function isPhi(entry) {
  return norm(entry.dataClass || entry.data_class) === "phi";
}

function isApi(entry) {
  const kind = norm(entry.kind);
  const resource = String(entry.resource || "");
  return kind === "api" || resource.startsWith("/");
}

function allowlistHit(resource, allowlist) {
  const value = norm(resource).replace(/\/$/, "");
  return allowlist.some((item) => {
    const allowed = norm(item).replace(/\/$/, "");
    if (!allowed) return false;
    return value === allowed || value.startsWith(`${allowed}/`);
  });
}

function capabilityViolations(control, parameters, capabilities) {
  const rows = Array.isArray(capabilities) ? capabilities : [];
  const allowed = rows.filter((row) => row && row.allowed !== false);
  if (control.requirement.kind === "data_class") {
    return allowed.filter((row) => isPhi(row));
  }
  if (control.requirement.kind === "database_write") {
    return allowed.filter((row) => isDatabaseWrite(row));
  }
  if (control.requirement.kind === "destructive") {
    return allowed.filter((row) => isDestructive(row));
  }
  if (control.requirement.kind === "api_allowlist") {
    const allowlist = Array.isArray(parameters.apiAllowlist) ? parameters.apiAllowlist : [];
    if (!allowlist.length) return [];
    return allowed.filter((row) => isApi(row) && row.resource && !allowlistHit(row.resource, allowlist));
  }
  return [];
}

function matchingEvents(control, parameters, events) {
  const rows = Array.isArray(events) ? events : [];
  return rows.filter((event) => {
    if (!event) return false;
    if (control.requirement.kind === "data_class") return isPhi(event);
    if (control.requirement.kind === "database_write") return isDatabaseWrite(event);
    if (control.requirement.kind === "destructive") return isDestructive(event);
    if (control.requirement.kind === "api_allowlist") {
      const allowlist = Array.isArray(parameters.apiAllowlist) ? parameters.apiAllowlist : [];
      if (!isApi(event) || !event.resource) return false;
      if (!allowlist.length) return false;
      return !allowlistHit(event.resource, allowlist);
    }
    return false;
  });
}

function planeCovered(coverage, plane) {
  return Boolean(coverage && coverage[plane] === true);
}

function describeCapability(row) {
  const operation = row.operation || row.action || "access";
  const resource = row.resource || row.kind || "resource";
  return `${operation} ${resource}`.trim();
}

/**
 * Evaluate one assigned control.
 * Absence of a violating event is not proof. Effective requires a covered
 * capability plane that complies and a covered runtime plane with no breach.
 */
export function evaluateControl({ control, parameters = {}, snapshot = null, events = [] }) {
  const requirement = {
    ...control.requirement,
    apiAllowlist: Array.isArray(parameters.apiAllowlist) ? parameters.apiAllowlist : []
  };
  const coverage = snapshot?.coverage || {};
  const capabilityPlane = control.planes.find((plane) => plane !== "runtime");
  const authCovered = planeCovered(coverage, capabilityPlane);
  const runtimeCovered = planeCovered(coverage, "runtime");
  const capabilities = snapshot?.capabilities || [];
  const chain = Array.isArray(snapshot?.chain) ? snapshot.chain : [];

  const missing = [];
  if (!snapshot) missing.push("permission_snapshot");
  else if (!authCovered) missing.push(`${capabilityPlane}_coverage`);
  if (control.requirement.kind === "api_allowlist" && !requirement.apiAllowlist.length) {
    missing.push("api_allowlist");
  }

  const violations = authCovered ? capabilityViolations(control, parameters, capabilities) : [];
  const observed = matchingEvents(control, parameters, events);
  const breached = observed.filter((event) => norm(event.decision) !== "blocked" && norm(event.decision) !== "unknown");
  const blocked = observed.filter((event) => norm(event.decision) === "blocked");
  const undecided = observed.filter((event) => norm(event.decision) === "unknown");

  const evidence = [];
  if (snapshot?.id) evidence.push({ type: "permission_snapshot", id: snapshot.id, source: snapshot.source || null });
  for (const step of chain) {
    evidence.push({ type: "permission_chain", step: step.step || step.kind || "step", name: step.name || null });
  }
  for (const row of violations) {
    evidence.push({ type: "effective_permission", detail: describeCapability(row), allowed: true });
  }
  for (const event of [...breached, ...blocked, ...undecided]) {
    evidence.push({
      type: "runtime_event",
      id: event.id || null,
      operation: event.operation || event.action || null,
      resource: event.resource || null,
      decision: event.decision || null,
      occurredAt: event.occurredAt || event.occurred_at || null
    });
  }

  let status = "unknown";
  let summary = "Insufficient authorization or runtime evidence to decide.";

  if (breached.length) {
    status = "violated";
    summary = `Runtime behavior breached ${control.name}.`;
  } else if (blocked.length) {
    status = "blocked_violation";
    summary = `A prohibited action was attempted and enforcement stopped it.`;
  } else if (undecided.length) {
    status = "unknown";
    summary = "A matching runtime event has no authorization decision.";
  } else if (!authCovered || (control.requirement.kind === "api_allowlist" && !requirement.apiAllowlist.length)) {
    status = "unknown";
    summary = missing.includes("api_allowlist")
      ? "Approved API list is empty, so this control cannot be judged."
      : `${control.name} needs a covered ${capabilityPlane} permission snapshot.`;
  } else if (violations.length) {
    status = "ineffective";
    summary = `Capability violates ${control.name} before any breach is observed.`;
  } else if (!runtimeCovered) {
    status = "unknown";
    summary = "Capability complies. Runtime telemetry for this control has not been collected.";
    missing.push("runtime_coverage");
  } else {
    status = "effective";
    summary = `${control.name} holds: capability complies and runtime evidence supports it.`;
  }

  return {
    controlId: control.id,
    status,
    summary,
    requirement,
    effectivePermission: violations[0]
      ? {
          operation: violations[0].operation || violations[0].action || null,
          resource: violations[0].resource || null,
          allowed: true,
          dataClass: violations[0].dataClass || violations[0].data_class || null
        }
      : authCovered
        ? { allowed: false, plane: capabilityPlane }
        : null,
    evidence,
    missing
  };
}

export function permissionFingerprint(capabilities) {
  return (Array.isArray(capabilities) ? capabilities : [])
    .map((row) =>
      [
        norm(row.kind),
        norm(row.operation || row.action),
        norm(row.resource),
        norm(row.dataClass || row.data_class),
        row.allowed === false ? "deny" : "allow",
        row.destructive === true ? "destructive" : ""
      ].join("|")
    )
    .sort()
    .join("\n");
}

export function postureFromSnapshot(snapshot) {
  const coverage = snapshot?.coverage || {};
  const capabilities = snapshot?.capabilities || [];
  const phiCovered = coverage.authorization === true;
  const dbCovered = coverage.database === true;
  const phiAllowed = capabilities.some((row) => row.allowed !== false && isPhi(row));
  const writeAllowed = capabilities.some((row) => row.allowed !== false && isDatabaseWrite(row));
  return {
    phi: phiCovered ? (phiAllowed ? "allow" : "deny") : "unknown",
    databaseWrite: dbCovered ? (writeAllowed ? "allow" : "deny") : "unknown",
    permissionFingerprint: permissionFingerprint(capabilities),
    toolCount: Number.isFinite(snapshot?.toolCount) ? snapshot.toolCount : null,
    mcpCount: Number.isFinite(snapshot?.mcpCount) ? snapshot.mcpCount : null
  };
}

export function detectDrift(baseline, current) {
  if (!baseline) return { drifted: false, severity: "none", changes: [] };
  const changes = [];
  if (baseline.phi && current.phi && baseline.phi !== "unknown" && current.phi !== "unknown" && baseline.phi !== current.phi) {
    changes.push({ field: "phi", from: baseline.phi, to: current.phi });
  }
  if (
    baseline.databaseWrite &&
    current.databaseWrite &&
    baseline.databaseWrite !== "unknown" &&
    current.databaseWrite !== "unknown" &&
    baseline.databaseWrite !== current.databaseWrite
  ) {
    changes.push({ field: "databaseWrite", from: baseline.databaseWrite, to: current.databaseWrite });
  }
  if (baseline.permissionFingerprint && current.permissionFingerprint && baseline.permissionFingerprint !== current.permissionFingerprint) {
    changes.push({ field: "permissions", from: "baseline", to: "current" });
  }
  if (baseline.toolCount != null && current.toolCount != null && baseline.toolCount !== current.toolCount) {
    changes.push({ field: "tools", from: baseline.toolCount, to: current.toolCount });
  }
  if (baseline.mcpCount != null && current.mcpCount != null && baseline.mcpCount !== current.mcpCount) {
    changes.push({ field: "mcp", from: baseline.mcpCount, to: current.mcpCount });
  }
  const critical = changes.some((change) => change.field === "phi" || change.field === "databaseWrite");
  return {
    drifted: changes.length > 0,
    severity: changes.length === 0 ? "none" : critical ? "critical" : "warning",
    changes
  };
}
