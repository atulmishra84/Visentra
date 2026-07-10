import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DataTable, type Column } from "../components/DataTable";
import { DetailDrawer } from "../components/DetailDrawer";
import { apiRequest, compactDate, listFromPayload, numberAt, valueAt } from "../lib/api";

const DEFAULT_COLLECTORS = ["cloud_stub", "edr", "saas_platform", "ide_filesystem", "process", "mcp"];

export function DiscoveryDashboardPage() {
  const [payload, setPayload] = useState<unknown>(null);
  const [connectors, setConnectors] = useState<Record<string, unknown>[]>([]);
  const [events, setEvents] = useState<Record<string, unknown>[]>([]);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadJobs = async () => {
    setLoading(true);
    setError(null);
    try {
      const [jobsPayload, connectorsPayload, eventsPayload] = await Promise.all([
        apiRequest<unknown>("/api/discovery/jobs"),
        apiRequest<unknown>("/api/connectors"),
        apiRequest<unknown>("/api/discovery/events")
      ]);
      setPayload(jobsPayload);
      setConnectors(listFromPayload<Record<string, unknown>>(connectorsPayload, ["connectors", "items"]));
      setEvents(listFromPayload<Record<string, unknown>>(eventsPayload, ["events", "items"]).slice(0, 8));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to load discovery jobs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadJobs();
  }, []);

  useEffect(() => {
    const listener = () => {
      void loadJobs();
    };
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
    setMessage(null);

    try {
      await apiRequest("/api/discovery/jobs", {
        method: "POST",
        body: JSON.stringify({
          collectors: DEFAULT_COLLECTORS,
          reason: "Manual scan including cloud and EDR connectors"
        })
      });
      setMessage(
        "Discovery started. Cloud, EDR, and SaaS platform connectors (Copilot, Salesforce, Workday, ServiceNow) are included. Refreshing in a few seconds..."
      );
      setTimeout(() => {
        void loadJobs();
      }, 4000);
      await loadJobs();
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
      render: (job) => (
        <strong>{valueAt(job, ["name", "id", "jobId"], "Discovery scan")}</strong>
      ),
      sortValue: (job) => valueAt(job, ["name", "id", "jobId"])
    },
    {
      key: "status",
      header: "Status",
      render: (job) => <span className="badge">{valueAt(job, ["status", "state"], "unknown")}</span>,
      sortValue: (job) => valueAt(job, ["status", "state"])
    },
    {
      key: "collectors",
      header: "Collectors",
      render: (job) => {
        const collectors = job.collector_ids;
        if (Array.isArray(collectors)) return collectors.join(", ");
        return valueAt(job, ["collectors"], "—");
      }
    },
    {
      key: "agents",
      header: "Agents found",
      render: (job) =>
        numberAt(job, ["agents_found", "observationsAccepted", "observations", "entitiesCreated"], 0).toLocaleString(),
      sortValue: (job) =>
        numberAt(job, ["agents_found", "observationsAccepted", "observations", "entitiesCreated"], 0)
    },
    {
      key: "started",
      header: "Started",
      render: (job) => compactDate(job.started_at ?? job.startedAt ?? job.created_at ?? job.createdAt),
      sortValue: (job) => String(job.started_at ?? job.startedAt ?? job.created_at ?? job.createdAt ?? "")
    }
  ];

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Discovery</p>
          <h1>Discovery Dashboard</h1>
          <p className="page-description">
            Run scans against configured connectors. Azure uses live ARM; EDR connectors (including Netskope) validate
            API credentials and surface endpoint visibility sources.
          </p>
        </div>
        <button className="button primary" disabled={running} type="button" onClick={() => void triggerDiscovery()}>
          {running ? "Starting scan..." : "Run discovery scan"}
        </button>
      </header>

      {error ? <div className="error-state">{error}</div> : null}
      {message ? <div className="status-pill" style={{ marginBottom: 16 }}>{message}</div> : null}

      <section className="three-grid">
        <div className="panel">
          <h2>Connectors</h2>
          {connectors.length === 0 ? (
            <p className="muted">
              None configured. Add cloud or EDR (CrowdStrike, Defender, Intune, Cortex, Netskope) under{" "}
              <Link to="/settings/connectors">Settings → Connectors</Link>.
            </p>
          ) : (
            <ul className="chart-list">
              {connectors.map((c) => (
                <li key={String(c.id)} className="bar-row">
                  <span>
                    {valueAt(c, ["name"])} ({String(c.provider).toUpperCase()}
                    {c.category ? ` · ${String(c.category)}` : ""})
                  </span>
                  <span className="mono">{valueAt(c, ["status"])}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="panel">
          <h2>How to verify</h2>
          <p className="muted">
            1) Test connector in Settings<br />
            2) Click <strong>Run discovery scan</strong><br />
            3) Check Inventory for `Azure scan — …` and AI resources<br />
            4) Check Discovery Events for scan counts
          </p>
        </div>
        <div className="panel">
          <h2>Recent connector events</h2>
          {events.filter((e) => String(e.event_type || "").includes("connector")).length === 0 ? (
            <p className="muted">No connector scan events yet.</p>
          ) : (
            <ul className="chart-list">
              {events
                .filter((e) => String(e.event_type || "").includes("connector"))
                .slice(0, 5)
                .map((e, idx) => (
                  <li key={idx} className="bar-row">
                    <span>{valueAt(e, ["message"])}</span>
                  </li>
                ))}
            </ul>
          )}
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
