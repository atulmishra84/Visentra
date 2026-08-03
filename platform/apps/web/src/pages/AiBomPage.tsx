import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DataTable, type Column } from "../components/DataTable";
import { DetailDrawer } from "../components/DetailDrawer";
import { KpiCard } from "../components/KpiCard";
import { apiRequest, getAuthToken, buildApiUrl } from "../lib/api";

type FieldScore = {
  id: string;
  category: string;
  label: string;
  source: string;
  filled: boolean;
  value: unknown;
};

type BomSystem = {
  bomRef: string;
  agentId: string;
  name: string;
  fingerprint?: string;
  composition: Record<string, any>;
  score: {
    pct: number;
    filled: number;
    total: number;
    byCategory: Record<string, { filled: number; total: number; pct: number }>;
    gaps: FieldScore[];
    fields: FieldScore[];
  };
  enrichment?: { updatedAt?: string; updatedBy?: string; completeness?: number } | null;
};

type BomComponent = {
  bomRef: string;
  category: string;
  type: string;
  name: string;
  version?: string | null;
  provider?: string | null;
  occurrenceCount?: number;
  usedBy?: string[];
  agentIds?: string[];
};

type SnapshotRow = {
  id: string;
  serial_number: string;
  format: string;
  label?: string | null;
  summary?: Record<string, unknown>;
  created_by?: string | null;
  created_at: string;
};

type AiBomResponse = {
  bomFormat: string;
  specVersion: string;
  serialNumber: string;
  metadata: { generatedAt: string; note?: string };
  summary: {
    systems: number;
    models: number;
    data: number;
    software_infra: number;
    tools_integrations: number;
    identity_access: number;
    governance: number;
    behavioral: number;
    componentTotal: number;
    ownershipCoveragePct: number;
    modelNamedPct: number;
    enrichedPct: number;
    shadowCandidates: number;
    completenessPct: number;
    fieldRollup: {
      pct: number;
      byCategory: Record<string, { filled: number; total: number; pct: number }>;
    };
    gaps: string[];
  };
  systems: BomSystem[];
  components: BomComponent[];
  categories: Record<string, BomComponent[]>;
};

const TABS = ["overview", "systems", "matrix", "enrich", "snapshots"] as const;
type Tab = (typeof TABS)[number];

const CATEGORY_LABELS: Record<string, string> = {
  models: "1. Models",
  data: "2. Data",
  software_infra: "3. Software & infra",
  tools_integrations: "4. Tools & integrations",
  identity_access: "5. Identity & access",
  governance: "6. Governance",
  behavioral: "7. Behavioral / risk"
};

const ENRICH_TEMPLATE = `{
  "model": {
    "version": "",
    "checksum": "",
    "modelCardId": "",
    "provenance": "third_party_api",
    "baseModel": "",
    "registry": "",
    "trainingDataSource": "",
    "license": "",
    "modelType": "llm",
    "quantization": "",
    "knownCves": []
  },
  "data": {
    "trainingDatasets": [],
    "ragSources": [],
    "promptHash": "",
    "hasPii": false,
    "hasPhi": false,
    "dataClasses": []
  },
  "software": {
    "frameworkVersion": "",
    "packageSbom": "",
    "containerDigest": "",
    "imageCves": [],
    "servingLayer": ""
  },
  "tools": {
    "schemas": [],
    "plugins": []
  },
  "identity": {
    "authMode": "managed_identity",
    "secretsRefs": []
  },
  "governance": {
    "approvalStatus": "approved",
    "environment": "production",
    "compliance": ["NIST_AI_RMF"]
  },
  "behavioral": {
    "knownRisks": [],
    "evalResults": "",
    "guardrails": []
  }
}`;

