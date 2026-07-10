import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiRequest, listFromPayload, valueAt } from "../lib/api";

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const initialQuery = params.get("q") ?? "";
  const [query, setQuery] = useState(initialQuery);
  const [payload, setPayload] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = (nextQuery: string) => {
    if (!nextQuery.trim()) {
      setPayload(null);
      return;
    }

    setLoading(true);
    setError(null);
    apiRequest<unknown>("/api/search", { query: { q: nextQuery.trim() } })
      .then(setPayload)
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Search failed."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setQuery(initialQuery);
    search(initialQuery);
    // URL query changes are the source of truth for global search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setParams(query.trim() ? { q: query.trim() } : {});
    search(query);
  };

  const results = useMemo(
    () => listFromPayload<Record<string, unknown>>(payload, ["items", "results", "hits"]),
    [payload]
  );
  const facets = useMemo(
    () => listFromPayload<Record<string, unknown>>(payload, ["facets", "filters"]),
    [payload]
  );

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Search</p>
          <h1>Global Search</h1>
          <p className="page-description">Search agents, repositories, models, tools, MCP servers, cloud assets, and discovery evidence.</p>
        </div>
      </header>

      <form className="facet-bar" onSubmit={submit}>
        <div className="field" style={{ flex: 1, minWidth: 280 }}>
          <label htmlFor="global-search">Query</label>
          <input
            autoFocus
            className="input"
            id="global-search"
            placeholder="invoice extraction, gpt-4.1, platform-ai..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <button className="button primary" type="submit">
          Search
        </button>
      </form>

      {loading ? (
        <div className="loading-state">Searching AgentRadar...</div>
      ) : error ? (
        <div className="error-state">{error}</div>
      ) : (
        <section className="split-grid">
          <aside className="panel">
            <h2>Facets</h2>
            {facets.length ? (
              <div className="chart-list">
                {facets.map((facet, index) => (
                  <div className="bar-row" key={String(facet.name ?? index)}>
                    <span>{valueAt(facet, ["name", "label", "field"])}</span>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: "55%" }} />
                    </div>
                    <span className="mono">{valueAt(facet, ["count", "value"], "")}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">Facets will appear after the search API returns them.</div>
            )}
          </aside>

          <section className="panel">
            <h2>Results</h2>
            {results.length ? (
              <div className="chart-list">
                {results.map((result, index) => {
                  const entityId = valueAt(result, ["id", "agentId"], "");
                  const type = valueAt(result, ["type", "kind", "entityType"], "Result");
                  return (
                    <article className="panel" key={String(result.id ?? index)} style={{ boxShadow: "none" }}>
                      <div className="page-header">
                        <div>
                          <strong>{valueAt(result, ["name", "displayName", "title"], "Search result")}</strong>
                          <p className="muted">{valueAt(result, ["summary", "description", "snippet"], "No summary returned.")}</p>
                        </div>
                        {type.toLowerCase().includes("agent") && entityId ? (
                          <Link className="button" to={`/agents/${encodeURIComponent(entityId)}`}>
                            Open
                          </Link>
                        ) : (
                          <span className="badge">{type}</span>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state">Enter a query to search global AgentRadar visibility data.</div>
            )}
          </section>
        </section>
      )}
    </div>
  );
}
