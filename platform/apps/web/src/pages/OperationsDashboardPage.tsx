import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { DataTable, type Column } from "../components/DataTable";
import { DetailDrawer } from "../components/DetailDrawer";
import { KpiCard } from "../components/KpiCard";
import { apiRequest, compactDate, listFromPayload, numberAt, valueAt } from "../lib/api";

export function OperationsDashboardPage() {
  const navigate = useNavigate();
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    apiRequest<Record<string, unknown>>("/api/dashboards/operations")
      .then((data) => mounted && setPayload(data))
      .catch((requestError) => mounted && setError(requestError instanceof Error ? requestError.message : "Failed to load operations."))
      .finally(() => mounted && setLoading(false));

    return () => {
      mounted = false;
    };
  }, []);

  const dashboard = (payload?.dashboard as Record<string, unknown> | undefined) ?? payload ?? {};
  const queue = useMemo(
    () => listFromPayload<Record<string, unknown>>(dashboard, ["queue", "items", "agents", "newDiscoveries", "changedRelationships"]),
    [dashboard]
  );

  const columns: Array<Column<Record<string, unknown>>> = [
    {
      key: "name",
      header: "Agent / Finding",
      render: (row) => <strong>{valueAt(row, ["name", "displayName", "agentName", "title"])}</strong>,
      sortValue: (row) => valueAt(row, ["name", "displayName", "agentName", "title"])
    },
    {
      key: "queue",
      header: "Queue",
      render: (row) => <span className="badge">{valueAt(row, ["queue", "type", "status"], "triage")}</span>,
      sortValue: (row) => valueAt(row, ["queue", "type", "status"])
    },
    {
      key: "owner",
      header: "Owner",
      render: (row) => valueAt(row, ["owner", "team", "department"]),
      sortValue: (row) => valueAt(row, ["owner", "team", "department"])
    },
    {
      key: "confidence",
      header: "Confidence",
      render: (row) => `${Math.round(numberAt(row, ["confidence", "confidence_score"], 0) * 100)}%`,
      sortValue: (row) => numberAt(row, ["confidence", "confidence_score"], 0)
    },
    {
      key: "last",
      header: "Last observed",
      render: (row) => compactDate(row.lastObservedAt ?? row.last_seen ?? row.updatedAt),
      sortValue: (row) => String(row.lastObservedAt ?? row.last_seen ?? row.updatedAt ?? "")
    }
  ];

  if (loading) {
    return <div className="page"><div className="loading-state">Loading operations queue...</div></div>;
  }

  if (error) {
    return <div className="page"><div className="error-state">{error}</div></div>;
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Analyst Workbench</h1>
          <p className="page-description">
            New discoveries, Shadow AI candidates, ownerless agents, and low-confidence findings.
          </p>
        </div>
        <Link className="button primary" to="/shadow-ai">
          Open Shadow AI
        </Link>
      </header>

      <section className="card-grid">
        <KpiCard label="Shadow AI" value={numberAt(dashboard, ["shadowAiAgents", "shadowAi"], queue.length)} tone="warn" />
        <KpiCard label="Ownerless" value={numberAt(dashboard, ["ownerlessAgents", "ownerless"], 0)} tone="warn" />
        <KpiCard label="Low Confidence" value={numberAt(dashboard, ["lowConfidence", "lowConfidenceAgents"], 0)} tone="warn" />
        <KpiCard label="Changed Edges" value={numberAt(dashboard, ["changedRelationships", "changedEdges"], 0)} />
      </section>

      <section className="panel">
        <div className="page-header">
          <div>
            <h2>Investigation Queue</h2>
            <p className="muted">Click a row for a drawer, or open the full agent detail when an ID is present.</p>
          </div>
        </div>
        <DataTable columns={columns} rows={queue} onRowClick={setSelected} emptyMessage="No operations findings returned." />
      </section>

      <DetailDrawer
        data={selected}
        open={Boolean(selected)}
        title={selected ? valueAt(selected, ["name", "displayName", "title"], "Queue item") : "Queue item"}
        subtitle={selected ? valueAt(selected, ["summary", "description", "type"], "Operations detail") : undefined}
        onClose={() => setSelected(null)}
      >
        {selected?.id ? (
          <button className="button primary" type="button" onClick={() => navigate(`/agents/${String(selected.id)}`)}>
            Open full agent page
          </button>
        ) : null}
      </DetailDrawer>
    </div>
  );
}
