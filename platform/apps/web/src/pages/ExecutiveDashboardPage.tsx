import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { KpiCard } from "../components/KpiCard";
import { apiRequest, listFromPayload, numberAt, valueAt } from "../lib/api";

type DistRow = Record<string, unknown> & {
  name?: string;
  count?: number;
  inventoryQuery?: Record<string, string | undefined>;
};

function metric(payload: Record<string, unknown>, keys: string[], fallback = 0): number {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number") return value;
    if (value && typeof value === "object") {
      const nested = numberAt(value as Record<string, unknown>, ["value", "count", "total"], NaN);
      if (!Number.isNaN(nested)) return nested;
    }
  }
  return fallback;
}

function inventoryPath(query: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const qs = params.toString();
  return qs ? `/inventory?${qs}` : "/inventory";
}

function DonutChart({
  rows,
  title,
  onSelect
}: {
  rows: DistRow[];
  title: string;
  onSelect?: (row: DistRow) => void;
}) {
  const total = Math.max(
    1,
    rows.reduce((sum, row) => sum + numberAt(row, ["count", "value", "total"], 0), 0)
  );
  const size = 180;
  const stroke = 28;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const palette = [
    "var(--brand)",
    "var(--blue)",
    "color-mix(in srgb, var(--brand) 55%, #f4bd50)",
    "color-mix(in srgb, var(--blue) 60%, #7dd3c7)",
    "color-mix(in srgb, var(--brand) 40%, #c4b5fd)",
    "color-mix(in srgb, var(--blue) 35%, #fda4af)"
  ];

  if (!rows.length) {
    return <div className="empty-state">No {title.toLowerCase()} data yet.</div>;
  }

  return (
    <div className="donut-block">
      <div className="donut-visual">
        <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={title}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--bar-track)"
            strokeWidth={stroke}
          />
          {rows.map((row, index) => {
            const count = numberAt(row, ["count", "value", "total"], 0);
            const length = (count / total) * circumference;
            const dashoffset = circumference * 0.25 - offset;
            offset += length;
            return (
              <circle
                key={`${valueAt(row, ["name", "label"])}-${index}`}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={palette[index % palette.length]}
                strokeWidth={stroke}
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={dashoffset}
                className="donut-segment"
              >
                <title>{`${valueAt(row, ["name", "label"])}: ${count}`}</title>
              </circle>
            );
          })}
          <text x="50%" y="48%" textAnchor="middle" className="donut-total">
            {total}
          </text>
          <text x="50%" y="60%" textAnchor="middle" className="donut-total-label">
            agents
          </text>
        </svg>
      </div>
      <ul className="donut-legend">
        {rows.map((row, index) => {
          const count = numberAt(row, ["count", "value", "total"], 0);
          const name = valueAt(row, ["name", "label"]);
          const pct = Math.round((count / total) * 100);
          return (
            <li key={`${name}-${index}`}>
              <button
                type="button"
                className="donut-legend-item"
                onClick={() => onSelect?.(row)}
                disabled={!onSelect}
              >
                <span className="donut-swatch" style={{ background: palette[index % palette.length] }} />
                <span className="donut-legend-label">{name.replace(/_/g, " ")}</span>
                <span className="mono">
                  {count} · {pct}%
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function BarList({
  title,
  rows,
  onSelect
}: {
  title: string;
  rows: DistRow[];
  onSelect?: (row: DistRow) => void;
}) {
  const max = Math.max(1, ...rows.map((row) => numberAt(row, ["value", "count", "total"], 0)));

  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>{title}</h2>
        {onSelect ? <p className="muted">Click a bar to open Inventory.</p> : null}
      </div>
      <div className="chart-list">
        {rows.length ? (
          rows.map((row, index) => {
            const count = numberAt(row, ["value", "count", "total"], 0);
            const name = valueAt(row, ["label", "name", "model", "framework", "category"]);
            const inner = (
              <>
                <span className="bar-label">{name}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${Math.max(6, (count / max) * 100)}%` }} />
                </div>
                <span className="mono bar-count">{count}</span>
              </>
            );
            return onSelect ? (
              <button
                type="button"
                className="bar-row bar-row-button"
                key={`${title}-${index}`}
                onClick={() => onSelect(row)}
              >
                {inner}
              </button>
            ) : (
              <div className="bar-row" key={`${title}-${index}`}>
                {inner}
              </div>
            );
          })
        ) : (
          <div className="empty-state">No {title.toLowerCase()} data returned yet.</div>
        )}
      </div>
    </section>
  );
}

function TrendSparkline({ series }: { series: Array<{ week: string; count: number }> }) {
  if (!series.length) return <div className="empty-state">No discovery trend yet.</div>;
  const max = Math.max(1, ...series.map((p) => p.count));
  const width = 560;
  const height = 120;
  const pad = 16;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const step = series.length > 1 ? innerW / (series.length - 1) : 0;
  const points = series.map((p, i) => {
    const x = pad + i * step;
    const y = pad + innerH - (p.count / max) * innerH;
    return { x, y, ...p };
  });
  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");
  const area = `${pad},${pad + innerH} ${polyline} ${points[points.length - 1].x},${pad + innerH}`;

  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Discovery trend">
        <defs>
          <linearGradient id="execTrendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#execTrendFill)" />
        <polyline points={polyline} className="trend-line" fill="none" />
        {points.map((p) => (
          <circle key={p.week} cx={p.x} cy={p.y} r={3} className="trend-dot">
            <title>{`${p.week}: ${p.count}`}</title>
          </circle>
        ))}
      </svg>
      <div className="trend-labels">
        <span>{series[0]?.week}</span>
        <span>{series[series.length - 1]?.week}</span>
      </div>
    </div>
  );
}

export function ExecutiveDashboardPage() {
  const navigate = useNavigate();
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    apiRequest<Record<string, unknown>>("/api/dashboards/executive")
      .then((data) => mounted && setPayload(data))
      .catch((requestError) =>
        mounted && setError(requestError instanceof Error ? requestError.message : "Failed to load dashboard.")
      )
      .finally(() => mounted && setLoading(false));

    return () => {
      mounted = false;
    };
  }, []);

  const dashboard = (payload?.dashboard as Record<string, unknown> | undefined) ?? payload ?? {};

  const modelRows = useMemo(
    () => listFromPayload<DistRow>(dashboard, ["models", "modelUsage", "modelsInUse"]),
    [dashboard]
  );
  const categoryRows = useMemo(
    () => listFromPayload<DistRow>(dashboard, ["categories", "agentsByCategory", "categoryCoverage"]),
    [dashboard]
  );
  const evidence = (dashboard.evidence as Record<string, unknown> | undefined) || {};
  const evidenceRows = listFromPayload<DistRow>(evidence, ["byEvidenceClass"]);
  const statusRows = listFromPayload<DistRow>(evidence, ["byAgentStatus"]);
  const trends = (dashboard.trends as { series?: Array<{ week: string; count: number }> } | undefined) || {};
  const series = trends.series || [];
  const insight = valueAt(dashboard, ["insight"], "");

  const openDist = (row: DistRow, facet?: string) => {
    const fromApi = (row.inventoryQuery || {}) as Record<string, string | undefined>;
    if (Object.keys(fromApi).length) {
      navigate(inventoryPath(fromApi));
      return;
    }
    if (facet) navigate(inventoryPath({ [facet]: valueAt(row, ["name", "label"]) }));
  };

  if (loading) {
    return (
      <div className="page">
        <div className="loading-state">Loading executive visibility posture...</div>
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
          <p className="eyebrow">Executive</p>
          <h1>AI Agent Visibility Overview</h1>
          <p className="page-description">
            Leadership view of discovered agents, ownership, Shadow AI, and usage mix across the estate.
          </p>
        </div>
        <span className="status-pill">Updated {new Date().toLocaleTimeString()}</span>
      </header>

      {insight ? <p className="usage-insight">{insight}</p> : null}

      <section className="card-grid">
        <KpiCard label="Discovered" value={metric(dashboard, ["totalAgents", "agentsTotal", "total"])} trend="Inventory" />
        <KpiCard
          label="Confirmed"
          value={metric(dashboard, ["confirmedAgents"], 0)}
          trend="Strong evidence"
          tone="good"
        />
        <KpiCard
          label="Ownerless"
          value={metric(dashboard, ["ownerlessAgents", "ownerless"])}
          trend="Needs attribution"
          tone="warn"
        />
        <KpiCard
          label="Shadow AI"
          value={metric(dashboard, ["shadowAiAgents", "shadowAi"])}
          trend="Unmanaged / unsanctioned"
          tone="warn"
        />
        <KpiCard
          label="Managed"
          value={metric(dashboard, ["managedAgents"], 0)}
          trend="Owned & not shadow"
          tone="good"
        />
        <KpiCard
          label="Avg confidence"
          value={`${Math.round(metric(dashboard, ["avgConfidence"], 0) * 100)}%`}
          trend="Discovery confidence"
          tone="good"
        />
        <KpiCard
          label="Over-permissioned"
          value={metric(dashboard, ["overPermissionedAgents", "overPermissioned"], 0)}
          trend="Broad access scopes"
          tone="warn"
        />
        <KpiCard
          label="High-sensitivity access"
          value={metric(dashboard, ["highAccessSensitivity"], 0)}
          trend="Secrets / admin / identity"
          tone="warn"
        />
      </section>

      <p className="muted" style={{ marginBottom: 16 }}>
        Investigate Shadow AI in the <Link to="/shadow-ai">Shadow AI</Link> workbench, or open{" "}
        <Link to="/inventory">Inventory</Link> from any chart.
      </p>

      <section className="split-grid">
        <section className="panel">
          <h2>By evidence class</h2>
          <DonutChart rows={evidenceRows} title="Evidence" onSelect={(row) => openDist(row)} />
        </section>
        <section className="panel">
          <h2>By agent status</h2>
          <DonutChart rows={statusRows} title="Status" onSelect={(row) => openDist(row)} />
        </section>
      </section>

      <section className="split-grid">
        <BarList title="Models in use" rows={modelRows} onSelect={(row) => openDist(row, "model")} />
        <BarList title="Agents by category" rows={categoryRows} onSelect={(row) => openDist(row, "category")} />
      </section>

      <section className="panel">
        <h2>Discovery trend</h2>
        <TrendSparkline series={series} />
      </section>
    </div>
  );
}
