import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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

function uniqueOptions(rows: Agent[], key: string): string[] {
  const values = new Set<string>();
  rows.forEach((row) => {
    const value =
      key === "cloud"
        ? valueAt(row, ["cloud_provider", "cloud", "provider"], "")
        : valueAt(row, [key], "");
    if (value) values.add(value);
  });
  return [...values].sort((left, right) => left.localeCompare(right));
}

function categoryBadge(category: string) {
  const c = category.toLowerCase();
  if (c === "cloud") return "cloud";
  if (c === "endpoint" || c === "edr") return "endpoint";
  if (["ide", "local", "local_llm", "framework", "mcp", "browser", "autonomous", "saas", "container"].includes(c)) {
    return "agent";
  }
  return c || "unknown";
}

export function InventoryPage({ title }: { title: string }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [facets, setFacets] = useState<Facets>({});
  const [payload, setPayload] = useState<unknown>(null);
  const [selected, setSelected] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<"csv" | "json" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shadowOnly = searchParams.get("shadow") === "true";

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    apiRequest<unknown>("/api/agents", {
      query: { ...facets, limit: 500, shadow: shadowOnly ? "true" : undefined }
    })
      .then((data) => mounted && setPayload(data))
      .catch(
        (requestError) =>
          mounted && setError(requestError instanceof Error ? requestError.message : "Failed to load inventory.")
      )
      .finally(() => mounted && setLoading(false));

    return () => {
      mounted = false;
    };
  }, [facets, shadowOnly]);

  const agents = useMemo(() => listFromPayload<Agent>(payload, ["items", "agents"]), [payload]);

  const counts = useMemo(() => {
    const out = { all: agents.length, cloud: 0, endpoint: 0, agent: 0, other: 0 };
    for (const row of agents) {
      const kind = categoryBadge(valueAt(row, ["category"], ""));
      if (kind === "cloud") out.cloud += 1;
      else if (kind === "endpoint") out.endpoint += 1;
      else if (kind === "agent") out.agent += 1;
      else out.other += 1;
    }
    return out;
  }, [agents]);

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

  const setCategoryQuick = (category?: string) => {
    setFacets((prev) => ({ ...prev, category: category || undefined }));
  };

  const columns: Array<Column<Agent>> = [
    {
      key: "name",
      header: "Name",
      render: (agent) => <strong>{valueAt(agent, ["name", "displayName", "id"], "Unnamed asset")}</strong>,
      sortValue: (agent) => valueAt(agent, ["name", "displayName", "id"])
    },
    {
      key: "category",
      header: "Category",
      render: (agent) => {
        const category = valueAt(agent, ["category"], "unknown");
        return <span className="badge">{category}</span>;
      },
      sortValue: (agent) => valueAt(agent, ["category"])
    },
    {
      key: "owner",
      header: "Owner",
      render: (agent) => valueAt(agent, ["owner", "team"]),
      sortValue: (agent) => valueAt(agent, ["owner", "team"])
    },
    {
      key: "framework",
      header: "Type / framework",
      render: (agent) => valueAt(agent, ["framework", "runtimeFramework", "device", "hostname"]),
      sortValue: (agent) => valueAt(agent, ["framework", "runtimeFramework", "device", "hostname"])
    },
    {
      key: "model",
      header: "Model / signal",
      render: (agent) => valueAt(agent, ["model", "primaryModel", "models"]),
      sortValue: (agent) => valueAt(agent, ["model", "primaryModel", "models"])
    },
    {
      key: "cloud",
      header: "Provider",
      render: (agent) =>
        valueAt(agent, ["cloud_provider", "provider", "cloud", "environment"]),
      sortValue: (agent) => valueAt(agent, ["cloud_provider", "provider", "cloud", "environment"])
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
          <p className="page-description">
            {shadowOnly
              ? "Filtered to Shadow AI candidates (ownerless / unmanaged / unsanctioned AI signals)."
              : "Unified inventory from discovery: AI agents, cloud resources, and EDR endpoints. Filter by category to focus."}
          </p>
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

      <div className="toolbar" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button className={`button ${!facets.category ? "primary" : "ghost"}`} type="button" onClick={() => setCategoryQuick()}>
          All
        </button>
        <button
          className={`button ${facets.category === "cloud" ? "primary" : "ghost"}`}
          type="button"
          onClick={() => setCategoryQuick("cloud")}
        >
          Cloud
        </button>
        <button
          className={`button ${facets.category === "endpoint" ? "primary" : "ghost"}`}
          type="button"
          onClick={() => setCategoryQuick("endpoint")}
        >
          Endpoints
        </button>
        <span className="muted" style={{ alignSelf: "center", fontSize: 13 }}>
          In this view: {counts.cloud} cloud · {counts.endpoint} endpoints · {counts.agent + counts.other} agents/other
        </span>
      </div>

      <FacetBar facets={facets} options={options} onChange={setFacets} />
      {error ? <div className="error-state">{error}</div> : null}

      <section className="panel">
        <div className="page-header">
          <h2>Discovered assets</h2>
          <span className="status-pill">{agents.length} results</span>
        </div>
        <DataTable
          columns={columns}
          emptyMessage="No assets match the current filters. Clear facets or run discovery (cloud / EDR)."
          loading={loading}
          rows={agents}
          onRowClick={setSelected}
        />
      </section>

      <DetailDrawer
        data={selected}
        open={Boolean(selected)}
        title={selected ? valueAt(selected, ["name", "displayName", "id"], "Asset") : "Asset"}
        subtitle={
          selected
            ? valueAt(selected, ["category", "summary", "description"], "Inventory detail")
            : undefined
        }
        onClose={() => setSelected(null)}
      >
        {selected?.id ? (
          <button className="button primary" type="button" onClick={() => navigate(`/agents/${String(selected.id)}`)}>
            Open detail
          </button>
        ) : null}
      </DetailDrawer>
    </div>
  );
}
