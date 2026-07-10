import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps
} from "@xyflow/react";
import { memo, useEffect, useMemo, useState } from "react";
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
  identity: "#f0abfc",
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

type TopologyNodeData = {
  title: string;
  subtitle: string;
  color: string;
  kind: string;
  payload: GraphNode;
};

const TopologyNode = memo(function TopologyNode({ data, selected }: NodeProps & { data: TopologyNodeData }) {
  const theme = graphTheme();
  return (
    <div
      className={`topology-node ${selected ? "is-selected" : ""}`}
      style={{
        borderColor: data.color,
        background: theme.nodeBg,
        boxShadow: selected ? `0 0 0 2px ${data.color}, 0 0 28px ${data.color}33` : `0 0 20px ${data.color}18`,
        color: theme.text
      }}
    >
      <Handle type="target" position={Position.Top} className="topology-handle" />
      <div className="topology-node-kind" style={{ color: data.color }}>
        {data.kind}
      </div>
      <strong className="topology-node-title">{data.title}</strong>
      <div className="topology-node-sub" style={{ color: theme.muted }}>
        {data.subtitle}
      </div>
      <Handle type="source" position={Position.Bottom} className="topology-handle" />
    </div>
  );
});

const nodeTypes = { topology: TopologyNode };

function layoutNodes(nodes: GraphNode[]): Node[] {
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
      type: "topology",
      data: {
        title: nodeTitle(node),
        subtitle: String(node.category || node.type || "agent"),
        color,
        kind: String(node.type || "Agent"),
        payload: node
      },
      position: { x: 80 + col * 240, y: 40 + row * 130 }
    });
  });

  const otherCols = Math.max(4, Math.ceil(Math.sqrt(Math.max(others.length, 1))));
  const agentRows = Math.ceil(agents.length / agentCols) || 1;
  const baseY = 40 + agentRows * 130 + 70;
  others.forEach((node, index) => {
    const col = index % otherCols;
    const row = Math.floor(index / otherCols);
    const kind = nodeKind(node);
    const color = palette[kind] ?? palette.asset;
    positioned.push({
      id: String(node.id),
      type: "topology",
      data: {
        title: nodeTitle(node),
        subtitle: String(node.type || node.category || "asset"),
        color,
        kind: String(node.type || "Asset"),
        payload: node
      },
      position: { x: 40 + col * 210, y: baseY + row * 120 }
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
    animated: edges.length < 100,
    style: { stroke: theme.edge, strokeWidth: 1.5 },
    labelStyle: { fill: theme.muted, fontWeight: 600, fontSize: 10 },
    labelBgStyle: { fill: theme.labelBg },
    labelBgPadding: [4, 6] as [number, number],
    labelBgBorderRadius: 6
  }));
}

function FitViewOnData({ nonce }: { nonce: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.2, maxZoom: 1.15, duration: 200 });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [fitView, nonce]);
  return null;
}

function TopologyGraphInner({
  graph,
  loading,
  emptyMessage = "No graph relationships are available for the current scope.",
  onNodeSelect
}: TopologyGraphProps) {
  const [themeTick, setThemeTick] = useState(0);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    const observer = new MutationObserver(() => setThemeTick((value) => value + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const graphNodes = useMemo(() => normalizeNodes(graph), [graph]);
  const graphEdges = useMemo(() => normalizeEdges(graph), [graph]);
  const layoutNonce = useMemo(
    () => `${graphNodes.map((n) => n.id).join("|")}|${graphEdges.length}|${themeTick}`,
    [graphNodes, graphEdges.length, themeTick]
  );

  useEffect(() => {
    setNodes(layoutNodes(graphNodes));
    setEdges(layoutEdges(graphEdges));
  }, [graphNodes, graphEdges, themeTick, setNodes, setEdges]);

  const theme = useMemo(() => graphTheme(), [themeTick]);
  const meta = (graph as GraphPayload & { meta?: { message?: string; nodeCount?: number; edgeCount?: number } })
    ?.meta;

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    const payload = (node.data as TopologyNodeData | undefined)?.payload;
    if (payload) onNodeSelect?.(payload);
  };

  if (loading) {
    return <div className="loading-state">Rendering graph neighborhood...</div>;
  }

  if (!graphNodes.length) {
    return <div className="empty-state">{meta?.message || emptyMessage}</div>;
  }

  return (
    <div className="graph-shell">
      <div className="graph-meta">
        {graphNodes.length} nodes · {graphEdges.length} edges
        {meta?.message ? ` · ${meta.message}` : ""}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodesConnectable={false}
        edgesReconnectable={false}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.15 }}
        minZoom={0.12}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
        panOnScroll
        selectionOnDrag={false}
        defaultEdgeOptions={{ type: "smoothstep" }}
      >
        <FitViewOnData nonce={layoutNonce} />
        <Background color={theme.grid} gap={28} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => String((node.data as TopologyNodeData | undefined)?.color ?? theme.brand)}
        />
        <Controls showInteractive={false} />
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
