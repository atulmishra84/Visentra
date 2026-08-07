import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { KpiCard } from "../components/KpiCard";
import {
  apiRequest,
  downloadUsageExport,
  listFromPayload,
  numberAt,
  valueAt
} from "../lib/api";

type UsageDashboardPageProps = {
  kind: "models" | "frameworks" | "cloud" | "ide";
  title: string;
};

type UsageRow = Record<string, unknown> & {
  name?: string;
  count?: number;
  inventoryQuery?: Record<string, string | undefined>;
};

const USAGE_TABS: Array<{ kind: UsageDashboardPageProps["kind"]; label: string; to: string }> = [
  { kind: "models", label: "Models", to: "/usage/models" },
  { kind: "frameworks", label: "Frameworks", to: "/usage/frameworks" },
  { kind: "cloud", label: "Cloud", to: "/usage/cloud" },
  { kind: "ide", label: "IDE", to: "/usage/ide" }
];

const KIND_FACET: Record<UsageDashboardPageProps["kind"], string> = {
  models: "model",
  frameworks: "framework",
  cloud: "cloud",
  ide: "ide"
};

function inventoryPath(query: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const qs = params.toString();
  return qs ? `/inventory?${qs}` : "/inventory";
}

function UsageBarChart({
  rows,
  onSelect
}: {
  rows: UsageRow[];
  onSelect: (row: UsageRow) => void;
}) {
  const max = Math.max(1, ...rows.map((row) => numberAt(row, ["count", "agents", "value", "total"], 0)));

  if (!rows.length) {
    return <div className="empty-state">No labeled values for this view. Try showing unknowns or clearing Confirmed only.</div>;
  }

  return (
    <div className="chart-list usage-bars" role="list">
      {rows.map((row, index) => {
        const count = numberAt(row, ["count", "agents", "value", "total"], 0);
        const name = valueAt(row, ["name", "label", "model", "framework", "provider", "ide"]);
        const width = Math.max(4, (count / max) * 100);
        return (
          <button
            type="button"
            className="bar-row bar-row-button"
            key={`${name}-${index}`}
            onClick={() => onSelect(row)}
            title={`Open inventory filtered to ${name}`}
          >
            <span className="bar-label">{name}</span>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${width}%` }} />
            </div>
            <span className="mono bar-count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

function TrendChart({ series }: { series: Array<{ week: string; count: number }> }) {
  if (!series.length) {
    return <div className="empty-state">No discovery trend data in this window.</div>;
  }

  const max = Math.max(1, ...series.map((p) => p.count));
  const width = 640;
  const height = 160;
  const padX = 28;
  const padY = 20;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const step = series.length > 1 ? innerW / (series.length - 1) : 0;

  const points = series.map((p, i) => {
    const x = padX + i * step;
    const y = padY + innerH - (p.count / max) * innerH;
    return { x, y, ...p };
  });

  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");
  const area = `${padX},${padY + innerH} ${polyline} ${points[points.length - 1].x},${padY + innerH}`;

  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Agents discovered per week">
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line x1={padX} y1={padY + innerH} x2={padX + innerW} y2={padY + innerH} className="trend-axis" />
        <polygon points={area} fill="url(#trendFill)" />
        <polyline points={polyline} className="trend-line" fill="none" />
        {points.map((p) => (
          <g key={p.week}>
            <circle cx={p.x} cy={p.y} r={3.5} className="trend-dot" />
            <title>{`${p.week}: ${p.count}`}</title>
          </g>
        ))}
      </svg>
      <div className="trend-labels">
        <span>{series[0]?.week}</span>
        <span>{series[series.length - 1]?.week}</span>
      </div>
    </div>
  );
}

function MiniBars({
  rows,
  onSelect
}: {
  rows: UsageRow[];
  onSelect: (row: UsageRow) => void;
}) {
  const max = Math.max(1, ...rows.map((r) => numberAt(r, ["count"], 0)));
  if (!rows.length) return <div className="empty-state">No data.</div>;
  return (
    <div className="mini-bars">
      {rows.map((row) => {
        const count = numberAt(row, ["count"], 0);
        const name = valueAt(row, ["name"]);
        return (
          <button
            key={name}
            type="button"
            className="mini-bar-row"
            onClick={() => onSelect(row)}
            title={`Filter inventory: ${name}`}
          >
            <span>{name.replace(/_/g, " ")}</span>
            <div className="bar-track">
              <div className="bar-fill accent" style={{ width: `${Math.max(4, (count / max) * 100)}%` }} />
            </div>
            <span className="mono">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

export function UsageDashboardPage({ kind, title }: UsageDashboardPageProps) {
  const navigate = useNavigate();
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hideUnknown, setHideUnknown] = useState(true);
  const [confirmedOnly, setConfirmedOnly] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    apiRequest<Record<string, unknown>>(`/api/dashboards/${kind}`, {
      query: {
        hideUnknown: hideUnknown ? "true" : "false",
        confirmedOnly: confirmedOnly ? "true" : "false",
        weeks: 12
      }
    })
      .then((data) => mounted && setPayload(data))
      .catch((requestError) =>
        mounted && setError(requestError instanceof Error ? requestError.message : `Failed to load ${title}.`)
      )
      .finally(() => mounted && setLoading(false));

    return () => {
      mounted = false;
    };
  }, [kind, title, hideUnknown, confirmedOnly]);

  const dashboard = (payload?.dashboard as Record<string, unknown> | undefined) ?? payload ?? {};
  const rows = useMemo(
    () => listFromPayload<UsageRow>(dashboard, ["items", "rows", "usage", kind]),
    [dashboard, kind]
  );

  const evidence = (dashboard.evidence as Record<string, unknown> | undefined) || {};
  const evidenceClassRows = listFromPayload<UsageRow>(evidence, ["byEvidenceClass"]);
  const statusRows = listFromPayload<UsageRow>(evidence, ["byAgentStatus"]);
  const trends = (dashboard.trends as { series?: Array<{ week: string; count: number }> } | undefined) || {};
  const series = trends.series || [];
  const providerUsage = (dashboard.providerUsage as { providers?: Record<string, unknown>[] } | undefined) || {};
  const providers = providerUsage.providers || [];

  const total = numberAt(dashboard, ["totalAgents"], rows.reduce((sum, row) => sum + numberAt(row, ["count"], 0), 0));
  const labeled = numberAt(dashboard, ["labeledAgents"], rows.reduce((sum, row) => sum + numberAt(row, ["count"], 0), 0));
  const unknownCount = numberAt(dashboard, ["unknownCount"], 0);
  const insight = valueAt(dashboard, ["insight"], "");
  const topName = rows[0] ? valueAt(rows[0], ["name", "label"]) : "None";

  const openRow = (row: UsageRow) => {
    const fromApi = (row.inventoryQuery || {}) as Record<string, string | undefined>;
    const facet = KIND_FACET[kind];
    const name = valueAt(row, ["name"]);
    const query = Object.keys(fromApi).length
      ? fromApi
      : { [facet]: name, ...(confirmedOnly ? { agentStatus: "confirmed" } : {}) };
    if (confirmedOnly && !query.agentStatus) query.agentStatus = "confirmed";
    navigate(inventoryPath(query));
  };

  const openEvidence = (row: UsageRow) => {
    const fromApi = (row.inventoryQuery || {}) as Record<string, string | undefined>;
    navigate(inventoryPath(fromApi));
  };

  const onExport = async () => {
    setExporting(true);
    setError(null);
    try {
      await downloadUsageExport(kind, {
        hideUnknown: hideUnknown ? "true" : "false",
        confirmedOnly: confirmedOnly ? "true" : "false"
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Usage Analytics</p>
          <h1>Usage Analytics</h1>
          <p className="page-description">
            Inventory distribution by {KIND_FACET[kind]}, with evidence mix, discovery trends
            {kind === "models" || kind === "cloud" ? ", and provider usage signals" : ""}.
          </p>
        </div>
        <div className="toolbar">
          <button className="button" type="button" disabled={exporting || loading} onClick={onExport}>
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </header>

      <nav className="segmented-nav" aria-label="Usage dimension">
        {USAGE_TABS.map((tab) => (
          <Link
            key={tab.kind}
            className={`segmented-nav-item${tab.kind === kind ? " active" : ""}`}
            to={tab.to}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="toolbar usage-controls">
        <label className="toggle">
          <input
            type="checkbox"
            checked={hideUnknown}
            onChange={(e) => setHideUnknown(e.target.checked)}
          />
          Hide unknown
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={confirmedOnly}
            onChange={(e) => setConfirmedOnly(e.target.checked)}
          />
          Confirmed only
        </label>
      </div>

      {loading ? (
        <div className="loading-state">Loading {title.toLowerCase()}...</div>
      ) : error ? (
        <div className="error-state">{error}</div>
      ) : (
        <>
          {insight ? <p className="usage-insight">{insight}</p> : null}

          <section className="card-grid">
            <KpiCard label="Agents in scope" value={total} />
            <KpiCard label="Labeled" value={labeled} />
            <KpiCard label="Unique values" value={rows.length} />
            <KpiCard label="Top value" value={topName} />
            {unknownCount > 0 ? <KpiCard label="Unknown (hidden)" value={unknownCount} tone="warn" /> : null}
          </section>

          <section className="panel">
            <div className="panel-heading">
              <h2>{title} distribution</h2>
              <p className="muted">Click a bar to open Inventory with that filter.</p>
            </div>
            <UsageBarChart rows={rows} onSelect={openRow} />
          </section>

          <section className="two-grid usage-secondary">
            <div className="panel">
              <h2>Evidence mix</h2>
              <p className="muted">How agents were identified.</p>
              <MiniBars rows={evidenceClassRows} onSelect={openEvidence} />
              <h3 className="subhead">Status</h3>
              <MiniBars rows={statusRows} onSelect={openEvidence} />
            </div>
            <div className="panel">
              <h2>Discovery trend</h2>
              <p className="muted">Agents first discovered per week (last 12 weeks).</p>
              <TrendChart series={series} />
            </div>
          </section>

          {(kind === "models" || kind === "cloud") && (
            <section className="panel">
              <h2>Provider usage</h2>
              <p className="muted">
                Live token/cost when an OpenAI org-admin key is connected; otherwise inventory proxies for Azure OpenAI and Bedrock.
              </p>
              {!providers.length ? (
                <div className="empty-state">No provider usage signals yet. Add OpenAI / Azure / AWS connectors and discover models.</div>
              ) : (
                <div className="provider-usage-grid">
                  {providers.map((p, idx) => {
                    const provider = valueAt(p, ["provider"]);
                    const status = valueAt(p, ["status"], "—");
                    const tokens = p.tokens == null ? "—" : Number(p.tokens).toLocaleString();
                    const cost = p.costUsd == null ? "—" : `$${Number(p.costUsd).toFixed(2)}`;
                    const agents = p.agentCount == null ? null : Number(p.agentCount);
                    return (
                      <article className="provider-card" key={`${provider}-${idx}`}>
                        <header>
                          <strong>{provider.replace(/_/g, " ")}</strong>
                          <span className={`status-pill ${status === "ok" || status === "legacy" ? "ok" : ""}`}>
                            {status.replace(/_/g, " ")}
                          </span>
                        </header>
                        <dl className="provider-metrics">
                          <div>
                            <dt>Tokens</dt>
                            <dd className="mono">{tokens}</dd>
                          </div>
                          <div>
                            <dt>Cost</dt>
                            <dd className="mono">{cost}</dd>
                          </div>
                          {agents != null ? (
                            <div>
                              <dt>Agents</dt>
                              <dd className="mono">{agents}</dd>
                            </div>
                          ) : null}
                        </dl>
                        <p className="muted small">{valueAt(p, ["message"], valueAt(p, ["source"]))}</p>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
