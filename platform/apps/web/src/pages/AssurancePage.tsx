import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { apiRequest } from "../lib/api";

type Control = {
  id: string;
  name: string;
  framework: string;
  assigned?: boolean;
  parameters?: { apiAllowlist?: string[] };
  evaluation?: {
    status: string;
    summary: string;
    evidence?: Array<Record<string, unknown>>;
    effective_permission?: Record<string, unknown> | null;
    missing?: string[];
    evaluated_at?: string;
  } | null;
};

type AgentRow = {
  id: string;
  name: string;
  model?: string | null;
  provider?: string | null;
  assigned?: string[];
  results?: Record<string, number>;
  drift?: { severity?: string } | null;
};

type Detail = {
  agent: { id: string; name: string };
  controls: Control[];
  snapshot: {
    source?: string;
    chain?: Array<{ step?: string; name?: string }>;
    capabilities?: Array<Record<string, unknown>>;
    coverage?: Record<string, boolean>;
    captured_at?: string;
  } | null;
  events: Array<Record<string, unknown>>;
  baseline: { snapshot?: Record<string, unknown>; created_at?: string } | null;
  drift: Array<Record<string, unknown>>;
};

const STATUS_LABEL: Record<string, string> = {
  effective: "Effective",
  ineffective: "Ineffective",
  violated: "Violated",
  blocked_violation: "Blocked violation",
  unknown: "Unknown",
  not_tested: "Not tested"
};

function statusLabel(status?: string | null) {
  if (!status) return "Not tested";
  return STATUS_LABEL[status] || status;
}

