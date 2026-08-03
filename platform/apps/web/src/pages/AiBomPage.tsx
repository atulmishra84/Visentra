import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DataTable, type Column } from "../components/DataTable";
import { KpiCard } from "../components/KpiCard";
import { apiRequest, getAuthToken, buildApiUrl } from "../lib/api";

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
  properties?: Record<string, unknown>;
  coverage?: Record<string, string>;
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
    componentTotal: number;
    ownershipCoveragePct: number;
    modelNamedPct: number;
    shadowCandidates: number;
    gaps: string[];
  };
  components: BomComponent[];
  dependencies: Array<{ from: string; to: string; relType: string }>;
};

const CATEGORY_LABELS: Record<string, string> = {
  systems: "AI systems",
  models: "Models",
  data: "Data",
  software_infra: "Software & infra",
  tools_integrations: "Tools & integrations",
  identity_access: "Identity & access",
  governance: "Governance"
};

const CATEGORY_ORDER = [
  "systems",
  "models",
  "data",
  "software_infra",
  "tools_integrations",
  "identity_access",
  "governance"
] as const;

async function downloadBom(format: "json" | "cyclonedx") {
  const token = getAuthToken();
  const response = await fetch(buildApiUrl("/api/ai-bom/export", { format }), {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Export failed (${response.status})`);
  }
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
  const [data, setData] = useState<AiBomResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("systems");
  const [exportBusy, setExportBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    apiRequest<AiBomResponse>("/api/ai-bom")
      .then((payload) => {
        if (mounted) setData(payload);
      })
      .catch((err) => {
        if (mounted) setError(err instanceof Error ? err.message : "Failed to load AI BOM");
      });
    return () => {
      mounted = false;
    };
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.components.filter((c) => c.category === category);
  }, [data, category]);

  const columns: Column<BomComponent>[] = useMemo(
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
        render: (row) => (row.usedBy || []).slice(0, 3).join(", ") || "—",
        sortValue: (row) => (row.usedBy || []).join(",")
      },
      {
        key: "agentIds",
        header: "Open",
        render: (row) => {
          const id = row.agentIds?.[0] || (row.category === "systems" ? row.bomRef.replace(/^agent:/, "") : null);
          if (!id || row.category !== "systems") return <span className="muted">—</span>;
          return (
            <Link className="button ghost" to={`/agents/${id}`} style={{ minHeight: 28, padding: "2px 8px" }}>
              Agent
            </Link>
          );
        }
      }
    ],
    []
  );

  const onExport = async (format: "json" | "cyclonedx") => {
    setExportBusy(true);
    setError(null);
    try {
      await downloadBom(format);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExportBusy(false);
    }
  };

  if (error && !data) return <div className="error-state">{error}</div>;
  if (!data) return <div className="loading-state">Building AI BOM composition…</div>;

  const s = data.summary;

  const categoryCount = (key: (typeof CATEGORY_ORDER)[number]): number => {
    switch (key) {
      case "systems":
        return s.systems;
      case "models":
        return s.models;
      case "data":
        return s.data;
      case "software_infra":
        return s.software_infra;
      case "tools_integrations":
        return s.tools_integrations;
      case "identity_access":
        return s.identity_access;
      case "governance":
        return s.governance;
      default:
        return 0;
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">AI BOM</p>
          <h1>Bill of Materials</h1>
          <p className="page-description">
            Composition of discovered AI systems — models, tools, MCP, infra, identity, and governance signals.
            Separate from Inventory: this module is the structured BOM layer for provenance and risk response.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="button" type="button" disabled={exportBusy} onClick={() => void onExport("json")}>
            {exportBusy ? "Exporting…" : "Export JSON"}
          </button>
          <button className="button primary" type="button" disabled={exportBusy} onClick={() => void onExport("cyclonedx")}>
            Export CycloneDX-lite
          </button>
        </div>
      </header>

      {error ? <div className="error-state" style={{ marginBottom: 16 }}>{error}</div> : null}

      <div className="kpi-grid">
        <KpiCard label="AI systems" value={String(s.systems)} />
        <KpiCard label="Models" value={String(s.models)} />
        <KpiCard label="Tools & MCP" value={String(s.tools_integrations)} />
        <KpiCard label="Components" value={String(s.componentTotal)} />
        <KpiCard label="Ownership coverage" value={`${s.ownershipCoveragePct}%`} />
        <KpiCard label="Shadow candidates" value={String(s.shadowCandidates)} />
      </div>

      <section className="panel" style={{ marginTop: 20 }}>
        <div className="panel-header" style={{ marginBottom: 12 }}>
          <h2>Composition categories</h2>
          <span className="muted" style={{ fontSize: "0.82rem" }}>
            Generated {new Date(data.metadata.generatedAt).toLocaleString()} · {data.specVersion}
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {CATEGORY_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              className={`button ${category === key ? "primary" : "ghost"}`}
              onClick={() => setCategory(key)}
            >
              {CATEGORY_LABELS[key]} ({categoryCount(key)})
            </button>
          ))}
        </div>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-header">
          <h2>{CATEGORY_LABELS[category] || category}</h2>
          <span className="status-pill">{rows.length} components</span>
        </div>
        <DataTable
          rows={rows}
          columns={columns}
          emptyMessage="No components in this category yet. Connect sources and run discovery."
        />
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Known gaps (V1)</h2>
        <p className="muted" style={{ marginTop: 8 }}>
          Visentra marks unobserved ML-BOM fields explicitly instead of inventing them.
        </p>
        <ul style={{ margin: "12px 0 0", paddingLeft: 18, color: "var(--text-muted)", lineHeight: 1.55 }}>
          {s.gaps.map((gap) => (
            <li key={gap}>{gap}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
