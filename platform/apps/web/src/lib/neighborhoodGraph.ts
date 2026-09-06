import { type GraphEdge, type GraphNode, type GraphPayload } from "./api";

function valueAt(record: Record<string, unknown>, keys: string[], fallback = "Unknown"): string {
  for (const key of keys) {
    const value = record[key];
    if (value === undefined || value === null || value === "") continue;
    return String(value);
  }
  return fallback;
}

export type GraphLayer = "identity" | "agent" | "runtime" | "data";
export type RiskLevel = "critical" | "high" | "medium" | "low" | "info";

export const GRAPH_LAYERS: GraphLayer[] = ["identity", "agent", "runtime", "data"];

export const LAYER_LABELS: Record<GraphLayer, string> = {
  identity: "Identity",
  agent: "Agent",
  runtime: "Tools & runtime",
  data: "Data & cloud"
};

export const RISK_LABELS: Record<RiskLevel, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info"
};

export const RISK_COLORS: Record<RiskLevel, string> = {
  critical: "#e85d6c",
  high: "#e0a93b",
  medium: "#4d9fff",
  low: "#2eb8a6",
  info: "#8b9cb0"
};

export const LAYER_COLORS: Record<GraphLayer, string> = {
  identity: "#f0abfc",
  agent: "#2eb8a6",
  runtime: "#58a6ff",
  data: "#67e8a3"
};

const IDENTITY_KINDS = new Set([
  "identity",
  "user",
  "owner",
  "connector",
  "edrplatform",
  "serviceprincipal",
  "managedidentity"
]);

const AGENT_KINDS = new Set(["agent", "bedrockagent", "agentalias", "agentid", "copilot"]);

const RUNTIME_KINDS = new Set([
  "tool",
  "mcp",
  "mcpserver",
  "lambda",
  "lambdafunction",
  "framework",
  "model",
  "sagemakerendpoint",
  "ecsservice",
  "ide",
  "api",
  "endpoint",
  "process",
  "runtime"
]);

const DATA_KINDS = new Set([
  "database",
  "bedrockknowledgebase",
  "knowledgebase",
  "cloud",
  "cloudresource",
  "cloudaccount",
  "repo",
  "repository",
  "storage",
  "bucket"
]);

