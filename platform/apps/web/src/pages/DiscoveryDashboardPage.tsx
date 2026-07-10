import { useEffect, useMemo, useState } from "react";
import { DataTable, type Column } from "../components/DataTable";
import { DetailDrawer } from "../components/DetailDrawer";
import { apiRequest, compactDate, listFromPayload, numberAt, valueAt } from "../lib/api";

export function DiscoveryDashboardPage() {
  const [payload, setPayload] = useState<unknown>(null);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadJobs = () => {
    setLoading(true);
    apiRequest<unknown>("/api/discovery/jobs")
      .then(setPayload)
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Failed to load discovery jobs."))
      .finally(() => setLoading(false));
  };

  useEffect(loadJobs, []);

  useEffect(() => {
    const listener = () => loadJobs();
    window.addEventListener("agentradar:graph-event", listener);
    return () => window.removeEventListener("agentradar:graph-event", listener);
  }, []);

  const jobs = useMemo(
    () => listFromPayload<Record<string, unknown>>(payload, ["jobs", "items", "runs"]),
    [payload]
  );

  const triggerDiscovery = async () => {
    setRunning(true);
    setError(null);

    try {
      await apiRequest("/api/discovery/jobs", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          name: "manual-ui-scan",
          collectors: ["aws", "kubernetes", "github", "llm_api"],
          reason: "Manual scan triggered from AgentRadar web"
        })
      });
      loadJobs();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to trigger discovery.");
    } finally {
      setRunning(false);
    }
  };

  const columns: Array<Column<Record<string, unknown>>> = [
    {
      key: "name",
      header: "Job",
      render: (job) => <strong>{valueAt(job, ["name", "id", "jobId"], "Discovery scan")}</strong>,
      sortValue: (job) => valueAt(job, ["name", "id", "jobId"])
    },
    {
      key: "status",
      header: "Status",
      render: (job) => <span className="badge">{valueAt(job, ["status", "state"], "unknown")}</span>,
      sortValue: (job) => valueAt(job, ["status", "state"])
    },
    {
      key: "progress",
      header: "Progress",
      render: (job) => {
        const progress = numberAt(job, ["percent", "progress", "completion"], 0);
        return `${progress > 1 ? progress : Math.round(progress * 100)}%`;
      },
      sortValue: (job) => numberAt(job, ["percent", "progress", "completion"], 0)
    },
    {
      key: "observations",
      header: "Observations",
      render: (job) => numberAt(job, ["observationsAccepted", "observations", "entitiesCreated"], 0).toLocaleString(),
      sortValue: (job) => numberAt(job, ["observationsAccepted", "observations", "entitiesCreated"], 0)
    },
    {
      key: "started",
      header: "Started",
      render: (job) => compactDate(job.startedAt ?? job.createdAt),
      sortValue: (job) => String(job.startedAt ?? job.createdAt ?? "")
    }
  ];

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Discovery</p>
          <h1>Discovery Dashboard</h1>
          <p className="page-description">Launch scans, monitor discovery runs, and inspect collector progress.</p>
        </div>
        <button className="button primary" disabled={running} type="button" onClick={triggerDiscovery}>
          {running ? "Starting scan..." : "Run discovery scan"}
        </button>
      </header>

      {error ? <div className="error-state">{error}</div> : null}

      <section className="three-grid">
        <div className="panel">
          <h2>Connectors</h2>
          <p className="muted">AWS, Kubernetes, GitHub, IDE telemetry, LLM APIs, and MCP sources.</p>
        </div>
        <div className="panel">
          <h2>Collector Health</h2>
          <p className="muted">Live job refreshes are triggered by graph stream events when available.</p>
        </div>
        <div className="panel">
          <h2>Coverage Focus</h2>
          <p className="muted">Use discovery runs to reduce unknown owners, models, and relationships.</p>
        </div>
      </section>

      <section className="panel">
        <h2>Recent Jobs</h2>
        <DataTable
          columns={columns}
          emptyMessage="No discovery jobs found. Trigger a scan to populate the run list."
          loading={loading}
          rows={jobs}
          onRowClick={setSelected}
        />
      </section>

      <DetailDrawer
        data={selected}
        open={Boolean(selected)}
        title={selected ? valueAt(selected, ["name", "id", "jobId"], "Discovery job") : "Discovery job"}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
