/**
 * Governance & Compliance control catalogs.
 * Frameworks: OWASP LLM Top 10, HIPAA (agent-relevant safeguards), NIST AI RMF.
 */

export const COMPLIANCE_FRAMEWORKS = [
  {
    id: "owasp_llm",
    name: "OWASP LLM Top 10",
    version: "2025",
    description: "OWASP Top 10 for Large Language Model Applications — agent security risks."
  },
  {
    id: "hipaa",
    name: "HIPAA",
    version: "Security Rule (agent-relevant)",
    description: "Technical and administrative safeguards applied to AI agents that may touch ePHI."
  },
  {
    id: "nist_ai_rmf",
    name: "NIST AI RMF",
    version: "1.0",
    description: "NIST AI Risk Management Framework — Govern, Map, Measure, Manage functions."
  }
];

/** @typedef {"pass"|"fail"|"partial"|"unknown"|"not_applicable"} ControlStatus */

/**
 * @typedef {object} ComplianceControl
 * @property {string} id
 * @property {string} framework
 * @property {string} code
 * @property {string} title
 * @property {string} description
 * @property {string} [family]
 * @property {string[]} evidenceHints  Signals the assessor looks at
 */

/** @type {ComplianceControl[]} */
export const COMPLIANCE_CONTROLS = [
  // —— OWASP LLM Top 10 ——
  {
    id: "owasp_llm.LLM01",
    framework: "owasp_llm",
    code: "LLM01",
    title: "Prompt Injection",
    description: "Agent resists or mitigates direct/indirect prompt injection that hijacks goals or tools.",
    family: "LLM Top 10",
    evidenceHints: ["instructions", "guardrails", "tools"]
  },
  {
    id: "owasp_llm.LLM02",
    framework: "owasp_llm",
    code: "LLM02",
    title: "Sensitive Information Disclosure",
    description: "Agent does not expose secrets, PII, or PHI through prompts, tools, or memory.",
    family: "LLM Top 10",
    evidenceHints: ["dataAccess", "pii", "phi", "secrets"]
  },
  {
    id: "owasp_llm.LLM03",
    framework: "owasp_llm",
    code: "LLM03",
    title: "Supply Chain",
    description: "Models, tools, plugins, and dependencies used by the agent are known and governed.",
    family: "LLM Top 10",
    evidenceHints: ["model", "framework", "tools", "ownership"]
  },
  {
    id: "owasp_llm.LLM04",
    framework: "owasp_llm",
    code: "LLM04",
    title: "Data and Model Poisoning",
    description: "Training/RAG/memory sources are controlled to reduce poisoning risk.",
    family: "LLM Top 10",
    evidenceHints: ["knowledgeBases", "memory", "rag"]
  },
  {
    id: "owasp_llm.LLM05",
    framework: "owasp_llm",
    code: "LLM05",
    title: "Improper Output Handling",
    description: "Downstream systems treat model output as untrusted (no unsafe eval / command paths).",
    family: "LLM Top 10",
    evidenceHints: ["tools", "codeExecution"]
  },
  {
    id: "owasp_llm.LLM06",
    framework: "owasp_llm",
    code: "LLM06",
    title: "Excessive Agency",
    description: "Tool permissions and autonomy are least-privilege; high-risk actions are constrained.",
    family: "LLM Top 10",
    evidenceHints: ["tools", "overPermissioned", "internet", "codeExecution"]
  },
  {
    id: "owasp_llm.LLM07",
    framework: "owasp_llm",
    code: "LLM07",
    title: "System Prompt Leakage",
    description: "System/developer instructions are protected from extraction.",
    family: "LLM Top 10",
    evidenceHints: ["instructions", "guardrails"]
  },
  {
    id: "owasp_llm.LLM08",
    framework: "owasp_llm",
    code: "LLM08",
    title: "Vector and Embedding Weaknesses",
    description: "Vector stores / RAG corpora are access-controlled and integrity-checked.",
    family: "LLM Top 10",
    evidenceHints: ["knowledgeBases", "rag"]
  },
  {
    id: "owasp_llm.LLM09",
    framework: "owasp_llm",
    code: "LLM09",
    title: "Misinformation",
    description: "Outputs are grounded or reviewed where decisions have material impact.",
    family: "LLM Top 10",
    evidenceHints: ["guardrails", "humanOversight"]
  },
  {
    id: "owasp_llm.LLM10",
    framework: "owasp_llm",
    code: "LLM10",
    title: "Unbounded Consumption",
    description: "Usage, cost, and rate limits prevent abuse and runaway agent loops.",
    family: "LLM Top 10",
    evidenceHints: ["observability", "ownership"]
  },

  // —— HIPAA (agent-relevant) ——
  {
    id: "hipaa.AC",
    framework: "hipaa",
    code: "§164.312(a)",
    title: "Access Control",
    description: "Unique identity and least-privilege access for agents that can reach ePHI.",
    family: "Technical Safeguards",
    evidenceHints: ["ownership", "identity", "overPermissioned"]
  },
  {
    id: "hipaa.AU",
    framework: "hipaa",
    code: "§164.312(b)",
    title: "Audit Controls",
    description: "Agent actions involving ePHI are logged and reviewable.",
    family: "Technical Safeguards",
    evidenceHints: ["observability", "audit"]
  },
  {
    id: "hipaa.IA",
    framework: "hipaa",
    code: "§164.312(d)",
    title: "Person or Entity Authentication",
    description: "Agent runtime authenticates before accessing systems that hold ePHI.",
    family: "Technical Safeguards",
    evidenceHints: ["identity", "auth"]
  },
  {
    id: "hipaa.TR",
    framework: "hipaa",
    code: "§164.312(e)",
    title: "Transmission Security",
    description: "ePHI in transit via agent tools/APIs is protected (TLS / approved channels).",
    family: "Technical Safeguards",
    evidenceHints: ["internet", "connectivity"]
  },
  {
    id: "hipaa.PHI_MIN",
    framework: "hipaa",
    code: "Minimum Necessary",
    title: "Minimum Necessary ePHI",
    description: "Agent tools and knowledge sources are limited to the minimum ePHI required.",
    family: "Privacy Rule",
    evidenceHints: ["phi", "tools", "dataAccess"]
  },
  {
    id: "hipaa.OWNER",
    framework: "hipaa",
    code: "Workforce / Ownership",
    title: "Accountable Owner",
    description: "A responsible owner/team is assigned for agents that may process health data.",
    family: "Administrative Safeguards",
    evidenceHints: ["ownership", "shadowAi"]
  },
  {
    id: "hipaa.GUARD",
    framework: "hipaa",
    code: "Integrity / Guardrails",
    title: "Integrity & Improper Alteration",
    description: "Guardrails or review reduce improper alteration/disclosure of ePHI by the agent.",
    family: "Technical Safeguards",
    evidenceHints: ["guardrails", "phi"]
  },
  {
    id: "hipaa.SHADOW",
    framework: "hipaa",
    code: "Shadow AI",
    title: "No Unmanaged ePHI Agents",
    description: "Agents touching health data are not Shadow AI / unmanaged.",
    family: "Administrative Safeguards",
    evidenceHints: ["shadowAi", "phi"]
  },

  // —— NIST AI RMF ——
  {
    id: "nist.GOVERN_1",
    framework: "nist_ai_rmf",
    code: "GOVERN 1",
    title: "Policies & Accountability",
    description: "Governance policies and accountable roles cover this AI agent.",
    family: "GOVERN",
    evidenceHints: ["ownership", "approval"]
  },
  {
    id: "nist.GOVERN_2",
    framework: "nist_ai_rmf",
    code: "GOVERN 2",
    title: "Risk Culture & Oversight",
    description: "Human oversight or approval path exists for material agent actions.",
    family: "GOVERN",
    evidenceHints: ["humanOversight", "ownership"]
  },
  {
    id: "nist.MAP_1",
    framework: "nist_ai_rmf",
    code: "MAP 1",
    title: "Context of Use",
    description: "Agent purpose, environment, and deployment context are documented.",
    family: "MAP",
    evidenceHints: ["environment", "category", "discovery"]
  },
  {
    id: "nist.MAP_2",
    framework: "nist_ai_rmf",
    code: "MAP 2",
    title: "Categorize Risks",
    description: "Data sensitivity (PII/PHI/secrets) and tool risks are identified.",
    family: "MAP",
    evidenceHints: ["pii", "phi", "tools", "risk"]
  },
  {
    id: "nist.MEASURE_1",
    framework: "nist_ai_rmf",
    code: "MEASURE 1",
    title: "Testing & Evaluation",
    description: "Deep/adversarial scan or equivalent evaluation evidence exists.",
    family: "MEASURE",
    evidenceHints: ["deepScan", "adversarial"]
  },
  {
    id: "nist.MEASURE_2",
    framework: "nist_ai_rmf",
    code: "MEASURE 2",
    title: "Monitoring",
    description: "Observability/telemetry supports ongoing risk measurement.",
    family: "MEASURE",
    evidenceHints: ["observability"]
  },
  {
    id: "nist.MANAGE_1",
    framework: "nist_ai_rmf",
    code: "MANAGE 1",
    title: "Prioritize & Treat Risks",
    description: "High-risk findings (excessive agency, PHI reach, over-permission) are addressed.",
    family: "MANAGE",
    evidenceHints: ["risk", "overPermissioned", "phi", "guardrails"]
  },
  {
    id: "nist.MANAGE_2",
    framework: "nist_ai_rmf",
    code: "MANAGE 2",
    title: "Incident & Change Readiness",
    description: "Owner and inventory linkage enable response when the agent changes or fails.",
    family: "MANAGE",
    evidenceHints: ["ownership", "inventory"]
  }
];

