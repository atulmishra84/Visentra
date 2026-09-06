import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { GraphSeedBar, type GraphSeedOption } from "../components/GraphSeedBar";
import { KpiCard } from "../components/KpiCard";
import { TopologyGraph } from "../components/TopologyGraph";
import { apiRequest, type GraphNode, type GraphPayload, valueAt } from "../lib/api";
import {
  edgeEndpoints,
  edgeRelation,
  filterNeighborhood,
  GRAPH_LAYERS,
  graphNodeTitle,
  inboundOutbound,
  isShadowNode,
  LAYER_COLORS,
  LAYER_LABELS,
  neighborhoodKpis,
  nodeLayer,
  nodeRisk,
  normalizeGraphEdges,
  normalizeGraphNodes,
  RISK_COLORS,
  RISK_LABELS,
  uniqueRelations,
  type GraphLayer
} from "../lib/neighborhoodGraph";

function looksLikeAgent(node: GraphNode): boolean {
  const type = String(node.type || node.category || "").toLowerCase();
  return type === "agent" || type.includes("agent");
}

export function NeighborhoodGraphPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const agentId = params.get("agentId") || params.get("seed") || "";
  const [seed, setSeed] = useState(agentId);
  const [depth, setDepth] = useState(Number(params.get("depth") || 2));
  const [graph, setGraph] = useState<GraphPayload | undefined>();
  const [seeds, setSeeds] = useState<GraphSeedOption[]>([]);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [relTypes, setRelTypes] = useState<string[]>([]);
  const [layers, setLayers] = useState<GraphLayer[]>([]);

  const loadSeeds = useCallback(async (q = "") => {
    try {
      const payload = await apiRequest<{ seeds?: GraphSeedOption[] }>("/api/graph/seeds", {
        query: { q: q || undefined }
      });
      setSeeds(payload.seeds || []);
    } catch {
      /* non-blocking */
    }
  }, []);

  const loadGraph = useCallback(
    async (nextSeed = seed, nextDepth = depth) => {
      setLoading(true);
      setError(null);
      try {
        const payload = await apiRequest<GraphPayload>("/api/graph", {
          query: {
            agentId: nextSeed || undefined,
            depth: nextDepth,
            limit: nextSeed ? 80 : 50
          }
        });
        setGraph(payload);
        setSelected(null);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed to load neighborhood graph.");
        setGraph({ nodes: [], edges: [] });
      } finally {
        setLoading(false);
      }
    },
    [depth, seed]
  );

  useEffect(() => {
    setSeed(agentId);
    void loadSeeds();
    void loadGraph(agentId, depth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent).detail as { type?: string } | undefined;
      if (!detail?.type || detail.type === "connected") return;
      void loadGraph(seed, depth);
    };
    window.addEventListener("visentra:graph-event", listener);
    return () => window.removeEventListener("visentra:graph-event", listener);
  }, [depth, loadGraph, seed]);

  const applySeed = (nextSeed: string, nextDepth = depth) => {
    const next = new URLSearchParams(params);
    if (nextSeed.trim()) next.set("agentId", nextSeed.trim());
    else next.delete("agentId");
    next.delete("seed");
    next.set("depth", String(nextDepth));
    setParams(next);
    void loadGraph(nextSeed.trim(), nextDepth);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    applySeed(seed, depth);
  };

  const rawNodes = useMemo(() => normalizeGraphNodes(graph), [graph]);
  const rawEdges = useMemo(() => normalizeGraphEdges(graph), [graph]);
  const relations = useMemo(() => uniqueRelations(rawEdges), [rawEdges]);
  const filtered = useMemo(
    () => filterNeighborhood(rawNodes, rawEdges, { relTypes, layers, query }),
    [rawNodes, rawEdges, relTypes, layers, query]
  );
  const scopedGraph = useMemo<GraphPayload>(
    () => ({
      nodes: filtered.nodes,
      edges: filtered.edges,
      meta: graph?.meta
    }),
    [filtered, graph?.meta]
  );
  const kpis = useMemo(() => neighborhoodKpis(filtered.nodes, filtered.edges), [filtered]);
  const selectedIo = selected ? inboundOutbound(filtered.edges, String(selected.id)) : { inbound: [], outbound: [] };
  const nodeById = useMemo(
    () => new Map(filtered.nodes.map((node) => [String(node.id), node])),
    [filtered.nodes]
  );

  const toggleRel = (rel: string) => {
    setRelTypes((current) => (current.includes(rel) ? current.filter((item) => item !== rel) : [...current, rel]));
  };

  const toggleLayer = (layer: GraphLayer) => {
    setLayers((current) => (current.includes(layer) ? current.filter((item) => item !== layer) : [...current, layer]));
  };

  return (
    <div className="page sg-page">
      <header className="sg-header">
        <div>
          <p className="eyebrow">Security graph</p>
          <h1>Neighborhood</h1>
          <p className="page-description">
            Focused blast-radius view of an agent and the identities, tools, runtimes, and data it can reach.
          </p>
        </div>
        <div className="toolbar">
          <Link
            className="button ghost"
            to={agentId ? `/relationships?agentId=${encodeURIComponent(agentId)}` : "/relationships"}
          >
            Anatomy
          </Link>
          <Link
            className="button ghost"
            to={agentId ? `/topology?agentId=${encodeURIComponent(agentId)}` : "/topology"}
          >
            Topology map
          </Link>
          <button className="button" type="button" onClick={() => void loadGraph(seed, depth)}>
            Refresh
          </button>
        </div>
      </header>

      <div className="card-grid sg-kpis">
        <KpiCard label="Nodes" value={kpis.nodes} trend="In current scope" />
        <KpiCard label="Edges" value={kpis.edges} trend="Visible relationships" />
        <KpiCard label="Critical" value={kpis.critical} tone={kpis.critical ? "bad" : "good"} trend="Highest risk" />
        <KpiCard label="High" value={kpis.high} tone={kpis.high ? "warn" : "neutral"} trend="Elevated risk" />
        <KpiCard label="Shadow" value={kpis.shadow} tone={kpis.shadow ? "warn" : "good"} trend="Unmanaged / candidate" />
        <KpiCard label="Isolated" value={kpis.isolated} tone={kpis.isolated ? "warn" : "neutral"} trend="No edges in view" />
      </div>

      <div className="sg-controls">
        <GraphSeedBar
          idPrefix="neighborhood"
          seed={seed}
          depth={depth}
          seeds={seeds}
          submitLabel="Focus"
          clearLabel="Overview"
          showChips
          onSeedChange={setSeed}
          onDepthChange={setDepth}
          onSubmit={submit}
          onClear={() => {
            setSeed("");
            applySeed("", depth);
          }}
          onPickSeed={(option) => {
            setSeed(option.id);
            applySeed(option.id, depth);
          }}
          onSearchSeeds={(q) => void loadSeeds(q)}
        />
        <div className="sg-filter-row">
          <div className="field sg-search">
            <label htmlFor="neighborhood-filter">Filter nodes</label>
            <input
              className="input"
              id="neighborhood-filter"
              placeholder="Name, type, or ID"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="sg-chip-group" aria-label="Relationship scope">
            {relations.length ? (
              relations.map((rel) => (
                <button
                  key={rel}
                  className={`sg-chip ${relTypes.includes(rel) ? "is-on" : ""}`}
                  type="button"
                  onClick={() => toggleRel(rel)}
                >
                  {rel.replace(/_/g, " ")}
                </button>
              ))
            ) : (
              <span className="muted">No relationships in this neighborhood yet.</span>
            )}
            {relTypes.length ? (
              <button className="sg-chip is-clear" type="button" onClick={() => setRelTypes([])}>
                All relationships
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {error ? <div className="error-state">{error}</div> : null}

      <div className="sg-stage">
        <aside className="sg-legend" aria-label="Graph legend">
          <p className="eyebrow">Layers</p>
          {GRAPH_LAYERS.map((layer) => (
            <button
              key={layer}
              className={`sg-legend-row ${layers.includes(layer) ? "is-on" : ""}`}
              type="button"
              onClick={() => toggleLayer(layer)}
            >
              <i style={{ background: LAYER_COLORS[layer] }} />
              {LAYER_LABELS[layer]}
            </button>
          ))}
          {layers.length ? (
            <button className="sg-chip is-clear" type="button" onClick={() => setLayers([])}>
              All layers
            </button>
          ) : (
            <p className="muted sg-legend-hint">Click a layer to isolate it.</p>
          )}
          <p className="eyebrow" style={{ marginTop: 16 }}>
            Risk
          </p>
          {(Object.keys(RISK_LABELS) as Array<keyof typeof RISK_LABELS>).map((risk) => (
            <div className="sg-legend-row" key={risk}>
              <i style={{ background: RISK_COLORS[risk] }} />
              {RISK_LABELS[risk]}
            </div>
          ))}
          <div className="sg-legend-row">
            <i className="is-dashed" />
            Shadow / candidate
          </div>
        </aside>

        <section className="sg-canvas" aria-label="Neighborhood security graph">
          <TopologyGraph
            graph={scopedGraph}
            loading={loading}
            layoutMode="security"
            selectedNodeId={selected ? String(selected.id) : null}
            hideMeta
            emptyMessage={
              rawNodes.length && (query || relTypes.length || layers.length)
                ? "No nodes match the current filters. Clear relationship or layer chips to widen the blast radius."
                : "No neighborhood to plot. Run discovery, then focus an agent from Inventory."
            }
            onNodeSelect={setSelected}
          />
        </section>

        <aside className="sg-inspector" aria-label="Node inspector">
          {selected ? (
            <>
              <p className="eyebrow">Inspector</p>
              <h2>{graphNodeTitle(selected)}</h2>
              <p className="muted">{valueAt(selected, ["kindLabel", "type", "category"], "Entity")}</p>
              <div className="sg-inspector-pills">
                <span className="sg-pill" style={{ borderColor: LAYER_COLORS[nodeLayer(selected)] }}>
                  {LAYER_LABELS[nodeLayer(selected)]}
                </span>
                <span className="sg-pill" style={{ borderColor: RISK_COLORS[nodeRisk(selected)] }}>
                  {RISK_LABELS[nodeRisk(selected)]}
                </span>
                {isShadowNode(selected) ? <span className="sg-pill is-shadow">Shadow</span> : null}
              </div>
              <dl className="sg-meta">
                <div>
                  <dt>Status</dt>
                  <dd>{valueAt(selected, ["agentStatus", "runningStatus"], "—")}</dd>
                </div>
                <div>
                  <dt>Owner</dt>
                  <dd>{valueAt(selected, ["owner"], "Unassigned")}</dd>
                </div>
                <div>
                  <dt>Account</dt>
                  <dd>{valueAt(selected, ["accountId", "connectorName"], "—")}</dd>
                </div>
                <div>
                  <dt>Region</dt>
                  <dd>{valueAt(selected, ["region"], "—")}</dd>
                </div>
              </dl>
              <div className="sg-io">
                <h3>Inbound · {selectedIo.inbound.length}</h3>
                {selectedIo.inbound.length ? (
                  <ul>
                    {selectedIo.inbound.slice(0, 8).map((edge) => {
                      const { source } = edgeEndpoints(edge);
                      const peer = nodeById.get(source);
                      return (
                        <li key={String(edge.id ?? `${source}-${edgeRelation(edge)}`)}>
                          <button type="button" onClick={() => peer && setSelected(peer)}>
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
                <h3>Outbound · {selectedIo.outbound.length}</h3>
                {selectedIo.outbound.length ? (
                  <ul>
                    {selectedIo.outbound.slice(0, 8).map((edge) => {
                      const { target } = edgeEndpoints(edge);
                      const peer = nodeById.get(target);
                      return (
                        <li key={String(edge.id ?? `${target}-${edgeRelation(edge)}`)}>
                          <button type="button" onClick={() => peer && setSelected(peer)}>
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
                {looksLikeAgent(selected) ? (
                  <>
                    <button
                      className="button primary"
                      type="button"
                      onClick={() => navigate(`/agents/${encodeURIComponent(String(selected.id))}`)}
                    >
                      Open agent
                    </button>
                    <button
                      className="button"
                      type="button"
                      onClick={() => {
                        const id = String(selected.id);
                        setSeed(id);
                        applySeed(id, depth);
                      }}
                    >
                      Focus neighborhood
                    </button>
                  </>
                ) : (
                  <button className="button ghost" type="button" onClick={() => setSelected(null)}>
                    Clear selection
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="eyebrow">Inspector</p>
              <h2>Select a node</h2>
              <p className="page-description">
                Click an identity, agent, tool, or data node to inspect inbound and outbound blast radius.
              </p>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
