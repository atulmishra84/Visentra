import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps
} from "@xyflow/react";
import { memo, useEffect, useMemo, useState } from "react";
import {
  buildAgentExecutionTopology,
  type ExecNodeKind,
  type ExecRiskLane,
  type ExecTopoNode,
  type ExecTopology
} from "../lib/buildAgentExecutionTopology";

type AgentExecutionTopologyProps = {
  agent: Record<string, unknown>;
  title?: string;
  compact?: boolean;
};

const LANE_COLOR: Record<ExecRiskLane, string> = {
  state_modifying: "#e5484d",
  phi_access: "#e8a838",
  informational: "#3b82f6",
  neutral: "#8b9cb3"
};

const KIND_GLYPH: Record<ExecNodeKind, string> = {
  ingress: "◎",
  agent: "✦",
  tool: "⚡",
  runtime: "λ",
  datastore: "▣",
  identity: "⚿"
};

function laneLabel(lane: ExecRiskLane): string {
  if (lane === "state_modifying") return "State modifying";
  if (lane === "phi_access") return "PHI / PII access";
  if (lane === "informational") return "Informational";
  return "Neutral";
}

type ExecNodeData = { payload: ExecTopoNode };

const ExecNodeView = memo(function ExecNodeView({ data, selected }: NodeProps & { data: ExecNodeData }) {
  const node = data.payload;
  const color = LANE_COLOR[node.lane];
  const isAgent = node.kind === "agent";
  return (
    <div
      className={`exec-node exec-node-${node.kind} ${selected ? "is-selected" : ""}`}
      style={{
        borderColor: color,
        boxShadow: selected ? `0 0 0 2px ${color}, 0 0 24px ${color}44` : undefined
      }}
    >
      <Handle type="target" position={Position.Left} className="exec-handle" />
      <div className="exec-node-head">
        <span className="exec-node-glyph" style={{ color }}>
          {isAgent ? <span className="exec-brand-mark">V</span> : KIND_GLYPH[node.kind]}
        </span>
        <div>
          <div className="exec-node-kind">{node.kind}</div>
          <strong className="exec-node-title">{node.label}</strong>
        </div>
      </div>
      {node.subtitle ? <div className="exec-node-sub">{node.subtitle}</div> : null}
      <div className="exec-node-lane" style={{ color }}>
        {laneLabel(node.lane)}
      </div>
      <Handle type="source" position={Position.Right} className="exec-handle" />
    </div>
  );
});

const nodeTypes = { exec: ExecNodeView };

function columnFor(kind: ExecNodeKind): number {
  if (kind === "ingress") return 0;
  if (kind === "agent" || kind === "identity") return 1;
  if (kind === "tool") return 2;
  if (kind === "runtime") return 3;
  return 4;
}

function layoutTopology(topo: ExecTopology): { nodes: Node[]; edges: Edge[] } {
  const byCol = new Map<number, ExecTopoNode[]>();
  for (const node of topo.nodes) {
    const col = columnFor(node.kind);
    const list = byCol.get(col) || [];
    list.push(node);
    byCol.set(col, list);
  }

  for (const [, list] of byCol) {
    list.sort((a, b) => {
      if (a.kind === "agent") return -1;
      if (b.kind === "agent") return 1;
      if (a.lane === "state_modifying" && b.lane !== "state_modifying") return -1;
      if (b.lane === "state_modifying" && a.lane !== "state_modifying") return 1;
      return a.label.localeCompare(b.label);
    });
  }

  const rfNodes: Node[] = [];
  for (const [col, list] of [...byCol.entries()].sort((a, b) => a[0] - b[0])) {
    list.forEach((node, row) => {
      const yBase = node.kind === "identity" ? 150 : 0;
      rfNodes.push({
        id: node.id,
        type: "exec",
        position: { x: 40 + col * 240, y: yBase + row * 120 },
        data: { payload: node }
      });
    });
  }

  const rfEdges: Edge[] = topo.edges.map((edge) => {
    const color = LANE_COLOR[edge.lane];
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      animated: edge.lane === "state_modifying" || edge.lane === "phi_access",
      style: {
        stroke: color,
        strokeWidth: edge.lane === "state_modifying" ? 2.2 : 1.6,
        strokeDasharray: edge.lane === "informational" ? "5 4" : undefined
      },
      labelStyle: { fill: color, fontWeight: 600, fontSize: 10 },
      labelBgStyle: { fill: "var(--graph-label-bg)" },
      labelBgPadding: [3, 5] as [number, number],
      labelBgBorderRadius: 4,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 }
    };
  });

  return { nodes: rfNodes, edges: rfEdges };
}

