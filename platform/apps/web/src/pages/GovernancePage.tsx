import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { DataTable, type Column } from "../components/DataTable";
import { KpiCard } from "../components/KpiCard";
import { apiRequest, numberAt, valueAt } from "../lib/api";

type Framework = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  controlCount?: number;
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
  byFramework?: Record<string, { summary: AssessmentSummary }>;
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
      .catch((err) => mounted && setError(err instanceof Error ? err.message : "Failed to load governance"))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [framework]);

  const frameworks = data?.frameworks || [];
  const assessments = data?.assessments || [];
  const rollup = data?.rollup || {};

  const columns: Array<Column<AssessmentRow & Record<string, unknown>>> = useMemo(
    () => [
      {
        key: "agent",
        header: "Agent",
        render: (row) => (
          <>
            <strong>{row.agentName}</strong>
            <div className="muted small">{row.category || "—"}{row.cloudProvider ? ` · ${row.cloudProvider}` : ""}</div>
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
        key: "status",
        header: "Evidence",
        render: (row) => row.evidenceClass?.replace(/_/g, " ") || row.agentStatus || "—",
        sortValue: (row) => row.evidenceClass || ""
      }
    ],
    []
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Governance &amp; Compliance</h1>
          <p className="muted">
            Auto-review each discovered agent against OWASP LLM Top 10, HIPAA, and NIST AI RMF controls using
            discovery and deep-scan evidence.
          </p>
        </div>
        <div className="toolbar" style={{ gap: 8 }}>
          <select
            className="input"
            value={framework}
            onChange={(e) => {
              const next = new URLSearchParams(searchParams);
              if (e.target.value) next.set("framework", e.target.value);
              else next.delete("framework");
              setSearchParams(next, { replace: true });
            }}
            aria-label="Framework filter"
          >
            <option value="">All frameworks</option>
            {frameworks.map((fw) => (
              <option key={fw.id} value={fw.id}>
                {fw.name}
              </option>
            ))}
          </select>
          <Link className="button ghost" to="/governance/catalog">
            Control catalog
          </Link>
        </div>
      </div>

      {error ? <div className="error-state">{error}</div> : null}

      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <KpiCard label="Agents assessed" value={numberAt(rollup, ["agentsAssessed"], assessments.length)} />
        <KpiCard label="Compliant" value={numberAt(rollup, ["compliant"], 0)} tone="good" />
        <KpiCard label="Partial" value={numberAt(rollup, ["partial"], 0)} tone="warn" />
        <KpiCard label="Non-compliant" value={numberAt(rollup, ["nonCompliant"], 0)} tone="bad" />
        <KpiCard
          label="Avg score"
          value={rollup.avgScore == null ? "—" : `${rollup.avgScore}%`}
        />
      </div>

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="page-header">
          <h2>Frameworks</h2>
        </div>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {frameworks.map((fw) => (
            <button
              key={fw.id}
              type="button"
              className={`panel ${framework === fw.id ? "selected" : ""}`}
              style={{ textAlign: "left", cursor: "pointer", boxShadow: "none" }}
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.set("framework", fw.id);
                setSearchParams(next, { replace: true });
              }}
            >
              <strong>{fw.name}</strong>
              <div className="muted small">{fw.version}</div>
              <div className="muted small" style={{ marginTop: 6 }}>
                {fw.controlCount ?? 0} controls
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="page-header">
          <h2>Agent control reviews</h2>
          <span className="status-pill">{assessments.length} agents</span>
        </div>
        {loading ? (
          <div className="loading-state">Assessing agents against compliance controls...</div>
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
            Generated {valueAt(data, ["generatedAt"], "")}
          </div>
        ) : null}
      </section>
    </div>
  );
}
