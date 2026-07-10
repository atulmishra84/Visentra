import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { KpiCard } from "../components/KpiCard";
import { apiRequest, listFromPayload, numberAt, valueAt } from "../lib/api";

function metric(payload: Record<string, unknown>, keys: string[], fallback = 0): number {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number") {
      return value;
    }
    if (value && typeof value === "object") {
      const nested = numberAt(value as Record<string, unknown>, ["value", "count", "total"], NaN);
      if (!Number.isNaN(nested)) {
        return nested;
      }
    }
  }
  return fallback;
}

function BarList({ title, rows }: { title: string; rows: Record<string, unknown>[] }) {
  const max = Math.max(1, ...rows.map((row) => numberAt(row, ["value", "count", "total"], 0)));

  return (
    <section className="panel">
      <h2>{title}</h2>
      <div className="chart-list">
        {rows.length ? (
          rows.map((row, index) => {
            const count = numberAt(row, ["value", "count", "total"], 0);
            return (
              <div className="bar-row" key={`${title}-${index}`}>
                <span>{valueAt(row, ["label", "name", "model", "framework", "category"])}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${Math.max(6, (count / max) * 100)}%` }} />
                </div>
                <span className="mono">{count}</span>
              </div>
            );
          })
        ) : (
          <div className="empty-state">No {title.toLowerCase()} data returned yet.</div>
        )}
      </div>
    </section>
  );
}

export function ExecutiveDashboardPage() {
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    apiRequest<Record<string, unknown>>("/api/dashboards/executive")
      .then((data) => mounted && setPayload(data))
      .catch((requestError) => mounted && setError(requestError instanceof Error ? requestError.message : "Failed to load dashboard."))
      .finally(() => mounted && setLoading(false));

    return () => {
      mounted = false;
    };
  }, []);

  const dashboard = (payload?.dashboard as Record<string, unknown> | undefined) ?? payload ?? {};
  const modelRows = useMemo(
    () => listFromPayload<Record<string, unknown>>(dashboard, ["models", "modelUsage", "modelsInUse"]),
    [dashboard]
  );
  const categoryRows = useMemo(
    () => listFromPayload<Record<string, unknown>>(dashboard, ["categories", "agentsByCategory", "categoryCoverage"]),
    [dashboard]
  );
  const changes = useMemo(
    () => listFromPayload<Record<string, unknown>>(dashboard, ["recentChanges", "changes", "events"]),
    [dashboard]
  );

  if (loading) {
    return <div className="page"><div className="loading-state">Loading executive visibility posture...</div></div>;
  }

  if (error) {
    return <div className="page"><div className="error-state">{error}</div></div>;
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Executive</p>
          <h1>AI Agent Visibility Overview</h1>
          <p className="page-description">Inventory, ownership, Shadow AI exposure, and discovery coverage for leadership.</p>
        </div>
        <span className="status-pill">Last updated {new Date().toLocaleTimeString()}</span>
      </header>

      <section className="card-grid">
        <KpiCard label="Total Agents" value={metric(dashboard, ["totalAgents", "agentsTotal", "total"])} trend="Discovered inventory" />
        <KpiCard label="Ownerless" value={metric(dashboard, ["ownerlessAgents", "ownerless"])} trend="Needs attribution" tone="warn" />
        <KpiCard
          label="Shadow AI"
          value={metric(dashboard, ["shadowAiAgents", "shadowAi"])}
          trend="Unmanaged / unsanctioned AI"
          tone="warn"
        />
        <KpiCard
          label="Avg confidence"
          value={`${Math.round(metric(dashboard, ["avgConfidence"], 0) * 100)}%`}
          trend="Discovery confidence"
          tone="good"
        />
      </section>

      <p className="muted" style={{ marginBottom: 16 }}>
        Investigate Shadow AI findings in the <Link to="/shadow-ai">Shadow AI</Link> workbench.
      </p>

      <section className="split-grid">
        <BarList title="Models in Use" rows={modelRows} />
        <BarList title="Agents by Category" rows={categoryRows} />
      </section>

      <section className="panel">
        <h2>Recent Significant Changes</h2>
        {changes.length ? (
          <div className="timeline">
            {changes.slice(0, 8).map((change, index) => (
              <div className="timeline-item" key={String(change.id ?? index)}>
                <span className="mono muted">{valueAt(change, ["timestamp", "createdAt", "observedAt"], "Recent")}</span>
                <div>
                  <strong>{valueAt(change, ["title", "name", "type"], "Visibility change")}</strong>
                  <p className="muted">{valueAt(change, ["description", "message", "summary"], "No description supplied.")}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">No recent changes returned by the executive dashboard endpoint.</div>
        )}
      </section>
    </div>
  );
}
