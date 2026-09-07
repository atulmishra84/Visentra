import {
  Background,
  BackgroundVariant,
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
import { memo, type ReactNode, useEffect, useMemo, useState } from "react";
import { type GraphEdge, type GraphNode, type GraphPayload, valueAt } from "../lib/api";
import {
  neighborIds,
  neuralLayout,
  nodeLayer,
  nodeRisk,
  RISK_COLORS,
  securityLayout,
  type RiskLevel
} from "../lib/neighborhoodGraph";

type TopologyGraphProps = {
  graph?: GraphPayload;
  loading?: boolean;
  emptyMessage?: string;
  onNodeSelect?: (node: GraphNode) => void;
  layoutMode?: "grid" | "security" | "neural";
  selectedNodeId?: string | null;
  seedNodeId?: string | null;
  hideMeta?: boolean;
  hideMinimap?: boolean;
  emptyContent?: ReactNode;
  className?: string;
};

const palette: Record<string, string> = {
  agent: "#41d6c3",
  bedrockagent: "#41d6c3",
  bedrockknowledgebase: "#67e8a3",
  lambdafunction: "#f4bd50",
  sagemakerendpoint: "#58a6ff",
  ecsservice: "#9bd2ff",
  model: "#58a6ff",
  framework: "#9bd2ff",
  cloud: "#67e8a3",
  cloudresource: "#67e8a3",
  cloudaccount: "#34d399",
  connector: "#a78bfa",
  agentalias: "#c4b5fd",
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
    grid: cssVar("--panel-border-strong", "rgba(139, 163, 190, 0.2)"),
    candidate: "#94a8bf"
  };
}

