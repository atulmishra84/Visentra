import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { numberAt, valueAt } from "../lib/api";

export type AnatomyItem = {
  id?: string;
  label?: string;
  kind?: string;
  detail?: string | null;
  href?: string | null;
};

export type AnatomyGroup = {
  id?: string;
  label?: string;
  description?: string;
  items?: AnatomyItem[];
};

export type AgentAnatomy = {
  center?: {
    agentId?: string;
    name?: string;
    category?: string;
    framework?: string;
    owner?: string | null;
    model?: {
      name?: string;
      provider?: string;
      label?: string;
    };
  };
  profile?: Record<string, unknown>;
  groups?: {
    usersInputs?: AnatomyGroup;
    channels?: AnatomyGroup;
    actions?: AnatomyGroup;
    data?: AnatomyGroup;
  };
  counts?: Record<string, number>;
  risk?: Record<string, unknown>;
};

type TabId = "anatomy" | "risk" | "residual" | "sessions";

function providerLabel(provider?: string): string {
  const p = String(provider || "llm").toLowerCase();
  if (p === "openai") return "OPENAI";
  if (p === "anthropic") return "ANTHROPIC";
  if (p === "azure") return "AZURE";
  if (p === "google") return "GOOGLE";
  if (p === "aws") return "AWS";
  if (p === "microsoft") return "MICROSOFT";
  if (p === "local") return "LOCAL";
  return p.toUpperCase();
}

function shortLabel(label: string, max = 18): string {
  if (label.length <= max) return label;
  return `${label.slice(0, max - 1)}…`;
}

function formatDate(value: unknown): string {
  if (!value) return "—";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function itemIcon(kind?: string): string {
  const k = String(kind || "");
  if (k === "user" || k === "owner" || k === "identity" || k === "input") return "user";
  if (k === "channel" || k === "app") return "channel";
  if (k === "action" || k === "mcp") return "action";
  if (k === "data" || k === "knowledge" || k === "vector" || k === "memory" || k === "data_class") return "data";
  return "item";
}

type SpokeLayout = {
  key: keyof NonNullable<AgentAnatomy["groups"]>;
  cx: number;
  cy: number;
  fan: "up" | "left" | "right" | "down";
};

const SPOKES: SpokeLayout[] = [
  { key: "usersInputs", cx: 500, cy: 118, fan: "up" },
  { key: "channels", cx: 150, cy: 360, fan: "left" },
  { key: "data", cx: 850, cy: 360, fan: "right" },
  { key: "actions", cx: 500, cy: 620, fan: "down" }
];

function spokeItemPoints(fan: SpokeLayout["fan"], count: number, hubX: number, hubY: number) {
  const n = Math.max(count, 1);
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0.5 : i / (n - 1);
    if (fan === "up") points.push({ x: hubX + (t - 0.5) * 280, y: hubY - 70 - Math.sin(t * Math.PI) * 18 });
    if (fan === "down") points.push({ x: hubX + (t - 0.5) * 300, y: hubY + 70 + Math.sin(t * Math.PI) * 12 });
    if (fan === "left") points.push({ x: hubX - 90, y: hubY + (t - 0.5) * 150 });
    if (fan === "right") points.push({ x: hubX + 90, y: hubY + (t - 0.5) * 150 });
  }
  return points;
}

type AgentAnatomyPanelProps = {
  anatomy: AgentAnatomy | null;
  loading?: boolean;
  error?: string | null;
  onClear?: () => void;
};

