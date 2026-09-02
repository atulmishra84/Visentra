import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { DataTable, type Column } from "../components/DataTable";
import { apiRequest, valueAt } from "../lib/api";

type Control = {
  id: string;
  framework: string;
  code: string;
  title: string;
  description: string;
  family?: string;
  evidenceHints?: string[];
};

type CatalogResponse = {
  frameworks?: Array<{ id: string; name: string; controlCount?: number; description?: string }>;
  controls?: Control[];
};

export function GovernanceCatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const framework = searchParams.get("framework") || "";
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    apiRequest<CatalogResponse>("/api/compliance/catalog", {
      query: { framework: framework || undefined }
    })
      .then((payload) => mounted && setData(payload))
      .catch((err) => mounted && setError(err instanceof Error ? err.message : "Failed to load catalog"))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [framework]);

  const fwName = useMemo(() => {
    const hit = (data?.frameworks || []).find((f) => f.id === framework);
    return hit?.name || "All frameworks";
  }, [data, framework]);

  const columns: Array<Column<Control & Record<string, unknown>>> = [
    {
      key: "code",
      header: "Code",
      render: (c) => <strong>{c.code}</strong>,
      sortValue: (c) => c.code
    },
    {
      key: "title",
      header: "Control",
      render: (c) => (
        <>
          <strong>{c.title}</strong>
          <div className="muted small">{c.family || c.framework}</div>
        </>
      ),
      sortValue: (c) => c.title
    },
    {
      key: "description",
      header: "Description",
      render: (c) => c.description,
      sortValue: (c) => c.description
    },
    {
      key: "evidence",
      header: "Evidence signals",
      render: (c) => (c.evidenceHints || []).join(", ") || "—",
      sortValue: (c) => (c.evidenceHints || []).join(",")
    }
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Control catalog</h1>
          <p className="muted">OWASP LLM Top 10, HIPAA agent-relevant safeguards, and NIST AI RMF controls used for reviews.</p>
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
                {fw.name} ({fw.controlCount ?? 0})
              </option>
            ))}
          </select>
          <Link className="button ghost" to="/governance">
            Back to assessments
          </Link>
        </div>
      </div>

      {error ? <div className="error-state">{error}</div> : null}

      <section className="panel">
        <div className="page-header">
          <h2>{fwName}</h2>
          <span className="status-pill">{(data?.controls || []).length} controls</span>
        </div>
        {loading ? (
          <div className="loading-state">Loading catalog...</div>
        ) : (
          <DataTable
            columns={columns}
            rows={(data?.controls || []) as Array<Control & Record<string, unknown>>}
            emptyMessage="No controls in catalog."
          />
        )}
        {(data?.frameworks || []).map((fw) =>
          !framework || framework === fw.id ? (
            <div key={fw.id} className="muted small" style={{ marginTop: 8 }}>
              {fw.name}: {valueAt(fw, ["description"], "")}
            </div>
          ) : null
        )}
      </section>
    </div>
  );
}
