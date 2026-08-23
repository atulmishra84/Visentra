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

function first(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
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

function Pill({
  children,
  tone = "neutral"
}: {
  children: string;
  tone?: "neutral" | "warn" | "ok" | "info";
}) {
  return <span className={`deep-pill deep-pill-${tone}`}>{children}</span>;
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <span
        className="bar-meta"
        style={{ maxWidth: "68%", textAlign: "right", wordBreak: "break-word" } as CSSProperties}
      >
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
    const flags = asRec(tool.risk_flags) || asRec(tool.riskFlags) || {};
    const riskFlags = Object.entries(flags)
      .filter(([, on]) => on === true)
      .map(([key]) => key.replace(/^can_/, "").replace(/_/g, " "));
    return {
      name: String(tool.name || "tool"),
      description: String(tool.description || ""),
      source: String(tool.source || ""),
      params: requiredParams(asRec(tool.parameters_schema) || asRec(tool.parametersSchema)),
      riskFlags
    };
  });
}

function DeepScanStatusBanner({
  meta,
  deep,
  surface
}: {
  meta: AnyRec;
  deep: AnyRec | null;
  surface: AnyRec | null;
}) {
  const status = String(meta.deepScanStatus || "");
  const error = String(meta.deepScanError || "");
  const awsType = String(meta.awsType || meta.aws_type || "");
  const isBedrock = /bedrockagent/i.test(awsType) || Boolean(meta.agentId);

  if (deep) {
    return (
      <div className="chip-row" style={{ marginTop: 0, marginBottom: 12 }}>
        <Pill tone="ok">Deep scan OK</Pill>
        {surface ? <Pill tone="info">Adversarial surface present</Pill> : null}
        {meta.deepScanSchema ? <Pill tone="neutral">{String(meta.deepScanSchema)}</Pill> : null}
      </div>
    );
  }

  if (status === "permission_denied") {
    return (
      <Section
        title="Deep scan blocked"
        hint="metadata.deep is missing because AWS denied GetAgent (or related deep APIs)."
      >
        <div className="chip-row" style={{ marginTop: 0 }}>
          <Pill tone="warn">permission_denied</Pill>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          {error || "IAM principal cannot call bedrock:GetAgent / deep-scan actions."}
        </p>
        <p className="muted">
          Fix: grant the connector role the deep-scan IAM actions in AWS_DISCOVERY.md (GetAgent,
          ListAgentActionGroups, GetAgentActionGroup, ListAgentKnowledgeBases, GetKnowledgeBase,
          etc.), then re-run the AWS connector scan. Deep scan itself stays enabled server-side.
        </p>
      </Section>
    );
  }

  if (status && status !== "ok") {
    return (
      <Section
        title="Deep scan incomplete"
        hint="List found this agent, but deep enrichment did not complete."
      >
        <div className="chip-row" style={{ marginTop: 0 }}>
          <Pill tone="warn">{status}</Pill>
        </div>
        {error ? (
          <p className="muted" style={{ marginTop: 10 }}>
            {error}
          </p>
        ) : null}
      </Section>
    );
  }

  if (isBedrock && !deep) {
    return (
      <Section
        title="Deep profile not available"
        hint="This looks like a Bedrock agent but metadata.deep is empty."
      >
        <p className="muted">
          Re-run AWS discovery after confirming IAM deep-scan permissions. ListAgents alone does not
          populate tools, instructions, or adversarial surface details.
        </p>
      </Section>
    );
  }

  return null;
}

function hasDeepScanUi(meta: AnyRec, deep: AnyRec | null, surface: AnyRec | null): boolean {
  if (deep || surface) return true;
  if (meta.deepScanStatus) return true;
  const awsType = String(meta.awsType || meta.aws_type || "");
  if (/bedrockagent/i.test(awsType) || Boolean(meta.agentId)) return true;
  return meta.source === "graph-agent365-catalog" || Boolean(meta.agent365PackageId);
}

