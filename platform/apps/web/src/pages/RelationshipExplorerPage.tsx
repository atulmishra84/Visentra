import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AgentAnatomyPanel, type AgentAnatomy } from "../components/AgentAnatomyPanel";
import { AgentExecutionTopology } from "../components/AgentExecutionTopology";
import { GraphSeedBar, type GraphSeedOption } from "../components/GraphSeedBar";
import { NeighborhoodInspector } from "../components/NeighborhoodInspector";
import { TopologyGraph } from "../components/TopologyGraph";
import { apiRequest, type Agent, type GraphNode, type GraphPayload, valueAt } from "../lib/api";
import {
  GRAPH_LAYERS,
  LAYER_COLORS,
  LAYER_LABELS,
  normalizeGraphEdges,
  normalizeGraphNodes,
  RISK_COLORS,
  RISK_LABELS
} from "../lib/neighborhoodGraph";

type SideTab = "node" | "anatomy" | "path";

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
    void loadGraph(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const graphNodes = useMemo(() => normalizeGraphNodes(graph), [graph]);
  const graphEdges = useMemo(() => normalizeGraphEdges(graph), [graph]);
  const focusedName =
    (focusedAgent && valueAt(focusedAgent, ["displayName", "name"], "")) ||
    (anatomy?.center && valueAt(anatomy.center as Record<string, unknown>, ["name"], "")) ||
    seeds.find((item) => item.id === focusedAgentId)?.name ||
    "";

  return (
    <div className="page rx-page">
      <header className="rx-header">
        <div>
          <p className="eyebrow">Relationships</p>
          <h1>{focusedName ? `Neighborhood · ${focusedName}` : "Relationship Explorer"}</h1>
          <p className="page-description">
            {focusedName
              ? `${depth} hop${depth === 1 ? "" : "s"} around this agent — identities, tools, runtimes, and data it can reach.`
              : "Focus an agent to open its neural neighborhood. Anatomy and execution path stay in the inspector."}
          </p>
        </div>
        <div className="toolbar">
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
            Tenant topology
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
        showChips={!focusedAgentId}
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

      <div className="rx-stage" id="neighborhood">
        <section className="rx-canvas" aria-label="Neighborhood neural graph">
          <TopologyGraph
            graph={graph}
            loading={loading}
            layoutMode="neural"
            selectedNodeId={selected ? String(selected.id) : null}
            seedNodeId={focusedAgentId}
            hideMinimap
            hideMeta
            emptyContent={
              <div className="rx-empty">
                <h3>No neighborhood to plot</h3>
                <p>
                  This map shows the identities, tools, runtimes, and data around a focused agent. Run discovery, then
                  pick an agent from Inventory.
                </p>
                <div className="toolbar">
                  <Link className="button primary" to="/discovery">
                    Open Discovery
                  </Link>
                  <Link className="button" to="/settings/connectors">
                    Connectors
                  </Link>
                  <Link className="button ghost" to="/inventory">
                    Inventory
                  </Link>
                </div>
              </div>
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
                nodes={graphNodes}
                edges={graphEdges}
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
