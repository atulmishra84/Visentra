import type { CSSProperties, ReactNode } from "react";

type AnyRec = Record<string, unknown>;

function asRec(value: unknown): AnyRec | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRec) : null;
}

function asArr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStrings(value: unknown): string[] {
  return asArr(value).map((item) => String(item)).filter(Boolean);
}

function truthyLabel(value: unknown): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  if (value == null || value === "") return "—";
  return String(value);
}

function requiredParams(schema: AnyRec | null): string[] {
  if (!schema) return [];
  const required = asStrings(schema.required);
  if (required.length) return required;
  const props = asRec(schema.properties);
  if (!props) return [];
  return Object.entries(props)
    .filter(([, def]) => asRec(def)?.required === true)
    .map(([key]) => key);
}

function Pill({ children, tone = "neutral" }: { children: string; tone?: "neutral" | "warn" | "ok" | "info" }) {
  return <span className={`deep-pill deep-pill-${tone}`}>{children}</span>;
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <span className="bar-meta" style={{ maxWidth: "68%", textAlign: "right", wordBreak: "break-word" } as CSSProperties}>
        {value || "—"}
      </span>
    </div>
  );
}

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <section className="panel deep-scan-panel">
      <h2>{title}</h2>
      {hint ? <p className="muted">{hint}</p> : null}
      {children}
    </section>
  );
}

type ToolView = {
  name: string;
  description: string;
  source: string;
  params: string[];
  riskFlags: string[];
};

function mapTools(items: unknown[]): ToolView[] {
  return items.map((item) => {
    const tool = asRec(item) || {};
    const flags = asRec(tool.risk_flags) || {};
    const riskFlags = Object.entries(flags)
      .filter(([, on]) => on === true)
      .map(([key]) => key.replace(/^can_/, "").replace(/_/g, " "));
    return {
      name: String(tool.name || "tool"),
      description: String(tool.description || ""),
      source: String(tool.source || ""),
      params: requiredParams(asRec(tool.parameters_schema)),
      riskFlags,
    };
  });
}

