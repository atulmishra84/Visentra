import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DataTable, type Column } from "../components/DataTable";
import { KpiCard } from "../components/KpiCard";
import { apiRequest, compactDate, numberAt, valueAt } from "../lib/api";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
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
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const evidenceClasses = useMemo(() => {
    return (
      evidence?.byEvidenceClass ||
      evidence?.items ||
      ((evidence as Record<string, unknown> | null)?.evidenceClass as Array<Record<string, unknown>> | undefined) ||
      []
    );
  }, [evidence]);

  const statuses = useMemo(() => {
    return (
      evidence?.byAgentStatus ||
      ((evidence as Record<string, unknown> | null)?.agentStatus as Array<Record<string, unknown>> | undefined) ||
      []
    );
  }, [evidence]);

  const columns: Array<Column<CoverageSource & Record<string, unknown>>> = [
    {
      key: "source",
      header: "Source",
      render: (src) => (
        <>
          <strong>{src.label}</strong>
          <div className="muted small">{src.collector}</div>
        </>
      ),
      sortValue: (src) => src.label
    },
    {
      key: "category",
      header: "Category",
      render: (src) => src.category,
      sortValue: (src) => src.category
    },
    {
      key: "status",
      header: "Status",
      render: (src) => <span className={`status-pill status-${src.status}`}>{src.status}</span>,
      sortValue: (src) => src.status
    },
    {
      key: "connectors",
      header: "Connectors",
      render: (src) => (
        <span className="mono">
          {src.connectorsActive}/{src.connectorsConfigured}
          {src.connectorsError ? ` (${src.connectorsError} err)` : ""}
        </span>
      ),
      sortValue: (src) => src.connectorsActive
    },
    {
      key: "agents",
      header: "Agents",
      render: (src) => <span className="mono">{src.agentsDiscovered}</span>,
      sortValue: (src) => src.agentsDiscovered
    },
    {
      key: "lastJob",
      header: "Last job",
      render: (src) => (
        <span className="muted">
          {src.lastJobStatus || "—"}
          {src.lastJobAt ? ` · ${compactDate(src.lastJobAt)}` : ""}
        </span>
      ),
      sortValue: (src) => String(src.lastJobAt || "")
    }
  ];

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Activity</p>
          <h1>Coverage Map</h1>
          <p className="page-description">
            Which sources are configured, producing inventory, or still blind — plus evidence quality mix.
          </p>
        </div>
        <div className="toolbar">
          <Link className="button" to="/settings/connectors">
            Connectors
          </Link>
          <Link className="button" to="/inventory">
            Open inventory
          </Link>
        </div>
      </header>

      {error ? <div className="error-state">{error}</div> : null}

      <section className="card-grid">
        <KpiCard label="Covered" value={loading ? "—" : String(data?.summary.covered ?? 0)} tone="good" />
        <KpiCard label="Configured" value={loading ? "—" : String(data?.summary.configured ?? 0)} />
        <KpiCard label="Blind" value={loading ? "—" : String(data?.summary.blind ?? 0)} tone="warn" />
        <KpiCard label="Errors" value={loading ? "—" : String(data?.summary.error ?? 0)} tone="bad" />
      </section>

      {evidenceClasses.length || statuses.length ? (
        <section className="split-grid">
          <div className="panel">
            <h2>Evidence quality</h2>
            <p className="muted">How agents were classified by evidence class.</p>
            <div className="chart-list">
              {evidenceClasses.slice(0, 10).map((row, index) => (
                <div className="bar-row" key={valueAt(row, ["key", "name", "label"], `evidence-${index}`)}>
                  <span className="bar-label">{valueAt(row, ["key", "name", "label", "evidenceClass"], "unknown")}</span>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{
                        width: `${Math.max(
                          6,
                          (numberAt(row, ["count", "value", "total"], 0) /
                            Math.max(
                              1,
                              ...evidenceClasses.map((r) => numberAt(r, ["count", "value", "total"], 0))
                            )) *
                            100
                        )}%`
                      }}
                    />
                  </div>
                  <span className="mono bar-count">{numberAt(row, ["count", "value", "total"], 0)}</span>
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
                  <span className="bar-label">{valueAt(row, ["key", "name", "label", "agentStatus"], "unknown")}</span>
                  <div className="bar-track">
                    <div
                      className="bar-fill accent"
                      style={{
                        width: `${Math.max(
                          6,
                          (numberAt(row, ["count", "value", "total"], 0) /
                            Math.max(1, ...statuses.map((r) => numberAt(r, ["count", "value", "total"], 0)))) *
                            100
                        )}%`
                      }}
                    />
                  </div>
                  <span className="mono bar-count">{numberAt(row, ["count", "value", "total"], 0)}</span>
                </div>
              ))}
              {!statuses.length ? <div className="empty-state">No status mix yet.</div> : null}
            </div>
            <div className="toolbar" style={{ marginTop: 10 }}>
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

      <section className="panel">
        <div className="panel-heading">
          <h2>Source coverage</h2>
          <span className="status-pill">{data?.sources.length ?? 0} sources</span>
        </div>
        <DataTable
          columns={columns}
          emptyMessage="No coverage sources returned yet."
          loading={loading}
          rows={(data?.sources || []) as Array<CoverageSource & Record<string, unknown>>}
          getRowKey={(row) => row.id}
        />
      </section>
    </div>
  );
}
