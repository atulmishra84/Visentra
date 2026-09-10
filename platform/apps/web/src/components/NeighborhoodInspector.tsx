import { Link } from "react-router";
import { type GraphEdge, type GraphNode, valueAt } from "../lib/api";
import {
  edgeEndpoints,
  edgeRelation,
  graphNodeTitle,
  inboundOutbound,
  isShadowNode,
  LAYER_COLORS,
  LAYER_LABELS,
  nodeLayer,
  nodeRisk,
  RISK_COLORS,
  RISK_LABELS
} from "../lib/neighborhoodGraph";

type NeighborhoodInspectorProps = {
  node: GraphNode | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  onSelectPeer: (node: GraphNode) => void;
  onFocus: (node: GraphNode) => void;
};

function looksLikeAgent(node: GraphNode): boolean {
  return nodeLayer(node) === "agent";
}

export function NeighborhoodInspector({
  node,
  nodes,
  edges,
  onSelectPeer,
  onFocus
}: NeighborhoodInspectorProps) {
  if (!node) {
    return (
      <div className="rx-inspector-empty">
        <p className="eyebrow">Inspector</p>
        <h2>Select a node</h2>
        <p className="page-description">
          Click an identity, agent, tool, or data node to see risk, owner, and inbound/outbound blast radius.
        </p>
      </div>
    );
  }

  const layer = nodeLayer(node);
  const risk = nodeRisk(node);
  const io = inboundOutbound(edges, String(node.id));
  const byId = new Map(nodes.map((item) => [String(item.id), item]));
  const agent = looksLikeAgent(node);

  return (
    <div className="rx-inspector">
      <p className="eyebrow">Inspector</p>
      <h2>{graphNodeTitle(node)}</h2>
      <p className="muted">{valueAt(node, ["kindLabel", "type", "category"], "Entity")}</p>
      <div className="rx-pills">
        <span className="sg-pill" style={{ borderColor: LAYER_COLORS[layer] }}>
          {LAYER_LABELS[layer]}
        </span>
        <span className="sg-pill" style={{ borderColor: RISK_COLORS[risk] }}>
          {RISK_LABELS[risk]}
        </span>
        {isShadowNode(node) ? <span className="sg-pill is-shadow">Shadow</span> : null}
      </div>
      <dl className="sg-meta">
        <div>
          <dt>Status</dt>
          <dd>{valueAt(node, ["agentStatus", "runningStatus"], "—")}</dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>{valueAt(node, ["owner"], "Unassigned")}</dd>
        </div>
        <div>
          <dt>Account</dt>
          <dd>{valueAt(node, ["accountId", "subscriptionId", "connectorName"], "—")}</dd>
        </div>
        {agent ? (
          <>
            <div>
              <dt>Agent ID</dt>
              <dd>{valueAt(node, ["agentId"], "—")}</dd>
            </div>
            <div>
              <dt>Resource group</dt>
              <dd>{valueAt(node, ["resourceGroup"], "—")}</dd>
            </div>
          </>
        ) : null}
        <div>
          <dt>Region</dt>
          <dd>{valueAt(node, ["region"], "—")}</dd>
        </div>
      </dl>
      <div className="sg-io">
        <h3>Inbound · {io.inbound.length}</h3>
        {io.inbound.length ? (
          <ul>
            {io.inbound.slice(0, 8).map((edge) => {
              const { source } = edgeEndpoints(edge);
              const peer = byId.get(source);
              return (
                <li key={String(edge.id ?? `${source}-${edgeRelation(edge)}`)}>
                  <button type="button" onClick={() => peer && onSelectPeer(peer)}>
                    {peer ? graphNodeTitle(peer) : source}
                  </button>
                  <span>{edgeRelation(edge).replace(/_/g, " ")}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">No inbound edges in this view.</p>
        )}
        <h3>Outbound · {io.outbound.length}</h3>
        {io.outbound.length ? (
          <ul>
            {io.outbound.slice(0, 8).map((edge) => {
              const { target } = edgeEndpoints(edge);
              const peer = byId.get(target);
              return (
                <li key={String(edge.id ?? `${target}-${edgeRelation(edge)}`)}>
                  <button type="button" onClick={() => peer && onSelectPeer(peer)}>
                    {peer ? graphNodeTitle(peer) : target}
                  </button>
                  <span>{edgeRelation(edge).replace(/_/g, " ")}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">No outbound edges in this view.</p>
        )}
      </div>
      <div className="toolbar" style={{ marginTop: 12 }}>
        {agent ? (
          <>
            <Link className="button primary" to={`/agents/${encodeURIComponent(String(node.id))}`}>
              Open agent
            </Link>
            <button className="button" type="button" onClick={() => onFocus(node)}>
              Focus here
            </button>
          </>
        ) : (
          <button className="button ghost" type="button" onClick={() => onFocus(node)}>
            Focus neighborhood
          </button>
        )}
      </div>
    </div>
  );
}
