import { useEffect, useMemo, useState } from "react";
import { DataTable, type Column } from "../components/DataTable";
import { DetailDrawer } from "../components/DetailDrawer";
import { apiRequest, compactDate, listFromPayload, valueAt } from "../lib/api";

export function DiscoveryEventsPage() {
  const [payload, setPayload] = useState<unknown>(null);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadEvents = () => {
    setLoading(true);
    apiRequest<unknown>("/api/discovery/events")
      .then(setPayload)
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Failed to load discovery events."))
      .finally(() => setLoading(false));
  };

  useEffect(loadEvents, []);

  const events = useMemo(
    () => listFromPayload<Record<string, unknown>>(payload, ["items", "events"]),
    [payload]
  );

  const columns: Array<Column<Record<string, unknown>>> = [
    {
      key: "time",
      header: "Time",
      render: (event) => compactDate(event.timestamp ?? event.createdAt ?? event.observedAt),
      sortValue: (event) => String(event.timestamp ?? event.createdAt ?? event.observedAt ?? "")
    },
    {
      key: "type",
      header: "Event",
      render: (event) => <strong>{valueAt(event, ["type", "eventType", "name"], "discovery.event")}</strong>,
      sortValue: (event) => valueAt(event, ["type", "eventType", "name"])
    },
    {
      key: "source",
      header: "Source",
      render: (event) => valueAt(event, ["source", "connector", "collector"]),
      sortValue: (event) => valueAt(event, ["source", "connector", "collector"])
    },
    {
      key: "message",
      header: "Message",
      render: (event) => valueAt(event, ["message", "description", "summary"], "No message"),
      sortValue: (event) => valueAt(event, ["message", "description", "summary"])
    }
  ];

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Discovery</p>
          <h1>Discovery Events</h1>
          <p className="page-description">Operational event stream from the discovery pipeline.</p>
        </div>
        <button className="button" type="button" onClick={loadEvents}>
          Refresh
        </button>
      </header>

      {error ? <div className="error-state">{error}</div> : null}
      <section className="panel">
        <DataTable
          columns={columns}
          emptyMessage="No discovery events returned yet."
          loading={loading}
          rows={events}
          onRowClick={setSelected}
        />
      </section>

      <DetailDrawer
        data={selected}
        open={Boolean(selected)}
        title={selected ? valueAt(selected, ["type", "eventType", "name"], "Discovery event") : "Discovery event"}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
