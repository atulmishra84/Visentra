import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { DataTable, type Column } from "../components/DataTable";
import { apiRequest, valueAt } from "../lib/api";

type Framework = {
  id: string;
  name: string;
  version?: string | null;
  description?: string;
  controlCount?: number;
  builtin?: boolean;
};

type Control = {
  id: string;
  framework: string;
  code: string;
  title: string;
  description: string;
  family?: string | null;
  evidenceHints?: string[];
  builtin?: boolean;
};

type CatalogResponse = {
  frameworks?: Framework[];
  controls?: Control[];
};

const EMPTY_FRAMEWORK = { id: "", name: "", version: "", description: "" };
const EMPTY_CONTROL = {
  framework: "",
  code: "",
  title: "",
  description: "",
  family: "",
  evidenceHints: ""
};

export function GovernanceCatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const framework = searchParams.get("framework") || "";
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [frameworkForm, setFrameworkForm] = useState({ ...EMPTY_FRAMEWORK });
  const [controlForm, setControlForm] = useState({ ...EMPTY_CONTROL });
  const [showFrameworkForm, setShowFrameworkForm] = useState(false);
  const [showControlForm, setShowControlForm] = useState(false);

  const load = async (fw = framework) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiRequest<CatalogResponse>("/api/compliance/catalog", {
        query: { framework: fw || undefined }
      });
      setData(payload);
      if (!controlForm.framework && payload.frameworks?.[0]?.id) {
        setControlForm((prev) => ({ ...prev, framework: fw || payload.frameworks![0].id }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load catalog");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(framework);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framework]);

  const frameworks = data?.frameworks || [];
  const controls = data?.controls || [];
  const selectedFramework = useMemo(
    () => frameworks.find((f) => f.id === framework) || null,
    [frameworks, framework]
  );

  const setFrameworkFilter = (id: string) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set("framework", id);
    else next.delete("framework");
    setSearchParams(next, { replace: true });
    setControlForm((prev) => ({ ...prev, framework: id || prev.framework }));
  };

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
          <div className="muted small">
            {c.family || c.framework}
            {c.builtin === false ? " · custom" : ""}
          </div>
        </>
      ),
      sortValue: (c) => c.title
    },
    {
      key: "description",
      header: "Description",
      render: (c) => c.description || "—",
      sortValue: (c) => c.description || ""
    },
    {
      key: "evidence",
      header: "Evidence signals",
      render: (c) => (c.evidenceHints || []).join(", ") || "—",
      sortValue: (c) => (c.evidenceHints || []).join(",")
    }
  ];

  const submitFramework = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const payload = await apiRequest<{ framework: Framework }>("/api/compliance/catalog/frameworks", {
        method: "POST",
        body: JSON.stringify({
          id: frameworkForm.id.trim() || undefined,
          name: frameworkForm.name.trim(),
          version: frameworkForm.version.trim() || undefined,
          description: frameworkForm.description.trim()
        })
      });
      setFrameworkForm({ ...EMPTY_FRAMEWORK });
      setShowFrameworkForm(false);
      setMessage(`Framework “${payload.framework.name}” added.`);
      setFrameworkFilter(payload.framework.id);
      await load(payload.framework.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create framework");
    } finally {
      setBusy(false);
    }
  };

  const submitControl = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const payload = await apiRequest<{ control: Control }>("/api/compliance/catalog/controls", {
        method: "POST",
        body: JSON.stringify({
          framework: controlForm.framework || framework,
          code: controlForm.code.trim(),
          title: controlForm.title.trim(),
          description: controlForm.description.trim(),
          family: controlForm.family.trim() || undefined,
          evidenceHints: controlForm.evidenceHints
        })
      });
      setControlForm({
        ...EMPTY_CONTROL,
        framework: payload.control.framework
      });
      setShowControlForm(false);
      setMessage(`Control “${payload.control.code}” added.`);
      if (framework !== payload.control.framework) {
        setFrameworkFilter(payload.control.framework);
      } else {
        await load(framework);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create control");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Governance &amp; Compliance</p>
          <h1>Control catalog</h1>
          <p className="page-description">
            Built-in OWASP LLM, HIPAA, and NIST AI RMF controls — plus custom frameworks and controls you add for
            assessments.
          </p>
        </div>
        <div className="toolbar" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="button" type="button" onClick={() => setShowFrameworkForm((v) => !v)}>
            {showFrameworkForm ? "Close framework form" : "Add framework"}
          </button>
          <button className="button primary" type="button" onClick={() => setShowControlForm((v) => !v)}>
            {showControlForm ? "Close control form" : "Add control"}
          </button>
          <Link className="button ghost" to="/governance">
            Back to assessments
          </Link>
        </div>
      </header>

      {error ? <div className="error-state">{error}</div> : null}
      {message ? (
        <div className="status-pill ok" style={{ marginBottom: 12 }}>
          {message}
        </div>
      ) : null}

      <div className="catalog-layout">
        <aside className="panel catalog-side">
          <div className="panel-heading">
            <h2>Frameworks</h2>
            <span className="status-pill">{frameworks.length}</span>
          </div>
          <button
            type="button"
            className={`framework-chip ${!framework ? "is-active" : ""}`}
            style={{ width: "100%", marginBottom: 8 }}
            onClick={() => setFrameworkFilter("")}
          >
            <strong>All frameworks</strong>
            <div className="meta">{controls.length} controls in view</div>
          </button>
          <div className="framework-list">
            {frameworks.map((fw) => (
              <button
                key={fw.id}
                type="button"
                className={`framework-chip ${framework === fw.id ? "is-active" : ""}`}
                onClick={() => setFrameworkFilter(fw.id)}
              >
                <strong>{fw.name}</strong>
                <div className="meta">
                  {fw.version || "—"} · {fw.controlCount ?? 0} controls
                  {fw.builtin === false ? " · custom" : " · built-in"}
                </div>
                {fw.description ? <div className="meta">{fw.description}</div> : null}
              </button>
            ))}
          </div>

          {showFrameworkForm ? (
            <form className="connector-form" style={{ marginTop: 16 }} onSubmit={(e) => void submitFramework(e)}>
              <h3 className="form-section-title">New framework</h3>
              <label>
                Name
                <input
                  className="input"
                  required
                  value={frameworkForm.name}
                  onChange={(e) => setFrameworkForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="ISO 42001"
                />
              </label>
              <label>
                ID (optional)
                <input
                  className="input"
                  value={frameworkForm.id}
                  onChange={(e) => setFrameworkForm((p) => ({ ...p, id: e.target.value }))}
                  placeholder="iso_42001"
                />
              </label>
              <label>
                Version
                <input
                  className="input"
                  value={frameworkForm.version}
                  onChange={(e) => setFrameworkForm((p) => ({ ...p, version: e.target.value }))}
                  placeholder="2023"
                />
              </label>
              <label>
                Description
                <textarea
                  className="input"
                  rows={3}
                  value={frameworkForm.description}
                  onChange={(e) => setFrameworkForm((p) => ({ ...p, description: e.target.value }))}
                />
              </label>
              <button className="button primary" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save framework"}
              </button>
            </form>
          ) : null}
        </aside>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>{selectedFramework?.name || "All frameworks"}</h2>
              {selectedFramework?.description ? (
                <p className="muted small" style={{ margin: "4px 0 0" }}>
                  {selectedFramework.description}
                </p>
              ) : null}
            </div>
            <span className="status-pill">{controls.length} controls</span>
          </div>

          {showControlForm ? (
            <form className="connector-form" style={{ marginBottom: 16 }} onSubmit={(e) => void submitControl(e)}>
              <h3 className="form-section-title">New control</h3>
              <div className="form-row">
                <label>
                  Framework
                  <select
                    className="input"
                    required
                    value={controlForm.framework || framework}
                    onChange={(e) => setControlForm((p) => ({ ...p, framework: e.target.value }))}
                  >
                    <option value="">Select framework</option>
                    {frameworks.map((fw) => (
                      <option key={fw.id} value={fw.id}>
                        {fw.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Code
                  <input
                    className="input"
                    required
                    value={controlForm.code}
                    onChange={(e) => setControlForm((p) => ({ ...p, code: e.target.value }))}
                    placeholder="CTL-01"
                  />
                </label>
              </div>
              <label>
                Title
                <input
                  className="input"
                  required
                  value={controlForm.title}
                  onChange={(e) => setControlForm((p) => ({ ...p, title: e.target.value }))}
                  placeholder="Human oversight required"
                />
              </label>
              <label>
                Description
                <textarea
                  className="input"
                  rows={3}
                  value={controlForm.description}
                  onChange={(e) => setControlForm((p) => ({ ...p, description: e.target.value }))}
                />
              </label>
              <div className="form-row">
                <label>
                  Family
                  <input
                    className="input"
                    value={controlForm.family}
                    onChange={(e) => setControlForm((p) => ({ ...p, family: e.target.value }))}
                    placeholder="Governance"
                  />
                </label>
                <label>
                  Evidence signals (comma-separated)
                  <input
                    className="input"
                    value={controlForm.evidenceHints}
                    onChange={(e) => setControlForm((p) => ({ ...p, evidenceHints: e.target.value }))}
                    placeholder="ownership, guardrails, audit"
                  />
                </label>
              </div>
              <button className="button primary" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save control"}
              </button>
            </form>
          ) : null}

          {loading ? (
            <div className="loading-state">Loading catalog…</div>
          ) : (
            <DataTable
              columns={columns}
              rows={controls as Array<Control & Record<string, unknown>>}
              emptyMessage="No controls in this view. Add a control or pick another framework."
            />
          )}

          {!selectedFramework && frameworks.length ? (
            <div className="muted small" style={{ marginTop: 12 }}>
              {frameworks.map((fw) => (
                <div key={fw.id}>
                  {fw.name}: {valueAt(fw as Record<string, unknown>, ["description"], "")}
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
