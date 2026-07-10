import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DataTable, type Column } from "../components/DataTable";
import { DetailDrawer } from "../components/DetailDrawer";
import { FacetBar, type Facets } from "../components/FacetBar";
import {
  apiRequest,
  compactDate,
  downloadAgentExport,
  listFromPayload,
  numberAt,
  type Agent,
  valueAt
} from "../lib/api";

function uniqueOptions(rows: Agent[], key: keyof Facets): string[] {
  const values = new Set<string>();
  rows.forEach((row) => {
    const value = valueAt(row, [key], "");
    if (value) {
      values.add(value);
    }
  });
  return [...values].sort((left, right) => left.localeCompare(right));
}

export function InventoryPage({ title }: { title: string }) {
  const navigate = useNavigate();
  const [facets, setFacets] = useState<Facets>({});
  const [payload, setPayload] = useState<unknown>(null);
  const [selected, setSelected] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<"csv" | "json" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    apiRequest<unknown>("/api/agents", { query: { ...facets, limit: 100 } })
      .then((data) => mounted && setPayload(data))
      .catch((requestError) => mounted && setError(requestError instanceof Error ? requestError.message : "Failed to load agents."))
      .finally(() => mounted && setLoading(false));

    return () => {
      mounted = false;
    };
  }, [facets]);

  const agents = useMemo(() => listFromPayload<Agent>(payload, ["items", "agents"]), [payload]);

  const options = useMemo(
    () => ({
      owner: uniqueOptions(agents, "owner"),
      model: uniqueOptions(agents, "model"),
      framework: uniqueOptions(agents, "framework"),
      cloud: uniqueOptions(agents, "cloud"),
      category: uniqueOptions(agents, "category"),
      department: uniqueOptions(agents, "department")
    }),
    [agents]
  );

  const exportAgents = async (format: "csv" | "json") => {
    setExporting(format);
    setError(null);
    try {
      await downloadAgentExport(format, facets);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Export failed.");
    } finally {
      setExporting(null);
    }
  };

  const columns: Array<Column<Agent>> = [
    {
      key: "name",
      header: "Name",
      render: (agent) => <strong>{valueAt(agent, ["name", "displayName", "id"], "Unnamed agent")}</strong>,
      sortValue: (agent) => valueAt(agent, ["name", "displayName", "id"])
    },
    {
      key: "owner",
      header: "Owner",
      render: (agent) => valueAt(agent, ["owner", "team"]),
      sortValue: (agent) => valueAt(agent, ["owner", "team"])
    },
    {
      key: "model",
      header: "Model",
      render: (agent) => valueAt(agent, ["model", "primaryModel", "models"]),
      sortValue: (agent) => valueAt(agent, ["model", "primaryModel", "models"])
    },
    {
      key: "framework",
      header: "Framework",
      render: (agent) => valueAt(agent, ["framework", "runtimeFramework"]),
      sortValue: (agent) => valueAt(agent, ["framework", "runtimeFramework"])
    },
    {
      key: "cloud",
      header: "Cloud",
      render: (agent) => valueAt(agent, ["cloud", "provider", "environment"]),
      sortValue: (agent) => valueAt(agent, ["cloud", "provider", "environment"])
    },
    {
      key: "confidence",
      header: "Confidence",
      render: (agent) => `${Math.round(numberAt(agent, ["confidence", "confidence_score"], 0) * 100)}%`,
      sortValue: (agent) => numberAt(agent, ["confidence", "confidence_score"], 0)
    },
    {
      key: "lastSeen",
      header: "Last seen",
      render: (agent) => compactDate(agent.lastObservedAt ?? agent.last_seen),
      sortValue: (agent) => String(agent.lastObservedAt ?? agent.last_seen ?? "")
    }
  ];

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Inventory</p>
          <h1>{title}</h1>
          <p className="page-description">Facet and export canonical AI agent inventory from the live API.</p>
        </div>
        <div className="toolbar">
          <button className="button" disabled={Boolean(exporting)} type="button" onClick={() => exportAgents("csv")}>
            Export CSV
          </button>
          <button className="button" disabled={Boolean(exporting)} type="button" onClick={() => exportAgents("json")}>
            Export JSON
          </button>
        </div>
      </header>

      <FacetBar facets={facets} options={options} onChange={setFacets} />
      {error ? <div className="error-state">{error}</div> : null}

      <section className="panel">
        <div className="page-header">
          <h2>Agents</h2>
          <span className="status-pill">{agents.length} results</span>
        </div>
        <DataTable
          columns={columns}
          emptyMessage="No agents match the current filters. Clear facets or run discovery."
          loading={loading}
          rows={agents}
          onRowClick={setSelected}
        />
      </section>

      <DetailDrawer
        data={selected}
        open={Boolean(selected)}
        title={selected ? valueAt(selected, ["name", "displayName", "id"], "Agent") : "Agent"}
        subtitle={selected ? valueAt(selected, ["summary", "description", "category"], "Agent inventory detail") : undefined}
        onClose={() => setSelected(null)}
      >
        {selected?.id ? (
          <button className="button primary" type="button" onClick={() => navigate(`/agents/${String(selected.id)}`)}>
            Open agent detail
          </button>
        ) : null}
      </DetailDrawer>
    </div>
  );
}
