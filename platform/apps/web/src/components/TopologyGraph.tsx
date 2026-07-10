import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeMouseHandler
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import { type GraphEdge, type GraphNode, type GraphPayload, valueAt } from "../lib/api";

type TopologyGraphProps = {
  graph?: GraphPayload;
  loading?: boolean;
  emptyMessage?: string;
  onNodeSelect?: (node: GraphNode) => void;
};

const palette: Record<string, string> = {
  agent: "#41d6c3",
  model: "#58a6ff",
  framework: "#9bd2ff",
  cloud: "#67e8a3",
  cloudresource: "#67e8a3",
  ide: "#f4bd50",
  tool: "#c8d5e3",
  mcp: "#ffb86b",
  mcpserver: "#ffb86b",
  repo: "#7dd3fc",
  repository: "#7dd3fc",
  database: "#ff6b7a",
  api: "#a8f5e5",
  endpoint: "#c4b5fd",
  edrplatform: "#c4b5fd",
  asset: "#8ba3be"
};

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function graphTheme() {
  return {
    nodeBg: cssVar("--graph-node-bg", "rgba(10, 22, 38, 0.94)"),
    text: cssVar("--text", "#eef6ff"),
    muted: cssVar("--text-muted", "#94a8bf"),
    edge: cssVar("--graph-edge", "rgba(65, 214, 195, 0.55)"),
    labelBg: cssVar("--graph-label-bg", "rgba(8, 17, 31, 0.9)"),
    brand: cssVar("--brand", "#41d6c3"),
    grid: cssVar("--panel-border-strong", "rgba(139, 163, 190, 0.2)")
  };
}

function nodeKind(node: GraphNode): string {
  const raw = String(node.type ?? node.category ?? node.label ?? "asset").toLowerCase();
  return raw.replace(/[^a-z0-9]/g, "");
}

function nodeTitle(node: GraphNode): string {
  const title = valueAt(node, ["displayName", "name", "label", "type"], node.id);
  return title.length > 42 ? `${title.slice(0, 40)}…` : title;
}

function normalizeNodes(graph?: GraphPayload): GraphNode[] {
  if (!graph?.nodes?.length) return [];
  return graph.nodes.filter((node): node is GraphNode => Boolean(node?.id));
}

function normalizeEdges(graph?: GraphPayload): GraphEdge[] {
  const edges = graph?.edges ?? graph?.relationships ?? [];
  const nodeIds = new Set((graph?.nodes ?? []).map((n) => String(n.id)));
  return edges.filter((edge) => {
    const source = String(edge.source ?? edge.from ?? "");
    const target = String(edge.target ?? edge.to ?? "");
    return source && target && nodeIds.has(source) && nodeIds.has(target);
  });
}

/** Layered radial/grid hybrid so large graphs stay readable with fitView */
function layoutNodes(nodes: GraphNode[]): Node[] {
  const theme = graphTheme();
  const agents = nodes.filter((n) => String(n.type).toLowerCase() === "agent");
  const others = nodes.filter((n) => String(n.type).toLowerCase() !== "agent");
  const positioned: Node[] = [];

  const agentCols = Math.max(3, Math.ceil(Math.sqrt(Math.max(agents.length, 1))));
  agents.forEach((node, index) => {
    const col = index % agentCols;
    const row = Math.floor(index / agentCols);
    const kind = nodeKind(node);
    const color = palette[kind] ?? palette.agent;
    positioned.push({
      id: String(node.id),
      data: {
        label: (
          <div>
            <strong>{nodeTitle(node)}</strong>
            <div className="muted" style={{ fontSize: 11 }}>
              {String(node.category || node.type || "agent")}
            </div>
          </div>
        )
      },
      position: { x: 80 + col * 220, y: 60 + row * 110 },
      style: {
        minWidth: 160,
        maxWidth: 200,
        border: `1px solid ${color}`,
        background: theme.nodeBg,
        boxShadow: `0 0 24px ${color}22`,
        color: theme.text,
        padding: 10,
        fontSize: 12
      }
    });
  });

  const otherCols = Math.max(4, Math.ceil(Math.sqrt(Math.max(others.length, 1))));
  const agentRows = Math.ceil(agents.length / agentCols) || 1;
  const baseY = 60 + agentRows * 110 + 80;
  others.forEach((node, index) => {
    const col = index % otherCols;
    const row = Math.floor(index / otherCols);
    const kind = nodeKind(node);
    const color = palette[kind] ?? palette.asset;
    positioned.push({
      id: String(node.id),
      data: {
        label: (
          <div>
            <strong>{nodeTitle(node)}</strong>
            <div className="muted" style={{ fontSize: 11 }}>
              {String(node.type || node.category || "asset")}
            </div>
          </div>
        )
      },
      position: { x: 40 + col * 200, y: baseY + row * 100 },
      style: {
        minWidth: 140,
        maxWidth: 190,
        border: `1px solid ${color}`,
        background: theme.nodeBg,
        boxShadow: `0 0 20px ${color}18`,
        color: theme.text,
        padding: 10,
        fontSize: 12
      }
    });
  });

  return positioned;
}

function layoutEdges(edges: GraphEdge[]): Edge[] {
  const theme = graphTheme();
  return edges.map((edge, index) => ({
    id: String(edge.id ?? `${edge.from ?? edge.source}-${edge.to ?? edge.target}-${index}`),
    source: String(edge.source ?? edge.from),
    target: String(edge.target ?? edge.to),
    label: String(edge.type ?? edge.label ?? ""),
    animated: edges.length < 80,
    style: { stroke: theme.edge },
    labelStyle: { fill: theme.muted, fontWeight: 600, fontSize: 10 },
    labelBgStyle: { fill: theme.labelBg }
  }));
}

function TopologyGraphInner({
  graph,
  loading,
  emptyMessage = "No graph relationships are available for the current scope.",
  onNodeSelect
}: TopologyGraphProps) {
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setThemeTick((value) => value + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const graphNodes = useMemo(() => normalizeNodes(graph), [graph]);
  const nodes = useMemo(() => layoutNodes(graphNodes), [graphNodes, themeTick]);
  const edges = useMemo(() => layoutEdges(normalizeEdges(graph)), [graph, themeTick]);
  const theme = useMemo(() => graphTheme(), [themeTick]);
  const meta = (graph as GraphPayload & { meta?: { message?: string; nodeCount?: number; edgeCount?: number } })
    ?.meta;

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    const selected = graphNodes.find((candidate) => String(candidate.id) === node.id);
    if (selected) onNodeSelect?.(selected);
  };

  if (loading) {
    return <div className="loading-state">Rendering graph neighborhood...</div>;
  }

  if (!nodes.length) {
    return <div className="empty-state">{meta?.message || emptyMessage}</div>;
  }

  return (
    <div className="graph-shell">
      <div className="graph-meta">
        {nodes.length} nodes · {edges.length} edges
        {meta?.message ? ` · ${meta.message}` : ""}
      </div>
      <ReactFlow
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
        nodes={nodes}
        edges={edges}
        minZoom={0.15}
        maxZoom={1.75}
        proOptions={{ hideAttribution: true }}
        onNodeClick={handleNodeClick}
      >
        <Background color={theme.grid} gap={28} />
        <MiniMap pannable zoomable nodeColor={(node) => String(node.style?.border ?? theme.brand)} />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export function TopologyGraph(props: TopologyGraphProps) {
  return (
    <ReactFlowProvider>
      <TopologyGraphInner {...props} />
    </ReactFlowProvider>
  );
}
