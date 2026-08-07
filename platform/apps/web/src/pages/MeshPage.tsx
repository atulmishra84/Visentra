import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { apiRequest, numberAt, valueAt } from "../lib/api";

type MeshNode = {
  id?: string;
  name?: string;
  category?: string;
  status?: "active" | "flagged" | "inactive" | "shadow" | string;
  kind?: "agent" | "device" | string;
  href?: string;
  relationshipsHref?: string;
};

type MeshCluster = {
  lane?: string;
  label?: string;
  count?: number;
  flaggedCount?: number;
  shadowCount?: number;
  deviceCount?: number;
  categories?: Array<{ name?: string; count?: number }>;
  nodes?: MeshNode[];
  href?: string;
};

/** Deterministic pseudo-random in [0,1) from a string. */
function hashUnit(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function nodePosition(node: MeshNode, index: number, total: number, lane?: string) {
  const id = String(node.id || node.name || index);
  const ring = 0.28 + hashUnit(`${id}:r`) * 0.55;
  const base = (index / Math.max(total, 1)) * Math.PI * 2;
  const jitter = (hashUnit(`${id}:a`) - 0.5) * 0.55;
  // Endpoints: cleaner oval ring
  const angle = lane === "endpoints" ? (index / Math.max(total, 1)) * Math.PI * 2 : base + jitter;
  const rx = lane === "endpoints" ? 0.62 : ring;
  const ry = lane === "endpoints" ? 0.42 : ring * (0.75 + hashUnit(`${id}:y`) * 0.35);
  return {
    left: `${50 + Math.cos(angle) * rx * 42}%`,
    top: `${50 + Math.sin(angle) * ry * 42}%`
  };
}

function categoryPosition(name: string, index: number, total: number) {
  const angle = -Math.PI / 2 + (index / Math.max(total, 1)) * Math.PI * 2;
  const radius = 34;
  return {
    left: `${50 + Math.cos(angle) * radius}%`,
    top: `${50 + Math.sin(angle) * radius}%`
  };
}

function MeshGlyph({ status, kind }: { status?: string; kind?: string }) {
  if (kind === "device") {
    return <span className="gm-glyph device" aria-hidden />;
  }
  return <span className={`gm-glyph ${status || "active"}`} aria-hidden />;
}

export function MeshPage() {
  const navigate = useNavigate();
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shadowOnly, setShadowOnly] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    apiRequest<Record<string, unknown>>("/api/mesh", {
      query: { shadow: shadowOnly ? "true" : undefined }
    })
      .then((data) => mounted && setPayload(data))
      .catch((requestError) =>
        mounted && setError(requestError instanceof Error ? requestError.message : "Failed to load agent mesh.")
      )
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [shadowOnly]);

  const clusters = useMemo(() => {
    const fromApi = (payload?.clusters as MeshCluster[] | undefined) || [];
    if (fromApi.length) return fromApi;
    return [];
  }, [payload]);

  const totals = (payload?.totals as Record<string, unknown> | undefined) || {};

  if (loading) {
    return (
      <div className="page gm-page">
        <div className="loading-state">Loading global mesh...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page gm-page">
        <div className="error-state">{error}</div>
      </div>
    );
  }

  return (
    <div className="page gm-page">
      <header className="gm-header">
        <div>
          <h1 className="gm-title">Global Mesh</h1>
          <p className="gm-subtitle">
            {numberAt(totals, ["agents"], 0)} agents across environments
            {numberAt(totals, ["flagged"], 0) ? ` · ${numberAt(totals, ["flagged"], 0)} flagged` : ""}
            {numberAt(totals, ["shadow"], 0) ? ` · ${numberAt(totals, ["shadow"], 0)} shadow` : ""}
          </p>
        </div>
        <div className="gm-legend" aria-label="Mesh legend">
          <span>
            <i className="gm-glyph active" /> Active
          </span>
          <span>
            <i className="gm-glyph flagged" /> Flagged
          </span>
          <span>
            <i className="gm-glyph inactive" /> Inactive
          </span>
          <span>
            <i className="gm-glyph shadow" /> Shadow
          </span>
          <span>
            <i className="gm-glyph device" /> Device
          </span>
        </div>
        <div className="toolbar">
          <button
            className={`button ${shadowOnly ? "primary" : "ghost"}`}
            type="button"
            onClick={() => setShadowOnly((prev) => !prev)}
          >
            {shadowOnly ? "Shadow only · on" : "Shadow only"}
          </button>
          <Link className="button ghost" to="/inventory">
            Inventory
          </Link>
        </div>
      </header>

      <div className="gm-canvas" role="img" aria-label="Global agent mesh constellation">
        <div className="gm-dotgrid" />
        {clusters.map((cluster) => {
          const nodes = cluster.nodes || [];
          const categories = cluster.categories || [];
          const flagged = numberAt(cluster, ["flaggedCount"], 0);
          const shadow = numberAt(cluster, ["shadowCount"], 0);
          const count = numberAt(cluster, ["count"], nodes.length);
          const isEndpoints = cluster.lane === "endpoints";

          return (
            <section
              key={String(cluster.lane || cluster.label)}
              className={`gm-cluster lane-${cluster.lane || "unknown"}`}
              onClick={() => {
                if (cluster.href) navigate(cluster.href);
              }}
            >
              <div className="gm-cluster-core">
                <h2>{valueAt(cluster, ["label"], "Environment")}</h2>
                <p>
                  {isEndpoints ? (
                    <>
                      <strong>{numberAt(cluster, ["deviceCount"], count)}</strong> Devices
                    </>
                  ) : (
                    <>
                      <strong>{count}</strong> Agents
                      {flagged ? (
                        <>
                          , <em>{flagged} Flagged</em>
                        </>
                      ) : null}
                      {shadow && cluster.lane === "saas" ? (
                        <>
                          , <span className="gm-shadow-count">{shadow} Shadow</span>
                        </>
                      ) : null}
                    </>
                  )}
                </p>
              </div>

              {categories.map((cat, index) => (
                <div
                  key={`${cluster.lane}-${cat.name}`}
                  className="gm-category"
                  style={categoryPosition(String(cat.name), index, categories.length)}
                >
                  {valueAt(cat, ["name"], "General")}
                </div>
              ))}

              {nodes.map((node, index) => {
                const pos = nodePosition(node, index, nodes.length, cluster.lane);
                const tipId = String(node.id || `${cluster.lane}-${index}`);
                return (
                  <button
                    key={tipId}
                    type="button"
                    className={`gm-node ${node.kind || "agent"} status-${node.status || "active"} ${
                      hovered === tipId ? "is-hot" : ""
                    }`}
                    style={pos}
                    title={valueAt(node, ["name"], "Agent")}
                    onMouseEnter={() => setHovered(tipId)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={(event) => {
                      event.stopPropagation();
                      navigate(valueAt(node, ["relationshipsHref", "href"], "/relationships"));
                    }}
                  >
                    <MeshGlyph status={node.status} kind={node.kind} />
                    {hovered === tipId ? (
                      <span className="gm-tooltip">{valueAt(node, ["name"], "Agent")}</span>
                    ) : null}
                  </button>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
