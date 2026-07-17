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
  groups?: {
    usersInputs?: AnatomyGroup;
    channels?: AnatomyGroup;
    actions?: AnatomyGroup;
    data?: AnatomyGroup;
  };
  counts?: Record<string, number>;
  risk?: Record<string, unknown>;
};

const GROUP_ORDER: Array<{ key: keyof NonNullable<AgentAnatomy["groups"]>; slot: string }> = [
  { key: "usersInputs", slot: "nw" },
  { key: "channels", slot: "ne" },
  { key: "actions", slot: "sw" },
  { key: "data", slot: "se" }
];

function providerMark(provider?: string): string {
  const p = String(provider || "llm").toLowerCase();
  if (p === "openai") return "OA";
  if (p === "anthropic") return "AN";
  if (p === "azure") return "AZ";
  if (p === "google") return "G";
  if (p === "aws") return "AWS";
  if (p === "microsoft") return "MS";
  if (p === "local") return "LL";
  return "LLM";
}

function riskTone(tier?: string): "good" | "warn" | "critical" {
  const t = String(tier || "").toLowerCase();
  if (t === "critical" || t === "elevated") return t === "critical" ? "critical" : "warn";
  if (t === "moderate") return "warn";
  return "good";
}

function GroupCard({ group, slot }: { group?: AnatomyGroup; slot: string }) {
  const items = group?.items || [];
  return (
    <section className={`anatomy-group anatomy-group-${slot}`}>
      <header>
        <h3>{valueAt(group || {}, ["label"], "Group")}</h3>
        <span className="anatomy-count">{items.length}</span>
      </header>
      <p className="muted anatomy-group-desc">{valueAt(group || {}, ["description"], "")}</p>
      {items.length ? (
        <ul className="anatomy-item-list">
          {items.map((item) => (
            <li key={String(item.id || item.label)}>
              <span className={`anatomy-chip kind-${String(item.kind || "item")}`}>
                {valueAt(item, ["label"], "—")}
              </span>
              {item.detail ? <em>{item.detail}</em> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted anatomy-empty">None discovered</p>
      )}
    </section>
  );
}

type AgentAnatomyPanelProps = {
  anatomy: AgentAnatomy | null;
  loading?: boolean;
  error?: string | null;
  onClear?: () => void;
};

export function AgentAnatomyPanel({ anatomy, loading, error, onClear }: AgentAnatomyPanelProps) {
  if (loading) {
    return (
      <section className="panel anatomy-panel">
        <div className="loading-state">Loading agent anatomy...</div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="panel anatomy-panel">
        <div className="error-state">{error}</div>
      </section>
    );
  }

  if (!anatomy?.center) {
    return (
      <section className="panel anatomy-panel anatomy-panel-empty">
        <div className="panel-heading">
          <h2>Agent anatomy</h2>
        </div>
        <p className="muted">
          Select an agent seed above to inspect connections: users &amp; inputs, channels, actions, and data — with
          inherent risk profiling.
        </p>
      </section>
    );
  }

  const center = anatomy.center;
  const model = center.model || {};
  const risk = anatomy.risk || {};
  const tier = valueAt(risk, ["tier"], "low");
  const tone = riskTone(tier);
  const reasons = Array.isArray(risk.reasons) ? (risk.reasons as string[]) : [];
  const paths = Array.isArray(risk.paths) ? (risk.paths as Array<Record<string, unknown>>) : [];

  return (
    <div className="anatomy-layout">
      <section className="panel anatomy-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Anatomy</p>
            <h2>Agent connections</h2>
          </div>
          <div className="toolbar">
            {center.agentId ? (
              <Link className="button ghost" to={`/agents/${center.agentId}`}>
                Open agent
              </Link>
            ) : null}
            {onClear ? (
              <button className="button ghost" type="button" onClick={onClear}>
                Clear focus
              </button>
            ) : null}
          </div>
        </div>

        <div className="anatomy-orbit">
          {GROUP_ORDER.map(({ key, slot }) => (
            <GroupCard key={key} group={anatomy.groups?.[key]} slot={slot} />
          ))}

          <div className="anatomy-center">
            <div className="anatomy-center-card">
              <div className={`anatomy-llm-mark provider-${valueAt(model, ["provider"], "llm")}`}>
                <span>{providerMark(valueAt(model, ["provider"], "llm"))}</span>
              </div>
              <p className="anatomy-llm-name">{valueAt(model, ["label", "name"], "No model")}</p>
              <h3 className="anatomy-agent-name">{valueAt(center, ["name"], "Agent")}</h3>
              <p className="muted anatomy-agent-meta">
                {[center.category, center.framework].filter(Boolean).join(" · ") || "Discovered agent"}
              </p>
            </div>
          </div>
        </div>
      </section>

      <aside className="panel anatomy-risk-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Risk profiling</p>
            <h2>Inherent risk</h2>
          </div>
          <span className={`status-pill tone-${tone}`}>{tier}</span>
        </div>

        <div className="anatomy-risk-score">
          <strong>{numberAt(risk, ["score"], 0)}</strong>
          <span>/ 100</span>
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
              {paths.slice(0, 6).map((path, index) => (
                <li key={`${valueAt(path, ["toName"], "path")}-${index}`}>
                  <strong>{valueAt(path, ["relType"], "REL")}</strong>
                  {" → "}
                  {valueAt(path, ["toName"], "target")}
                  {path.riskHint ? <em> · {String(path.riskHint)}</em> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="muted">No elevated relationship paths recorded for this agent.</p>
        )}
      </aside>
    </div>
  );
}
