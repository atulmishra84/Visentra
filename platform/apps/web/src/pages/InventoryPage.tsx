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
import { AGENT_PLANES, ENVIRONMENT_LANES, meshBadgeLabel } from "../lib/mesh";

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

function metaAt(agent: Agent, key: string, fallback = ""): string {
  const meta = (agent.metadata || {}) as Record<string, unknown>;
  const value = meta[key];
  return value == null ? fallback : String(value);
}

function uniqueMetaOptions(rows: Agent[], key: string): string[] {
  const values = new Set<string>();
  rows.forEach((row) => {
    const value = metaAt(row, key);
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

function facetsFromSearchParams(params: URLSearchParams): Facets {
  const keys: Array<keyof Facets> = [
    "q",
    "owner",
    "model",
    "framework",
    "cloud",
    "ide",
    "category",
    "department",
    "evidenceClass",
    "agentStatus",
    "access",
    "accessSensitivity",
    "overPermissioned",
    "hasInstructions",
    "dataClass",
    "primaryDataClass",
    "agentPlane",
    "environmentLane",
    "assistedBy",
    "endpointPresence",
    "projectKind"
  ];
  const next: Facets = {};
  for (const key of keys) {
    const value = params.get(key);
    if (value) next[key] = value;
  }
  return next;
}

export function InventoryPage({ title }: { title: string }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [facets, setFacets] = useState<Facets>(() => facetsFromSearchParams(searchParams));
  const [payload, setPayload] = useState<unknown>(null);
  const [selected, setSelected] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<"csv" | "json" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shadowOnly = searchParams.get("shadow") === "true";

  useEffect(() => {
    const fromUrl = facetsFromSearchParams(searchParams);
    setFacets((prev) => {
      const keys = new Set([...Object.keys(prev), ...Object.keys(fromUrl)] as Array<keyof Facets>);
      for (const key of keys) {
        if ((prev[key] || "") !== (fromUrl[key] || "")) return fromUrl;
      }
      return prev;
    });
  }, [searchParams]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (shadowOnly) next.set("shadow", "true");
    (Object.entries(facets) as Array<[keyof Facets, string | undefined]>).forEach(([key, value]) => {
      if (value) next.set(key, value);
    });
    const current = searchParams.toString();
    const upcoming = next.toString();
    if (current !== upcoming) {
      setSearchParams(next, { replace: true });
    }
    // Only push facet changes into the URL; shadow is read from searchParams.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: avoid loops on searchParams identity
  }, [facets, shadowOnly, setSearchParams]);

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
      ide: uniqueOptions(agents, "ide"),
      category: uniqueOptions(agents, "category"),
      department: uniqueOptions(agents, "department"),
      evidenceClass: uniqueMetaOptions(agents, "evidenceClass"),
      agentStatus: uniqueMetaOptions(agents, "agentStatus"),
      accessSensitivity: uniqueMetaOptions(agents, "accessSensitivity"),
      agentPlane: [...AGENT_PLANES, ...uniqueMetaOptions(agents, "agentPlane")].filter(
        (v, i, arr) => arr.indexOf(v) === i
      ),
      environmentLane: [...ENVIRONMENT_LANES, ...uniqueMetaOptions(agents, "environmentLane")].filter(
        (v, i, arr) => arr.indexOf(v) === i
      ),
      assistedBy: (() => {
        const values = new Set<string>();
        agents.forEach((row) => {
          const meta = (row.metadata || {}) as Record<string, unknown>;
          const assisted = Array.isArray(meta.assistedBy) ? meta.assistedBy : [];
          assisted.forEach((v) => {
            if (v) values.add(String(v));
          });
        });
        return [...values].sort((a, b) => a.localeCompare(b));
      })(),
      endpointPresence: (() => {
        const values = new Set<string>();
        agents.forEach((row) => {
          const meta = (row.metadata || {}) as Record<string, unknown>;
          const presence = Array.isArray(meta.endpointPresence) ? meta.endpointPresence : [];
          presence.forEach((v) => {
            if (v) values.add(String(v));
          });
        });
        return [...values].sort((a, b) => a.localeCompare(b));
      })(),
      projectKind: uniqueMetaOptions(agents, "projectKind"),
      dataClass: (() => {
        const values = new Set<string>(["pii", "phi", "secrets", "financial", "none"]);
        agents.forEach((row) => {
          const primary = metaAt(row, "primaryDataClass");
          if (primary) values.add(primary);
          const meta = (row.metadata || {}) as Record<string, unknown>;
          const classes = Array.isArray(meta.dataClasses) ? meta.dataClasses : [];
          classes.forEach((c) => {
            if (c) values.add(String(c));
          });
        });
        return [...values].sort((left, right) => left.localeCompare(right));
      })(),
      access: (() => {
        const values = new Set<string>();
        agents.forEach((row) => {
          const meta = (row.metadata || {}) as Record<string, unknown>;
          const access = (meta.agentAccess as Record<string, unknown> | undefined) || {};
          const granted = Array.isArray(access.granted) ? access.granted : [];
          granted.forEach((scope) => {
            if (scope) values.add(String(scope));
          });
        });
        return [...values].sort((left, right) => left.localeCompare(right));
      })()
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
    setFacets((prev) => ({ ...prev, category: category || undefined, agentStatus: undefined }));
  };

  const setStatusQuick = (agentStatus?: string) => {
    setFacets((prev) => ({ ...prev, agentStatus: agentStatus || undefined }));
  };

  const columns: Array<Column<Agent>> = [
    {
      key: "name",
      header: "Name",
      render: (agent) => <strong>{valueAt(agent, ["name", "displayName", "id"], "Unnamed asset")}</strong>,
      sortValue: (agent) => valueAt(agent, ["name", "displayName", "id"])
    },
    {
      key: "evidence",
      header: "Evidence",
      render: (agent) => {
        const evidence = metaAt(agent, "evidenceClass", "—");
        return <span className="badge">{evidence.replace(/_/g, " ")}</span>;
      },
      sortValue: (agent) => metaAt(agent, "evidenceClass")
    },
    {
      key: "status",
      header: "Status",
      render: (agent) => {
        const status = metaAt(agent, "agentStatus", "—");
        return <span className={`status-pill ${status === "confirmed" ? "ok" : ""}`}>{status}</span>;
      },
      sortValue: (agent) => metaAt(agent, "agentStatus")
    },
    {
      key: "access",
      header: "Access",
      render: (agent) => {
        const sensitivity = metaAt(agent, "accessSensitivity", "—");
        const grants = metaAt(agent, "accessGrantCount", "0");
        const over = metaAt(agent, "overPermissioned") === "true";
        return (
          <span className={`badge ${over ? "bad" : ""}`}>
            {sensitivity}
            {grants !== "0" && grants !== "" ? ` · ${grants}` : ""}
            {over ? " · over" : ""}
          </span>
        );
      },
      sortValue: (agent) => metaAt(agent, "accessSensitivity")
    },
    {
      key: "dataClass",
      header: "Data class",
      render: (agent) => {
        const primary = metaAt(agent, "primaryDataClass", "none");
        const conf = metaAt(agent, "dataAccessConfidence", "");
        const tone = primary === "phi" || primary === "pii" ? "bad" : "";
        return (
          <span className={`badge ${tone}`}>
            {primary.toUpperCase()}
            {conf ? ` · ${conf}` : ""}
          </span>
        );
      },
      sortValue: (agent) => metaAt(agent, "primaryDataClass")
    },
    {
      key: "mesh",
      header: "Mesh",
      render: (agent) => {
        const plane = metaAt(agent, "agentPlane", "—");
        const lane = metaAt(agent, "environmentLane", "—");
        return (
          <span className="badge">
            {meshBadgeLabel(plane)} · {meshBadgeLabel(lane)}
          </span>
        );
      },
      sortValue: (agent) => `${metaAt(agent, "agentPlane")}:${metaAt(agent, "environmentLane")}`
    },
    {
      key: "how",
      header: "How identified",
      render: (agent) => metaAt(agent, "howIdentified", "—"),
      sortValue: (agent) => metaAt(agent, "howIdentified")
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
              : "AI agent inventory classified by evidence (platform, cloud runtime, IDE, process, repo) and confirmed vs candidate status."}
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
        <button className={`button ${!facets.category && !facets.agentStatus ? "primary" : "ghost"}`} type="button" onClick={() => setFacets({})}>
          All
        </button>
        <button
          className={`button ${facets.agentStatus === "confirmed" ? "primary" : "ghost"}`}
          type="button"
          onClick={() => setStatusQuick("confirmed")}
        >
          Confirmed
        </button>
        <button
          className={`button ${facets.agentStatus === "candidate" ? "primary" : "ghost"}`}
          type="button"
          onClick={() => setStatusQuick("candidate")}
        >
          Candidates
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
