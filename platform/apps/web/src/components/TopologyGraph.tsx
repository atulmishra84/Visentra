import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler
} from "@xyflow/react";
import { useMemo } from "react";
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
  ide: "#f4bd50",
  tool: "#c8d5e3",
  mcp: "#ffb86b",
  repo: "#7dd3fc",
  database: "#ff6b7a",
  api: "#a8f5e5"
};

function nodeKind(node: GraphNode): string {
  return String(node.type ?? node.label ?? "asset").toLowerCase();
}

function nodeTitle(node: GraphNode): string {
  return valueAt(node, ["displayName", "name", "label", "type"], node.id);
}

function normalizeNodes(graph?: GraphPayload): GraphNode[] {
  if (!graph?.nodes?.length) {
    return [];
  }

  return graph.nodes.filter((node): node is GraphNode => Boolean(node?.id));
}

function normalizeEdges(graph?: GraphPayload): GraphEdge[] {
  const edges = graph?.edges ?? graph?.relationships ?? [];
  return edges.filter((edge) => Boolean((edge.source ?? edge.from) && (edge.target ?? edge.to)));
}

function layoutNodes(nodes: GraphNode[]): Node[] {
  const radius = Math.max(220, nodes.length * 28);
  const centerX = 440;
  const centerY = 300;

  return nodes.map((node, index) => {
    const angle = nodes.length === 1 ? 0 : (index / nodes.length) * Math.PI * 2;
    const kind = nodeKind(node);
    const color = palette[kind] ?? "#8ba3be";

    return {
      id: node.id,
      data: {
        label: (
          <div>
            <strong>{nodeTitle(node)}</strong>
            <div className="muted" style={{ fontSize: 11 }}>
              {kind}
            </div>
          </div>
        )
      },
      position: {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius
      },
      style: {
        minWidth: 150,
        border: `1px solid ${color}`,
        background: "rgba(10, 22, 38, 0.94)",
        boxShadow: `0 0 30px ${color}22`,
        color: "#eef6ff",
        padding: 12
      }
    };
  });
}

function layoutEdges(edges: GraphEdge[]): Edge[] {
  return edges.map((edge, index) => ({
    id: String(edge.id ?? `${edge.from ?? edge.source}-${edge.to ?? edge.target}-${index}`),
    source: String(edge.source ?? edge.from),
    target: String(edge.target ?? edge.to),
    label: String(edge.type ?? edge.label ?? ""),
    animated: true,
    style: { stroke: "rgba(65, 214, 195, 0.6)" },
    labelStyle: { fill: "#94a8bf", fontWeight: 700 },
    labelBgStyle: { fill: "rgba(8, 17, 31, 0.9)" }
  }));
}

export function TopologyGraph({
  graph,
  loading,
  emptyMessage = "No graph relationships are available for the current scope.",
  onNodeSelect
}: TopologyGraphProps) {
  const graphNodes = useMemo(() => normalizeNodes(graph), [graph]);
  const nodes = useMemo(() => layoutNodes(graphNodes), [graphNodes]);
  const edges = useMemo(() => layoutEdges(normalizeEdges(graph)), [graph]);

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    const selected = graphNodes.find((candidate) => candidate.id === node.id);
    if (selected) {
      onNodeSelect?.(selected);
    }
  };

  if (loading) {
    return <div className="loading-state">Rendering graph neighborhood...</div>;
  }

  if (!nodes.length) {
    return <div className="empty-state">{emptyMessage}</div>;
  }

  return (
    <div className="graph-shell">
      <ReactFlow
        fitView
        nodes={nodes}
        edges={edges}
        proOptions={{ hideAttribution: true }}
        onNodeClick={handleNodeClick}
      >
        <Background color="rgba(139, 163, 190, 0.2)" gap={28} />
        <MiniMap pannable zoomable nodeColor={(node) => String(node.style?.border ?? "#41d6c3")} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
