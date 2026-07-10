import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest, numberAt, valueAt } from "../lib/api";
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

type EvidenceMix = {
  byEvidenceClass?: Array<Record<string, unknown>>;
  byAgentStatus?: Array<Record<string, unknown>>;
  items?: Array<Record<string, unknown>>;
};

export function CoveragePage() {
  const [data, setData] = useState<CoverageResponse | null>(null);
  const [evidence, setEvidence] = useState<EvidenceMix | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      apiRequest<CoverageResponse>("/api/coverage"),
      apiRequest<EvidenceMix>("/api/usage/evidence").catch(() => null)
    ])
      .then(([coverage, mix]) => {
        if (!mounted) return;
        setData(coverage);
        setEvidence(mix);
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

  const evidenceClasses =
    evidence?.byEvidenceClass ||
    evidence?.items ||
    ((evidence as Record<string, unknown> | null)?.evidenceClass as Array<Record<string, unknown>> | undefined) ||
    [];
  const statuses =
    evidence?.byAgentStatus ||
    ((evidence as Record<string, unknown> | null)?.agentStatus as Array<Record<string, unknown>> | undefined) ||
    [];

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Discovery</p>
          <h1>Coverage map</h1>
          <p className="page-description">
            Which sources are configured, producing inventory, or still blind spots — plus evidence quality mix.
          </p>
        </div>
        <Link className="button" to="/inventory">
          Open inventory
        </Link>
      </header>

      <div className="kpi-grid">
        <KpiCard label="Covered" value={String(data.summary.covered)} />
        <KpiCard label="Configured" value={String(data.summary.configured)} />
        <KpiCard label="Blind" value={String(data.summary.blind)} />
        <KpiCard label="Errors" value={String(data.summary.error)} />
      </div>

      {evidenceClasses.length || statuses.length ? (
        <section className="split-grid" style={{ marginTop: 24 }}>
          <div className="panel">
            <h2>Evidence quality</h2>
            <p className="muted">How agents were classified by evidence class.</p>
            <div className="chart-list">
              {evidenceClasses.slice(0, 10).map((row, index) => (
                <div className="bar-row" key={valueAt(row, ["key", "name", "label"], `evidence-${index}`)}>
                  <span>{valueAt(row, ["key", "name", "label", "evidenceClass"], "unknown")}</span>
                  <span className="mono">{numberAt(row, ["count", "value", "total"], 0)}</span>
                  <span />
                </div>
              ))}
              {!evidenceClasses.length ? <div className="empty-state">No evidence mix yet.</div> : null}
            </div>
          </div>
          <div className="panel">
            <h2>Confirmation status</h2>
            <p className="muted">Confirmed vs candidate inventory.</p>
            <div className="chart-list">
              {statuses.slice(0, 8).map((row, index) => (
                <div className="bar-row" key={valueAt(row, ["key", "name", "label"], `status-${index}`)}>
                  <span>{valueAt(row, ["key", "name", "label", "agentStatus"], "unknown")}</span>
                  <span className="mono">{numberAt(row, ["count", "value", "total"], 0)}</span>
                  <span />
                </div>
              ))}
              {!statuses.length ? <div className="empty-state">No status mix yet.</div> : null}
            </div>
            <div className="toolbar" style={{ marginTop: 12 }}>
              <Link className="button ghost" to="/inventory?agentStatus=confirmed">
                Confirmed only
              </Link>
              <Link className="button ghost" to="/inventory?agentStatus=candidate">
                Candidates
              </Link>
            </div>
          </div>
        </section>
      ) : null}

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