export function listFrameworks() {
  return COMPLIANCE_FRAMEWORKS.map((f) => ({
    ...f,
    builtin: true,
    controlCount: COMPLIANCE_CONTROLS.filter((c) => c.framework === f.id).length
  }));
}

export function listControls(frameworkId) {
  if (!frameworkId) return COMPLIANCE_CONTROLS.map((c) => ({ ...c, builtin: true }));
  return COMPLIANCE_CONTROLS.filter((c) => c.framework === String(frameworkId)).map((c) => ({
    ...c,
    builtin: true
  }));
}

export function getControl(controlId) {
  const hit = COMPLIANCE_CONTROLS.find((c) => c.id === controlId);
  return hit ? { ...hit, builtin: true } : null;
}

function slugify(value, fallback = "custom") {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return slug || fallback;
}

function mapCustomFramework(row, controlCount = 0) {
  return {
    id: row.id,
    name: row.name,
    version: row.version || null,
    description: row.description || "",
    builtin: false,
    controlCount
  };
}

function mapCustomControl(row) {
  const hints = Array.isArray(row.evidence_hints)
    ? row.evidence_hints
    : typeof row.evidence_hints === "string"
      ? (() => {
          try {
            return JSON.parse(row.evidence_hints);
          } catch {
            return [];
          }
        })()
      : [];
  return {
    id: row.id,
    framework: row.framework,
    code: row.code,
    title: row.title,
    description: row.description || "",
    family: row.family || null,
    evidenceHints: hints.map(String),
    builtin: false
  };
}

