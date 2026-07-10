import { FormEvent, useEffect, useState } from "react";
import { DetailDrawer } from "../components/DetailDrawer";
import { TopologyGraph } from "../components/TopologyGraph";
import { apiRequest, type GraphNode, type GraphPayload, valueAt } from "../lib/api";

type SeedOption = {
  id: string;
  name?: string;
  category?: string;
  framework?: string;
  fingerprint?: string;
  edge_count?: number;
};

export function RelationshipExplorerPage() {
  const [seed, setSeed] = useState("");
  const [depth, setDepth] = useState(2);
  const [graph, setGraph] = useState<GraphPayload | undefined>();
  const [seeds, setSeeds] = useState<SeedOption[]>([]);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadSeeds = async (q = "") => {
    try {
      const payload = await apiRequest<{ seeds?: SeedOption[] }>("/api/graph/seeds", {
        query: { q: q || undefined }
      });
      setSeeds(payload.seeds || []);
    } catch {
      /* non-blocking */
    }
  };

  const loadGraph = async (nextSeed = seed) => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const payload = await apiRequest<GraphPayload & { meta?: { message?: string; matched?: number } }>(
        "/api/graph",
        {
          query: {
            agentId: nextSeed || undefined,
            depth,
            limit: nextSeed ? 80 : 50
          }
        }
      );
      setGraph(payload);
      if (payload.meta?.message) setMessage(payload.meta.message);
      else if (!(payload.nodes || []).length) {
        setMessage("No relationships found. Open Inventory, pick an asset, then expand from here.");
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to load relationship graph.");
      setGraph({ nodes: [], edges: [] });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSeeds();
    void loadGraph("");
    // Initial graph should load once; subsequent requests are form-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void loadGraph(seed);
  };

  const pickSeed = (option: SeedOption) => {
    setSeed(option.id);
    void loadGraph(option.id);
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Relationships</p>
          <h1>Relationship Explorer</h1>
          <p className="page-description">
            Explore links between agents, models, cloud resources, and EDR platforms. Leave seed blank for an overview,
            or search by name / paste an inventory ID.
          </p>
        </div>
        <button className="button" type="button" onClick={() => void loadGraph(seed)}>
          Refresh
        </button>
      </header>

      <form className="facet-bar" onSubmit={submit}>
        <div className="field" style={{ minWidth: 360 }}>
          <label htmlFor="seed">Seed (name, fingerprint, or inventory ID)</label>
          <input
            className="input"
            id="seed"
            list="relationship-seeds"
            placeholder="e.g. HR Copilot or leave blank for overview"
            value={seed}
            onChange={(event) => {
              setSeed(event.target.value);
              void loadSeeds(event.target.value);
            }}
          />
          <datalist id="relationship-seeds">
            {seeds.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} ({option.category || "asset"})
              </option>
            ))}
          </datalist>
        </div>
        <div className="field">
          <label htmlFor="depth">Depth</label>
          <select className="select" id="depth" value={depth} onChange={(event) => setDepth(Number(event.target.value))}>
            <option value={1}>1 hop</option>
            <option value={2}>2 hops</option>
            <option value={3}>3 hops</option>
          </select>
        </div>
        <button className="button primary" type="submit">
          Expand
        </button>
        <button
          className="button ghost"
          type="button"
          onClick={() => {
            setSeed("");
            void loadGraph("");
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
      {message ? <div className="status-pill" style={{ marginBottom: 12 }}>{message}</div> : null}

      <TopologyGraph
        graph={graph}
        loading={loading}
        emptyMessage="No relationships yet. Run discovery, then pick a seed with edges from the chips above."
        onNodeSelect={setSelected}
      />

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
