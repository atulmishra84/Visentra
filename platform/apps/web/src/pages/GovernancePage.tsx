import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { DataTable, type Column } from "../components/DataTable";
import { KpiCard } from "../components/KpiCard";
import { apiRequest, numberAt, valueAt } from "../lib/api";

type Framework = {
  id: string;
  name: string;
  version?: string | null;
  description?: string;
  controlCount?: number;
  builtin?: boolean;
};

type AssessmentSummary = {
  counts?: Record<string, number>;
  score?: number | null;
  posture?: string;
};

type AssessmentRow = {
  agentId: string;
  agentName: string;
  category?: string | null;
  cloudProvider?: string | null;
  evidenceClass?: string | null;
  agentStatus?: string | null;
  summary: AssessmentSummary;
};

type ComplianceReport = {
  frameworks?: Framework[];
  rollup?: {
    agentsAssessed?: number;
    compliant?: number;
    partial?: number;
    nonCompliant?: number;
    unknown?: number;
    avgScore?: number | null;
  };
  assessments?: AssessmentRow[];
  generatedAt?: string;
};

function postureClass(posture?: string) {
  if (posture === "compliant") return "ok";
  if (posture === "partial") return "warn";
  if (posture === "non_compliant") return "error";
  return "";
}

export function GovernancePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const framework = searchParams.get("framework") || "";
  const [data, setData] = useState<ComplianceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    apiRequest<ComplianceReport>("/api/compliance", {
      query: { framework: framework || undefined, limit: 500 }
    })
      .then((report) => mounted && setData(report))
      .catch((err) => mounted && setError(err instanceof Error ? err.message : "Failed to load assessments"))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [framework]);

  const frameworks = data?.frameworks || [];
  const assessments = data?.assessments || [];
  const rollup = data?.rollup || {};

  const setFramework = (id: string) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set("framework", id);
    else next.delete("framework");
    setSearchParams(next, { replace: true });
  };

  const columns: Array<Column<AssessmentRow & Record<string, unknown>>> = useMemo(
    () => [
      {
        key: "agent",
        header: "Agent",
        render: (row) => (
          <>
            <strong>{row.agentName}</strong>
            <div className="muted small">
              {row.category || "—"}
              {row.cloudProvider ? ` · ${row.cloudProvider}` : ""}
            </div>
          </>
        ),
        sortValue: (row) => row.agentName
      },
      {
        key: "posture",
        header: "Posture",
        render: (row) => (
          <span className={`status-pill ${postureClass(row.summary?.posture)}`}>
            {(row.summary?.posture || "unknown").replace(/_/g, " ")}
          </span>
        ),
        sortValue: (row) => row.summary?.posture || ""
      },
      {
        key: "score",
        header: "Score",
        render: (row) => (row.summary?.score == null ? "—" : `${row.summary.score}%`),
        sortValue: (row) => Number(row.summary?.score ?? -1)
      },
      {
        key: "fail",
        header: "Fail",
        render: (row) => numberAt(row.summary?.counts || {}, ["fail"], 0),
        sortValue: (row) => Number(row.summary?.counts?.fail || 0)
      },
      {
        key: "partial",
        header: "Partial",
        render: (row) => numberAt(row.summary?.counts || {}, ["partial"], 0),
        sortValue: (row) => Number(row.summary?.counts?.partial || 0)
      },
      {
        key: "pass",
        header: "Pass",
        render: (row) => numberAt(row.summary?.counts || {}, ["pass"], 0),
        sortValue: (row) => Number(row.summary?.counts?.pass || 0)
      },
      {
        key: "evidence",
        header: "Evidence",
        render: (row) => row.evidenceClass?.replace(/_/g, " ") || row.agentStatus || "—",
        sortValue: (row) => row.evidenceClass || ""
      }
    ],
    []
  );

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Governance &amp; Compliance</p>
          <h1>Assessments</h1>
          <p className="page-description">
            Auto-review discovered agents against your control catalog using discovery and deep-scan evidence.
          </p>
        </div>
        <div className="toolbar" style={{ gap: 8, flexWrap: "wrap" }}>
          <Link className="button" to="/governance/catalog">
            Control catalog
          </Link>
        </div>
      </header>

      {error ? <div className="error-state">{error}</div> : null}

      <section className="card-grid" style={{ marginBottom: 16 }}>
        <KpiCard label="Agents assessed" value={numberAt(rollup, ["agentsAssessed"], assessments.length)} />
        <KpiCard label="Compliant" value={numberAt(rollup, ["compliant"], 0)} tone="good" />
        <KpiCard label="Partial" value={numberAt(rollup, ["partial"], 0)} tone="warn" />
        <KpiCard label="Non-compliant" value={numberAt(rollup, ["nonCompliant"], 0)} tone="bad" />
        <KpiCard label="Avg score" value={rollup.avgScore == null ? "—" : `${rollup.avgScore}%`} />
      </section>

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-heading">
          <h2>Frameworks</h2>
          <button className="button ghost" type="button" onClick={() => setFramework("")}>
            Clear filter
          </button>
        </div>
        <div className="framework-chip-row">
          {frameworks.map((fw) => (
            <button
              key={fw.id}
              type="button"
              className={`framework-chip ${framework === fw.id ? "is-active" : ""}`}
              onClick={() => setFramework(fw.id)}
            >
              <strong>{fw.name}</strong>
              <div className="meta">
                {fw.version || "—"} · {fw.controlCount ?? 0} controls
                {fw.builtin === false ? " · custom" : ""}
              </div>
            </button>
          ))}
          {!frameworks.length && !loading ? <p className="muted">No frameworks yet.</p> : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Agent control reviews</h2>
          <span className="status-pill">{assessments.length} agents</span>
        </div>
        {loading ? (
          <div className="loading-state">Assessing agents against compliance controls…</div>
        ) : (
          <DataTable
            columns={columns}
            rows={assessments as Array<AssessmentRow & Record<string, unknown>>}
            emptyMessage="No agents to assess yet. Run discovery, then refresh."
            onRowClick={(row) => navigate(`/governance/agents/${encodeURIComponent(String(row.agentId))}`)}
          />
        )}
        {data?.generatedAt ? (
          <div className="muted small" style={{ marginTop: 8 }}>
            Generated {valueAt(data as Record<string, unknown>, ["generatedAt"], "")}
          </div>
        ) : null}
      </section>
    </div>
  );
}