function FitViewOnData({ nonce }: { nonce: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.18, maxZoom: 1.05, duration: 180 });
    }, 40);
    return () => window.clearTimeout(timer);
  }, [fitView, nonce]);
  return null;
}

function TelemetryPanel({ node }: { node: ExecTopoNode | null }) {
  if (!node) {
    return (
      <aside className="exec-telemetry">
        <p className="eyebrow">Selected node telemetry</p>
        <h3>Click a component</h3>
        <p className="muted">
          Inspect blast radius, privileges, and security impact for tools, Lambdas, and data stores on
          this agent path.
        </p>
      </aside>
    );
  }

  const color = LANE_COLOR[node.lane];
  return (
    <aside className="exec-telemetry">
      <p className="eyebrow">Selected node telemetry</p>
      <div className="exec-telemetry-badges">
        {node.severity ? (
          <span className="badge" style={{ borderColor: color, color }}>
            {String(node.severity).toUpperCase()}
          </span>
        ) : null}
        <span className="badge">{laneLabel(node.lane)}</span>
      </div>
      <h3 className="mono">{node.label}</h3>
      <p className="muted">{node.role || node.kind}</p>
      <div className="exec-telemetry-grid">
        <div>
          <span className="deep-kpi-label">Privilege</span>
          <strong className="mono" style={{ fontSize: "0.78rem", wordBreak: "break-all" }}>
            {node.privilege || "—"}
          </strong>
        </div>
        <div>
          <span className="deep-kpi-label">Component</span>
          <strong>{node.kind}</strong>
        </div>
      </div>
      {node.impact ? (
        <div className="exec-impact" style={{ borderColor: color }}>
          <strong>Security impact</strong>
          <p>{node.impact}</p>
        </div>
      ) : null}
      {node.evidence && node.evidence.length > 0 ? (
        <div className="chart-list" style={{ marginTop: 12 }}>
          {node.evidence.map((line) => (
            <div className="bar-row" key={line}>
              <span>Evidence</span>
              <span>{line}</span>
              <span />
            </div>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

function AgentExecutionTopologyInner({ agent, title, compact }: AgentExecutionTopologyProps) {
  const topo = useMemo(() => buildAgentExecutionTopology(agent), [agent]);
  const laidOut = useMemo(() => layoutTopology(topo), [topo]);
  const [nodes, setNodes, onNodesChange] = useNodesState(laidOut.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(laidOut.edges);
  const [selected, setSelected] = useState<ExecTopoNode | null>(null);

  useEffect(() => {
    setNodes(laidOut.nodes);
    setEdges(laidOut.edges);
    setSelected(null);
  }, [laidOut, setNodes, setEdges]);

  if (topo.nodes.length === 0) {
    return (
      <section className="panel exec-topology-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Execution path</p>
            <h2>{title || "Node topology & relationships"}</h2>
          </div>
        </div>
        <p className="muted">{topo.emptyReason || "No execution topology available."}</p>
      </section>
    );
  }

  return (
    <section className="panel exec-topology-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Execution path</p>
          <h2>{title || "Node topology & relationships"}</h2>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            Click any component to inspect downstream blast radius and security boundaries. Built from{" "}
            <span className="mono">metadata.deep</span> + <span className="mono">adversarial_surface</span>.
          </p>
        </div>
        <div className="exec-legend">
          <span>
            <i style={{ background: LANE_COLOR.state_modifying }} /> State modifying
          </span>
          <span>
            <i style={{ background: LANE_COLOR.phi_access }} /> PHI access
          </span>
          <span>
            <i style={{ background: LANE_COLOR.informational }} /> Informational
          </span>
          <span className="muted">Confidence {Math.round(topo.confidence * 100)}%</span>
        </div>
      </div>

      <div className={`exec-topology-layout ${compact ? "is-compact" : ""}`}>
        <div className="graph-shell exec-graph-shell">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.35}
            maxZoom={1.4}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => {
              const payload = (node.data as ExecNodeData | undefined)?.payload;
              setSelected(payload || null);
            }}
            onPaneClick={() => setSelected(null)}
          >
            <Background gap={18} size={1} />
            <Controls showInteractive={false} />
            <FitViewOnData nonce={`${topo.nodes.length}:${topo.edges.length}:${topo.confidence}`} />
          </ReactFlow>
        </div>
        <TelemetryPanel node={selected} />
      </div>
    </section>
  );
}

export function AgentExecutionTopology(props: AgentExecutionTopologyProps) {
  return (
    <ReactFlowProvider>
      <AgentExecutionTopologyInner {...props} />
    </ReactFlowProvider>
  );
}
