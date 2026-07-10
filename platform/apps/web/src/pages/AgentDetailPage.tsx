import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { KpiCard } from "../components/KpiCard";
import { apiRequest, compactDate, numberAt, type Agent, valueAt } from "../lib/api";

export function AgentDetailPage() {
  const { id } = useParams();
  const [payload, setPayload] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      return;
    }

    let mounted = true;
    setLoading(true);
    apiRequest<unknown>(`/api/agents/${encodeURIComponent(id)}`)
      .then((data) => mounted && setPayload(data))
      .catch((requestError) => mounted && setError(requestError instanceof Error ? requestError.message : "Failed to load agent."))
      .finally(() => mounted && setLoading(false));

    return () => {
      mounted = false;
    };
  }, [id]);

  const agent = ((payload as { agent?: Agent } | null)?.agent ?? payload ?? {}) as Agent;

  if (loading) {
    return <div className="page"><div className="loading-state">Loading agent profile...</div></div>;
  }

  if (error) {
    return <div className="page"><div className="error-state">{error}</div></div>;
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Agent Detail</p>
          <h1>{valueAt(agent, ["name", "displayName", "id"], "Agent")}</h1>
          <p className="page-description">
            {valueAt(agent, ["summary", "description", "category"], "Canonical agent profile from the inventory API.")}
          </p>
        </div>
        <div className="toolbar">
          <Link className="button" to={`/topology?agentId=${encodeURIComponent(String(agent.id ?? id))}`}>
            Open in topology
          </Link>
          <Link className="button" to="/inventory">
            Back to inventory
          </Link>
        </div>
      </header>

      <section className="card-grid">
        <KpiCard label="Owner" value={valueAt(agent, ["owner", "team"])} />
        <KpiCard label="Framework" value={valueAt(agent, ["framework", "runtimeFramework"])} />
        <KpiCard label="Model" value={valueAt(agent, ["model", "primaryModel", "models"])} />
        <KpiCard
          label="Shadow AI"
          value={agent.shadowAi ? `${Math.round(numberAt(agent, ["shadowAiScore"], 0) * 100)}%` : "No"}
          tone={agent.shadowAi ? "warn" : "good"}
        />
      </section>

      {agent.shadowAi ? (
        <section className="panel" style={{ marginBottom: 16 }}>
          <h2>Shadow AI signals</h2>
          <p className="muted">
            {((agent.shadowAiReasons as string[] | undefined) || []).join(" · ") || "Flagged as unmanaged / unsanctioned AI."}
          </p>
          <div className="toolbar" style={{ gap: 8, flexWrap: "wrap" }}>
            {((agent.shadowAiTags as string[] | undefined) || []).map((tag) => (
              <span className="badge" key={tag}>
                {tag}
              </span>
            ))}
            <Link className="button ghost" to="/shadow-ai">
              View all Shadow AI
            </Link>
          </div>
        </section>
      ) : null}

      <section className="split-grid">
        <div className="panel">
          <h2>Runtime & Ownership</h2>
          <div className="chart-list">
            <div className="bar-row"><span>Department</span><span>{valueAt(agent, ["department", "businessUnit"])}</span><span /></div>
            <div className="bar-row"><span>Cloud</span><span>{valueAt(agent, ["cloud", "provider", "environment"])}</span><span /></div>
            <div className="bar-row"><span>Category</span><span>{valueAt(agent, ["category", "type"])}</span><span /></div>
            <div className="bar-row"><span>Last seen</span><span>{compactDate(agent.lastObservedAt ?? agent.last_seen)}</span><span /></div>
          </div>
        </div>

        <div className="panel">
          <h2>Raw JSON</h2>
          <pre className="json-block">{JSON.stringify(agent, null, 2)}</pre>
        </div>
      </section>
    </div>
  );
}
