import type { Agent } from "../lib/api";
import { agentIdentificationRows, hasCloudIdentification, resolveAgentIdentification } from "../lib/agentIdentification";

export function AgentIdentificationPanel({
  agent,
  extras
}: {
  agent: Agent;
  extras?: Record<string, unknown>;
}) {
  const ids = resolveAgentIdentification(agent, extras);
  const rows = agentIdentificationRows(agent, extras);
  if (!hasCloudIdentification(ids) && rows.length === 0) return null;

  return (
    <div className="panel">
      <h2>Agent Identification</h2>
      <p className="muted">
        Cloud and directory locators collected from AWS, Azure, and Entra discovery — not just owner
        display names.
      </p>
      {rows.length ? (
        <div className="chart-list">
          {rows.map((row) => (
            <div className="bar-row" key={row.label}>
              <span>{row.label}</span>
              <span className="mono" style={{ textAlign: "right", wordBreak: "break-word", maxWidth: "70%" }}>
                {row.value}
              </span>
              <span />
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">No cloud locator fields on this agent yet. Re-run the AWS or Azure connector scan.</p>
      )}
    </div>
  );
}
