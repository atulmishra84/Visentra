import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { DataTable, type Column } from "../components/DataTable";
import { KpiCard } from "../components/KpiCard";
import { apiRequest, compactDate, listFromPayload, numberAt, valueAt } from "../lib/api";

type ChangeRow = Record<string, unknown>;

export function DiscoveryChangesPage() {
  const navigate = useNavigate();
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"new" | "updated" | "drift">("drift");

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

  const rows = tab === "new" ? newlyDiscovered : tab === "updated" ? updated : configDrift;

  const columns: Array<Column<ChangeRow>> = [
    {
      key: "name",
      header: "Agent",
      render: (row) => <strong>{valueAt(row, ["name", "displayName"], "Unnamed")}</strong>,
      sortValue: (row) => valueAt(row, ["name", "displayName"])
    },
    {
      key: "owner",
      header: "Owner",
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
      header: tab === "drift" ? "Drift" : "Detail",
      render: (row) => {
        if (tab === "drift") {
          const changes = (row.changes as Array<Record<string, unknown>> | undefined) || [];
          if (!changes.length) return valueAt(row, ["summary", "detail"], "—");
          return changes
            .slice(0, 4)
            .map((c) => `${valueAt(c, ["op"])} ${valueAt(c, ["field"])}:${valueAt(c, ["value"])}`)
            .join(" · ");
        }
        return valueAt(row, ["summary", "howIdentified", "evidenceClass"], "—");
      },
      sortValue: (row) => valueAt(row, ["summary", "detail", "name"])
    },
    {
      key: "when",
      header: "When",
      render: (row) => compactDate(row.changedAt ?? row.firstDiscovered ?? row.last_seen ?? row.observedAt),
      sortValue: (row) =>
        String(row.changedAt ?? row.firstDiscovered ?? row.last_seen ?? row.observedAt ?? "")
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
            New agents, observation updates, and configuration drift over the last 7 days (visibility only).
          </p>
        </div>
        <Link className="button" to="/operations">
          Operations queue
        </Link>
      </header>

      <section className="card-grid">
        <KpiCard
          label="Newly discovered"
          value={numberAt(summary, ["newAgents", "newlyDiscovered", "new"], newlyDiscovered.length)}
        />
        <KpiCard
          label="Updated"
          value={numberAt(summary, ["updatedAgents", "updated", "updates"], updated.length)}
        />
        <KpiCard
          label="Config drift"
          value={numberAt(summary, ["configDrift", "drift"], configDrift.length)}
          tone="warn"
        />
        <KpiCard
          label="Changed relationships"
          value={numberAt(payload || {}, ["changedRelationships"], numberAt(summary, ["changedRelationships"], 0))}
        />
      </section>

      <div className="toolbar" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button className={`button ${tab === "drift" ? "primary" : "ghost"}`} type="button" onClick={() => setTab("drift")}>
          Config drift
        </button>
        <button className={`button ${tab === "new" ? "primary" : "ghost"}`} type="button" onClick={() => setTab("new")}>
          Newly discovered
        </button>
        <button
          className={`button ${tab === "updated" ? "primary" : "ghost"}`}
          type="button"
          onClick={() => setTab("updated")}
        >
          Updated
        </button>
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
