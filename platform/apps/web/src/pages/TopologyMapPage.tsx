import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DetailDrawer } from "../components/DetailDrawer";
import { TopologyGraph } from "../components/TopologyGraph";
import { apiRequest, type GraphNode, type GraphPayload, valueAt } from "../lib/api";

export function TopologyMapPage() {
  const [params] = useSearchParams();
  const [graph, setGraph] = useState<GraphPayload | undefined>();
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const agentId = params.get("agentId") ?? undefined;

  const loadGraph = () => {
    setLoading(true);
    apiRequest<GraphPayload>("/api/graph", { query: { agentId, depth: 2 } })
      .then(setGraph)
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Failed to load topology."))
      .finally(() => setLoading(false));
  };

  useEffect(loadGraph, [agentId]);

  useEffect(() => {
    const listener = () => loadGraph();
    window.addEventListener("agentradar:graph-event", listener);
    return () => window.removeEventListener("agentradar:graph-event", listener);
  }, [agentId]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Topology</p>
          <h1>Topology Map</h1>
          <p className="page-description">Live relationship map for agents, models, tools, cloud assets, IDEs, and repositories.</p>
        </div>
        <button className="button" type="button" onClick={loadGraph}>
          Refresh graph
        </button>
      </header>

      {error ? <div className="error-state">{error}</div> : null}
      <TopologyGraph graph={graph} loading={loading} onNodeSelect={setSelected} />

      <DetailDrawer
        data={selected}
        open={Boolean(selected)}
        title={selected ? valueAt(selected, ["displayName", "name", "label", "id"], "Graph node") : "Graph node"}
        subtitle={selected ? valueAt(selected, ["type", "label"], "Entity") : undefined}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
