import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AgentAnatomyPanel, type AgentAnatomy } from "../components/AgentAnatomyPanel";
import { AgentExecutionTopology } from "../components/AgentExecutionTopology";
import { GraphSeedBar, type GraphSeedOption } from "../components/GraphSeedBar";
import { NeighborhoodInspector } from "../components/NeighborhoodInspector";
import { TopologyGraph } from "../components/TopologyGraph";
import { apiRequest, type Agent, type GraphNode, type GraphPayload, valueAt } from "../lib/api";
import {
  blastRadius,
  filterNeighborhood,
  GRAPH_LAYERS,
  LAYER_COLORS,
  LAYER_LABELS,
  neighborhoodKpis,
  normalizeGraphEdges,
  normalizeGraphNodes,
  RISK_COLORS,
  RISK_LABELS,
  uniqueRelations
} from "../lib/neighborhoodGraph";

type SideTab = "node" | "anatomy" | "path";
type ViewMode = "full" | "radius";

function looksLikeAgentId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function RelationshipExplorerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [seed, setSeed] = useState(() => searchParams.get("agentId") || searchParams.get("seed") || "");
  const [depth, setDepth] = useState(2);
  const [graph, setGraph] = useState<GraphPayload | undefined>();
  const [seeds, setSeeds] = useState<GraphSeedOption[]>([]);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anatomy, setAnatomy] = useState<AgentAnatomy | null>(null);
  const [anatomyLoading, setAnatomyLoading] = useState(false);
  const [anatomyError, setAnatomyError] = useState<string | null>(null);
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(() => searchParams.get("agentId") || null);
  const [focusedAgent, setFocusedAgent] = useState<Agent | null>(null);
  const [sideTab, setSideTab] = useState<SideTab>("node");
  const [viewMode, setViewMode] = useState<ViewMode>("full");
  const [shadowOnly, setShadowOnly] = useState(false);
  const [highPlus, setHighPlus] = useState(false);
  const [relTypes, setRelTypes] = useState<string[]>([]);
  const [showLabels, setShowLabels] = useState<boolean | null>(null);
  const [latestAgent, setLatestAgent] = useState<{ id: string; name: string } | null>(null);

  const loadSeeds = async (q = "") => {
    try {
      const payload = await apiRequest<{ seeds?: GraphSeedOption[] }>("/api/graph/seeds", {
        query: { q: q || undefined }
      });
      setSeeds(payload.seeds || []);
    } catch {
      /* non-blocking */
    }
  };

  const loadLatest = async () => {
    try {
      const payload = await apiRequest<{ agents?: Agent[] }>("/api/agents", { query: { limit: 1 } });
      const agent = payload.agents?.[0];
      if (agent?.id) {
        setLatestAgent({
          id: String(agent.id),
          name: valueAt(agent, ["displayName", "name"], String(agent.id))
        });
      } else {
        setLatestAgent(null);
      }
    } catch {
      setLatestAgent(null);
    }
  };

  const loadAnatomy = async (agentId: string | null) => {
    if (!agentId) {
      setAnatomy(null);
      setAnatomyError(null);
      setFocusedAgentId(null);
      setFocusedAgent(null);
      return;
    }
    setAnatomyLoading(true);
    setAnatomyError(null);
    setFocusedAgentId(agentId);
    try {
      const [anatomyPayload, agentPayload] = await Promise.all([
        apiRequest<AgentAnatomy>(`/api/agents/${agentId}/anatomy`),
        apiRequest<{ agent?: Agent } | Agent>(`/api/agents/${agentId}`).catch(() => null)
      ]);
      setAnatomy(anatomyPayload);
      const agentRecord =
        agentPayload && typeof agentPayload === "object" && "agent" in agentPayload
          ? ((agentPayload as { agent?: Agent }).agent as Agent | undefined) || null
          : ((agentPayload as Agent | null) || null);
      setFocusedAgent(agentRecord);
    } catch (requestError) {
      setAnatomy(null);
      setFocusedAgent(null);
      setAnatomyError(requestError instanceof Error ? requestError.message : "Failed to load agent anatomy.");
    } finally {
      setAnatomyLoading(false);
    }
  };

  const resolveFocusedAgent = (payload: GraphPayload, nextSeed: string) => {
    if (looksLikeAgentId(nextSeed)) return nextSeed;
    const nodes = payload.nodes || [];
    const agents = nodes.filter((node) => {
      const type = String(node.type || node.category || "").toLowerCase();
      return type === "agent" || type.includes("agent");
    });
    if (agents.length === 1) return String(agents[0].id);
    if (payload.meta?.seed && looksLikeAgentId(String(payload.meta.seed))) return String(payload.meta.seed);
    const byName = agents.find(
      (node) =>
        valueAt(node, ["name", "label"], "").toLowerCase() === nextSeed.toLowerCase() || String(node.id) === nextSeed
    );
    return byName ? String(byName.id) : null;
  };

  const loadGraph = async (nextSeed = seed) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiRequest<GraphPayload>("/api/graph", {
        query: {
          agentId: nextSeed || undefined,
          depth,
          limit: nextSeed ? 80 : 50
        }
      });
      setGraph(payload);
      setSelected(null);
      const agentId = nextSeed ? resolveFocusedAgent(payload, nextSeed) : null;
      await loadAnatomy(agentId);
      const nextParams = new URLSearchParams();
      if (agentId) nextParams.set("agentId", agentId);
      else if (nextSeed) nextParams.set("seed", nextSeed);
      setSearchParams(nextParams, { replace: true });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to load relationship graph.");
      setGraph({ nodes: [], edges: [] });
      setAnatomy(null);
      setFocusedAgent(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSeeds();
    void loadLatest();
    void loadGraph(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const listener = (event: Event) => {
      const type = String((event as CustomEvent).detail?.type || "");
      if (!type || type === "connected") return;
      void loadSeeds();
      void loadLatest();
      if (type === "discovery.job.completed" || type === "inventory.agent.updated") {
        void loadGraph(seed);
      }
    };
    window.addEventListener("visentra:graph-event", listener);
    return () => window.removeEventListener("visentra:graph-event", listener);
  }, [seed]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void loadGraph(seed);
  };

  const onNodeSelect = (node: GraphNode) => {
    setSelected(node);
    setSideTab("node");
    const type = String(node.type || node.category || "").toLowerCase();
    if (type === "agent" || type.includes("agent")) {
      setSeed(String(node.id));
      void loadAnatomy(String(node.id));
      setSearchParams({ agentId: String(node.id) }, { replace: true });
    }
  };

  const rawNodes = useMemo(() => normalizeGraphNodes(graph), [graph]);
  const rawEdges = useMemo(() => normalizeGraphEdges(graph), [graph]);
  const relations = useMemo(() => uniqueRelations(rawEdges), [rawEdges]);
  const filtered = useMemo(() => {
    let next = filterNeighborhood(rawNodes, rawEdges, {
      relTypes,
      shadowOnly,
      minRisk: highPlus ? "high" : undefined
    });
    if (viewMode === "radius") {
      next = blastRadius(next.nodes, next.edges, selected?.id || focusedAgentId);
    }
    return next;
  }, [rawNodes, rawEdges, relTypes, shadowOnly, highPlus, viewMode, selected?.id, focusedAgentId]);
  const scopedGraph = useMemo<GraphPayload>(
    () => ({ nodes: filtered.nodes, edges: filtered.edges, meta: graph?.meta }),
    [filtered, graph?.meta]
  );
  const kpis = useMemo(() => neighborhoodKpis(filtered.nodes, filtered.edges), [filtered]);
  const compactLabels = showLabels === null ? filtered.nodes.length > 12 : !showLabels;
  const focusedName =
    (focusedAgent && valueAt(focusedAgent, ["displayName", "name"], "")) ||
    (anatomy?.center && valueAt(anatomy.center as Record<string, unknown>, ["name"], "")) ||
    seeds.find((item) => item.id === focusedAgentId)?.name ||
    "";

  const toggleRel = (rel: string) => {
    setRelTypes((current) => (current.includes(rel) ? current.filter((item) => item !== rel) : [...current, rel]));
  };

  const focusLatest = () => {
    if (!latestAgent) return;
    setSeed(latestAgent.id);
    void loadGraph(latestAgent.id);
  };

  return (
    <div className="page rx-page">
      <header className="rx-header">
        <div>
          <p className="eyebrow">Neighborhood</p>
          <h1>{focusedName ? `Neighborhood · ${focusedName}` : "Relationship Explorer"}</h1>
          <p className="page-description">
            {focusedName
              ? `${depth} hop${depth === 1 ? "" : "s"} around this agent — identities, tools, runtimes, and data it can reach.`
              : "Focus an agent to open its neural neighborhood. Anatomy is the agent internals tab; tenant overview is a separate map."}
          </p>
        </div>
        <div className="toolbar">
          {latestAgent && latestAgent.id !== focusedAgentId ? (
            <button className="button" type="button" onClick={focusLatest}>
              Focus latest · {latestAgent.name.slice(0, 28)}
            </button>
          ) : null}
          {focusedAgentId ? (
            <Link className="button ghost" to={`/agents/${encodeURIComponent(focusedAgentId)}`}>
              Open agent
            </Link>
          ) : null}
          <Link
            className="button ghost"
            to={
              focusedAgentId
                ? `/topology?agentId=${encodeURIComponent(focusedAgentId)}`
                : seed
                  ? `/topology?agentId=${encodeURIComponent(seed)}`
                  : "/topology"
            }
          >
            Tenant overview
          </Link>
        </div>
      </header>

      <GraphSeedBar
        idPrefix="relationship"
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
          void loadGraph("");
        }}
        onPickSeed={(option) => {
          setSeed(option.id);
          void loadGraph(option.id);
        }}
        onSearchSeeds={(q) => void loadSeeds(q)}
      />

      {error ? <div className="error-state">{error}</div> : null}

      <div className="rx-kpis" aria-label="Neighborhood counts">
        <span>
          <strong>{kpis.nodes}</strong> nodes
        </span>
        <span>
          <strong>{kpis.edges}</strong> edges
        </span>
        <span>
          <strong>{kpis.shadow}</strong> shadow
        </span>
        <span>
          <strong>{kpis.critical}</strong> critical
        </span>
      </div>

      <div className="rx-stage" id="neighborhood">
        <section className="rx-canvas" aria-label="Neighborhood neural graph">
          <div className="rx-map-bar" aria-label="Map filters">
            <button
              className={`sg-chip ${viewMode === "full" ? "is-on" : ""}`}
              type="button"
              onClick={() => setViewMode("full")}
            >
              Full neighborhood
            </button>
            <button
              className={`sg-chip ${viewMode === "radius" ? "is-on" : ""}`}
              type="button"
              onClick={() => setViewMode("radius")}
            >
              Blast radius
            </button>
            <button
              className={`sg-chip ${shadowOnly ? "is-on" : ""}`}
              type="button"
              onClick={() => setShadowOnly((value) => !value)}
            >
              Shadow
            </button>
            <button
              className={`sg-chip ${highPlus ? "is-on" : ""}`}
              type="button"
              onClick={() => setHighPlus((value) => !value)}
            >
              High+
            </button>
            <button
              className={`sg-chip ${compactLabels ? "" : "is-on"}`}
              type="button"
              onClick={() => setShowLabels(compactLabels)}
            >
              Labels
            </button>
            {relations.map((rel) => (
              <button
                key={rel}
                className={`sg-chip ${relTypes.includes(rel) ? "is-on" : ""}`}
                type="button"
                onClick={() => toggleRel(rel)}
              >
                {rel.replace(/_/g, " ")}
              </button>
            ))}
          </div>
          <TopologyGraph
            graph={scopedGraph}
            loading={loading}
            layoutMode="neural"
            selectedNodeId={selected ? String(selected.id) : null}
            seedNodeId={focusedAgentId}
            hideMinimap
            hideMeta
            compactLabels={compactLabels}
            emptyContent={
              rawNodes.length ? (
                <div className="rx-empty">
                  <h3>No nodes match these filters</h3>
                  <p>Clear Shadow, High+, blast radius, or relationship chips to widen the neighborhood.</p>
                </div>
              ) : (
              <div className="rx-empty">
                <h3>No neighborhood to plot</h3>
                <p>
                  This map shows the identities, tools, runtimes, and data around a focused agent. Run discovery, then
                  focus the latest agent or pick one from Inventory.
                </p>
                <div className="toolbar">
                  {latestAgent ? (
                    <button className="button primary" type="button" onClick={focusLatest}>
                      Focus latest · {latestAgent.name.slice(0, 24)}
                    </button>
                  ) : (
                    <Link className="button primary" to="/discovery">
                      Open Discovery
                    </Link>
                  )}
                  <Link className="button" to="/settings/connectors">
                    Connectors
                  </Link>
                  <Link className="button ghost" to="/inventory">
                    Inventory
                  </Link>
                </div>
              </div>
              )
            }
            onNodeSelect={onNodeSelect}
          />
          <aside className="rx-legend" aria-label="Map legend">
            <p className="eyebrow">Kind</p>
            {GRAPH_LAYERS.map((layer) => (
              <div className="rx-legend-row" key={layer}>
                <i style={{ background: LAYER_COLORS[layer] }} />
                {LAYER_LABELS[layer]}
              </div>
            ))}
            <p className="eyebrow" style={{ marginTop: 10 }}>
              Risk
            </p>
            {(Object.keys(RISK_LABELS) as Array<keyof typeof RISK_LABELS>).map((risk) => (
              <div className="rx-legend-row" key={risk}>
                <i style={{ background: RISK_COLORS[risk] }} />
                {RISK_LABELS[risk]}
              </div>
            ))}
          </aside>
        </section>

        <aside className="rx-side" aria-label="Neighborhood details">
          <div className="rx-tabs" role="tablist">
            <button
              className={`rx-tab ${sideTab === "node" ? "is-on" : ""}`}
              type="button"
              role="tab"
              aria-selected={sideTab === "node"}
              onClick={() => setSideTab("node")}
            >
              Node
            </button>
            <button
              className={`rx-tab ${sideTab === "anatomy" ? "is-on" : ""}`}
              type="button"
              role="tab"
              aria-selected={sideTab === "anatomy"}
              onClick={() => setSideTab("anatomy")}
            >
              Anatomy
            </button>
            <button
              className={`rx-tab ${sideTab === "path" ? "is-on" : ""}`}
              type="button"
              role="tab"
              aria-selected={sideTab === "path"}
              onClick={() => setSideTab("path")}
            >
              Path
            </button>
          </div>
          <div className="rx-side-body">
            {sideTab === "node" ? (
              <NeighborhoodInspector
                node={selected}
                nodes={filtered.nodes}
                edges={filtered.edges}
                onSelectPeer={(peer) => {
                  setSelected(peer);
                }}
                onFocus={(node) => {
                  setSeed(String(node.id));
                  void loadGraph(String(node.id));
                }}
              />
            ) : null}
            {sideTab === "anatomy" ? (
              <AgentAnatomyPanel
                anatomy={anatomy}
                loading={anatomyLoading}
                error={anatomyError}
                embedded
                onClear={
                  focusedAgentId
                    ? () => {
                        setSeed("");
                        void loadGraph("");
                      }
                    : undefined
                }
              />
            ) : null}
            {sideTab === "path" ? (
              focusedAgent ? (
                <AgentExecutionTopology
                  agent={focusedAgent as Record<string, unknown>}
                  title="Execution path"
                  compact
                />
              ) : (
                <p className="muted">Focus an agent to see its execution path and tool relationships.</p>
              )
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
