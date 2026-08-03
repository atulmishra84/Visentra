import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { KpiCard } from "../components/KpiCard";
import { apiRequest, compactDate, numberAt, type Agent, valueAt } from "../lib/api";

function metaOf(agent: Agent): Record<string, unknown> {
  return ((agent.metadata || {}) as Record<string, unknown>) || {};
}

function listOf(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return [String(value)];
}

export function AgentDetailPage() {
  const { id } = useParams();
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let mounted = true;
    setLoading(true);
    apiRequest<Record<string, unknown>>(`/api/agents/${encodeURIComponent(id)}`)
      .then((data) => mounted && setPayload(data))
      .catch((requestError) =>
        mounted && setError(requestError instanceof Error ? requestError.message : "Failed to load agent.")
      )
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [id]);

  const agent = ((payload?.agent as Agent | undefined) ?? {}) as Agent;
  const meta = metaOf(agent);
  const agentConfig =
    (payload?.agentConfig as Record<string, unknown> | undefined) ||
    (agent.agentConfig as Record<string, unknown> | undefined) ||
    (meta.agentConfig as Record<string, unknown> | undefined) ||
    {};
  const agentAccess =
    (payload?.agentAccess as Record<string, unknown> | undefined) ||
    (agent.agentAccess as Record<string, unknown> | undefined) ||
    (meta.agentAccess as Record<string, unknown> | undefined) ||
    {};
  const ownership =
    (payload?.ownership as Record<string, unknown> | undefined) ||
    (agent.ownership as Record<string, unknown> | undefined) ||
    (meta.ownership as Record<string, unknown> | undefined) ||
    {};
  const dataAccess =
    (payload?.dataAccessClassification as Record<string, unknown> | undefined) ||
    (agent.dataAccessClassification as Record<string, unknown> | undefined) ||
    (meta.dataAccessClassification as Record<string, unknown> | undefined) ||
    {};
  const blast =
    (payload?.blastRadius as Record<string, unknown> | undefined) ||
    (agent.blastRadius as Record<string, unknown> | undefined) ||
    null;
  const relationships = (payload?.relationships as Record<string, unknown>[] | undefined) || [];
  const granted = listOf(agentAccess.granted);
  const tools = listOf(agentConfig.tools);
  const mcpServers = listOf(agentConfig.mcpServers);
  const knowledge = listOf(agentConfig.knowledgeSources);
  const triggers = listOf(agentConfig.triggers);
  const channels = listOf(agentConfig.channels);
  const dataClasses = listOf(dataAccess.dataClasses || meta.dataClasses);
  const dataEvidence = Array.isArray(dataAccess.evidence)
    ? (dataAccess.evidence as Record<string, unknown>[])
    : [];
  const primaryDataClass = valueAt(
    dataAccess,
    ["primaryDataClass"],
    valueAt(meta, ["primaryDataClass"], dataClasses[0] || "none")
  );
  const dataConfidence = valueAt(
    dataAccess,
    ["confidence"],
    valueAt(meta, ["dataAccessConfidence"], "low")
  );
  const paths = (blast?.paths as Record<string, unknown>[] | undefined) || [];
  const ownsRels = relationships.filter((rel) => /owns|uses_identity/i.test(valueAt(rel, ["rel_type", "type"])));
  const ownershipStatus = valueAt(ownership, ["ownershipStatus"], valueAt(agent, ["owner"]) ? "owned" : "ownerless");

  if (loading) {
    return (
      <div className="page">
        <div className="loading-state">Loading agent profile...</div>
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
          <p className="eyebrow">Agent Detail</p>
          <h1>{valueAt(agent, ["name", "displayName", "id"], "Agent")}</h1>
          <p className="page-description">
            {valueAt(meta, ["howIdentified"], valueAt(agent, ["summary", "description", "category"], "Canonical agent profile"))}
          </p>
        </div>
        <div className="toolbar">
          <Link className="button primary" to={`/relationships?agentId=${encodeURIComponent(String(agent.id ?? id))}`}>
            Open anatomy
          </Link>
          <Link
            className="button"
            to={`/relationships?agentId=${encodeURIComponent(String(agent.id ?? id))}&graph=1`}
          >
            Show neighborhood graph
          </Link>
          <Link
            className="button"
            to={`/ai-bom?tab=systems&agentId=${encodeURIComponent(String(agent.id ?? id))}`}
          >
            AI BOM
          </Link>
          <Link className="button" to="/inventory">
            Back to inventory
          </Link>
        </div>
      </header>

      <section className="card-grid">
        <KpiCard label="Owner" value={valueAt(ownership, ["owner"], valueAt(agent, ["owner", "team"]))} />
        <KpiCard
          label="Ownership"
          value={ownershipStatus}
          tone={ownershipStatus === "owned" ? "good" : "warn"}
        />
        <KpiCard label="Evidence" value={String(meta.evidenceClass || "—").replace(/_/g, " ")} />
        <KpiCard label="Status" value={String(meta.agentStatus || "—")} tone={meta.agentStatus === "confirmed" ? "good" : "warn"} />
        <KpiCard
          label="Blast radius"
          value={blast ? `${valueAt(blast, ["tier"], "—")} · ${numberAt(blast, ["score"], 0)}` : "—"}
          tone={numberAt(blast || {}, ["score"], 0) >= 45 ? "warn" : "good"}
        />
        <KpiCard label="Access scopes" value={granted.length || numberAt(agentAccess, ["grantCount"], 0)} />
        <KpiCard
          label="Shadow AI"
          value={agent.shadowAi ? `${Math.round(numberAt(agent, ["shadowAiScore"], 0) * 100)}%` : "No"}
          tone={agent.shadowAi ? "warn" : "good"}
        />
        <KpiCard
          label="Agent plane"
          value={
            valueAt((meta.mesh as Record<string, unknown>) || {}, ["planeLabel", "agentPlane"]) ||
            valueAt(meta, ["agentPlane"], "—")
          }
        />
        <KpiCard
          label="Environment"
          value={
            valueAt((meta.mesh as Record<string, unknown>) || {}, ["laneLabel", "environmentLane"]) ||
            valueAt(meta, ["environmentLane"], "—")
          }
        />
      </section>

      {agent.shadowAi ? (
        <section className="panel" style={{ marginBottom: 16 }}>
          <h2>Shadow AI signals</h2>
          <p className="muted">
            {((agent.shadowAiReasons as string[] | undefined) || []).join(" · ") || "Flagged as unmanaged / unsanctioned AI."}
          </p>
          <div className="toolbar" style={{ gap: 8, flexWrap: "wrap" }}>
            {((agent.shadowAiTags as string[] | undefined) || []).map((tag) => (
              <span className="badge" key={tag}>
                {tag}
              </span>
            ))}
            <Link className="button ghost" to="/shadow-ai">
              View all Shadow AI
            </Link>
          </div>
        </section>
      ) : null}

      <section className="split-grid">
        <div className="panel">
          <h2>Configuration</h2>
          <p className="muted">Discovered tools, MCP, knowledge, channels, auth, and instruction presence.</p>
          <div className="chart-list">
            <div className="bar-row">
              <span>Instructions</span>
              <span>{agentConfig.instructionsPresent ? "Present" : "Not detected"}</span>
              <span className="mono">{valueAt(agentConfig, ["instructionSource"], "—")}</span>
            </div>
            <div className="bar-row">
              <span>Framework</span>
              <span>{valueAt(agentConfig, ["framework"], valueAt(agent, ["framework"]))}</span>
              <span />
            </div>
            <div className="bar-row">
              <span>Models</span>
              <span>{listOf(agentConfig.models).join(", ") || valueAt(agent, ["model"]) || "—"}</span>
              <span />
            </div>
            <div className="bar-row">
              <span>Auth mode</span>
              <span>{valueAt(agentConfig, ["authMode"], valueAt(meta, ["authMode"]) || "—")}</span>
              <span />
            </div>
            <div className="bar-row">
              <span>Platform</span>
              <span>{valueAt(agentConfig, ["platform"], valueAt(meta, ["platformLabel", "platform"]) || "—")}</span>
              <span />
            </div>
            <div className="bar-row">
              <span>How configured</span>
              <span>{valueAt(agentConfig, ["howConfigured"], valueAt(meta, ["howIdentified"]))}</span>
              <span />
            </div>
          </div>
          {tools.length ? (
            <div className="chip-row">
              {tools.map((t) => (
                <span className="badge" key={`tool-${t}`}>
                  tool:{t}
                </span>
              ))}
            </div>
          ) : null}
          {mcpServers.length ? (
            <div className="chip-row">
              {mcpServers.map((t) => (
                <span className="badge" key={`mcp-${t}`}>
                  mcp:{t}
                </span>
              ))}
            </div>
          ) : null}
          {knowledge.length ? (
            <div className="chip-row">
              {knowledge.map((t) => (
                <span className="badge" key={`know-${t}`}>
                  knowledge:{t}
                </span>
              ))}
            </div>
          ) : null}
          {channels.length ? (
            <div className="chip-row">
              {channels.map((t) => (
                <span className="badge" key={`ch-${t}`}>
                  channel:{t}
                </span>
              ))}
            </div>
          ) : null}
          {triggers.length ? (
            <div className="chip-row">
              {triggers.map((t) => (
                <span className="badge" key={`trig-${t}`}>
                  trigger:{t}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="panel">
          <h2>Identity & ownership</h2>
          <p className="muted">
            Status: <strong>{ownershipStatus}</strong>
            {valueAt(ownership, ["identityProvider"])
              ? ` · identity provider ${valueAt(ownership, ["identityProvider"])}`
              : ""}
          </p>
          <div className="chart-list">
            <div className="bar-row">
              <span>Owner</span>
              <span>{valueAt(ownership, ["owner"], valueAt(agent, ["owner"])) || "—"}</span>
              <span />
            </div>
            <div className="bar-row">
              <span>Identity used</span>
              <span>
                {valueAt(ownership, ["identityUsed"], valueAt(agent, ["identity_used"])) || "—"}
              </span>
              <span />
            </div>
            <div className="bar-row">
              <span>Team / dept</span>
              <span>
                {valueAt(ownership, ["team", "department"], valueAt(agent, ["department", "business_unit"]) || "—")}
              </span>
              <span />
            </div>
            <div className="bar-row">
              <span>Object / app</span>
              <span className="mono">
                {valueAt(ownership, ["objectId", "appId"], "—")}
              </span>
              <span />
            </div>
          </div>
          <div className="chip-row">
            {listOf(ownership.identities).length ? (
              listOf(ownership.identities).map((idValue) => (
                <span className="badge" key={idValue}>
                  {idValue}
                </span>
              ))
            ) : (
              <span className="muted">No linked identities discovered.</span>
            )}
          </div>
          {ownsRels.length ? (
            <div className="chart-list" style={{ marginTop: 12 }}>
              {ownsRels.slice(0, 6).map((rel, index) => (
                <div className="bar-row" key={`own-${index}`}>
                  <span>{valueAt(rel, ["rel_type", "type"])}</span>
                  <span>
                    {valueAt(rel, ["asset_type"])} · {valueAt(rel, ["to_name", "name"])}
                  </span>
                  <span />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section className="split-grid" style={{ marginTop: 16 }}>
        <div className="panel">
          <h2>Access & permissions</h2>
          <p className="muted">
            Sensitivity: <strong>{valueAt(agentAccess, ["sensitivity"], "unknown")}</strong>
            {agentAccess.overPermissioned ? " · flagged over-permissioned" : ""}
          </p>
          <p className="muted" style={{ marginTop: 4 }}>
            Sensitive data:{" "}
            <strong className={/phi|pii/i.test(primaryDataClass) ? "badge bad" : ""}>
              {String(primaryDataClass).toUpperCase()}
            </strong>{" "}
            ({dataConfidence} confidence)
            {dataClasses.length > 1 ? ` · ${dataClasses.map((c) => c.toUpperCase()).join(", ")}` : ""}
          </p>
          <div className="chip-row">
            {granted.length ? (
              granted.map((scope) => (
                <span className="badge" key={scope}>
                  {scope}
                </span>
              ))
            ) : (
              <span className="muted">No access scopes discovered yet.</span>
            )}
          </div>
          {dataEvidence.length ? (
            <div className="chart-list" style={{ marginTop: 12 }}>
              <div className="bar-row">
                <span>Evidence</span>
                <span className="muted">Why this data class</span>
                <span />
              </div>
              {dataEvidence.slice(0, 8).map((ev, index) => (
                <div className="bar-row" key={`dac-${index}`}>
                  <span className="badge">{valueAt(ev, ["source"], "signal")}</span>
                  <span>{valueAt(ev, ["detail", "signal"], "—")}</span>
                  <span className="mono">{valueAt(ev, ["signal"], "")}</span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="chart-list" style={{ marginTop: 12 }}>
            <div className="bar-row">
              <span>Identities</span>
              <span>
                {listOf(agentAccess.identities).join(", ") ||
                  valueAt(agent, ["identity_used", "owner"]) ||
                  "—"}
              </span>
              <span />
            </div>
            <div className="bar-row">
              <span>Data stores</span>
              <span>{listOf(agentAccess.dataStores).join(", ") || "—"}</span>
              <span />
            </div>
            <div className="bar-row">
              <span>Connected apps</span>
              <span>{listOf(agentAccess.connectedApps).join(", ") || "—"}</span>
              <span />
            </div>
            <div className="bar-row">
              <span>Permissions</span>
              <span>{listOf(agentAccess.permissions).join(", ") || "—"}</span>
              <span />
            </div>
          </div>
        </div>

        <div className="panel">
          <h2>Blast radius</h2>
          {blast ? (
            <>
              <p className="muted">
                Tier <strong>{valueAt(blast, ["tier"])}</strong> · score{" "}
                <strong className="mono">{numberAt(blast, ["score"], 0)}</strong>
              </p>
              <p className="muted">{listOf(blast.reasons).join(" · ") || "No risk reasons."}</p>
              <div className="chart-list">
                {paths.slice(0, 8).map((path, index) => (
                  <div className="bar-row" key={`${path.toName}-${index}`}>
                    <span>{valueAt(path, ["relType"])}</span>
                    <span>
                      {valueAt(path, ["toType"])} · {valueAt(path, ["toName"])}
                    </span>
                    <span className="mono">{valueAt(path, ["riskHint"])}</span>
                  </div>
                ))}
                {!paths.length ? <div className="empty-state">No graph paths from this agent yet.</div> : null}
              </div>
            </>
          ) : (
            <div className="empty-state">Blast-radius score unavailable.</div>
          )}
        </div>

        <div className="panel">
          <h2>Relationships</h2>
          <div className="chart-list">
            {relationships.length ? (
              relationships.slice(0, 12).map((rel, index) => (
                <div className="bar-row" key={String(rel.id ?? index)}>
                  <span>{valueAt(rel, ["rel_type", "type"])}</span>
                  <span>
                    {valueAt(rel, ["asset_type"])} · {valueAt(rel, ["to_name", "name"])}
                  </span>
                  <span />
                </div>
              ))
            ) : (
              <div className="empty-state">No stored relationships for this agent.</div>
            )}
          </div>
          <div className="chart-list" style={{ marginTop: 16 }}>
            <div className="bar-row">
              <span>Department</span>
              <span>{valueAt(agent, ["department", "businessUnit"])}</span>
              <span />
            </div>
            <div className="bar-row">
              <span>Cloud</span>
              <span>{valueAt(agent, ["cloud_provider", "provider", "cloud", "environment"])}</span>
              <span />
            </div>
            <div className="bar-row">
              <span>Last seen</span>
              <span>{compactDate(agent.lastObservedAt ?? agent.last_seen)}</span>
              <span />
            </div>
            <div className="bar-row">
              <span>Evidence reason</span>
              <span>{valueAt(meta, ["evidenceReason"], "—")}</span>
              <span />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
