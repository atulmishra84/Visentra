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

const CATEGORY_ORDER = [
  "models",
  "data",
  "software_infra",
  "tools_integrations",
  "identity_access",
  "governance",
  "behavioral"
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  models: "Models",
  data: "Data",
  software_infra: "Software & infra",
  tools_integrations: "Tools & MCP",
  identity_access: "Identity",
  governance: "Governance",
  behavioral: "Behavioral"
};

const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  systems: "Systems",
  matrix: "Field matrix",
  enrich: "Enrich",
  snapshots: "Snapshots"
};

const ENRICH_TEMPLATE = `{
  "model": {
    "version": "",
    "checksum": "",
    "provenance": "third_party_api",
    "license": "",
    "modelType": "llm"
  },
  "data": {
    "hasPii": false,
    "hasPhi": false,
    "dataClasses": []
  },
  "software": {
    "frameworkVersion": "",
    "servingLayer": ""
  },
  "identity": {
    "authMode": "managed_identity"
  },
  "governance": {
    "approvalStatus": "approved",
    "environment": "production",
    "compliance": ["NIST_AI_RMF"]
  },
  "behavioral": {
    "guardrails": []
  }
}`;

async function downloadBom(format: "json" | "cyclonedx") {
  const token = getAuthToken();
  const response = await fetch(buildApiUrl("/api/ai-bom/export", { format }), {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
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

function BomSystemDrawer({
  system,
  onEnrich,
  onClose
}: {
  system: BomSystem;
  onEnrich: (agentId: string) => void;
  onClose: () => void;
}) {
  const c = system.composition;
  const tools = Array.isArray(c.tools?.list) ? c.tools.list.length : 0;
  const mcp = Array.isArray(c.tools?.mcpServers) ? c.tools.mcpServers.length : 0;
  const topGaps = (system.score.gaps || []).slice(0, 4);
  const facts = [
    { label: "Model", value: c.model?.name ? `${c.model.name}${c.model.provider ? ` · ${c.model.provider}` : ""}` : "—" },
    { label: "Framework", value: c.software?.framework || "—" },
    { label: "Owner", value: c.governance?.owner || "—" },
    { label: "Approval", value: c.governance?.approvalStatus || "—" },
    { label: "Identity", value: c.identity?.principal || c.identity?.authMode || "—" },
    {
      label: "Tools / MCP",
      value: tools || mcp ? `${tools || 0} tools · ${mcp || 0} MCP` : "—"
    }
  ];

  return (
    <div className="aibom-drawer">
      <div className="aibom-drawer-body">
        <div className="aibom-drawer-score">
          <div className="aibom-drawer-score-ring" style={{ ["--pct" as string]: `${system.score.pct}%` }}>
            <strong>{system.score.pct}%</strong>
            <span>BOM</span>
          </div>
          <div className="aibom-drawer-score-meta">
            <p>
              <strong>
                {system.score.filled}/{system.score.total}
              </strong>{" "}
              fields filled
            </p>
            <p className="muted">{system.enrichment ? "Enrichment applied" : "Discovery only — not enriched"}</p>
            {c.governance?.environment ? <p className="muted">Env · {c.governance.environment}</p> : null}
          </div>
        </div>

        <div className="aibom-fact-grid">
          {facts.map((fact) => (
            <div key={fact.label} className="aibom-fact">
              <span className="aibom-fact-label">{fact.label}</span>
              <span className="aibom-fact-value" title={String(fact.value)}>
                {fact.value}
              </span>
            </div>
          ))}
        </div>

        <div className="aibom-drawer-section">
          <h3>Coverage by category</h3>
          <ul className="aibom-cat-bars">
            {CATEGORY_ORDER.map((key) => {
              const stats = system.score.byCategory?.[key] || { filled: 0, total: 0, pct: 0 };
              return (
                <li key={key}>
                  <div className="aibom-cat-bar-head">
                    <span>{CATEGORY_LABELS[key]}</span>
                    <span>
                      {stats.pct}% · {stats.filled}/{stats.total}
                    </span>
                  </div>
                  <div className="aibom-cat-bar-track" aria-hidden="true">
                    <span style={{ width: `${stats.pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="aibom-drawer-section">
          <h3>Top gaps to fill</h3>
          {topGaps.length ? (
            <div className="aibom-gap-chips">
              {topGaps.map((gap) => (
                <span key={gap.id} className="aibom-gap-chip" title={`${gap.category} · ${gap.source}`}>
                  {gap.label}
                </span>
              ))}
            </div>
          ) : (
            <p className="muted">No gaps — catalog fields are filled.</p>
          )}
        </div>
      </div>

      <div className="aibom-drawer-actions">
        <button
          className="button primary"
          type="button"
          onClick={() => {
            onEnrich(system.agentId);
            onClose();
          }}
        >
          Enrich gaps
        </button>
        <Link className="button" to={`/agents/${system.agentId}`}>
          Open agent
        </Link>
      </div>
    </div>
  );
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
  const [componentCategory, setComponentCategory] = useState<string>("models");

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
    load().catch((err) => {
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
            <div className="muted aibom-subline">
              {row.composition?.model?.name || "no model"} · {row.composition?.software?.framework || "no framework"}
            </div>
          </div>
        ),
        sortValue: (row) => row.name
      },
      {
        key: "score",
        header: "Complete",
        render: (row) => <span className="aibom-score-pill">{row.score.pct}%</span>,
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
          <div className="aibom-row-actions">
            <button className="button ghost" type="button" onClick={() => setSelected(row)}>
              Summary
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
            <div className="muted aibom-subline">
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
      setEnrichJson(payload.enrichment?.fields ? JSON.stringify(payload.enrichment.fields, null, 2) : ENRICH_TEMPLATE);
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
    <div className="page aibom-page">
      <header className="page-header aibom-header">
        <div className="aibom-header-copy">
          <p className="eyebrow">AI BOM</p>
          <h1>Bill of Materials</h1>
          <p className="page-description">
            Composition of discovered AI systems — models, tools, identity, and governance — with explicit gaps for
            enrichment.
          </p>
        </div>
        <div className="toolbar aibom-header-actions">
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

      {error ? <div className="error-state">{error}</div> : null}

      <section className="card-grid aibom-kpi-grid">
        <KpiCard label="Completeness" value={`${s.completenessPct}%`} />
        <KpiCard label="AI systems" value={String(s.systems)} />
        <KpiCard label="Models" value={String(s.models)} />
        <KpiCard label="Tools & MCP" value={String(s.tools_integrations)} />
        <KpiCard label="Enriched" value={`${s.enrichedPct}%`} />
        <KpiCard label="Shadow" value={String(s.shadowCandidates)} />
      </section>

      <nav className="aibom-tabs" aria-label="AI BOM sections">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            className={`aibom-tab${tab === id ? " is-active" : ""}`}
            onClick={() => setTab(id)}
          >
            {TAB_LABELS[id]}
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <div className="aibom-stack">
          <section className="panel aibom-panel">
            <div className="aibom-panel-head">
              <h2>Category coverage</h2>
              <span className="muted">Estate field fill rate</span>
            </div>
            <div className="aibom-coverage-grid">
              {CATEGORY_ORDER.map((key) => {
                const stats = s.fieldRollup?.byCategory?.[key] || { filled: 0, total: 0, pct: 0 };
                return (
                  <div key={key} className="aibom-coverage-card">
                    <div className="aibom-coverage-card-top">
                      <strong>{CATEGORY_LABELS[key]}</strong>
                      <span>{stats.pct}%</span>
                    </div>
                    <div className="aibom-cat-bar-track" aria-hidden="true">
                      <span style={{ width: `${stats.pct}%` }} />
                    </div>
                    <p className="muted">
                      {stats.filled}/{stats.total} fields
                    </p>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel aibom-panel">
            <div className="aibom-panel-head">
              <h2>Estate components</h2>
              <span className="muted">{data.categories?.[componentCategory]?.length || 0} in view</span>
            </div>
            <div className="aibom-chip-row">
              {CATEGORY_ORDER.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`aibom-chip${componentCategory === key ? " is-active" : ""}`}
                  onClick={() => setComponentCategory(key)}
                >
                  {CATEGORY_LABELS[key]}
                  <em>{data.categories?.[key]?.length || 0}</em>
                </button>
              ))}
            </div>
            <DataTable rows={componentRows} columns={componentColumns} emptyMessage="No components in this category yet." />
          </section>
        </div>
      ) : null}

      {tab === "systems" ? (
        <section className="panel aibom-panel">
          <div className="aibom-panel-head">
            <h2>AI systems</h2>
            <span className="status-pill">{data.systems.length}</span>
          </div>
          <DataTable
            rows={data.systems}
            columns={systemColumns}
            getRowKey={(row) => row.agentId}
            emptyMessage="No agents in inventory yet."
            onRowClick={(row) => setSelected(row)}
          />
        </section>
      ) : null}

      {tab === "matrix" ? (
        <section className="panel aibom-panel">
          <div className="aibom-panel-head">
            <h2>Field matrix</h2>
            <span className="muted">{s.fieldRollup?.pct ?? 0}% filled</span>
          </div>
          <table className="data-table aibom-matrix-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Filled</th>
                <th>Total</th>
                <th>Coverage</th>
              </tr>
            </thead>
            <tbody>
              {CATEGORY_ORDER.map((key) => {
                const row = s.fieldRollup?.byCategory?.[key] || { filled: 0, total: 0, pct: 0 };
                return (
                  <tr key={key}>
                    <td>{CATEGORY_LABELS[key]}</td>
                    <td>{row.filled}</td>
                    <td>{row.total}</td>
                    <td>
                      <div className="aibom-matrix-cell">
                        <div className="aibom-cat-bar-track" aria-hidden="true">
                          <span style={{ width: `${row.pct}%` }} />
                        </div>
                        <span>{row.pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ) : null}

      {tab === "enrich" ? (
        <section className="panel aibom-panel">
          <div className="aibom-panel-head">
            <h2>Enrich fields</h2>
            <span className="muted">Operators / admins</span>
          </div>
          <p className="page-description">
            Add licenses, hashes, datasets, guardrails, and other fields discovery cannot observe.
          </p>
          <div className="aibom-enrich-layout">
            <div className="field">
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
            <div className="field aibom-enrich-json">
              <label htmlFor="enrich-json">Enrichment JSON</label>
              <textarea
                id="enrich-json"
                className="input"
                value={enrichJson}
                onChange={(e) => setEnrichJson(e.target.value)}
              />
            </div>
            <div className="aibom-header-actions">
              <button className="button primary" type="button" disabled={busy || !enrichAgentId} onClick={() => void saveEnrichment()}>
                Save enrichment
              </button>
              <button className="button ghost" type="button" onClick={() => setEnrichJson(ENRICH_TEMPLATE)}>
                Reset template
              </button>
            </div>
            {enrichMsg ? <p className="aibom-enrich-msg">{enrichMsg}</p> : null}
          </div>
        </section>
      ) : null}

      {tab === "snapshots" ? (
        <section className="panel aibom-panel">
          <div className="aibom-panel-head">
            <h2>Snapshots</h2>
            <button className="button" type="button" disabled={busy} onClick={() => void createSnapshot("cyclonedx")}>
              Snapshot CycloneDX
            </button>
          </div>
          <table className="data-table">
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
                    <td>
                      {String((snap.summary as { completenessPct?: number } | undefined)?.completenessPct ?? "—")}%
                    </td>
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
        title={selected?.name || "AI BOM"}
        subtitle="Composition summary"
        className="drawer-aibom"
        onClose={() => setSelected(null)}
      >
        {selected ? (
          <BomSystemDrawer system={selected} onEnrich={(id) => void loadEnrichment(id)} onClose={() => setSelected(null)} />
        ) : null}
      </DetailDrawer>
    </div>
  );
}
