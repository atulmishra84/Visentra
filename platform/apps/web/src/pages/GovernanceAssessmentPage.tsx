import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { DataTable, type Column } from "../components/DataTable";
import { KpiCard } from "../components/KpiCard";
import { apiRequest, numberAt, valueAt } from "../lib/api";

type Finding = {
  controlId: string;
  framework: string;
  code: string;
  title: string;
  family?: string | null;
  status: string;
  rationale: string;
  evidence?: string[];
};

type FrameworkBlock = {
  framework?: { id: string; name: string };
  summary?: { counts?: Record<string, number>; score?: number | null; posture?: string };
  findings?: Finding[];
};

type AssessmentPayload = {
  assessment?: {
    agentId: string;
    agentName: string;
    summary?: { counts?: Record<string, number>; score?: number | null; posture?: string };
    byFramework?: Record<string, FrameworkBlock>;
    findings?: Finding[];
    assessedAt?: string;
  };
  frameworks?: Array<{ id: string; name: string }>;
  agent?: { id: string; name?: string };
};

function statusClass(status: string) {
  if (status === "pass") return "ok";
  if (status === "partial") return "warn";
  if (status === "fail") return "error";
  if (status === "not_applicable") return "";
  return "";
}

export function GovernanceAssessmentPage() {
  const { agentId = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const framework = searchParams.get("framework") || "";
  const [data, setData] = useState<AssessmentPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!agentId) return;
    setLoading(true);
    setError(null);
    apiRequest<AssessmentPayload>(`/api/compliance/agents/${encodeURIComponent(agentId)}`, {
      query: { framework: framework || undefined }
    })
      .then((payload) => mounted && setData(payload))
      .catch((err) => mounted && setError(err instanceof Error ? err.message : "Failed to load assessment"))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [agentId, framework]);

  const assessment = data?.assessment;
  const findings = useMemo(() => {
    if (!assessment) return [] as Finding[];
    if (framework && assessment.byFramework?.[framework]?.findings) {
      return assessment.byFramework[framework].findings || [];
    }
    return assessment.findings || [];
  }, [assessment, framework]);

  const summary = framework && assessment?.byFramework?.[framework]?.summary
    ? assessment.byFramework[framework].summary
    : assessment?.summary;

  const columns: Array<Column<Finding & Record<string, unknown>>> = [
    {
      key: "code",
      header: "Control",
      render: (f) => (
        <>
          <strong>
            {f.code} — {f.title}
          </strong>
          <div className="muted small">{f.family || f.framework}</div>
        </>
      ),
      sortValue: (f) => `${f.framework}:${f.code}`
    },
    {
      key: "status",
      header: "Status",
      render: (f) => <span className={`status-pill ${statusClass(f.status)}`}>{f.status.replace(/_/g, " ")}</span>,
      sortValue: (f) => f.status
    },
    {
      key: "rationale",
      header: "Review",
      render: (f) => f.rationale,
      sortValue: (f) => f.rationale
    },
    {
      key: "evidence",
      header: "Evidence",
      render: (f) => (f.evidence?.length ? f.evidence.join(", ") : "—"),
      sortValue: (f) => (f.evidence || []).join(",")
    }
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{assessment?.agentName || "Agent compliance review"}</h1>
          <p className="muted">Control-by-control review from discovery and deep-scan evidence (auto-assessed).</p>
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
            {(data?.frameworks || []).map((fw) => (
              <option key={fw.id} value={fw.id}>
                {fw.name}
              </option>
            ))}
          </select>
          <button className="button ghost" type="button" onClick={() => navigate("/governance")}>
            Back
          </button>
          <Link className="button primary" to={`/agents/${encodeURIComponent(agentId)}`}>
            Open agent
          </Link>
        </div>
      </div>

      {error ? <div className="error-state">{error}</div> : null}
      {loading ? <div className="loading-state">Loading control review...</div> : null}

      {!loading && assessment ? (
        <>
          <div className="kpi-grid" style={{ marginBottom: 16 }}>
            <KpiCard label="Posture" value={(summary?.posture || "unknown").replace(/_/g, " ")} />
            <KpiCard label="Score" value={summary?.score == null ? "—" : `${summary.score}%`} />
            <KpiCard label="Pass" value={numberAt(summary?.counts || {}, ["pass"], 0)} tone="good" />
            <KpiCard label="Partial" value={numberAt(summary?.counts || {}, ["partial"], 0)} tone="warn" />
            <KpiCard label="Fail" value={numberAt(summary?.counts || {}, ["fail"], 0)} tone="bad" />
          </div>

          <section className="panel">
            <div className="page-header">
              <h2>Controls</h2>
              <span className="status-pill">{findings.length} reviewed</span>
            </div>
            <DataTable
              columns={columns}
              rows={findings as Array<Finding & Record<string, unknown>>}
              emptyMessage="No control findings for this filter."
            />
            {assessment.assessedAt ? (
              <div className="muted small" style={{ marginTop: 8 }}>
                Assessed {valueAt(assessment, ["assessedAt"], "")}
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