async function downloadBom(format: "json" | "cyclonedx", agentId?: string | null) {
  const token = getAuthToken();
  const response = await fetch(
    buildApiUrl("/api/ai-bom/export", { format, ...(agentId ? { agentId } : {}) }),
    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  );
  if (!response.ok) throw new Error((await response.text()) || `Export failed (${response.status})`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = format === "cyclonedx" ? "visentra-ai-bom.cdx.json" : "visentra-ai-bom.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function AiBomPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") as Tab) || "overview";
  const focusAgent = searchParams.get("agentId");

  const [tab, setTab] = useState<Tab>(TABS.includes(initialTab) ? initialTab : "overview");
  const [data, setData] = useState<AiBomResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<BomSystem | null>(null);
  const [enrichAgentId, setEnrichAgentId] = useState(focusAgent || "");
  const [enrichJson, setEnrichJson] = useState(ENRICH_TEMPLATE);
  const [enrichMsg, setEnrichMsg] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [componentCategory, setComponentCategory] = useState("models");

  const load = async () => {
    setError(null);
    const [bom, snap] = await Promise.all([
      apiRequest<AiBomResponse>("/api/ai-bom"),
      apiRequest<{ snapshots: SnapshotRow[] }>("/api/ai-bom/snapshots").catch(() => ({ snapshots: [] }))
    ]);
    setData(bom);
    setSnapshots(snap.snapshots || []);
    if (focusAgent) {
      const hit = bom.systems.find((s) => s.agentId === focusAgent);
      if (hit) setSelected(hit);
    }
  };

  useEffect(() => {
    let mounted = true;
    load()
      .catch((err) => {
        if (mounted) setError(err instanceof Error ? err.message : "Failed to load AI BOM");
      });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    if (enrichAgentId) next.set("agentId", enrichAgentId);
    else next.delete("agentId");
    setSearchParams(next, { replace: true });
  }, [tab, enrichAgentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const systemColumns: Column<BomSystem>[] = useMemo(
    () => [
      {
        key: "name",
        header: "AI system",
        render: (row) => (
          <div>
            <strong>{row.name}</strong>
            <div className="muted" style={{ fontSize: "0.78rem" }}>
              {row.composition?.model?.name || "no model"} · {row.composition?.software?.framework || "no framework"}
            </div>
          </div>
        ),
        sortValue: (row) => row.name
      },
      {
        key: "score",
        header: "Completeness",
        render: (row) => `${row.score.pct}%`,
        sortValue: (row) => row.score.pct
      },
      {
        key: "owner",
        header: "Owner",
        render: (row) => row.composition?.governance?.owner || "—",
        sortValue: (row) => row.composition?.governance?.owner || ""
      },
      {
        key: "approval",
        header: "Approval",
        render: (row) => row.composition?.governance?.approvalStatus || "—",
        sortValue: (row) => row.composition?.governance?.approvalStatus || ""
      },
      {
        key: "open",
        header: "",
        render: (row) => (
          <div style={{ display: "flex", gap: 6 }}>
            <button className="button ghost" type="button" onClick={() => setSelected(row)}>
              Fields
            </button>
            <Link className="button ghost" to={`/agents/${row.agentId}`}>
              Agent
            </Link>
          </div>
        )
      }
    ],
    []
  );

  const componentRows = data?.categories?.[componentCategory] || [];
  const componentColumns: Column<BomComponent>[] = useMemo(
    () => [
      {
        key: "name",
        header: "Component",
        render: (row) => (
          <div>
            <strong>{row.name}</strong>
            <div className="muted" style={{ fontSize: "0.78rem" }}>
              {row.type}
              {row.version ? ` · v${row.version}` : ""}
              {row.provider ? ` · ${row.provider}` : ""}
            </div>
          </div>
        ),
        sortValue: (row) => row.name
      },
      {
        key: "occurrenceCount",
        header: "Seen on",
        render: (row) => String(row.occurrenceCount ?? 1),
        sortValue: (row) => row.occurrenceCount ?? 1
      },
      {
        key: "usedBy",
        header: "Used by",
        render: (row) => (row.usedBy || []).slice(0, 4).join(", ") || "—",
        sortValue: (row) => (row.usedBy || []).join(",")
      }
    ],
    []
  );

  const onExport = async (format: "json" | "cyclonedx") => {
    setBusy(true);
    setError(null);
    try {
      await downloadBom(format);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  const loadEnrichment = async (agentId: string) => {
    setEnrichMsg(null);
    setEnrichAgentId(agentId);
    try {
      const payload = await apiRequest<{ enrichment: { fields?: Record<string, unknown> } | null }>(
        `/api/ai-bom/enrichments/${encodeURIComponent(agentId)}`
      );
      if (payload.enrichment?.fields) {
        setEnrichJson(JSON.stringify(payload.enrichment.fields, null, 2));
      } else {
        setEnrichJson(ENRICH_TEMPLATE);
      }
      setTab("enrich");
    } catch (err) {
      setEnrichMsg(err instanceof Error ? err.message : "Failed to load enrichment");
    }
  };

  const saveEnrichment = async () => {
    setEnrichMsg(null);
    setBusy(true);
    try {
      if (!enrichAgentId) throw new Error("Select an agent ID");
      const fields = JSON.parse(enrichJson);
      const result = await apiRequest<{ score: { pct: number } }>(
        `/api/ai-bom/enrichments/${encodeURIComponent(enrichAgentId)}`,
        { method: "PUT", body: JSON.stringify({ fields }) }
      );
      setEnrichMsg(`Saved. Completeness now ${result.score.pct}%.`);
      await load();
    } catch (err) {
      setEnrichMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const createSnapshot = async (format: "visentra" | "cyclonedx") => {
    setBusy(true);
    setError(null);
    try {
      await apiRequest("/api/ai-bom/snapshots", {
        method: "POST",
        body: JSON.stringify({ format, label: `AI BOM ${new Date().toISOString()}` })
      });
      await load();
      setTab("snapshots");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Snapshot failed");
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <div className="error-state">{error}</div>;
  if (!data) return <div className="loading-state">Building full AI BOM…</div>;

  const s = data.summary;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">AI BOM</p>
          <h1>Full Bill of Materials</h1>
          <p className="page-description">
            Complete AI/ML composition across models, data, software, tools, identity, governance, and behavioral
            risk — discovery plus enrichment, with explicit unknowns.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="button" type="button" disabled={busy} onClick={() => void onExport("json")}>
            Export JSON
          </button>
          <button className="button" type="button" disabled={busy} onClick={() => void onExport("cyclonedx")}>
            Export CycloneDX
          </button>
          <button className="button primary" type="button" disabled={busy} onClick={() => void createSnapshot("visentra")}>
            Snapshot
          </button>
        </div>
      </header>

      {error ? <div className="error-state" style={{ marginBottom: 16 }}>{error}</div> : null}

      <div className="kpi-grid">
        <KpiCard label="Completeness" value={`${s.completenessPct}%`} />
        <KpiCard label="AI systems" value={String(s.systems)} />
        <KpiCard label="Models" value={String(s.models)} />
        <KpiCard label="Tools & MCP" value={String(s.tools_integrations)} />
        <KpiCard label="Enriched systems" value={`${s.enrichedPct}%`} />
        <KpiCard label="Shadow candidates" value={String(s.shadowCandidates)} />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18 }}>
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            className={`button ${tab === id ? "primary" : "ghost"}`}
            onClick={() => setTab(id)}
          >
            {id === "overview"
              ? "Overview"
              : id === "systems"
                ? "Systems"
                : id === "matrix"
                  ? "Field matrix"
                  : id === "enrich"
                    ? "Enrich"
                    : "Snapshots"}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <>
          <section className="panel" style={{ marginTop: 16 }}>
            <h2>Category coverage</h2>
            <div className="kpi-grid" style={{ marginTop: 12 }}>
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
                const stats = s.fieldRollup?.byCategory?.[key];
                return (
                  <KpiCard
                    key={key}
                    label={label}
                    value={`${stats?.pct ?? 0}%`}
                  />
                );
              })}
            </div>
          </section>

          <section className="panel" style={{ marginTop: 16 }}>
            <div className="panel-header" style={{ marginBottom: 10 }}>
              <h2>Estate components</h2>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              {Object.keys(CATEGORY_LABELS).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`button ${componentCategory === key ? "primary" : "ghost"}`}
                  onClick={() => setComponentCategory(key)}
                >
                  {CATEGORY_LABELS[key]} ({data.categories?.[key]?.length || 0})
                </button>
              ))}
            </div>
            <DataTable
              rows={componentRows}
              columns={componentColumns}
              emptyMessage="No components in this category yet."
            />
          </section>
        </>
      ) : null}

      {tab === "systems" ? (
        <section className="panel" style={{ marginTop: 16 }}>
          <div className="panel-header">
            <h2>AI systems</h2>
            <span className="status-pill">{data.systems.length}</span>
          </div>
          <DataTable
            rows={data.systems}
            columns={systemColumns}
            getRowKey={(row) => row.agentId}
            emptyMessage="No agents in inventory yet."
          />
        </section>
      ) : null}

      {tab === "matrix" ? (
        <section className="panel" style={{ marginTop: 16 }}>
          <h2>Field matrix (estate rollup)</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            {s.fieldRollup?.pct ?? 0}% of catalog fields filled across all systems · generated{" "}
            {new Date(data.metadata.generatedAt).toLocaleString()}
          </p>
          <table className="data-table" style={{ marginTop: 14 }}>
            <thead>
              <tr>
                <th>Category</th>
                <th>Filled</th>
                <th>Total</th>
                <th>Coverage</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
                const row = s.fieldRollup?.byCategory?.[key] || { filled: 0, total: 0, pct: 0 };
                return (
                  <tr key={key}>
                    <td>{label}</td>
                    <td>{row.filled}</td>
                    <td>{row.total}</td>
                    <td>
                      <span className="status-pill">{row.pct}%</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <h3 style={{ marginTop: 20 }}>Typical enrichment gaps</h3>
          <ul style={{ marginTop: 8, paddingLeft: 18, color: "var(--text-muted)", lineHeight: 1.55 }}>
            {(s.gaps || []).slice(0, 12).map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === "enrich" ? (
        <section className="panel" style={{ marginTop: 16 }}>
          <h2>Enrich AI BOM fields</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            Supply model hashes, licenses, datasets, guardrails, and other fields discovery cannot observe.
            Operators and admins only.
          </p>
          <div className="field" style={{ marginTop: 14, maxWidth: 520 }}>
            <label htmlFor="enrich-agent">Agent</label>
            <select
              id="enrich-agent"
              className="input"
              value={enrichAgentId}
              onChange={(e) => {
                const id = e.target.value;
                if (id) void loadEnrichment(id);
                else setEnrichAgentId("");
              }}
            >
              <option value="">Select agent…</option>
              {data.systems.map((sys) => (
                <option key={sys.agentId} value={sys.agentId}>
                  {sys.name} ({sys.score.pct}%)
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="enrich-json">Enrichment JSON</label>
            <textarea
              id="enrich-json"
              className="input"
              style={{ minHeight: 360, fontFamily: "var(--font-mono)", fontSize: "0.82rem" }}
              value={enrichJson}
              onChange={(e) => setEnrichJson(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="button primary" type="button" disabled={busy || !enrichAgentId} onClick={() => void saveEnrichment()}>
              Save enrichment
            </button>
            <button className="button ghost" type="button" onClick={() => setEnrichJson(ENRICH_TEMPLATE)}>
              Reset template
            </button>
          </div>
          {enrichMsg ? <p style={{ marginTop: 12 }}>{enrichMsg}</p> : null}
        </section>
      ) : null}

      {tab === "snapshots" ? (
        <section className="panel" style={{ marginTop: 16 }}>
          <div className="panel-header">
            <h2>Snapshots</h2>
            <button className="button" type="button" disabled={busy} onClick={() => void createSnapshot("cyclonedx")}>
              Snapshot CycloneDX
            </button>
          </div>
          <table className="data-table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Created</th>
                <th>Format</th>
                <th>Label</th>
                <th>Completeness</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.length ? (
                snapshots.map((snap) => (
                  <tr key={snap.id}>
                    <td>{new Date(snap.created_at).toLocaleString()}</td>
                    <td>{snap.format}</td>
                    <td>{snap.label || snap.serial_number}</td>
                    <td>{String((snap.summary as { completenessPct?: number } | undefined)?.completenessPct ?? "—")}%</td>
                    <td className="muted">{snap.created_by || "—"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="muted">
                    No snapshots yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      ) : null}

      <DetailDrawer
        open={Boolean(selected)}
        title={selected ? `AI BOM · ${selected.name}` : "AI BOM"}
        onClose={() => setSelected(null)}
      >
        {selected ? (
          <div style={{ display: "grid", gap: 14 }}>
            <div className="kpi-grid">
              <KpiCard label="Completeness" value={`${selected.score.pct}%`} />
              <KpiCard label="Filled fields" value={`${selected.score.filled}/${selected.score.total}`} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="button" type="button" onClick={() => void loadEnrichment(selected.agentId)}>
                Enrich this system
              </button>
              <Link className="button ghost" to={`/agents/${selected.agentId}`}>
                Open agent
              </Link>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Status</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {selected.score.fields.map((field) => (
                  <tr key={field.id}>
                    <td>
                      <strong>{field.label}</strong>
                      <div className="muted" style={{ fontSize: "0.75rem" }}>
                        {field.category}
                      </div>
                    </td>
                    <td>
                      <span className={`status-pill ${field.filled ? "status-covered" : ""}`}>
                        {field.filled ? "filled" : "gap"}
                      </span>
                    </td>
                    <td className="muted">{field.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </DetailDrawer>
    </div>
  );
}
