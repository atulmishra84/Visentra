import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { KpiCard } from "../components/KpiCard";

type CoverageSource = {
  id: string;
  label: string;
  category: string;
  collector: string;
  status: string;
  connectorsConfigured: number;
  connectorsActive: number;
  connectorsError: number;
  agentsDiscovered: number;
  lastJobStatus: string | null;
  lastJobAt: string | null;
};

type CoverageResponse = {
  summary: { covered: number; configured: number; blind: number; error: number; total: number };
  sources: CoverageSource[];
};

export function CoveragePage() {
  const [data, setData] = useState<CoverageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    apiRequest<CoverageResponse>("/api/coverage")
      .then((payload) => {
        if (mounted) setData(payload);
      })
      .catch((err) => {
        if (mounted) setError(err instanceof Error ? err.message : "Failed to load coverage");
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (error) return <div className="error-state">{error}</div>;
  if (!data) return <div className="loading-state">Loading coverage map…</div>;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Discovery</p>
          <h1>Coverage map</h1>
          <p className="page-description">
            Which sources are configured, producing inventory, or still blind spots.
          </p>
        </div>
      </header>

      <div className="kpi-grid">
        <KpiCard label="Covered" value={String(data.summary.covered)} />
        <KpiCard label="Configured" value={String(data.summary.configured)} />
        <KpiCard label="Blind" value={String(data.summary.blind)} />
        <KpiCard label="Errors" value={String(data.summary.error)} />
      </div>

      <section className="panel" style={{ marginTop: 24 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Category</th>
              <th>Status</th>
              <th>Connectors</th>
              <th>Agents</th>
              <th>Last job</th>
            </tr>
          </thead>
          <tbody>
            {data.sources.map((src) => (
              <tr key={src.id}>
                <td>
                  <strong>{src.label}</strong>
                  <div className="muted">{src.collector}</div>
                </td>
                <td>{src.category}</td>
                <td>
                  <span className={`status-pill status-${src.status}`}>{src.status}</span>
                </td>
                <td>
                  {src.connectorsActive}/{src.connectorsConfigured}
                  {src.connectorsError ? ` (${src.connectorsError} err)` : ""}
                </td>
                <td>{src.agentsDiscovered}</td>
                <td className="muted">
                  {src.lastJobStatus || "—"}
                  {src.lastJobAt ? ` · ${new Date(src.lastJobAt).toLocaleString()}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
