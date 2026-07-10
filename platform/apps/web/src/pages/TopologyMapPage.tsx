import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { DetailDrawer } from "../components/DetailDrawer";
import { TopologyGraph } from "../components/TopologyGraph";
import { apiRequest, type GraphNode, type GraphPayload, valueAt } from "../lib/api";

type SeedOption = {
  id: string;
  name?: string;
  category?: string;
  framework?: string;
  edge_count?: number;
};

export function TopologyMapPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const agentId = params.get("agentId") ?? "";
  const [seed, setSeed] = useState(agentId);
  const [depth, setDepth] = useState(Number(params.get("depth") || 2));
  const [graph, setGraph] = useState<GraphPayload | undefined>();
  const [seeds, setSeeds] = useState<SeedOption[]>([]);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSeeds = useCallback(async (q = "") => {
    try {
      const payload = await apiRequest<{ seeds?: SeedOption[] }>("/api/graph/seeds", {
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
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed to load topology.");
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
    window.addEventListener("agentradar:graph-event", listener);
    return () => window.removeEventListener("agentradar:graph-event", listener);
  }, [depth, loadGraph, seed]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = new URLSearchParams(params);
    if (seed.trim()) next.set("agentId", seed.trim());
    else next.delete("agentId");
    next.set("depth", String(depth));
    setParams(next);
    void loadGraph(seed.trim(), depth);
  };

  const pickSeed = (option: SeedOption) => {
    setSeed(option.id);
    const next = new URLSearchParams(params);
    next.set("agentId", option.id);
    next.set("depth", String(depth));
    setParams(next);
    void loadGraph(option.id, depth);
  };

  const onNodeSelect = (node: GraphNode) => {
    setSelected(node);
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Topology</p>
          <h1>Topology Map</h1>
          <p className="page-description">
            Interactive map of agents and related models, frameworks, cloud resources, and tools. Pan, zoom, and click
            a node for details.
          </p>
        </div>
        <div className="toolbar">
          <Link className="button ghost" to="/relationships">
            Relationship Explorer
          </Link>
          <button className="button" type="button" onClick={() => void loadGraph(seed, depth)}>
            Refresh graph
          </button>
        </div>
      </header>

      <form className="facet-bar" onSubmit={submit}>
        <div className="field" style={{ minWidth: 320, flex: 1 }}>
          <label htmlFor="topology-seed">Focus seed (optional)</label>
          <input
            className="input"
            id="topology-seed"
            list="topology-seeds"
            placeholder="Leave blank for overview, or paste agent name / ID"
            value={seed}
            onChange={(event) => {
              setSeed(event.target.value);
              void loadSeeds(event.target.value);
            }}
          />
          <datalist id="topology-seeds">
            {seeds.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} ({option.category || "asset"})
              </option>
            ))}
          </datalist>
        </div>
        <div className="field">
          <label htmlFor="topology-depth">Depth</label>
          <select
            className="select"
            id="topology-depth"
            value={depth}
            onChange={(event) => setDepth(Number(event.target.value))}
          >
            <option value={1}>1 hop</option>
            <option value={2}>2 hops</option>
            <option value={3}>3 hops</option>
          </select>
        </div>
        <button className="button primary" type="submit">
          Apply
        </button>
        <button
          className="button ghost"
          type="button"
          onClick={() => {
            setSeed("");
            const next = new URLSearchParams(params);
            next.delete("agentId");
            setParams(next);
            void loadGraph("", depth);
          }}
        >
          Overview
        </button>
      </form>

      {seeds.length ? (
        <div className="toolbar" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          {seeds.slice(0, 8).map((option) => (
            <button key={option.id} className="button ghost" type="button" onClick={() => pickSeed(option)}>
              {valueAt(option as Record<string, unknown>, ["name"], option.id).slice(0, 36)}
              {option.edge_count ? ` · ${option.edge_count}` : ""}
            </button>
          ))}
        </div>
      ) : null}

      {error ? <div className="error-state">{error}</div> : null}
      <TopologyGraph graph={graph} loading={loading} onNodeSelect={onNodeSelect} />

      <DetailDrawer
        data={selected}
        open={Boolean(selected)}
        title={selected ? valueAt(selected, ["displayName", "name", "label", "id"], "Graph node") : "Graph node"}
        subtitle={selected ? valueAt(selected, ["type", "category", "label"], "Entity") : undefined}
        onClose={() => setSelected(null)}
      >
        {selected && String(selected.type).toLowerCase() === "agent" ? (
          <div className="toolbar" style={{ marginTop: 16 }}>
            <button
              className="button primary"
              type="button"
              onClick={() => navigate(`/agents/${encodeURIComponent(String(selected.id))}`)}
            >
              Open agent detail
            </button>
            <button
              className="button"
              type="button"
              onClick={() => {
                const id = String(selected.id);
                setSeed(id);
                const next = new URLSearchParams(params);
                next.set("agentId", id);
                setParams(next);
                void loadGraph(id, depth);
                setSelected(null);
              }}
            >
              Focus in map
            </button>
          </div>
        ) : null}
      </DetailDrawer>
    </div>
  );
}