export function AgentAnatomyPanel({ anatomy, loading, error, onClear }: AgentAnatomyPanelProps) {
  const [tab, setTab] = useState<TabId>("anatomy");
  const [hotItem, setHotItem] = useState<string | null>(null);

  const visibleGroups = useMemo(() => {
    if (!anatomy?.groups) return [];
    return SPOKES.map((spoke) => {
      const group = anatomy.groups?.[spoke.key];
      const items = (group?.items || []).slice(0, 5);
      const overflow = Math.max(0, (group?.items || []).length - items.length);
      const display = overflow
        ? [...items, { id: `more-${spoke.key}`, label: `+${overflow} more`, kind: "more" }]
        : items;
      const points = spokeItemPoints(spoke.fan, display.length, spoke.cx, spoke.cy);
      return { spoke, group, items, overflow, display, points };
    });
  }, [anatomy]);

  if (loading) {
    return (
      <section className="panel anatomy-shell">
        <div className="loading-state">Loading agent anatomy...</div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="panel anatomy-shell">
        <div className="error-state">{error}</div>
      </section>
    );
  }

  if (!anatomy?.center) {
    return (
      <section className="panel anatomy-shell anatomy-empty-state">
        <h2>Relationship Explorer</h2>
        <p className="muted">
          Select an agent to open its anatomy map — users &amp; inputs, channels, actions, data — with inherent risk
          profiling around the agent and LLM.
        </p>
      </section>
    );
  }

  const center = anatomy.center;
  const profile = anatomy.profile || {};
  const model = center.model || {};
  const risk = anatomy.risk || {};
  const tier = valueAt(risk, ["tier"], "low");
  const flagged = Boolean(profile.flagged || risk.flagged || risk.shadowAi);
  const reasons = Array.isArray(risk.reasons) ? (risk.reasons as string[]) : [];
  const paths = Array.isArray(risk.paths) ? (risk.paths as Array<Record<string, unknown>>) : [];
  const hubX = 500;
  const hubY = 360;

  return (
    <section className="anatomy-shell">
      <header className="anatomy-topbar">
        <div>
          <p className="anatomy-crumb">
            Agents / <span>{valueAt(center, ["name"], "agent")}</span>
          </p>
          <div className="anatomy-title-row">
            <span className="anatomy-mark" aria-hidden />
            <div>
              <h1>{valueAt(center, ["name"], "Agent")}</h1>
              <p className="muted">Owner: {valueAt(center, ["owner"], valueAt(profile, ["owner"], "Unassigned"))}</p>
            </div>
          </div>
        </div>
        <div className="toolbar">
          {flagged ? <span className="anatomy-flag">Flagged</span> : <span className="status-pill tone-good">Clear</span>}
          {center.agentId ? (
            <Link className="button ghost" to={`/agents/${center.agentId}`}>
              Open detail
            </Link>
          ) : null}
          {onClear ? (
            <button className="button ghost" type="button" onClick={onClear}>
              Clear
            </button>
          ) : null}
        </div>
      </header>

      <nav className="anatomy-tabs" aria-label="Agent investigation tabs">
        {(
          [
            ["anatomy", "Anatomy", "Agent connections and users"],
            ["risk", "Risk profile", "Inherent risk of the agent"],
            ["residual", "Residual risk", "Remaining risk after controls"],
            ["sessions", "Sessions", "Logs of agent conversations"]
          ] as Array<[TabId, string, string]>
        ).map(([id, label, desc]) => {
          const disabled = id === "residual" || id === "sessions";
          return (
            <button
              key={id}
              type="button"
              className={`anatomy-tab ${tab === id ? "is-active" : ""}`}
              disabled={disabled}
              title={disabled ? "Visibility roadmap — not in current discovery scope" : desc}
              onClick={() => setTab(id)}
            >
              <strong>{label}</strong>
              <span>{desc}</span>
            </button>
          );
        })}
      </nav>

      {tab === "risk" ? (
        <div className="anatomy-risk-view panel">
          <div className="anatomy-risk-score">
            <strong>{numberAt(risk, ["score"], 0)}</strong>
            <span>/ 100 · {tier}</span>
          </div>
          <dl className="anatomy-risk-grid">
            <div>
              <dt>Sensitivity</dt>
              <dd>{valueAt(risk, ["sensitivity"], "unknown")}</dd>
            </div>
            <div>
              <dt>Data class</dt>
              <dd>{String(valueAt(risk, ["primaryDataClass"], "none")).toUpperCase()}</dd>
            </div>
            <div>
              <dt>Access scopes</dt>
              <dd>{numberAt(risk, ["grantCount"], 0)}</dd>
            </div>
            <div>
              <dt>Ownership</dt>
              <dd>{valueAt(risk, ["ownershipStatus"], "—")}</dd>
            </div>
          </dl>
          <div className="toolbar" style={{ gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {risk.hasPhi ? <span className="badge">PHI</span> : null}
            {risk.hasPii ? <span className="badge">PII</span> : null}
            {risk.shadowAi ? <span className="badge">Shadow AI</span> : null}
            {risk.overPermissioned ? <span className="badge">Over-permissioned</span> : null}
          </div>
          {reasons.length ? (
            <div className="anatomy-risk-block">
              <h3>Why this score</h3>
              <ul>
                {reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {paths.length ? (
            <div className="anatomy-risk-block">
              <h3>Risk paths</h3>
              <ul>
                {paths.slice(0, 8).map((path, index) => (
                  <li key={`${valueAt(path, ["toName"], "path")}-${index}`}>
                    <strong>{valueAt(path, ["relType"], "REL")}</strong>
                    {" → "}
                    {valueAt(path, ["toName"], "target")}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="anatomy-body">
          <aside className="anatomy-sidebar panel">
            <p className="anatomy-function">{valueAt(profile, ["function"], "General")}</p>
            <p className="muted">{valueAt(profile, ["summary"], "")}</p>
            <div className="anatomy-owner-chip">
              <span className="anatomy-user-dot" />
              {valueAt(profile, ["owner"], "Unassigned")}
            </div>

            <h3>Boundaries</h3>
            <ul className="anatomy-boundaries">
              <li>
                <span>Registered agents</span>
                <em>Discovery</em>
              </li>
              <li>
                <span>{valueAt(profile, ["environment"], "Environment")}</span>
                <em>{valueAt(profile, ["plane"], "Plane")}</em>
              </li>
              <li>
                <span>{valueAt(profile, ["function"], "Function")}</span>
                <em>{numberAt((anatomy.counts || {}) as Record<string, unknown>, ["actions"], 0)} actions</em>
              </li>
            </ul>

            <dl className="anatomy-meta-grid">
              <div>
                <dt>Agent type</dt>
                <dd>{valueAt(profile, ["agentType"], "—")}</dd>
              </div>
              <div>
                <dt>Infra type</dt>
                <dd>{valueAt(profile, ["infraType"], "—")}</dd>
              </div>
              <div>
                <dt>Environment</dt>
                <dd>{valueAt(profile, ["environment"], "—")}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{valueAt(profile, ["location"], "—")}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatDate(profile.created)}</dd>
              </div>
              <div>
                <dt>Registered</dt>
                <dd>{formatDate(profile.registered)}</dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>{valueAt(profile, ["mode"], "Agent")}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{valueAt(model, ["name"], "—")}</dd>
              </div>
            </dl>
          </aside>

          <div className="anatomy-stage panel">
            <svg className="anatomy-svg" viewBox="0 0 1000 720" role="img" aria-label="Agent anatomy graph">
              <defs>
                <radialGradient id="hubGlow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="rgba(65,214,195,0.28)" />
                  <stop offset="70%" stopColor="rgba(65,214,195,0.05)" />
                  <stop offset="100%" stopColor="rgba(65,214,195,0)" />
                </radialGradient>
              </defs>
              <circle cx={hubX} cy={hubY} r="150" fill="url(#hubGlow)" />

              {visibleGroups.map(({ spoke, display, points }) =>
                display.map((item, index) => {
                  const point = points[index] || { x: spoke.cx, y: spoke.cy };
                  const hot = hotItem === String(item.id || item.label);
                  const path = `M ${hubX} ${hubY} Q ${spoke.cx} ${spoke.cy} ${point.x} ${point.y}`;
                  return (
                    <path
                      key={`edge-${spoke.key}-${item.id || item.label}`}
                      d={path}
                      className={`anatomy-edge ${hot ? "is-hot" : ""}`}
                      fill="none"
                    />
                  );
                })
              )}

              <circle cx={hubX} cy={hubY} r="86" className="anatomy-hub-ring" />
              <circle cx={hubX} cy={hubY} r="78" className="anatomy-hub-disk" />
            </svg>

            <div className="anatomy-hub">
              <span className="anatomy-mark large" aria-hidden />
              <strong>{shortLabel(valueAt(center, ["name"], "Agent"), 22)}</strong>
              <div className={`anatomy-llm provider-${valueAt(model, ["provider"], "llm")}`}>
                <em>{providerLabel(valueAt(model, ["provider"], "llm"))}</em>
                <span>{valueAt(model, ["name"], "model")}</span>
              </div>
            </div>

            {visibleGroups.map(({ spoke, group, display, points }) => (
              <div key={spoke.key}>
                <div
                  className="anatomy-spoke-label"
                  style={{ left: `${(spoke.cx / 1000) * 100}%`, top: `${(spoke.cy / 720) * 100}%` }}
                >
                  <strong>{valueAt(group || {}, ["label"], spoke.key)}</strong>
                  <span>{valueAt(group || {}, ["description"], "")}</span>
                </div>
                {display.map((item, index) => {
                  const point = points[index] || { x: spoke.cx, y: spoke.cy };
                  const id = String(item.id || item.label);
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`anatomy-node icon-${itemIcon(item.kind)} ${hotItem === id ? "is-hot" : ""} ${
                        item.kind === "more" ? "is-more" : ""
                      }`}
                      style={{ left: `${(point.x / 1000) * 100}%`, top: `${(point.y / 720) * 100}%` }}
                      onMouseEnter={() => setHotItem(id)}
                      onMouseLeave={() => setHotItem(null)}
                      title={valueAt(item, ["detail"], valueAt(item, ["label"], ""))}
                    >
                      <i aria-hidden />
                      <span>{shortLabel(valueAt(item, ["label"], "—"), 16)}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
