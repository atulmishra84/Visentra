import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { DataTable, type Column } from "../components/DataTable";
import { KpiCard } from "../components/KpiCard";
import { apiRequest, compactDate, listFromPayload, numberAt, valueAt } from "../lib/api";

type ChangeRow = Record<string, unknown>;
type ChangeTab = "new" | "updated" | "drift" | "disappeared" | "owners" | "dataclass";

export function DiscoveryChangesPage() {
  const navigate = useNavigate();
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ChangeTab>("disappeared");

  useEffect(() => {
    let mounted = true;
    apiRequest<Record<string, unknown>>("/api/discovery/changes", { query: { sinceHours: 168, limit: 100 } })
      .then((data) => mounted && setPayload(data))
      .catch((requestError) =>
        mounted && setError(requestError instanceof Error ? requestError.message : "Failed to load discovery changes.")
      )
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  const summary = (payload?.summary as Record<string, unknown> | undefined) || {};
  const newlyDiscovered = useMemo(
    () => listFromPayload<ChangeRow>(payload, ["newlyDiscovered", "new"]),
    [payload]
  );
  const updated = useMemo(
    () => listFromPayload<ChangeRow>(payload, ["recentlyUpdated", "updated", "updates"]),
    [payload]
  );
  const configDrift = useMemo(
    () => listFromPayload<ChangeRow>(payload, ["configDrift", "drift"]),
    [payload]
  );
  const disappeared = useMemo(
    () => listFromPayload<ChangeRow>(payload, ["disappeared", "gone"]),
    [payload]
  );
  const ownerChanges = useMemo(
    () => listFromPayload<ChangeRow>(payload, ["ownerChanges", "owners"]),
    [payload]
  );
  const dataClassEscalations = useMemo(
    () => listFromPayload<ChangeRow>(payload, ["dataClassEscalations", "dataClass", "dataclass"]),
    [payload]
  );

  const rows =
    tab === "new"
      ? newlyDiscovered
      : tab === "updated"
        ? updated
        : tab === "disappeared"
          ? disappeared
          : tab === "owners"
            ? ownerChanges
            : tab === "dataclass"
              ? dataClassEscalations
              : configDrift;

  const columns: Array<Column<ChangeRow>> = [
    {
      key: "name",
      header: "Agent",
      render: (row) => <strong>{valueAt(row, ["name", "displayName"], "Unnamed")}</strong>,
      sortValue: (row) => valueAt(row, ["name", "displayName"])
    },
    {
      key: "owner",
      header: tab === "owners" ? "New owner" : "Owner",
      render: (row) => valueAt(row, ["owner", "team"]),
      sortValue: (row) => valueAt(row, ["owner", "team"])
    },
    {
      key: "category",
      header: "Category",
      render: (row) => <span className="badge">{valueAt(row, ["category"], "—")}</span>,
      sortValue: (row) => valueAt(row, ["category"])
    },
    {
      key: "detail",
      header:
        tab === "drift"
          ? "Drift"
          : tab === "owners"
            ? "Change"
            : tab === "dataclass"
              ? "Data class"
              : "Detail",
      render: (row) => {
        if (tab === "drift") {
          const changes = (row.changes as Array<Record<string, unknown>> | undefined) || [];
          if (!changes.length) return valueAt(row, ["summary", "detail"], "—");
          return changes
            .slice(0, 4)
            .map((c) => `${valueAt(c, ["op"])} ${valueAt(c, ["field"])}:${valueAt(c, ["value"])}`)
            .join(" · ");
        }
        if (tab === "owners") {
          return valueAt(row, ["summary"], `${valueAt(row, ["previousOwner"], "(none)")} → ${valueAt(row, ["owner"], "(none)")}`);
        }
        if (tab === "dataclass") {
          return valueAt(
            row,
            ["summary"],
            `${valueAt(row, ["previousDataClass"], "none")} → ${valueAt(row, ["primaryDataClass"], "—")}`
          );
        }
        return valueAt(row, ["summary", "howIdentified", "evidenceClass"], "—");
      },
      sortValue: (row) => valueAt(row, ["summary", "detail", "name"])
    },
    {
      key: "when",
      header: "When",
      render: (row) =>
        compactDate(row.changedAt ?? row.lastSeen ?? row.firstDiscovered ?? row.last_seen ?? row.observedAt),
      sortValue: (row) =>
        String(row.changedAt ?? row.lastSeen ?? row.firstDiscovered ?? row.last_seen ?? row.observedAt ?? "")
    }
  ];

  if (loading) {
    return (
      <div className="page">
        <div className="loading-state">Loading discovery changes...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <div className="error-state">{error}</div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Discovery</p>
          <h1>Change intelligence</h1>
          <p className="page-description">
            New, updated, disappeared, owner-changed, data-class escalations, and configuration drift over the last 7 days.
          </p>
        </div>
        <div className="toolbar">
          <Link className="button ghost" to="/discovery">
            Discovery dashboard
          </Link>
          <Link className="button" to="/operations">
            Operations queue
          </Link>
        </div>
      </header>

      <section className="card-grid">
        <KpiCard
          label="Newly discovered"
          value={numberAt(summary, ["newAgents", "newlyDiscovered", "new"], newlyDiscovered.length)}
        />
        <KpiCard
          label="Disappeared"
          value={numberAt(summary, ["disappearedAgents", "disappeared"], disappeared.length)}
          tone="warn"
        />
        <KpiCard
          label="Owner changes"
          value={numberAt(summary, ["ownerChanges"], ownerChanges.length)}
          tone="warn"
        />
        <KpiCard
          label="Data class escalations"
          value={numberAt(summary, ["dataClassEscalations"], dataClassEscalations.length)}
          tone="warn"
        />
        <KpiCard
          label="Config drift"
          value={numberAt(summary, ["configDrift", "drift"], configDrift.length)}
          tone="warn"
        />
      </section>

      <div className="toolbar" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {(
          [
            ["disappeared", "Disappeared"],
            ["owners", "Owner changes"],
            ["dataclass", "Data class"],
            ["drift", "Config drift"],
            ["new", "Newly discovered"],
            ["updated", "Updated"]
          ] as Array<[ChangeTab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            className={`button ${tab === id ? "primary" : "ghost"}`}
            type="button"
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <section className="panel">
        <DataTable
          columns={columns}
          rows={rows}
          emptyMessage="No changes in this window."
          onRowClick={(row) => {
            const id = row.agentId ?? row.id;
            if (id) navigate(`/agents/${String(id)}`);
          }}
        />
      </section>
    </div>
  );
}