export function AssurancePage() {
  const { agentId } = useParams();
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [controlId, setControlId] = useState("C-001");
  const [allowlist, setAllowlist] = useState("/patient\n/diagnosis");
  const [coverage, setCoverage] = useState({ authorization: false, database: false, api: false, runtime: false });
  const [chainText, setChainText] = useState("credential: svc-patient-support\nidentity: service-principal");
  const [capability, setCapability] = useState({
    kind: "database",
    operation: "UPDATE",
    resource: "Patient DB",
    dataClass: "phi",
    allowed: true
  });
  const [capabilities, setCapabilities] = useState<Array<Record<string, unknown>>>([]);
  const [eventForm, setEventForm] = useState({
    kind: "database",
    operation: "UPDATE",
    action: "PUT",
    resource: "Patient DB",
    dataClass: "phi",
    decision: "allowed"
  });

  const loadSummary = () =>
    apiRequest<{ agents: AgentRow[] }>("/api/assurance/summary").then((payload) => setAgents(payload.agents || []));

  const loadDetail = (id: string) =>
    apiRequest<Detail>(`/api/assurance/agents/${encodeURIComponent(id)}`).then((payload) => setDetail(payload));

  useEffect(() => {
    let mounted = true;
    setError(null);
    loadSummary().catch((err) => mounted && setError(err instanceof Error ? err.message : "Failed to load assurance"));
    if (agentId) {
      loadDetail(agentId).catch((err) => mounted && setError(err instanceof Error ? err.message : "Failed to load agent"));
    } else {
      setDetail(null);
    }
    return () => {
      mounted = false;
    };
  }, [agentId]);

  const refresh = async () => {
    await loadSummary();
    if (agentId) await loadDetail(agentId);
  };

  const assign = async (event: FormEvent) => {
    event.preventDefault();
    if (!agentId) return;
    setError(null);
    try {
      await apiRequest(`/api/assurance/agents/${encodeURIComponent(agentId)}/assignments`, {
        method: "POST",
        body: JSON.stringify({
          controlId,
          parameters: controlId === "C-003" ? { apiAllowlist: allowlist } : {}
        })
      });
      setMessage("Control assigned. Evaluation has not run yet.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assign failed");
    }
  };

  const evaluate = async () => {
    if (!agentId) return;
    setError(null);
    try {
      await apiRequest(`/api/assurance/agents/${encodeURIComponent(agentId)}/evaluate`, { method: "POST" });
      setMessage("Evaluation recorded. Previous results were kept.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluation failed");
    }
  };

  const saveSnapshot = async (event: FormEvent) => {
    event.preventDefault();
    if (!agentId) return;
    setError(null);
    const chain = chainText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [step, ...rest] = line.split(":");
        return { step: step.trim(), name: rest.join(":").trim() || step.trim() };
      });
    try {
      await apiRequest(`/api/assurance/agents/${encodeURIComponent(agentId)}/permissions`, {
        method: "POST",
        body: JSON.stringify({
          source: "operator",
          coverage,
          chain,
          capabilities
        })
      });
      setMessage("Permission snapshot recorded from the planes you marked as read.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Snapshot failed");
    }
  };

  const saveEvent = async (event: FormEvent) => {
    event.preventDefault();
    if (!agentId) return;
    setError(null);
    try {
      await apiRequest(`/api/assurance/agents/${encodeURIComponent(agentId)}/events`, {
        method: "POST",
        body: JSON.stringify({ source: "operator", ...eventForm })
      });
      setMessage("Runtime event recorded. Raw payloads are not stored.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Event failed");
    }
  };

  const approve = async () => {
    if (!agentId) return;
    setError(null);
    try {
      await apiRequest(`/api/assurance/agents/${encodeURIComponent(agentId)}/baseline`, { method: "POST" });
      setMessage("Baseline approved from the current permission snapshot.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Baseline failed");
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Governance</p>
          <h1>Control assurance</h1>
          <p className="page-description">
            For each agent: what policy requires, what the credential can do, what runtime showed, and whether the
            control held. Unknown stays unknown until the permission plane and runtime plane were actually read.
          </p>
        </div>
      </header>

      {error ? <div className="error-state">{error}</div> : null}
      {message ? <p className="status-pill">{message}</p> : null}

      {!agentId ? (
        <section className="panel">
          <h2>Agents</h2>
          {!agents.length ? (
            <p className="muted">No discovered agents yet. Add a connector and run discovery, then assign controls here.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Provider</th>
                  <th>Assigned</th>
                  <th>Results</th>
                  <th>Drift</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.id}>
                    <td>
                      <Link to={`/assurance/${agent.id}`}>{agent.name}</Link>
                      <div className="muted">{agent.model || "model unread"}</div>
                    </td>
                    <td>{agent.provider || "—"}</td>
                    <td>{(agent.assigned || []).join(", ") || "—"}</td>
                    <td>
                      {Object.entries(agent.results || {}).length
                        ? Object.entries(agent.results || {}).map(([status, count]) => (
                            <span key={status} className={`assurance-pill`} data-status={status}>
                              {statusLabel(status)} {count}
                            </span>
                          ))
                        : "Not tested"}
                    </td>
                    <td>{agent.drift?.severity && agent.drift.severity !== "none" ? agent.drift.severity : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : (
        <div className="split-layout">
          <section className="panel">
            <p className="muted">
              <Link to="/assurance">All agents</Link>
              {detail?.agent?.name ? ` · ${detail.agent.name}` : ""}
            </p>
            <div className="toolbar" style={{ margin: "12px 0" }}>
              <button className="button primary" type="button" onClick={() => void evaluate()}>
                Evaluate
              </button>
              <button className="button" type="button" onClick={() => void approve()}>
                Approve baseline
              </button>
            </div>

            <h2>Intent</h2>
            <form className="connector-form" onSubmit={(event) => void assign(event)}>
              <label>
                Control
                <select className="input" value={controlId} onChange={(event) => setControlId(event.target.value)}>
                  {(detail?.controls || []).map((control) => (
                    <option key={control.id} value={control.id}>
                      {control.id} · {control.name}
                    </option>
                  ))}
                </select>
              </label>
              {controlId === "C-003" ? (
                <label>
                  Approved API prefixes
                  <textarea className="input" rows={3} value={allowlist} onChange={(event) => setAllowlist(event.target.value)} />
                </label>
              ) : null}
              <button className="button" type="submit">
                Assign control
              </button>
            </form>

            <div className="assurance-results">
              {(detail?.controls || [])
                .filter((control) => control.assigned)
                .map((control) => (
                  <article key={control.id} className="assurance-card">
                    <div className="connector-card-head">
                      <strong>
                        {control.id} · {control.name}
                      </strong>
                      <span className="assurance-pill" data-status={control.evaluation?.status || "not_tested"}>
                        {statusLabel(control.evaluation?.status)}
                      </span>
                    </div>
                    <p className="muted">{control.evaluation?.summary || "Assigned. Not tested until you evaluate."}</p>
                    {control.evaluation?.effective_permission?.operation ? (
                      <p className="mono">
                        Effective permission: {String(control.evaluation.effective_permission.operation)}{" "}
                        {String(control.evaluation.effective_permission.resource || "")}
                      </p>
                    ) : null}
                    {control.evaluation?.evidence?.length ? (
                      <ul className="assurance-evidence">
                        {control.evaluation.evidence.map((item, index) => (
                          <li key={`${control.id}-${index}`}>{JSON.stringify(item)}</li>
                        ))}
                      </ul>
                    ) : null}
                  </article>
                ))}
            </div>

            <h2>Capability</h2>
            {detail?.snapshot?.chain?.length ? (
              <p className="chain-line">
                {detail.snapshot.chain.map((step) => step.name || step.step).filter(Boolean).join(" → ")}
              </p>
            ) : (
              <p className="muted">No permission chain recorded.</p>
            )}
            <form className="connector-form" onSubmit={(event) => void saveSnapshot(event)}>
              <label>
                Chain, one step per line (credential: name)
                <textarea className="input" rows={3} value={chainText} onChange={(event) => setChainText(event.target.value)} />
              </label>
              <div className="form-row">
                {(["authorization", "database", "api", "runtime"] as const).map((plane) => (
                  <label key={plane}>
                    <input
                      type="checkbox"
                      checked={coverage[plane]}
                      onChange={(event) => setCoverage((prev) => ({ ...prev, [plane]: event.target.checked }))}
                    />{" "}
                    {plane} read
                  </label>
                ))}
              </div>
              <div className="form-row">
                <input className="input" value={capability.kind} onChange={(event) => setCapability((prev) => ({ ...prev, kind: event.target.value }))} placeholder="kind" />
                <input className="input" value={capability.operation} onChange={(event) => setCapability((prev) => ({ ...prev, operation: event.target.value }))} placeholder="operation" />
                <input className="input" value={capability.resource} onChange={(event) => setCapability((prev) => ({ ...prev, resource: event.target.value }))} placeholder="resource" />
                <input className="input" value={capability.dataClass} onChange={(event) => setCapability((prev) => ({ ...prev, dataClass: event.target.value }))} placeholder="data class" />
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={capability.allowed}
                  onChange={(event) => setCapability((prev) => ({ ...prev, allowed: event.target.checked }))}
                />{" "}
                allowed
              </label>
              <button
                className="button"
                type="button"
                onClick={() => setCapabilities((prev) => [...prev, { ...capability }])}
              >
                Add capability to snapshot
              </button>
              {capabilities.length ? (
                <ul>
                  {capabilities.map((row, index) => (
                    <li key={index}>{JSON.stringify(row)}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">Add the permissions you actually resolved, then save the snapshot.</p>
              )}
              <button className="button" type="submit">
                Save permission snapshot
              </button>
            </form>

            <h2>Behavior</h2>
            <form className="connector-form" onSubmit={(event) => void saveEvent(event)}>
              <div className="form-row">
                <input className="input" value={eventForm.kind} onChange={(event) => setEventForm((prev) => ({ ...prev, kind: event.target.value }))} placeholder="kind" />
                <input className="input" value={eventForm.operation} onChange={(event) => setEventForm((prev) => ({ ...prev, operation: event.target.value }))} placeholder="operation" />
                <input className="input" value={eventForm.action} onChange={(event) => setEventForm((prev) => ({ ...prev, action: event.target.value }))} placeholder="action" />
                <input className="input" value={eventForm.resource} onChange={(event) => setEventForm((prev) => ({ ...prev, resource: event.target.value }))} placeholder="resource" />
                <select className="input" value={eventForm.decision} onChange={(event) => setEventForm((prev) => ({ ...prev, decision: event.target.value }))}>
                  <option value="allowed">allowed</option>
                  <option value="blocked">blocked</option>
                  <option value="unknown">unknown</option>
                </select>
              </div>
              <button className="button" type="submit">
                Record runtime event
              </button>
            </form>
            {detail?.events?.length ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Operation</th>
                    <th>Resource</th>
                    <th>Class</th>
                    <th>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.events.map((row) => (
                    <tr key={String(row.id)}>
                      <td className="muted">{row.occurred_at ? new Date(String(row.occurred_at)).toLocaleString() : "—"}</td>
                      <td>{String(row.operation || row.action || "—")}</td>
                      <td>{String(row.resource || "—")}</td>
                      <td>{String(row.data_class || "—")}</td>
                      <td>{String(row.decision || "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">No runtime events for this agent.</p>
            )}

            <h2>Drift</h2>
            {detail?.drift?.length ? (
              detail.drift.map((row) => (
                <p key={String(row.id)}>
                  <span className="assurance-pill" data-status={row.severity === "critical" ? "violated" : "ineffective"}>
                    {String(row.severity)}
                  </span>{" "}
                  {JSON.stringify(row.changes)}
                </p>
              ))
            ) : (
              <p className="muted">No drift against an approved baseline.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