/** Built-in + tenant custom frameworks/controls. */
export async function listFrameworksForTenant(pool, tenantId) {
  const builtin = listFrameworks();
  if (!pool || !tenantId) return builtin;

  const [fwRes, countRes] = await Promise.all([
    pool.query(
      `SELECT id, name, version, description FROM compliance_custom_frameworks
       WHERE tenant_id=$1 ORDER BY name ASC`,
      [tenantId]
    ),
    pool.query(
      `SELECT framework, COUNT(*)::int AS control_count
       FROM compliance_custom_controls WHERE tenant_id=$1
       GROUP BY framework`,
      [tenantId]
    )
  ]);

  const customCounts = new Map(countRes.rows.map((r) => [r.framework, Number(r.control_count) || 0]));
  const merged = builtin.map((f) => ({
    ...f,
    controlCount: f.controlCount + (customCounts.get(f.id) || 0)
  }));

  for (const row of fwRes.rows) {
    if (merged.some((f) => f.id === row.id)) continue;
    merged.push(mapCustomFramework(row, customCounts.get(row.id) || 0));
  }
  return merged;
}

export async function listControlsForTenant(pool, tenantId, frameworkId = null) {
  const builtin = listControls(frameworkId);
  if (!pool || !tenantId) return builtin;

  const params = [tenantId];
  let sql = `SELECT * FROM compliance_custom_controls WHERE tenant_id=$1`;
  if (frameworkId) {
    params.push(String(frameworkId));
    sql += ` AND framework=$${params.length}`;
  }
  sql += ` ORDER BY code ASC`;
  const custom = await pool.query(sql, params);
  return [...builtin, ...custom.rows.map(mapCustomControl)];
}

