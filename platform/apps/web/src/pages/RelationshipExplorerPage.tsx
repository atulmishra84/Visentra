import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AgentAnatomyPanel, type AgentAnatomy } from "../components/AgentAnatomyPanel";
import { DetailDrawer } from "../components/DetailDrawer";
import { GraphSeedBar, type GraphSeedOption } from "../components/GraphSeedBar";
import { TopologyGraph } from "../components/TopologyGraph";
import { apiRequest, type GraphNode, type GraphPayload, valueAt } from "../lib/api";

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
  const [showGraph, setShowGraph] = useState(false);

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
      return;
    }
    setAnatomyLoading(true);
    setAnatomyError(null);
    setFocusedAgentId(agentId);
    try {
      const payload = await apiRequest<AgentAnatomy>(`/api/agents/${agentId}/anatomy`);
      setAnatomy(payload);
    } catch (requestError) {
      setAnatomy(null);
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
    const type = String(node.type || node.category || "").toLowerCase();
    if (type === "agent" || type.includes("agent")) {
      setSeed(String(node.id));
      void loadAnatomy(String(node.id));
      setSearchParams({ agentId: String(node.id) }, { replace: true });
    }
  };

  return (
    <div className="page relationships-page">
      {!focusedAgentId ? (
        <header className="page-header">
          <div>
            <p className="eyebrow">Relationships</p>
            <h1>Relationship Explorer</h1>
            <p className="page-description">
              Pick an agent to open its anatomy map — users, channels, actions, data, and inherent risk around the
              agent + LLM.
            </p>
          </div>
        </header>
      ) : null}

      <GraphSeedBar
        idPrefix="relationship"
        seed={seed}
        depth={depth}
        seeds={seeds}
        submitLabel="Open anatomy"
        clearLabel="Clear"
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
        extraActions={
          <button className="button ghost" type="button" onClick={() => setShowGraph((v) => !v)}>
            {showGraph ? "Hide graph" : "Show graph"}
          </button>
        }
      />

      {error ? <div className="error-state">{error}</div> : null}

      <AgentAnatomyPanel
        anatomy={anatomy}
        loading={anatomyLoading}
        error={anatomyError}
        onClear={
          focusedAgentId
            ? () => {
                setSeed("");
                void loadGraph("");
              }
            : undefined
        }
      />

      {showGraph ? (
        <section className="panel" style={{ marginTop: 16 }}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Topology</p>
              <h2>Neighborhood graph</h2>
            </div>
          </div>
          <TopologyGraph
            graph={graph}
            loading={loading}
            emptyMessage="No relationships yet. Run discovery, then pick a seed."
            onNodeSelect={onNodeSelect}
          />
        </section>
      ) : null}

      <DetailDrawer
        data={selected}
        open={Boolean(selected)}
        title={selected ? valueAt(selected, ["displayName", "name", "label", "id"], "Relationship node") : "Relationship node"}
        subtitle={selected ? valueAt(selected, ["type", "category", "label"], "Entity") : undefined}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
