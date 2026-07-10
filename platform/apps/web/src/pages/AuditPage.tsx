import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";

type AuditEvent = {
  id: number;
  actor_email: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  created_at: string;
};

export function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    apiRequest<{ events: AuditEvent[] }>("/api/audit?limit=200")
      .then((payload) => {
        if (mounted) setEvents(payload.events || []);
      })
      .catch((err) => {
        if (mounted) setError(err instanceof Error ? err.message : "Failed to load audit log");
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (error) return <div className="error-state">{error}</div>;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Audit log</h1>
          <p className="page-description">
            Who changed connectors, started discovery jobs, and signed in.
          </p>
        </div>
      </header>

      <section className="panel">
        {!events.length ? (
          <p className="muted">No audit events yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Resource</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((evt) => (
                <tr key={evt.id}>
                  <td className="muted">{new Date(evt.created_at).toLocaleString()}</td>
                  <td>{evt.actor_email || "—"}</td>
                  <td>
                    <code>{evt.action}</code>
                  </td>
                  <td className="muted">
                    {evt.resource_type || "—"}
                    {evt.resource_id ? ` · ${String(evt.resource_id).slice(0, 8)}` : ""}
                  </td>
                  <td className="muted">
                    <code>{JSON.stringify(evt.details || {}).slice(0, 120)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