export async function getTenantCatalog(pool, tenantId, frameworkId = null) {
  const [frameworks, controls] = await Promise.all([
    listFrameworksForTenant(pool, tenantId),
    listControlsForTenant(pool, tenantId, frameworkId)
  ]);
  return { frameworks, controls };
}

export async function createFramework(pool, tenantId, body = {}) {
  const name = String(body.name || "").trim();
  if (!name) {
    const err = new Error("Framework name is required");
    err.status = 400;
    throw err;
  }
  let id = slugify(body.id || name);
  if (COMPLIANCE_FRAMEWORKS.some((f) => f.id === id)) {
    const err = new Error(`Framework id "${id}" is reserved for a built-in catalog`);
    err.status = 409;
    throw err;
  }
  const version = body.version != null ? String(body.version).trim() || null : null;
  const description = String(body.description || "").trim();

  const existing = await pool.query(
    `SELECT id FROM compliance_custom_frameworks WHERE tenant_id=$1 AND id=$2`,
    [tenantId, id]
  );
  if (existing.rowCount) {
    id = `${id}_${Date.now().toString(36).slice(-4)}`;
  }

  const inserted = await pool.query(
    `INSERT INTO compliance_custom_frameworks (tenant_id, id, name, version, description)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    [tenantId, id, name, version, description]
  );
  return mapCustomFramework(inserted.rows[0], 0);
}

export async function createControl(pool, tenantId, body = {}) {
  const framework = String(body.framework || "").trim();
  const code = String(body.code || "").trim();
  const title = String(body.title || "").trim();
  if (!framework || !code || !title) {
    const err = new Error("framework, code, and title are required");
    err.status = 400;
    throw err;
  }

  const frameworks = await listFrameworksForTenant(pool, tenantId);
  if (!frameworks.some((f) => f.id === framework)) {
    const err = new Error(`Unknown framework "${framework}". Create the framework first.`);
    err.status = 400;
    throw err;
  }

  let id = String(body.id || "").trim() || `${framework}.${slugify(code, "control")}`;
  if (COMPLIANCE_CONTROLS.some((c) => c.id === id)) {
    const err = new Error(`Control id "${id}" is reserved for a built-in control`);
    err.status = 409;
    throw err;
  }

  const description = String(body.description || "").trim();
  const family = body.family != null ? String(body.family).trim() || null : null;
  let evidenceHints = [];
  if (Array.isArray(body.evidenceHints)) {
    evidenceHints = body.evidenceHints.map((h) => String(h).trim()).filter(Boolean);
  } else if (typeof body.evidenceHints === "string") {
    evidenceHints = body.evidenceHints
      .split(/[,;\n]+/)
      .map((h) => h.trim())
      .filter(Boolean);
  }

  const clash = await pool.query(
    `SELECT id FROM compliance_custom_controls WHERE tenant_id=$1 AND id=$2`,
    [tenantId, id]
  );
  if (clash.rowCount) {
    id = `${id}_${Date.now().toString(36).slice(-4)}`;
  }

  const inserted = await pool.query(
    `INSERT INTO compliance_custom_controls
       (tenant_id, id, framework, code, title, description, family, evidence_hints)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     RETURNING *`,
    [tenantId, id, framework, code, title, description, family, JSON.stringify(evidenceHints)]
  );
  return mapCustomControl(inserted.rows[0]);
}
