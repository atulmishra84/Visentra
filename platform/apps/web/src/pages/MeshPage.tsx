import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { KpiCard } from "../components/KpiCard";
import { apiRequest, numberAt, valueAt } from "../lib/api";

type MeshCell = {
  lane?: string;
  label?: string;
  count?: number;
  shadowCount?: number;
  piiCount?: number;
  phiCount?: number;
  href?: string;
};

type MeshRow = {
  plane?: string;
  label?: string;
  cells?: MeshCell[];
};

export function MeshPage() {
  const navigate = useNavigate();
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shadowOnly, setShadowOnly] = useState(false);

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

  const matrix = useMemo(() => (payload?.matrix as MeshRow[] | undefined) || [], [payload]);
  const lanes = useMemo(
    () => (payload?.lanes as Array<{ id?: string; label?: string }> | undefined) || [],
    [payload]
  );
  const totals = (payload?.totals as Record<string, unknown> | undefined) || {};
  const byPlane = (totals.byPlane as Record<string, number> | undefined) || {};

  if (loading) {
    return (
      <div className="page">
        <div className="loading-state">Loading global agent mesh...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <div className="error-state">{error}</div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Estate map</p>
          <h1>Global Agent Mesh</h1>
          <p className="page-description">
            Agents segregated by deployment plane and environment lane. Shadow is an overlay — toggle to focus
            unsanctioned agents.
          </p>
        </div>
        <div className="toolbar">
          <button
            className={`button ${shadowOnly ? "primary" : "ghost"}`}
            type="button"
            onClick={() => setShadowOnly((prev) => !prev)}
          >
            {shadowOnly ? "Shadow only · on" : "Shadow only"}
          </button>
          <Link className="button" to="/inventory">
            Open inventory
          </Link>
        </div>
      </header>

      <section className="card-grid">
        <KpiCard label="Agents in mesh" value={numberAt(totals, ["agents"], 0)} />
        <KpiCard label="Shadow overlay" value={numberAt(totals, ["shadow"], 0)} tone="warn" />
        <KpiCard label="Containerized" value={byPlane.containerized || 0} />
        <KpiCard label="Serverless" value={byPlane.serverless || 0} />
        <KpiCard label="SaaS & third-party" value={byPlane.saas_third_party || 0} />
        <KpiCard label="Endpoint" value={byPlane.endpoint || 0} />
      </section>

      <section className="panel mesh-panel">
        <div className="mesh-scroll">
          <table className="mesh-table">
            <thead>
              <tr>
                <th scope="col">Plane \\ Lane</th>
                {lanes.map((lane) => (
                  <th scope="col" key={String(lane.id || lane.label)}>
                    {valueAt(lane, ["label", "id"], "—")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={String(row.plane || row.label)}>
                  <th scope="row">{valueAt(row, ["label", "plane"], "—")}</th>
                  {(row.cells || []).map((cell) => {
                    const count = numberAt(cell, ["count"], 0);
                    const shadow = numberAt(cell, ["shadowCount"], 0);
                    const pii = numberAt(cell, ["piiCount"], 0);
                    const phi = numberAt(cell, ["phiCount"], 0);
                    const tone = count === 0 ? "empty" : phi > 0 ? "phi" : pii > 0 ? "pii" : shadow > 0 ? "shadow" : "ok";
                    return (
                      <td key={`${row.plane}-${cell.lane}`}>
                        <button
                          type="button"
                          className={`mesh-cell ${tone}`}
                          disabled={count === 0}
                          onClick={() => {
                            const href = valueAt(cell, ["href"]);
                            if (href) navigate(href);
                          }}
                        >
                          <strong>{count}</strong>
                          <span>
                            {shadow ? `${shadow} shadow` : "—"}
                            {phi ? ` · ${phi} PHI` : pii ? ` · ${pii} PII` : ""}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ marginTop: 14 }}>
          Click a cell to open Inventory filtered by plane and environment. Shadow overlay does not create a fifth
          plane.
        </p>
      </section>
    </div>
  );
}
