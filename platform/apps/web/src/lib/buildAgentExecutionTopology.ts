/**
 * Build LTR agent execution / attack-path topology from
 * metadata.deep + metadata.adversarial_surface.
 * Does not invent resources absent from those payloads.
 */

export type ExecRiskLane = "state_modifying" | "phi_access" | "informational" | "neutral";
export type ExecNodeKind = "ingress" | "agent" | "tool" | "runtime" | "datastore" | "identity";

export type ExecTopoNode = {
  id: string;
  kind: ExecNodeKind;
  label: string;
  subtitle?: string;
  lane: ExecRiskLane;
  severity?: "critical" | "high" | "medium" | "low" | "info";
  role?: string;
  privilege?: string;
  impact?: string;
  evidence?: string[];
  meta?: Record<string, unknown>;
};

export type ExecTopoEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  lane: ExecRiskLane;
};

export type ExecTopology = {
  nodes: ExecTopoNode[];
  edges: ExecTopoEdge[];
  confidence: number;
  emptyReason?: string;
};

type AnyRec = Record<string, unknown>;

function asRec(value: unknown): AnyRec | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRec) : null;
}

function asArr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function lambdaFromPermission(permission: string): string | null {
  const arn = String(permission).match(/arn:aws:lambda:[^:]+:\d+:function:([A-Za-z0-9_-]+)/);
  if (arn) return arn[1];
  const invoke = String(permission).match(/^(?:invoke|lambda:InvokeFunction)[:/](.+)$/i);
  if (!invoke) return null;
  const tail = invoke[1].split(":").pop() || invoke[1];
  return tail.replace(/^function\//, "") || null;
}

function laneForTool(tool: AnyRec, surfaceHasPhi: boolean): ExecRiskLane {
  const flags = asRec(tool.risk_flags) || asRec(tool.riskFlags) || {};
  const name = String(tool.name || "");
  if (flags.can_modify_state === true || flags.can_write_data === true) return "state_modifying";
  // Prefer explicit state-mutation naming even when risk_flags are sparse.
  if (/update|write|delete|create|put|patch|mutate|send_/i.test(name)) {
    return "state_modifying";
  }
  // Retrieval tools stay informational; PHI is shown on the KB/store nodes.
  if (/retrieve|search|kb|knowledge|rag/i.test(name)) {
    return "informational";
  }
  const blob = `${name} ${tool.description || ""}`;
  if (
    flags.can_access_phi === true ||
    flags.can_access_pii === true ||
    surfaceHasPhi ||
    /phi|pii|claim|patient|medical/i.test(blob)
  ) {
    return "phi_access";
  }
  if (/lookup|get_/i.test(name)) return "informational";
  return "neutral";
}

function severityFor(lane: ExecRiskLane): ExecTopoNode["severity"] {
  if (lane === "state_modifying") return "critical";
  if (lane === "phi_access") return "high";
  if (lane === "informational") return "info";
  return "medium";
}

function impactFor(tool: AnyRec, lane: ExecRiskLane): string {
  const desc = String(tool.description || "").trim();
  if (desc) return desc;
  if (lane === "state_modifying") {
    return "Allows persistent alteration of backend state without a confirmed human approval gate.";
  }
  if (lane === "phi_access") {
    return "Can read or return sensitive claim/PII/PHI-adjacent data via tool invocation.";
  }
  return "Tool is reachable from the agent orchestration path.";
}

function roleFor(lane: ExecRiskLane): string {
  if (lane === "state_modifying") return "State mutation action tool";
  if (lane === "phi_access") return "Sensitive data access tool";
  return "Action / retrieval tool";
}

/** Build topology from an agent record (needs metadata.deep and/or adversarial_surface). */
export function buildAgentExecutionTopology(agent: AnyRec): ExecTopology {
  const meta = asRec(agent.metadata) || {};
  const deep = asRec(meta.deep);
  const surface = asRec(meta.adversarial_surface);
  if (!deep && !surface) {
    return {
      nodes: [],
      edges: [],
      confidence: 0,
      emptyReason:
        "No metadata.deep or adversarial_surface yet. Re-run AWS discovery after granting GetAgent IAM."
    };
  }

  const tools = asArr(surface?.tools).length ? asArr(surface?.tools) : asArr(deep?.tools);
  const memory = asRec(surface?.memory_and_context);
  const dataAccess = asRec(surface?.data_access) || asRec(agent.dataAccessClassification);
  const identity = asRec(surface?.identity_and_access) || asRec(deep?.identity);
  const kbs = asArr(memory?.knowledge_bases).length
    ? asArr(memory?.knowledge_bases)
    : asArr(deep?.knowledgeBases);
  const stores = asArr(dataAccess?.data_stores);
  const surfaceHasPhi =
    dataAccess?.has_phi === true ||
    dataAccess?.hasPhi === true ||
    asArr(dataAccess?.data_classes || dataAccess?.dataClasses).some((c) =>
      /phi|pii/i.test(String(c))
    );

  const agentName = String(
    agent.name || agent.displayName || deep?.agentName || meta.agentName || "Agent"
  );
  const roleArn = String(
    identity?.arn || deep?.agentResourceRoleArn || meta.agentResourceRoleArn || ""
  );
  const roleName = String(
    identity?.name || (roleArn ? roleArn.split("/").pop() : "") || "execution role"
  );

  const nodes: ExecTopoNode[] = [];
  const edges: ExecTopoEdge[] = [];
  const seen = new Set<string>();

  const addNode = (node: ExecTopoNode) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    nodes.push(node);
  };
  const addEdge = (edge: ExecTopoEdge) => {
    if (!seen.has(edge.source) || !seen.has(edge.target)) return;
    if (edges.some((e) => e.source === edge.source && e.target === edge.target)) return;
    edges.push(edge);
  };

  addNode({
    id: "ingress",
    kind: "ingress",
    label: "User / Ingress",
    subtitle: "InvokeAgent / alias",
    lane: "informational",
    severity: "info",
    role: "Caller entrypoint",
    privilege: "bedrock:InvokeAgent",
    impact: "External or internal caller enters the agent orchestration path."
  });

  addNode({
    id: "agent",
    kind: "agent",
    label: agentName,
    subtitle: String(deep?.foundationModel || meta.foundationModel || "Bedrock Agent"),
    lane: "neutral",
    severity: "medium",
    role: "Orchestrating agent",
    privilege: roleName,
    impact: "Routes prompts to tools, knowledge bases, and downstream runtimes.",
    evidence: asArr(surface?.evidence).map(String).slice(0, 6),
    meta: { foundationModel: deep?.foundationModel || meta.foundationModel }
  });

  addEdge({
    id: "e-ingress-agent",
    source: "ingress",
    target: "agent",
    label: "invoke",
    lane: "informational"
  });

  if (roleArn || identity?.name) {
    addNode({
      id: "identity",
      kind: "identity",
      label: roleName,
      subtitle: "IAM execution role",
      lane: "neutral",
      severity: "medium",
      role: "Agent resource role",
      privilege: roleArn || roleName,
      impact: "Permissions boundary for tool and knowledge-base calls.",
      evidence: asArr(identity?.evidence).map(String).slice(0, 4)
    });
    addEdge({
      id: "e-agent-identity",
      source: "agent",
      target: "identity",
      label: "assumes",
      lane: "neutral"
    });
  }

  tools.forEach((raw, index) => {
    const tool = asRec(raw) || {};
    const name = String(tool.name || `tool-${index + 1}`);
    const toolId = `tool:${slug(name)}`;
    const lane = laneForTool(tool, surfaceHasPhi);
    const permissions = asArr(tool.permissions || tool.permission).map(String);
    addNode({
      id: toolId,
      kind: "tool",
      label: name,
      subtitle: String(tool.source || "action group tool"),
      lane,
      severity: severityFor(lane),
      role: roleFor(lane),
      privilege: permissions[0] || "agent tool invoke",
      impact: impactFor(tool, lane),
      evidence: asArr(tool.evidence).map(String).slice(0, 4),
      meta: { risk_flags: tool.risk_flags || tool.riskFlags, permissions }
    });
    addEdge({
      id: `e-agent-${toolId}`,
      source: "agent",
      target: toolId,
      label: "uses",
      lane
    });

    permissions.forEach((perm) => {
      const lambda = lambdaFromPermission(perm);
      if (!lambda) return;
      const runtimeId = `runtime:lambda:${slug(lambda)}`;
      addNode({
        id: runtimeId,
        kind: "runtime",
        label: `Lambda: ${lambda}`,
        subtitle: "Action group executor",
        lane,
        severity: severityFor(lane),
        role: "Lambda executor",
        privilege: "lambda:InvokeFunction",
        impact: `Tool ${name} can invoke this function.`,
        evidence: [`Permission ${perm}`]
      });
      addEdge({
        id: `e-${toolId}-${runtimeId}`,
        source: toolId,
        target: runtimeId,
        label: "invoke",
        lane
      });
    });
  });

  kbs.forEach((raw, index) => {
    const kb = asRec(raw) || {};
    const name = String(kb.name || kb.id || kb.knowledgeBaseId || `kb-${index + 1}`);
    const kbId = `store:kb:${slug(name)}`;
    const lane: ExecRiskLane = surfaceHasPhi ? "phi_access" : "informational";
    addNode({
      id: kbId,
      kind: "datastore",
      label: name,
      subtitle: "Knowledge base",
      lane,
      severity: severityFor(lane),
      role: "Retrieval corpus",
      privilege: String(kb.access_level || "read"),
      impact: "Agent can retrieve grounded content from this knowledge base.",
      evidence: asArr(kb.evidence).map(String).slice(0, 3)
    });
    const retrieveTool = nodes.find(
      (n) =>
        n.kind === "tool" &&
        (/retrieve|kb|knowledge|search|rag/i.test(n.label) || n.lane === "informational")
    );
    if (retrieveTool) {
      addEdge({
        id: `e-${retrieveTool.id}-${kbId}`,
        source: retrieveTool.id,
        target: kbId,
        label: "retrieve",
        lane
      });
    } else {
      addEdge({
        id: `e-agent-${kbId}`,
        source: "agent",
        target: kbId,
        label: "retrieve",
        lane
      });
    }
  });

  stores.forEach((raw, index) => {
    const store = asRec(raw) || {};
    const name = String(store.name || store.id || `store-${index + 1}`);
    const type = String(store.type || "data_store");
    if (/knowledge_base/i.test(type)) return;
    const storeId = `store:${slug(type)}:${slug(name)}`;
    const sensitive = /phi|pii|secret|high/i.test(
      `${store.sensitivity || ""} ${asArr(store.data_classes).join(" ")}`
    );
    const lane: ExecRiskLane = sensitive || surfaceHasPhi ? "phi_access" : "neutral";
    addNode({
      id: storeId,
      kind: "datastore",
      label: name,
      subtitle: type,
      lane,
      severity: severityFor(lane),
      role: "Data store",
      privilege: String(store.access_level || "unknown"),
      impact: "Referenced by adversarial data_access inventory.",
      evidence: asArr(store.evidence).map(String).slice(0, 3)
    });
    const bridge =
      nodes.find((n) => n.kind === "runtime" && n.lane === "state_modifying") ||
      nodes.find((n) => n.kind === "runtime") ||
      nodes.find((n) => n.kind === "tool" && n.lane === "state_modifying") ||
      nodes.find((n) => n.kind === "tool");
    if (bridge) {
      addEdge({
        id: `e-${bridge.id}-${storeId}`,
        source: bridge.id,
        target: storeId,
        label: "access",
        lane
      });
    }
  });

  const signalCount = tools.length + kbs.length + stores.length;
  const confidence = Math.min(
    0.98,
    0.35 +
      (deep ? 0.25 : 0) +
      (surface ? 0.2 : 0) +
      Math.min(0.18, tools.length * 0.04) +
      Math.min(0.1, kbs.length * 0.05)
  );

  if (signalCount === 0) {
    return {
      nodes,
      edges,
      confidence,
      emptyReason:
        "Agent profile present but no tools, knowledge bases, or data stores to draw an execution path."
    };
  }

  return { nodes, edges, confidence };
}