function sanitizeKind(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function graphNodeKind(node: GraphNode): string {
  return sanitizeKind(node.awsType ?? node.kindLabel ?? node.type ?? node.category ?? node.label ?? "asset");
}

export function graphNodeTitle(node: GraphNode): string {
  return valueAt(node, ["displayName", "name", "label", "type"], node.id);
}

export function normalizeGraphNodes(graph?: GraphPayload): GraphNode[] {
  if (!graph?.nodes?.length) return [];
  return graph.nodes.filter((node): node is GraphNode => Boolean(node?.id));
}

export function normalizeGraphEdges(graph?: GraphPayload): GraphEdge[] {
  const edges = graph?.edges ?? graph?.relationships ?? [];
  const nodeIds = new Set((graph?.nodes ?? []).map((node) => String(node.id)));
  return edges.filter((edge) => {
    const source = String(edge.source ?? edge.from ?? "");
    const target = String(edge.target ?? edge.to ?? "");
    return source && target && nodeIds.has(source) && nodeIds.has(target);
  });
}

export function edgeEndpoints(edge: GraphEdge): { source: string; target: string } {
  return {
    source: String(edge.source ?? edge.from ?? ""),
    target: String(edge.target ?? edge.to ?? "")
  };
}

export function edgeRelation(edge: GraphEdge): string {
  return String(edge.type ?? edge.label ?? "RELATED").replace(/\s+/g, "_").toUpperCase();
}

export function nodeLayer(node: GraphNode): GraphLayer {
  const kind = graphNodeKind(node);
  const type = String(node.type || "").toLowerCase();
  const category = String(node.category || "").toLowerCase();
  if (IDENTITY_KINDS.has(kind) || type === "identity" || category === "identity") return "identity";
  if (AGENT_KINDS.has(kind) || type === "agent" || type.includes("agent") || category === "agent") return "agent";
  if (RUNTIME_KINDS.has(kind) || category === "tool" || category === "mcp" || category === "framework") {
    return "runtime";
  }
  if (DATA_KINDS.has(kind) || category === "cloud" || category === "database") return "data";
  if (type.includes("identity") || type.includes("user") || type.includes("connector")) return "identity";
  if (type.includes("tool") || type.includes("lambda") || type.includes("model")) return "runtime";
  if (type.includes("cloud") || type.includes("data") || type.includes("kb") || type.includes("repo")) {
    return "data";
  }
  return "data";
}

export function nodeRisk(node: GraphNode): RiskLevel {
  const score = Number(node.shadowAiScore ?? 0);
  const status = String(node.agentStatus || node.runningStatus || "").toLowerCase();
  const tags = Array.isArray(node.shadowAiTags) ? node.shadowAiTags.map(String) : [];
  const reasons = Array.isArray(node.shadowAiReasons) ? node.shadowAiReasons.map(String) : [];
  const blob = `${tags.join(" ")} ${reasons.join(" ")}`.toLowerCase();
  const layer = nodeLayer(node);

  if (node.shadowAi === true && (score >= 70 || /critical|over.?permission|phi|internet/.test(blob))) {
    return "critical";
  }
  if (node.shadowAi === true || status === "candidate" || /shadow|ownerless|unmanaged/.test(blob)) {
    return "high";
  }
  if (score >= 40 || status === "flagged") return "high";
  if (layer === "data" || layer === "identity") return "medium";
  if (layer === "runtime") return "low";
  if (status === "inactive") return "info";
  return "low";
}

export function isShadowNode(node: GraphNode): boolean {
  if (node.shadowAi === true) return true;
  const status = String(node.agentStatus || "").toLowerCase();
  if (status === "candidate") return true;
  const tags = Array.isArray(node.shadowAiTags) ? node.shadowAiTags.map(String) : [];
  return tags.some((tag) => /shadow|unmanaged|ownerless/.test(tag.toLowerCase()));
}

export function adjacencyMap(edges: GraphEdge[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const add = (from: string, to: string) => {
    if (!from || !to) return;
    const bucket = map.get(from) || new Set<string>();
    bucket.add(to);
    map.set(from, bucket);
  };
  for (const edge of edges) {
    const { source, target } = edgeEndpoints(edge);
    add(source, target);
    add(target, source);
  }
  return map;
}

export function neighborIds(edges: GraphEdge[], nodeId: string | null | undefined): Set<string> {
  const id = String(nodeId || "");
  if (!id) return new Set();
  return adjacencyMap(edges).get(id) || new Set();
}

export function isolatedNodeIds(nodes: GraphNode[], edges: GraphEdge[]): Set<string> {
  const degree = adjacencyMap(edges);
  return new Set(nodes.filter((node) => !degree.get(String(node.id))?.size).map((node) => String(node.id)));
}

export type NeighborhoodFilter = {
  relTypes?: string[];
  layers?: GraphLayer[];
  query?: string;
};

export function filterNeighborhood(
  nodes: GraphNode[],
  edges: GraphEdge[],
  filter: NeighborhoodFilter = {}
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const relAllow = new Set((filter.relTypes || []).map((value) => value.toUpperCase()).filter(Boolean));
  const layerAllow = new Set(filter.layers || []);
  const query = String(filter.query || "")
    .trim()
    .toLowerCase();

  let nextEdges = edges;
  if (relAllow.size) {
    nextEdges = edges.filter((edge) => relAllow.has(edgeRelation(edge)));
  }

  const connected = new Set<string>();
  for (const edge of nextEdges) {
    const { source, target } = edgeEndpoints(edge);
    connected.add(source);
    connected.add(target);
  }

  let nextNodes = nodes.filter((node) => {
    if (layerAllow.size && !layerAllow.has(nodeLayer(node))) return false;
    if (nextEdges.length && !connected.has(String(node.id)) && nodes.length > 1) {
      // Keep isolates only when no relationship filter removed their edges.
      if (relAllow.size) return false;
    }
    if (!query) return true;
    const haystack = [
      graphNodeTitle(node),
      String(node.id),
      String(node.type || ""),
      String(node.category || ""),
      String(node.kindLabel || ""),
      String(node.framework || "")
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });

  const visible = new Set(nextNodes.map((node) => String(node.id)));
  nextEdges = nextEdges.filter((edge) => {
    const { source, target } = edgeEndpoints(edge);
    return visible.has(source) && visible.has(target);
  });

  return { nodes: nextNodes, edges: nextEdges };
}

export type NeighborhoodKpis = {
  nodes: number;
  edges: number;
  critical: number;
  high: number;
  shadow: number;
  isolated: number;
};

export function neighborhoodKpis(nodes: GraphNode[], edges: GraphEdge[]): NeighborhoodKpis {
  const isolated = isolatedNodeIds(nodes, edges);
  return {
    nodes: nodes.length,
    edges: edges.length,
    critical: nodes.filter((node) => nodeRisk(node) === "critical").length,
    high: nodes.filter((node) => nodeRisk(node) === "high").length,
    shadow: nodes.filter((node) => isShadowNode(node)).length,
    isolated: isolated.size
  };
}

export function uniqueRelations(edges: GraphEdge[]): string[] {
  return [...new Set(edges.map(edgeRelation))].sort();
}

export function inboundOutbound(edges: GraphEdge[], nodeId: string): { inbound: GraphEdge[]; outbound: GraphEdge[] } {
  const id = String(nodeId);
  const inbound: GraphEdge[] = [];
  const outbound: GraphEdge[] = [];
  for (const edge of edges) {
    const { source, target } = edgeEndpoints(edge);
    if (target === id) inbound.push(edge);
    if (source === id) outbound.push(edge);
  }
  return { inbound, outbound };
}

export type SecurityLayoutNode = {
  id: string;
  layer: GraphLayer;
  risk: RiskLevel;
  x: number;
  y: number;
};

const COL_X: Record<GraphLayer, number> = {
  identity: 40,
  agent: 320,
  runtime: 600,
  data: 880
};

export function securityLayout(nodes: GraphNode[]): SecurityLayoutNode[] {
  const buckets: Record<GraphLayer, GraphNode[]> = {
    identity: [],
    agent: [],
    runtime: [],
    data: []
  };
  for (const node of nodes) {
    buckets[nodeLayer(node)].push(node);
  }
  for (const layer of GRAPH_LAYERS) {
    buckets[layer].sort((a, b) => {
      const riskRank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      const ra = riskRank[nodeRisk(a)];
      const rb = riskRank[nodeRisk(b)];
      if (ra !== rb) return ra - rb;
      return graphNodeTitle(a).localeCompare(graphNodeTitle(b));
    });
  }

  const positioned: SecurityLayoutNode[] = [];
  for (const layer of GRAPH_LAYERS) {
    buckets[layer].forEach((node, index) => {
      positioned.push({
        id: String(node.id),
        layer,
        risk: nodeRisk(node),
        x: COL_X[layer],
        y: 36 + index * 128
      });
    });
  }
  return positioned;
}