export function AgentDeepScanPanels({ agent }: { agent: AnyRec }) {
  const meta = asRec(agent.metadata) || {};
  const deep = asRec(meta.deep);
  const surface = asRec(meta.adversarial_surface);
  const dataAccess =
    asRec(agent.dataAccessClassification) ||
    asRec(meta.dataAccessClassification);

  if (!deep && !surface) return null;

  const identity = asRec(deep?.identity) || asRec(surface?.identity_and_access);
  const guardrails = asRec(deep?.guardrails);
  const memory = asRec(deep?.memoryConfiguration) || asRec(surface?.memory_and_context);
  const promptOverride = asRec(deep?.promptOverride);
  const instruction = asRec(deep?.instructions) || asRec(surface?.instructions);
  const observability = asRec(surface?.observability);
  const connectivity = asRec(surface?.connectivity);
  const surfaceData = asRec(surface?.data_access);
  const owasp = asRec(surface?.owasp_hints);
  const surfaceModel = asRec(surface?.model);

  const deepGroups = asArr(deep?.actionGroups);
  const deepKbs = asArr(deep?.knowledgeBases);
  const surfaceKbs = asArr(asRec(surface?.memory_and_context)?.knowledge_bases);
  const dataStores = asArr(surfaceData?.data_stores);

  const toolsToShow = mapTools(
    asArr(surface?.tools).length ? asArr(surface?.tools) : asArr(deep?.tools)
  );

  const riskIndicators = asStrings(surface?.risk_indicators);
  const dataClasses = asStrings(dataAccess?.dataClasses || surfaceData?.data_classes || meta.dataClasses);
  const hasPhi = dataAccess?.hasPhi === true || surfaceData?.has_phi === true || dataClasses.includes("phi");
  const hasPii = dataAccess?.hasPii === true || surfaceData?.has_pii === true || dataClasses.includes("pii") || hasPhi;

  const kbLabels = (
    surfaceKbs.length
      ? surfaceKbs
      : deepKbs.length
        ? deepKbs
        : dataStores
  ).map((item, index) => {
    const kb = asRec(item) || {};
    return String(kb.name || kb.id || kb.knowledgeBaseId || `store-${index + 1}`);
  });

  const foundationModel = String(
    deep?.foundationModel || surfaceModel?.foundation_model || surfaceModel?.name || meta.foundationModel || ""
  );
  const lifecycle = String(deep?.agentStatus || deep?.deploymentStatus || "");
  const runtimeStatus = String(deep?.agentRuntimeStatus || "");
  const showInstructions = Boolean(
    instruction && (instruction.present || instruction.preview || instruction.hash)
  );
  const showOwasp =
    Boolean(owasp) &&
    (asStrings(owasp?.llm_top10).length > 0 || asStrings(owasp?.agentic_asi).length > 0);

  return (
    <div className="deep-scan-stack">
      <Section
        title="Deep scan profile"
        hint="From AWS GetAgent / action groups / knowledge bases (metadata.deep + adversarial_surface)."
      >
        <div className="deep-kpi-row">
          {foundationModel ? (
            <div className="deep-kpi">
              <span className="deep-kpi-label">Model</span>
              <strong>{foundationModel}</strong>
            </div>
          ) : null}
          {lifecycle ? (
            <div className="deep-kpi">
              <span className="deep-kpi-label">Lifecycle</span>
              <strong>{lifecycle}</strong>
            </div>
          ) : null}
          {runtimeStatus ? (
            <div className="deep-kpi">
              <span className="deep-kpi-label">Runtime</span>
              <strong>{runtimeStatus}</strong>
            </div>
          ) : null}
          {(deep?.toolCount != null || toolsToShow.length > 0) && (
            <div className="deep-kpi">
              <span className="deep-kpi-label">Tools</span>
              <strong>{String(deep?.toolCount ?? toolsToShow.length)}</strong>
            </div>
          )}
          {(deep?.knowledgeBaseCount != null || kbLabels.length > 0) && (
            <div className="deep-kpi">
              <span className="deep-kpi-label">Knowledge bases</span>
              <strong>{String(deep?.knowledgeBaseCount ?? kbLabels.length)}</strong>
            </div>
          )}
        </div>

        <div className="deep-grid">
          <div>
            <h3 className="deep-subhead">Identity &amp; controls</h3>
            <MetaRow
              label="Execution role"
              value={String(identity?.arn || deep?.agentResourceRoleArn || identity?.name || "—")}
            />
            <MetaRow
              label="Guardrails"
              value={truthyLabel(
                guardrails?.present ?? observability?.guardrails_detected
              )}
            />
            {Boolean(guardrails?.guardrailIdentifier || observability?.guardrail_id) && (
              <MetaRow
                label="Guardrail ID"
                value={String(guardrails?.guardrailIdentifier || observability?.guardrail_id)}
              />
            )}
            <MetaRow
              label="Memory"
              value={truthyLabel(memory?.enabled ?? memory?.has_memory)}
            />
            {memory?.storageDays != null && (
              <MetaRow label="Memory retention" value={`${String(memory.storageDays)} days`} />
            )}
            {memory?.memory_type != null && memory.memory_type !== "" && (
              <MetaRow label="Memory type" value={String(memory.memory_type)} />
            )}
            <MetaRow label="Prompt override" value={truthyLabel(promptOverride?.configured)} />
            {deep?.idleSessionTTLInSeconds != null && (
              <MetaRow label="Idle session TTL" value={`${String(deep.idleSessionTTLInSeconds)}s`} />
            )}
            {deep?.agentVersionUsed != null && (
              <MetaRow label="Agent version" value={String(deep.agentVersionUsed)} />
            )}
          </div>

          <div>
            <h3 className="deep-subhead">Data access</h3>
            <div className="chip-row" style={{ marginTop: 0, marginBottom: 10 }}>
              {hasPhi ? <Pill tone="warn">PHI signal</Pill> : <Pill tone="ok">No PHI signal</Pill>}
              {hasPii ? <Pill tone="warn">PII signal</Pill> : <Pill tone="ok">No PII signal</Pill>}
              {dataAccess?.primaryDataClass || dataClasses[0] ? (
                <Pill tone="info">
                  {String(dataAccess?.primaryDataClass || dataClasses[0]).toUpperCase()}
                </Pill>
              ) : null}
            </div>
            <MetaRow
              label="Classes"
              value={dataClasses.length ? dataClasses.map((c) => c.toUpperCase()).join(", ") : "—"}
            />
            <MetaRow
              label="Confidence"
              value={String(dataAccess?.confidence || surfaceData?.confidence || "—")}
            />
            {kbLabels.length > 0 && <MetaRow label="Knowledge / stores" value={kbLabels.join(", ")} />}
            {connectivity && (
              <>
                <MetaRow label="Code execution" value={truthyLabel(connectivity.code_execution)} />
                <MetaRow label="Internet access" value={truthyLabel(connectivity.internet_access)} />
              </>
            )}
          </div>
        </div>

        {riskIndicators.length > 0 && (
          <div className="chip-row">
            {riskIndicators.map((flag) => (
              <Pill key={flag} tone="warn">
                {flag}
              </Pill>
            ))}
          </div>
        )}
      </Section>

      {(toolsToShow.length > 0 || deepGroups.length > 0) && (
        <Section title="Tools &amp; action groups" hint="Discovered from Bedrock action groups / tool schemas.">
          {deepGroups.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <h3 className="deep-subhead">Action groups</h3>
              <div className="chip-row" style={{ marginTop: 0 }}>
                {deepGroups.map((item, index) => {
                  const group = asRec(item) || {};
                  const label = String(group.actionGroupName || group.name || group.actionGroupId || `group-${index + 1}`);
                  const state = group.actionGroupState || group.state;
                  return (
                    <span key={`${label}-${index}`} className="badge">
                      {label}
                      {state ? ` · ${String(state)}` : ""}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {toolsToShow.length === 0 ? (
            <p className="muted">No tool schemas discovered.</p>
          ) : (
            <div className="deep-tool-list">
              {toolsToShow.map((tool, index) => (
                <div key={`${tool.name}-${index}`} className="deep-tool-card">
                  <div className="deep-tool-head">
                    <strong>{tool.name}</strong>
                    {tool.source ? <span className="badge">{tool.source}</span> : null}
                  </div>
                  {tool.description ? <p className="muted deep-tool-desc">{tool.description}</p> : null}
                  {(tool.params.length > 0 || tool.riskFlags.length > 0) && (
                    <div className="chip-row" style={{ marginTop: 8 }}>
                      {tool.params.map((param) => (
                        <span key={param} className="badge">
                          param:{param}
                        </span>
                      ))}
                      {tool.riskFlags.map((flag) => (
                        <Pill key={flag} tone="warn">
                          {flag}
                        </Pill>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {showInstructions && instruction ? (
        <Section title="Instructions &amp; prompt surface">
          <div className="deep-grid">
            <div>
              <MetaRow label="Configured" value={truthyLabel(instruction.present)} />
              <MetaRow
                label="Length"
                value={instruction.length != null ? `${String(instruction.length)} chars` : "—"}
              />
              {instruction.hash != null && instruction.hash !== "" ? (
                <MetaRow label="Hash" value={String(instruction.hash)} />
              ) : null}
              <MetaRow label="Tool guidance" value={truthyLabel(instruction.contains_tool_guidance)} />
              <MetaRow label="Safety rules" value={truthyLabel(instruction.contains_safety_rules)} />
              {instruction.source != null && instruction.source !== "" ? (
                <MetaRow label="Source" value={String(instruction.source)} />
              ) : null}
            </div>
            <div>
              {instruction.preview ? (
                <pre className="deep-instruction-preview">{String(instruction.preview)}</pre>
              ) : (
                <p className="muted">No instruction preview stored (hash-only / absent).</p>
              )}
            </div>
          </div>
        </Section>
      ) : null}

      {showOwasp && owasp ? (
        <Section
          title="Adversarial / OWASP hints"
          hint="Heuristic signals from deep scan — not confirmed exploit findings."
        >
          <div className="deep-grid">
            <div>
              <h3 className="deep-subhead">LLM Top 10</h3>
              <div className="chip-row" style={{ marginTop: 0 }}>
                {asStrings(owasp.llm_top10).map((item) => (
                  <span key={item} className="badge">
                    {item.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <h3 className="deep-subhead">Agentic ASI</h3>
              <div className="chip-row" style={{ marginTop: 0 }}>
                {asStrings(owasp.agentic_asi).map((item) => (
                  <span key={item} className="badge">
                    {item.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </div>
          </div>
          {asStrings(surface?.evidence).length > 0 && (
            <div className="chart-list" style={{ marginTop: 14 }}>
              {asStrings(surface?.evidence)
                .slice(0, 6)
                .map((line) => (
                  <div className="bar-row" key={line}>
                    <span>Evidence</span>
                    <span>{line}</span>
                    <span />
                  </div>
                ))}
            </div>
          )}
        </Section>
      ) : null}
    </div>
  );
}
