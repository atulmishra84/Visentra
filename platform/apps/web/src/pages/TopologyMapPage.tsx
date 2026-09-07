import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { DetailDrawer } from "../components/DetailDrawer";
import { GraphSeedBar, type GraphSeedOption } from "../components/GraphSeedBar";
import { TopologyGraph } from "../components/TopologyGraph";
import { apiRequest, type GraphNode, type GraphPayload, valueAt } from "../lib/api";

export function TopologyMapPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const agentId = params.get("agentId") ?? "";
  const [seed, setSeed] = useState(agentId);
  const [depth, setDepth] = useState(Number(params.get("depth") || 2));
  const [graph, setGraph] = useState<GraphPayload | undefined>();
  const [seeds, setSeeds] = useState<GraphSeedOption[]>([]);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    window.addEventListener("visentra:graph-event", listener);
    return () => window.removeEventListener("visentra:graph-event", listener);
  }, [depth, loadGraph, seed]);

  const applySeed = (nextSeed: string, nextDepth = depth) => {
    const next = new URLSearchParams(params);
    if (nextSeed.trim()) next.set("agentId", nextSeed.trim());
    else next.delete("agentId");
    next.set("depth", String(nextDepth));
    setParams(next);
    void loadGraph(nextSeed.trim(), nextDepth);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    applySeed(seed, depth);
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Tenant</p>
          <h1>Tenant overview</h1>
          <p className="page-description">
            Tenant-wide map of agents and related models, frameworks, cloud resources, and tools. Use Relationship
            Explorer for a focused neighborhood.
          </p>
        </div>
        <div className="toolbar">
          <Link
            className="button ghost"
            to={agentId ? `/relationships?agentId=${encodeURIComponent(agentId)}` : "/relationships"}
          >
            Neighborhood
          </Link>
          <button className="button" type="button" onClick={() => void loadGraph(seed, depth)}>
            Refresh graph
          </button>
        </div>
      </header>

      <GraphSeedBar
        idPrefix="topology"
        seed={seed}
        depth={depth}
        seeds={seeds}
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

      {error ? <div className="error-state">{error}</div> : null}
      <TopologyGraph graph={graph} loading={loading} onNodeSelect={setSelected} />

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
                applySeed(id, depth);
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