function sanitizeKind(value: unknown): string {
  return String(value ?? "asset")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function nodeKindKey(node: GraphNode): string {
  return sanitizeKind(node.awsType ?? node.kindLabel ?? node.type ?? node.category ?? node.label ?? "asset");
}

function nodeKindLabel(node: GraphNode): string {
  const awsType = valueAt(node, ["awsType", "kindLabel"], "");
  if (awsType) return awsType;
  return String(node.type || node.category || "Asset");
}

function nodeTitle(node: GraphNode): string {
  const title = valueAt(node, ["displayName", "name", "label", "type"], node.id);
  return title.length > 42 ? `${title.slice(0, 40)}…` : title;
}

function nodeSubtitle(node: GraphNode): string {
  const parts: string[] = [];
  const status = valueAt(node, ["agentStatus"], "");
  const lifecycle = valueAt(node, ["awsLifecycleStatus", "runningStatus"], "");
  const account = valueAt(node, ["accountId"], "");
  const region = valueAt(node, ["region"], "");
  if (status) parts.push(status);
  if (lifecycle && lifecycle.toLowerCase() !== status.toLowerCase()) parts.push(lifecycle);
  if (account) parts.push(account.length > 8 ? `…${account.slice(-6)}` : account);
  if (region) parts.push(region);
  if (!parts.length) return String(node.category || node.type || "asset");
  return parts.join(" · ");
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
  status?: string;
  managed?: boolean;
  payload: GraphNode;
  handles?: "vertical" | "horizontal";
  risk?: RiskLevel;
  layer?: string;
  dimmed?: boolean;
  hot?: boolean;
  shadow?: boolean;
};

const TopologyNode = memo(function TopologyNode({ data, selected }: NodeProps & { data: TopologyNodeData }) {
  const theme = graphTheme();
  const isCandidate = String(data.status || "").toLowerCase() === "candidate";
  const targetPos = data.handles === "horizontal" ? Position.Left : Position.Top;
  const sourcePos = data.handles === "horizontal" ? Position.Right : Position.Bottom;
  return (
    <div
      className={[
        "topology-node",
        selected ? "is-selected" : "",
        isCandidate ? "is-candidate" : "",
        data.managed ? "is-managed" : "",
        data.dimmed ? "is-dimmed" : "",
        data.hot ? "is-hot" : "",
        data.shadow ? "is-shadow" : "",
        data.risk ? `risk-${data.risk}` : ""
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        borderColor: data.color,
        borderStyle: isCandidate || data.shadow ? "dashed" : "solid",
        background: theme.nodeBg,
        boxShadow: selected
          ? `0 0 0 2px ${data.color}, 0 0 28px ${data.color}55`
          : data.hot
            ? `0 0 0 1px ${data.color}, 0 0 18px ${data.color}33`
            : `0 0 20px ${data.color}18`,
        color: theme.text
      }}
    >
      <Handle type="target" position={targetPos} className="topology-handle" />
      <div className="topology-node-kind" style={{ color: data.color }}>
        {data.kind}
        {data.risk ? <span className="topology-node-risk">{data.risk}</span> : null}
      </div>
      <strong className="topology-node-title">{data.title}</strong>
      <div className="topology-node-sub" style={{ color: theme.muted }}>
        {data.subtitle}
      </div>
      <Handle type="source" position={sourcePos} className="topology-handle" />
    </div>
  );
});

const NeuralNode = memo(function NeuralNode({ data, selected }: NodeProps & { data: TopologyNodeData }) {
  return (
    <div
      className={[
        "neural-node",
        selected ? "is-selected" : "",
        data.dimmed ? "is-dimmed" : "",
        data.hot ? "is-hot" : "",
        data.shadow ? "is-shadow" : "",
        data.layer === "agent" ? "is-nucleus" : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Handle type="target" position={Position.Top} className="neural-handle" />
      <Handle type="source" position={Position.Bottom} className="neural-handle" />
      <span
        className="neural-orb"
        style={{
          background: `radial-gradient(circle at 35% 30%, #fff6, ${data.color} 46%, ${data.color}aa)`,
          boxShadow: selected
            ? `0 0 0 2px ${data.color}, 0 0 28px ${data.color}`
            : `0 0 16px ${data.color}99`
        }}
      />
      <strong className="neural-label">{data.title}</strong>
      <span className="neural-kind" style={{ color: data.color }}>
        {data.kind}
      </span>
    </div>
  );
});

const nodeTypes = { topology: TopologyNode, neural: NeuralNode };

function layoutNodes(nodes: GraphNode[]): Node[] {
  const agents = nodes.filter((n) => String(n.type).toLowerCase() === "agent");
  const others = nodes.filter((n) => String(n.type).toLowerCase() !== "agent");
  const positioned: Node[] = [];
  const theme = graphTheme();

  const agentCols = Math.max(3, Math.ceil(Math.sqrt(Math.max(agents.length, 1))));
  agents.forEach((node, index) => {
    const col = index % agentCols;
    const row = Math.floor(index / agentCols);
    const kind = nodeKindKey(node);
    const status = valueAt(node, ["agentStatus"], "");
    const color =
      status.toLowerCase() === "candidate" ? theme.candidate : palette[kind] ?? palette.agent;
    positioned.push({
      id: String(node.id),
      type: "topology",
      data: {
        title: nodeTitle(node),
        subtitle: nodeSubtitle(node),
        color,
        kind: nodeKindLabel(node),
        status,
        managed: Boolean(node.managedCloudAgent),
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
    const kind = nodeKindKey(node);
    const color = palette[kind] ?? palette.asset;
    positioned.push({
      id: String(node.id),
      type: "topology",
      data: {
        title: nodeTitle(node),
        subtitle: nodeSubtitle(node),
        color,
        kind: nodeKindLabel(node),
        payload: node
      },
      position: { x: 40 + col * 210, y: baseY + row * 120 }
    });
  });

  return positioned;
}

function layoutEdges(edges: GraphEdge[], highlightIds?: Set<string>): Edge[] {
  const theme = graphTheme();
  const emphasis = new Set(["USES_KNOWLEDGE_BASE", "EXPOSES_ALIAS", "OBSERVED_BY"]);
  return edges.map((edge, index) => {
    const rel = String(edge.type ?? edge.label ?? "");
    const source = String(edge.source ?? edge.from);
    const target = String(edge.target ?? edge.to);
    const strong = emphasis.has(rel);
    const hot = Boolean(highlightIds?.size && highlightIds.has(source) && highlightIds.has(target));
    const dimmed = Boolean(highlightIds?.size && !hot);
    return {
      id: String(edge.id ?? `${edge.from ?? edge.source}-${edge.to ?? edge.target}-${index}`),
      source,
      target,
      label: rel.replace(/_/g, " "),
      animated: hot || ((strong || edges.length < 80) && !dimmed),
      style: {
        stroke: hot ? theme.brand : dimmed ? "rgba(139, 163, 190, 0.18)" : strong ? theme.brand : theme.edge,
        strokeWidth: hot ? 2.4 : strong ? 2 : 1.5,
        opacity: dimmed ? 0.35 : 1
      },
      labelStyle: { fill: theme.muted, fontWeight: 600, fontSize: 10 },
      labelBgStyle: { fill: theme.labelBg },
      labelBgPadding: [4, 6] as [number, number],
      labelBgBorderRadius: 6
    };
  });
}

function layoutNeuralNodes(
  nodes: GraphNode[],
  edges: GraphEdge[],
  selectedId?: string | null,
  highlightIds?: Set<string>,
  seedId?: string | null
): Node[] {
  const placed = neuralLayout(nodes, edges, seedId || selectedId);
  const byId = new Map(nodes.map((node) => [String(node.id), node]));
  return placed.map((slot) => {
    const node = byId.get(slot.id);
    if (!node) {
      return {
        id: slot.id,
        type: "neural",
        position: { x: slot.x, y: slot.y },
        data: {
          title: slot.id,
          subtitle: "",
          color: RISK_COLORS[slot.risk],
          kind: "node",
          payload: { id: slot.id }
        }
      };
    }
    const status = valueAt(node, ["agentStatus"], "");
    const selected = selectedId === slot.id;
    const hot = Boolean(highlightIds?.has(slot.id));
    return {
      id: slot.id,
      type: "neural",
      data: {
        title: nodeTitle(node),
        subtitle: nodeSubtitle(node),
        color: RISK_COLORS[slot.risk],
        kind: nodeKindLabel(node),
        status,
        managed: Boolean(node.managedCloudAgent),
        payload: node,
        risk: slot.risk,
        layer: nodeLayer(node),
        dimmed: Boolean(highlightIds?.size && !hot),
        hot: hot && !selected,
        shadow: node.shadowAi === true || status.toLowerCase() === "candidate"
      },
      position: { x: slot.x, y: slot.y }
    };
  });
}

function layoutSecurityNodes(nodes: GraphNode[], selectedId?: string | null, highlightIds?: Set<string>): Node[] {
  const placed = securityLayout(nodes);
  const byId = new Map(nodes.map((node) => [String(node.id), node]));
  return placed.map((slot) => {
    const node = byId.get(slot.id);
    if (!node) {
      return {
        id: slot.id,
        type: "topology",
        position: { x: slot.x, y: slot.y },
        data: { title: slot.id, subtitle: slot.layer, color: RISK_COLORS[slot.risk], kind: slot.layer, payload: { id: slot.id } }
      };
    }
    const status = valueAt(node, ["agentStatus"], "");
    const selected = selectedId === slot.id;
    const hot = Boolean(highlightIds?.has(slot.id));
    const dimmed = Boolean(highlightIds?.size && !hot);
    return {
      id: slot.id,
      type: "topology",
      data: {
        title: nodeTitle(node),
        subtitle: nodeSubtitle(node),
        color: RISK_COLORS[slot.risk],
        kind: nodeKindLabel(node),
        status,
        managed: Boolean(node.managedCloudAgent),
        payload: node,
        handles: "horizontal",
        risk: slot.risk,
        layer: nodeLayer(node),
        dimmed,
        hot: hot && !selected,
        shadow: node.shadowAi === true || status.toLowerCase() === "candidate"
      },
      position: { x: slot.x, y: slot.y }
    };
  });
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
  onNodeSelect,
  layoutMode = "grid",
  selectedNodeId = null,
  seedNodeId = null,
  hideMeta = false,
  hideMinimap = false,
  emptyContent,
  className
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
  const highlightIds = useMemo(() => {
    if (!selectedNodeId) return new Set<string>();
    const next = neighborIds(graphEdges, selectedNodeId);
    next.add(selectedNodeId);
    return next;
  }, [graphEdges, selectedNodeId]);
  const layoutNonce = useMemo(
    () =>
      `${layoutMode}|${graphNodes.map((n) => n.id).join("|")}|${graphEdges.length}|${selectedNodeId || ""}|${seedNodeId || ""}|${themeTick}`,
    [layoutMode, graphNodes, graphEdges.length, selectedNodeId, seedNodeId, themeTick]
  );

  useEffect(() => {
    if (layoutMode === "security") {
      setNodes(layoutSecurityNodes(graphNodes, selectedNodeId, highlightIds));
      setEdges(layoutEdges(graphEdges, highlightIds));
      return;
    }
    if (layoutMode === "neural") {
      setNodes(layoutNeuralNodes(graphNodes, graphEdges, selectedNodeId, highlightIds, seedNodeId));
      setEdges(layoutEdges(graphEdges, highlightIds));
      return;
    }
    setNodes(layoutNodes(graphNodes));
    setEdges(layoutEdges(graphEdges));
  }, [graphNodes, graphEdges, highlightIds, layoutMode, seedNodeId, selectedNodeId, themeTick, setNodes, setEdges]);

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
    if (layoutMode === "security" || layoutMode === "neural") {
      return (
        <div
          className={["graph-shell", layoutMode === "security" ? "is-security" : "is-neural", "is-empty", className]
            .filter(Boolean)
            .join(" ")}
        >
          {layoutMode === "security" ? (
            <div className="sg-lane-rail" aria-hidden="true">
              <span>Identity</span>
              <span>Agent</span>
              <span>Tools & runtime</span>
              <span>Data & cloud</span>
            </div>
          ) : (
            <div className="nn-empty-hint" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          )}
          <div className="empty-state sg-empty">
            {emptyContent || meta?.message || emptyMessage}
          </div>
        </div>
      );
    }
    return <div className="empty-state">{meta?.message || emptyMessage}</div>;
  }

  return (
    <div
      className={[
        "graph-shell",
        layoutMode === "security" ? "is-security" : "",
        layoutMode === "neural" ? "is-neural" : "",
        className
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {hideMeta ? null : (
        <div className="graph-meta">
          {graphNodes.length} nodes · {graphEdges.length} edges
          {meta?.message ? ` · ${meta.message}` : ""}
        </div>
      )}
      {layoutMode === "security" ? (
        <div className="sg-lane-rail" aria-hidden="true">
          <span>Identity</span>
          <span>Agent</span>
          <span>Tools & runtime</span>
          <span>Data & cloud</span>
        </div>
      ) : null}
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
        defaultEdgeOptions={{ type: layoutMode === "neural" ? "default" : "smoothstep" }}
      >
        <FitViewOnData nonce={layoutNonce} />
        <Background
          color={theme.grid}
          gap={layoutMode === "neural" ? 22 : 28}
          variant={layoutMode === "neural" ? BackgroundVariant.Dots : BackgroundVariant.Lines}
        />
        {hideMinimap ? null : (
          <MiniMap
            pannable
            zoomable
            nodeColor={(node) => String((node.data as TopologyNodeData | undefined)?.color ?? theme.brand)}
          />
        )}
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
