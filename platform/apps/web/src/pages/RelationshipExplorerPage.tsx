import { FormEvent, useEffect, useState } from "react";
import { DetailDrawer } from "../components/DetailDrawer";
import { TopologyGraph } from "../components/TopologyGraph";
import { apiRequest, type GraphNode, type GraphPayload, valueAt } from "../lib/api";

export function RelationshipExplorerPage() {
  const [seed, setSeed] = useState("");
  const [depth, setDepth] = useState(2);
  const [graph, setGraph] = useState<GraphPayload | undefined>();
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGraph = (nextSeed = seed) => {
    setLoading(true);
    setError(null);
    apiRequest<GraphPayload>("/api/graph", {
      query: {
        agentId: nextSeed || undefined,
        depth
      }
    })
      .then(setGraph)
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Failed to load relationship graph."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadGraph("");
    // Initial graph should load once; subsequent requests are form-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    loadGraph(seed);
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Relationships</p>
          <h1>Relationship Explorer</h1>
          <p className="page-description">Focus the graph around a seed agent and inspect connected entities.</p>
        </div>
      </header>

      <form className="facet-bar" onSubmit={submit}>
        <div className="field" style={{ minWidth: 320 }}>
          <label htmlFor="seed">Seed agent ID</label>
          <input
            className="input"
            id="seed"
            placeholder="agt_contract_review"
            value={seed}
            onChange={(event) => setSeed(event.target.value)}
          />
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
      </form>

      {error ? <div className="error-state">{error}</div> : null}
      <TopologyGraph graph={graph} loading={loading} onNodeSelect={setSelected} />

      <DetailDrawer
        data={selected}
        open={Boolean(selected)}
        title={selected ? valueAt(selected, ["displayName", "name", "label", "id"], "Relationship node") : "Relationship node"}
        subtitle={selected ? valueAt(selected, ["type", "label"], "Entity") : undefined}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
