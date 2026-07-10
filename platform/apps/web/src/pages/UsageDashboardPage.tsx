import { useEffect, useMemo, useState } from "react";
import { KpiCard } from "../components/KpiCard";
import { apiRequest, listFromPayload, numberAt, valueAt } from "../lib/api";

type UsageDashboardPageProps = {
  kind: "models" | "frameworks" | "cloud" | "ide";
  title: string;
};

function UsageRows({ rows }: { rows: Record<string, unknown>[] }) {
  const max = Math.max(1, ...rows.map((row) => numberAt(row, ["count", "agents", "value", "total"], 0)));

  if (!rows.length) {
    return <div className="empty-state">No usage rows returned for this dashboard.</div>;
  }

  return (
    <div className="chart-list">
      {rows.map((row, index) => {
        const count = numberAt(row, ["count", "agents", "value", "total"], 0);
        return (
          <div className="bar-row" key={String(row.id ?? row.name ?? index)}>
            <span>{valueAt(row, ["name", "label", "model", "framework", "provider", "ide"])}</span>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${Math.max(6, (count / max) * 100)}%` }} />
            </div>
            <span className="mono">{count}</span>
          </div>
        );
      })}
    </div>
  );
}

export function UsageDashboardPage({ kind, title }: UsageDashboardPageProps) {
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    apiRequest<Record<string, unknown>>(`/api/dashboards/${kind}`)
      .then((data) => mounted && setPayload(data))
      .catch((requestError) => mounted && setError(requestError instanceof Error ? requestError.message : `Failed to load ${title}.`))
      .finally(() => mounted && setLoading(false));

    return () => {
      mounted = false;
    };
  }, [kind, title]);

  const dashboard = (payload?.dashboard as Record<string, unknown> | undefined) ?? payload ?? {};
  const rows = useMemo(
    () => listFromPayload<Record<string, unknown>>(dashboard, ["items", "rows", "usage", kind]),
    [dashboard, kind]
  );

  const total = rows.reduce((sum, row) => sum + numberAt(row, ["count", "agents", "value", "total"], 0), 0);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Usage Analytics</p>
          <h1>{title}</h1>
          <p className="page-description">Inventory analytics from `/api/dashboards/{kind}`.</p>
        </div>
      </header>

      {loading ? (
        <div className="loading-state">Loading {title.toLowerCase()}...</div>
      ) : error ? (
        <div className="error-state">{error}</div>
      ) : (
        <>
          <section className="card-grid">
            <KpiCard label="Total References" value={total} />
            <KpiCard label="Unique Values" value={rows.length} />
            <KpiCard label="Top Value" value={rows[0] ? valueAt(rows[0], ["name", "label", "model", "framework", "provider", "ide"]) : "None"} />
            <KpiCard label="Dashboard" value={kind} />
          </section>

          <section className="panel">
            <h2>{title} Distribution</h2>
            <UsageRows rows={rows} />
          </section>

          <section className="panel">
            <h2>Raw dashboard payload</h2>
            <pre className="json-block">{JSON.stringify(payload, null, 2)}</pre>
          </section>
        </>
      )}
    </div>
  );
}
