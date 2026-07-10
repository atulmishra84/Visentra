import { useEffect, useMemo, useState } from "react";
import { apiRequest, compactDate, listFromPayload, valueAt } from "../lib/api";

export function TimelinePage() {
  const [payload, setPayload] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    apiRequest<unknown>("/api/dashboards/timeline")
      .then((data) => mounted && setPayload(data))
      .catch((requestError) => mounted && setError(requestError instanceof Error ? requestError.message : "Failed to load timeline."))
      .finally(() => mounted && setLoading(false));

    return () => {
      mounted = false;
    };
  }, []);

  const rows = useMemo(
    () => listFromPayload<Record<string, unknown>>(payload, ["items", "events", "timeline", "activity"]),
    [payload]
  );

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Timeline</p>
          <h1>Agent Timeline</h1>
          <p className="page-description">Time-based visibility into agent inventory, discovery, and relationship activity.</p>
        </div>
      </header>

      {loading ? (
        <div className="loading-state">Loading timeline activity...</div>
      ) : error ? (
        <div className="error-state">{error}</div>
      ) : rows.length ? (
        <section className="panel timeline">
          {rows.map((row, index) => (
            <article className="timeline-item" key={String(row.id ?? index)}>
              <span className="mono muted">{compactDate(row.timestamp ?? row.createdAt ?? row.observedAt)}</span>
              <div>
                <strong>{valueAt(row, ["title", "name", "type"], "Timeline event")}</strong>
                <p className="muted">{valueAt(row, ["description", "message", "summary"], "No details supplied.")}</p>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <div className="empty-state">No timeline events returned by `/api/dashboards/timeline`.</div>
      )}
    </div>
  );
}