export function AgentDeepScanPanels({ agent }: { agent: AnyRec }) {
  const meta = asRec(agent.metadata) || {};
  const deep = asRec(meta.deep);
  const surface = asRec(meta.adversarial_surface);
  const dataAccess =
    asRec(agent.dataAccessClassification) || asRec(meta.dataAccessClassification);

  if (!hasDeepScanUi(meta, deep, surface)) return null;

  const statusBanner = (
    <DeepScanStatusBanner meta={meta} deep={deep} surface={surface} />
  );

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

  const deepGroups = asArr(first(deep?.actionGroups, deep?.action_groups));
  const deepKbs = asArr(deep?.knowledgeBases);
  const surfaceKbs = asArr(asRec(surface?.memory_and_context)?.knowledge_bases);
  const dataStores = asArr(surfaceData?.data_stores);

  const toolsToShow = mapTools(
    asArr(surface?.tools).length ? asArr(surface?.tools) : asArr(deep?.tools)
  );
  const riskIndicators = asStrings(surface?.risk_indicators);
  const dataClasses = asStrings(
    dataAccess?.dataClasses || surfaceData?.data_classes || meta.dataClasses
  );
  const hasPhi =
    dataAccess?.hasPhi === true || surfaceData?.has_phi === true || dataClasses.includes("phi");
  const hasPii =
    dataAccess?.hasPii === true ||
    surfaceData?.has_pii === true ||
    dataClasses.includes("pii") ||
    hasPhi;

  const kbLabels = (surfaceKbs.length ? surfaceKbs : deepKbs.length ? deepKbs : dataStores).map(
    (item, index) => {
      const kb = asRec(item) || {};
      return String(kb.name || kb.id || kb.knowledgeBaseId || `store-${index + 1}`);
    }
  );

  const foundationModel = String(
    first(
      deep?.foundationModel,
      surfaceModel?.foundation_model,
      surfaceModel?.name,
      meta.foundationModel
    ) || ""
  );
  const lifecycle = String(first(deep?.agentStatus, deep?.deploymentStatus) || "");
  const runtimeStatus = String(first(deep?.agentRuntimeStatus, deep?.runtimeStatus) || "");
  const promptOverrideOn = first(promptOverride?.present, promptOverride?.configured);
  const memoryRetention = first(memory?.storageDays, memory?.storage_days);
  const idleTtl = first(deep?.idleSessionTTLInSeconds, deep?.idleSessionTtlInSeconds);
  const agentVersion = first(deep?.agentVersionUsed, deep?.agentVersion, meta.agentVersionUsed);
  const executionRole = String(
    first(identity?.arn, deep?.agentResourceRoleArn, identity?.name) || "—"
  );
  const guardrailId = first(
    guardrails?.guardrailIdentifier,
    guardrails?.guardrailId,
    observability?.guardrail_id
  );

  const showInstructions = Boolean(
    instruction && (instruction.present || instruction.preview || instruction.hash)
  );
  const llmHints = asStrings(first(owasp?.llm_top10, owasp?.llmTop10));
  const asiHints = asStrings(first(owasp?.agentic_asi, owasp?.agenticAsi));
  const showOwasp = Boolean(owasp) && (llmHints.length > 0 || asiHints.length > 0);

  return (
    <div className="deep-scan-stack">
      {statusBanner}

      {(deep || surface) && (
        <Section
          title="Deep scan profile"
          hint="From AWS GetAgent or Agent 365 catalog package detail (metadata.deep + adversarial_surface)."
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
              <MetaRow label="Execution role" value={executionRole} />
              <MetaRow
                label="Guardrails"
                value={truthyLabel(first(guardrails?.present, observability?.guardrails_detected))}
              />
              {guardrailId != null ? (
                <MetaRow label="Guardrail ID" value={String(guardrailId)} />
              ) : null}
              <MetaRow
                label="Memory"
                value={truthyLabel(first(memory?.enabled, memory?.has_memory))}
              />
              {memoryRetention != null ? (
                <MetaRow label="Memory retention" value={`${String(memoryRetention)} days`} />
              ) : null}
              {memory?.memory_type != null && memory.memory_type !== "" ? (
                <MetaRow label="Memory type" value={String(memory.memory_type)} />
              ) : null}
              <MetaRow label="Prompt override" value={truthyLabel(promptOverrideOn)} />
              {idleTtl != null ? (
                <MetaRow label="Idle session TTL" value={`${String(idleTtl)}s`} />
              ) : null}
              {agentVersion != null ? (
                <MetaRow label="Agent version" value={String(agentVersion)} />
              ) : null}
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
                value={String(first(dataAccess?.confidence, surfaceData?.confidence) || "—")}
              />
              {kbLabels.length > 0 ? (
                <MetaRow label="Knowledge / stores" value={kbLabels.join(", ")} />
              ) : null}
              {connectivity ? (
                <>
                  <MetaRow
                    label="Code execution"
                    value={truthyLabel(connectivity.code_execution)}
                  />
                  <MetaRow
                    label="Internet access"
                    value={truthyLabel(connectivity.internet_access)}
                  />
                </>
              ) : null}
            </div>
          </div>

          {riskIndicators.length > 0 ? (
            <div className="chip-row">
              {riskIndicators.map((flag) => (
                <Pill key={flag} tone="warn">
                  {flag}
                </Pill>
              ))}
            </div>
          ) : null}
        </Section>
      )}

      {toolsToShow.length > 0 || deepGroups.length > 0 ? (
        <Section
          title="Tools &amp; action groups"
          hint="Discovered from Bedrock action groups / tool schemas."
        >
          {deepGroups.length > 0 ? (
            <div style={{ marginBottom: 14 }}>
              <h3 className="deep-subhead">Action groups</h3>
              <div className="chip-row" style={{ marginTop: 0 }}>
                {deepGroups.map((item, index) => {
                  const group = asRec(item) || {};
                  const label = String(
                    first(group.actionGroupName, group.name, group.actionGroupId) ||
                      `group-${index + 1}`
                  );
                  const state = first(group.actionGroupState, group.state);
                  return (
                    <span key={`${label}-${index}`} className="badge">
                      {label}
                      {state ? ` · ${String(state)}` : ""}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : null}

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
                  {tool.description ? (
                    <p className="muted deep-tool-desc">{tool.description}</p>
                  ) : null}
                  {tool.params.length > 0 || tool.riskFlags.length > 0 ? (
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
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Section>
      ) : null}

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
              <MetaRow
                label="Tool guidance"
                value={truthyLabel(instruction.contains_tool_guidance)}
              />
              <MetaRow
                label="Safety rules"
                value={truthyLabel(instruction.contains_safety_rules)}
              />
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
                {llmHints.map((item) => (
                  <span key={item} className="badge">
                    {item.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <h3 className="deep-subhead">Agentic ASI</h3>
              <div className="chip-row" style={{ marginTop: 0 }}>
                {asiHints.map((item) => (
                  <span key={item} className="badge">
                    {item.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </div>
          </div>
          {asStrings(surface?.evidence).length > 0 ? (
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
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}
