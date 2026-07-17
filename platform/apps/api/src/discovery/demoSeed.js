/**
 * Demo / seed collector — modern agentic estate for Global Mesh + Relationship anatomy.
 * Enabled only when DISCOVERY_DEMO_SEED=true. Never on in strict production.
 */

import { AGENT_PLANES, ENVIRONMENT_LANES } from "../meshConstants.js";

export function demoSeedEnabled() {
  return String(process.env.DISCOVERY_DEMO_SEED || "").toLowerCase() === "true";
}

function withMesh(meta, agentPlane, environmentLane, environment) {
  return {
    ...meta,
    ...(environment ? { environment } : {}),
    agentPlane,
    environmentLane,
    meshConfidence: "high",
    mesh: { agentPlane, environmentLane, confidence: "high" }
  };
}

function rel(rel_type, to_type, to_key, to_name) {
  return { rel_type, to_type, to_key, to_name };
}

/**
 * Compact factory for constellation density + anatomy richness.
 */
function agent(spec) {
  const {
    fingerprint,
    name,
    category,
    owner = null,
    department = "General",
    business_unit = "Enterprise",
    plane,
    lane,
    environment = lane,
    model = "gpt-4o",
    provider = "openai",
    framework = null,
    deployment_type = "container",
    cloud_provider = null,
    region = null,
    hostname = null,
    container = null,
    ide = null,
    repository = null,
    running_status = "running",
    confidence_score = 0.88,
    tools = [],
    mcp = [],
    channels = [],
    identities = [],
    dataStores = [],
    knowledge = [],
    permissions = [],
    triggers = [],
    shadow = false,
    dataClass = null,
    relationships = [],
    extraMeta = {}
  } = spec;

  if (!AGENT_PLANES.includes(plane)) {
    throw new Error(`demo seed invalid plane: ${plane} (${fingerprint})`);
  }
  if (!ENVIRONMENT_LANES.includes(lane)) {
    throw new Error(`demo seed invalid lane: ${lane} (${fingerprint})`);
  }

  const scopes = {};
  for (const t of tools.concat(mcp)) {
    if (/db|sql|postgres|snowflake|vector/i.test(t)) scopes.database = true;
    if (/mail|email|outlook/i.test(t)) scopes.email = true;
    if (/slack|teams|chat/i.test(t)) scopes.slack = true;
    if (/file|sharepoint|drive|fs/i.test(t)) scopes.filesystem = true;
    if (/web|browse|search|http/i.test(t)) scopes.internet = true;
    if (/github|git|pr/i.test(t)) scopes.github = true;
  }
  if (mcp.length) scopes.mcp = true;
  if (dataClass === "phi") scopes.phi = true;
  if (dataClass === "pii" || dataClass === "phi") scopes.crm = true;

  const dataClasses = dataClass ? (dataClass === "phi" ? ["phi", "pii"] : [dataClass]) : [];
  const risk_indicators = [];
  if (shadow) risk_indicators.push("shadow", "unmanaged");
  if (!owner) risk_indicators.push("ownerless");
  if (permissions.length >= 6) risk_indicators.push("over_permissioned");

  return {
    collector_id: "demo",
    fingerprint,
    name,
    category,
    owner,
    department,
    business_unit,
    hostname,
    ide,
    provider,
    model,
    framework,
    deployment_type,
    container,
    cloud_provider,
    region,
    repository,
    running_status,
    confidence_score,
    tools,
    mcp_connections: mcp,
    internet_access: Boolean(scopes.internet),
    filesystem_access: Boolean(scopes.filesystem),
    database_access: Boolean(scopes.database),
    github_access: Boolean(scopes.github),
    email_access: Boolean(scopes.email),
    relationships,
    risk_indicators: risk_indicators.length ? risk_indicators : undefined,
    metadata: withMesh(
      {
        aiRelevant: true,
        demoSeed: true,
        inventoryClass: category,
        evidenceClass:
          category === "ide"
            ? "ide_agent"
            : category === "saas"
              ? "platform_agent"
              : category === "cloud"
                ? "cloud_ai_runtime"
                : "process_agent",
        agentStatus: shadow || !owner ? "candidate" : "confirmed",
        shadowAi: shadow || undefined,
        howIdentified: `Demo mesh — ${framework || category}`,
        hasInstructions: tools.length > 0,
        function: department,
        agentConfig: {
          tools,
          mcpServers: mcp,
          knowledgeSources: knowledge,
          triggers,
          channels,
          authMode: identities.some((i) => /sp-|svc-|mi-/i.test(i)) ? "managed_identity" : "oauth",
          platform: framework || provider,
          instructionsPresent: true,
          howConfigured: framework || deployment_type
        },
        agentAccess: {
          scopes,
          identities: identities.length ? identities : owner ? [owner] : [],
          dataStores,
          connectedApps: channels,
          permissions
        },
        ownership: {
          owner,
          identities: identities.length ? identities : owner ? [owner] : [],
          ownershipStatus: owner ? "owned" : "ownerless",
          team: department
        },
        ownershipStatus: owner ? "owned" : "ownerless",
        ...(dataClasses.length
          ? {
              dataClasses,
              primaryDataClass: dataClass,
              dataAccessClassification: {
                dataClasses,
                primaryDataClass: dataClass,
                confidence: "high",
                evidence: [{ source: "demo", signal: dataClass, detail: `Demo ${dataClass} access` }]
              }
            }
          : {}),
        ...extraMeta
      },
      plane,
      lane,
      environment
    ),
    last_seen: new Date().toISOString()
  };
}

/**
 * @returns {Array<Record<string, unknown>>}
 */
export function buildDemoObservations() {
  const fleet = [
    // ── Showcase anatomy: logistics SSO agent (hub-and-spoke rich) ──
    agent({
      fingerprint: "demo:prod:sso-logistics-agent",
      name: "sso-logistics-agent",
      category: "autonomous",
      owner: "dean.diasti@example.com",
      department: "Logistics",
      business_unit: "Operations",
      plane: "containerized",
      lane: "production",
      environment: "production",
      model: "gpt-4o",
      provider: "openai",
      framework: "LangGraph",
      deployment_type: "container",
      cloud_provider: "gcp",
      region: "us-central1",
      container: "sso-logistics-agent:2.4.1",
      hostname: "gke-prod-logistics-7",
      tools: [
        "get_shipment_tracking",
        "get_estimated_arrival",
        "get_order_details",
        "get_cheapest_vendor",
        "reroute_shipment",
        "notify_carrier",
        "update_sla_clock"
      ],
      mcp: ["mcp-postgres-ops", "mcp-maps", "mcp-slack-ops"],
      channels: ["Email", "Slack", "ServiceNow"],
      identities: [
        "dean.diasti@example.com",
        "demo.staff@example.com",
        "demo.manager@example.com",
        "nouha.tiyal@example.com",
        "sp-logistics-runtime"
      ],
      dataStores: ["postgres", "shipment-events", "carrier-rate-cards"],
      knowledge: ["logistics-playbook", "SLA catalog", "Google APIs", "Google OAuth"],
      permissions: [
        "Shipments.Read",
        "Shipments.Write",
        "Vendors.Read",
        "Slack.Chat.Write",
        "Mail.Send",
        "Maps.Route"
      ],
      triggers: ["shipment_exception", "user_prompt", "sla_breach"],
      dataClass: "pii",
      relationships: [
        rel("OWNS", "Developer", "dean.diasti", "Dean Diasti"),
        rel("USES_IDENTITY", "ServicePrincipal", "sp-logistics", "sp-logistics-runtime"),
        rel("USES_IDENTITY", "Developer", "demo.staff", "Demo Staff"),
        rel("USES_IDENTITY", "Developer", "demo.manager", "Demo Manager"),
        rel("USES_IDENTITY", "Developer", "nouha.tiyal", "Nouha Tiyal"),
        rel("INVOKES_MODEL", "Model", "gpt-4o", "gpt-4o"),
        rel("USES_TOOL", "Tool", "get_shipment_tracking", "get_shipment_tracking"),
        rel("USES_TOOL", "Tool", "get_estimated_arrival", "get_estimated_arrival"),
        rel("USES_TOOL", "Tool", "get_order_details", "get_order_details"),
        rel("USES_TOOL", "Tool", "get_cheapest_vendor", "get_cheapest_vendor"),
        rel("USES_TOOL", "Tool", "reroute_shipment", "reroute_shipment"),
        rel("CONNECTS_MCP", "MCPServer", "mcp-postgres-ops", "mcp-postgres-ops"),
        rel("CONNECTS_MCP", "MCPServer", "mcp-maps", "mcp-maps"),
        rel("ACCESSES", "Database", "postgres-ops", "postgres"),
        rel("ACCESSES", "ExternalService", "google-apis", "Google APIs"),
        rel("ACCESSES", "ExternalService", "google-oauth", "Google OAuth"),
        rel("ACCESSES", "ExternalService", "slack", "Slack"),
        rel("ACCESSES", "ExternalService", "email", "Email"),
        rel("DEPLOYED_IN", "CloudResource", "gke-prod", "GKE prod"),
        rel("SOURCED_FROM", "Repository", "logistics-agents", "logistics-agents")
      ],
      extraMeta: {
        summary:
          "Coordinates shipment tracking, route optimization, carrier exceptions, and SLA recovery across logistics ops.",
        deploymentType: "Gke_pod",
        platform: "GKE"
      }
    }),

    // ── Production containerized / serverless ──
    agent({
      fingerprint: "demo:prod:claims-orchestrator",
      name: "claims-orchestrator",
      category: "autonomous",
      owner: "claims-eng@example.com",
      department: "Insurance Ops",
      plane: "serverless",
      lane: "production",
      model: "claude-3-5-sonnet",
      provider: "anthropic",
      framework: "Bedrock Agents",
      deployment_type: "serverless",
      cloud_provider: "aws",
      region: "us-west-2",
      tools: ["lookup_claim", "read_clinical_note", "summarize_encounter", "route_adjuster"],
      mcp: ["mcp-ehr-fhir"],
      channels: ["Email", "ServiceNow"],
      identities: ["claims-eng@example.com", "mi-bedrock-claims"],
      dataStores: ["patient-claims-db", "clinical-notes-ehr"],
      knowledge: ["FHIR Patient API", "claims handbook"],
      permissions: ["FHIR.Patient.Read", "EHR.Clinical.Read", "Claims.ReadWrite"],
      triggers: ["claim_submitted"],
      dataClass: "phi",
      relationships: [
        rel("INVOKES_MODEL", "Model", "claude-3-5-sonnet", "claude-3-5-sonnet"),
        rel("DEPLOYED_IN", "CloudResource", "bedrock-usw2", "Amazon Bedrock"),
        rel("ACCESSES", "Database", "claims-ehr", "Claims EHR store"),
        rel("CONNECTS_MCP", "MCPServer", "mcp-ehr-fhir", "mcp-ehr-fhir"),
        rel("OWNS", "Developer", "claims-eng", "claims-eng@example.com")
      ]
    }),
    agent({
      fingerprint: "demo:prod:support-triage-swarm",
      name: "support-triage-swarm",
      category: "framework",
      owner: "platform-ai@example.com",
      department: "Customer Support",
      plane: "containerized",
      lane: "production",
      framework: "CrewAI",
      cloud_provider: "aws",
      region: "us-east-1",
      container: "support-triage:3.1.0",
      tools: ["ticket_lookup", "kb_search", "escalate", "draft_reply", "sentiment_score"],
      mcp: ["mcp-zendesk", "mcp-confluence"],
      channels: ["Zendesk", "Slack", "Email"],
      identities: ["platform-ai@example.com", "sp-support-swarm"],
      dataStores: ["zendesk-tickets", "confluence-kb"],
      knowledge: ["support runbooks", "product FAQ"],
      permissions: ["Tickets.ReadWrite", "KB.Read", "Slack.Chat.Write"],
      triggers: ["ticket_created", "sla_warning"],
      dataClass: "pii",
      relationships: [
        rel("INVOKES_MODEL", "Model", "gpt-4o", "gpt-4o"),
        rel("DEPLOYED_IN", "CloudResource", "eks-prod", "EKS prod"),
        rel("CONNECTS_MCP", "MCPServer", "mcp-zendesk", "mcp-zendesk"),
        rel("ACCESSES", "ExternalService", "zendesk", "Zendesk"),
        rel("USES_TOOL", "Tool", "escalate", "escalate")
      ]
    }),
    agent({
      fingerprint: "demo:prod:finance-close-copilot",
      name: "finance-close-copilot",
      category: "framework",
      owner: "fpna@example.com",
      department: "Finance",
      plane: "containerized",
      lane: "production",
      framework: "Semantic Kernel",
      cloud_provider: "azure",
      region: "eastus",
      tools: ["pull_ledger", "reconcile_variance", "draft_close_notes", "flag_anomaly"],
      channels: ["Teams", "Email"],
      identities: ["fpna@example.com", "mi-finance-close"],
      dataStores: ["sap-fi", "anomaly-scores"],
      knowledge: ["close checklist", "policy pack"],
      permissions: ["Ledger.Read", "Payroll.Read", "Mail.Send"],
      dataClass: "financial",
      relationships: [
        rel("INVOKES_MODEL", "Model", "gpt-4o", "gpt-4o"),
        rel("ACCESSES", "Database", "sap-fi", "SAP FI"),
        rel("ACCESSES", "ExternalService", "teams", "Teams")
      ]
    }),
    agent({
      fingerprint: "demo:prod:secops-alert-triager",
      name: "secops-alert-triager",
      category: "autonomous",
      owner: "secops@example.com",
      department: "Security",
      plane: "containerized",
      lane: "production",
      framework: "LangGraph",
      cloud_provider: "azure",
      region: "eastus2",
      tools: ["enrich_ioc", "query_siem", "open_incident", "suggest_containment"],
      mcp: ["mcp-sentinel", "mcp-crowdstrike"],
      channels: ["Teams", "PagerDuty"],
      identities: ["secops@example.com", "sp-secops-triager"],
      dataStores: ["sentinel-workspace", "asset-cmbd"],
      knowledge: ["IR playbooks"],
      permissions: ["SecurityEvents.Read", "Incidents.Write"],
      relationships: [
        rel("INVOKES_MODEL", "Model", "gpt-4o", "gpt-4o"),
        rel("CONNECTS_MCP", "MCPServer", "mcp-sentinel", "mcp-sentinel"),
        rel("ACCESSES", "ExternalService", "crowdstrike", "CrowdStrike")
      ]
    }),
    agent({
      fingerprint: "demo:prod:hr-policy-assistant",
      name: "hr-policy-assistant",
      category: "saas",
      owner: "hr-ops@example.com",
      department: "Human Resources",
      plane: "saas_third_party",
      lane: "saas",
      framework: "Workday AI",
      deployment_type: "saas",
      provider: "workday",
      tools: ["lookup_worker", "answer_policy", "update_time_off"],
      channels: ["Workday", "Email"],
      identities: ["hr-ops@example.com"],
      dataStores: ["HR employee directory", "payroll summaries"],
      knowledge: ["benefits handbook"],
      permissions: ["Worker.Read", "Directory.Read", "Payroll.Read"],
      dataClass: "pii",
      relationships: [
        rel("ACCESSES", "ExternalService", "workday", "Workday"),
        rel("INVOKES_MODEL", "Model", "gpt-4o", "gpt-4o"),
        rel("OWNS", "Developer", "hr-ops", "hr-ops@example.com")
      ]
    }),
    agent({
      fingerprint: "demo:prod:devops-change-guardian",
      name: "devops-change-guardian",
      category: "framework",
      owner: "sre@example.com",
      department: "Devops",
      plane: "containerized",
      lane: "production",
      framework: "AutoGen",
      cloud_provider: "aws",
      region: "us-east-1",
      tools: ["review_diff", "check_slo", "open_change_ticket", "page_oncall"],
      mcp: ["mcp-github", "mcp-pagerduty"],
      channels: ["Slack", "GitHub"],
      identities: ["sre@example.com", "sp-change-guardian"],
      dataStores: ["deploy-history", "slo-metrics"],
      knowledge: ["change policy"],
      permissions: ["Repos.Read", "Actions.Read", "Incidents.Write"],
      relationships: [
        rel("CONNECTS_MCP", "MCPServer", "mcp-github", "mcp-github"),
        rel("INVOKES_MODEL", "Model", "gpt-4o-mini", "gpt-4o-mini"),
        rel("SOURCED_FROM", "Repository", "platform-gitops", "platform-gitops")
      ]
    }),
    agent({
      fingerprint: "demo:prod:data-lineage-steward",
      name: "data-lineage-steward",
      category: "framework",
      owner: "data-eng@example.com",
      department: "Data Engineering",
      plane: "containerized",
      lane: "production",
      framework: "LangGraph",
      cloud_provider: "gcp",
      region: "us-central1",
      tools: ["scan_lineage", "flag_pii_column", "open_dq_ticket"],
      channels: ["Slack"],
      identities: ["data-eng@example.com"],
      dataStores: ["bigquery-marts", "unity-catalog"],
      knowledge: ["data contracts"],
      permissions: ["BigQuery.JobUser", "Catalog.Read"],
      dataClass: "pii",
      relationships: [
        rel("ACCESSES", "Database", "bigquery-marts", "BigQuery marts"),
        rel("INVOKES_MODEL", "Model", "gemini-1.5-pro", "gemini-1.5-pro")
      ]
    }),
    agent({
      fingerprint: "demo:prod:sales-forecast-agent",
      name: "sales-forecast-agent",
      category: "cloud",
      owner: "revops@example.com",
      department: "Sales",
      plane: "serverless",
      lane: "production",
      framework: "Azure AI Foundry",
      deployment_type: "serverless",
      cloud_provider: "azure",
      region: "eastus",
      tools: ["pull_pipeline", "score_deal", "draft_forecast"],
      channels: ["Teams", "Salesforce"],
      identities: ["revops@example.com", "mi-sales-forecast"],
      dataStores: ["salesforce-opps"],
      knowledge: ["quota model"],
      permissions: ["Opportunities.Read", "Forecast.Write"],
      dataClass: "pii",
      relationships: [
        rel("ACCESSES", "ExternalService", "salesforce", "Salesforce"),
        rel("INVOKES_MODEL", "Model", "gpt-4o", "gpt-4o"),
        rel("DEPLOYED_IN", "CloudResource", "ai-foundry", "Azure AI Foundry")
      ]
    }),
    agent({
      fingerprint: "demo:prod:compliance-evidence-bot",
      name: "compliance-evidence-bot",
      category: "framework",
      owner: "grc@example.com",
      department: "Compliance",
      plane: "containerized",
      lane: "production",
      framework: "LangGraph",
      cloud_provider: "azure",
      tools: ["collect_control_evidence", "map_to_soc2", "draft_auditor_packet"],
      channels: ["Email", "SharePoint"],
      identities: ["grc@example.com"],
      dataStores: ["control-library", "evidence-vault"],
      knowledge: ["SOC2 mapping"],
      permissions: ["Files.Read.All", "Sites.Read.All"],
      dataClass: "secrets",
      relationships: [
        rel("ACCESSES", "ExternalService", "sharepoint", "SharePoint"),
        rel("INVOKES_MODEL", "Model", "gpt-4o", "gpt-4o")
      ]
    }),

    // ── Staging ──
    agent({
      fingerprint: "demo:stg:crewai-research-swarm",
      name: "research-swarm-staging",
      category: "autonomous",
      owner: "research@example.com",
      department: "Operations",
      plane: "containerized",
      lane: "staging",
      environment: "staging",
      framework: "CrewAI",
      cloud_provider: "aws",
      region: "us-east-1",
      container: "research-swarm:1.2.0-rc",
      tools: ["web_search", "summarize", "cite", "build_brief"],
      channels: ["Slack"],
      identities: ["research@example.com"],
      dataStores: ["brief-cache"],
      knowledge: ["research templates"],
      permissions: ["Internet.Browse"],
      relationships: [
        rel("INVOKES_MODEL", "Model", "gpt-4o-mini", "gpt-4o-mini"),
        rel("USES_TOOL", "Tool", "web_search", "web_search"),
        rel("DEPLOYED_IN", "CloudResource", "eks-staging", "EKS staging")
      ]
    }),
    agent({
      fingerprint: "demo:stg:marketing-campaign-agent",
      name: "marketing-campaign-agent",
      category: "framework",
      owner: "growth@example.com",
      department: "Marketing",
      plane: "containerized",
      lane: "staging",
      environment: "staging",
      framework: "LangGraph",
      cloud_provider: "gcp",
      tools: ["segment_audience", "draft_copy", "score_creative"],
      channels: ["Slack", "Email"],
      identities: ["growth@example.com"],
      dataStores: ["campaign-db"],
      knowledge: ["brand voice"],
      dataClass: "pii",
      relationships: [
        rel("INVOKES_MODEL", "Model", "gpt-4o", "gpt-4o"),
        rel("ACCESSES", "Database", "campaign-db", "campaign-db")
      ]
    }),
    agent({
      fingerprint: "demo:stg:cs-quality-reviewer",
      name: "cs-quality-reviewer",
      category: "framework",
      owner: "cx-qa@example.com",
      department: "Customer Support",
      plane: "containerized",
      lane: "staging",
      environment: "staging",
      framework: "AutoGen",
      tools: ["score_transcript", "flag_policy_gap", "suggest_coaching"],
      channels: ["Zendesk"],
      identities: ["cx-qa@example.com"],
      dataStores: ["call-transcripts"],
      dataClass: "pii",
      shadow: false,
      relationships: [
        rel("INVOKES_MODEL", "Model", "gpt-4o", "gpt-4o"),
        rel("ACCESSES", "ExternalService", "zendesk", "Zendesk")
      ]
    }),
    agent({
      fingerprint: "demo:stg:payments-recon-bot",
      name: "payments-recon-bot",
      category: "cloud",
      owner: "fintech@example.com",
      department: "Finance",
      plane: "serverless",
      lane: "staging",
      environment: "staging",
      framework: "Azure Functions + Assistants",
      deployment_type: "serverless",
      cloud_provider: "azure",
      tools: ["match_settlement", "raise_exception", "notify_treasury"],
      channels: ["Teams"],
      identities: ["fintech@example.com", "mi-payments-recon"],
      dataStores: ["settlement-files"],
      dataClass: "financial",
      relationships: [
        rel("INVOKES_MODEL", "Model", "gpt-4o", "gpt-4o"),
        rel("ACCESSES", "Database", "settlement-files", "settlement-files")
      ]
    }),
    agent({
      fingerprint: "demo:stg:flagged-ops-autopilot",
      name: "ops-autopilot-staging",
      category: "autonomous",
      owner: null,
      department: "Operations",
      plane: "containerized",
      lane: "staging",
      environment: "staging",
      framework: "CrewAI",
      tools: ["runbook_exec", "restart_service", "page_human"],
      channels: ["Slack"],
      identities: [],
      dataStores: ["runbook-store"],
      permissions: ["K8s.Pods.Delete", "Secrets.Read", "Slack.Admin"],
      shadow: true,
      relationships: [
        rel("INVOKES_MODEL", "Model", "gpt-4o-mini", "gpt-4o-mini"),
        rel("USES_TOOL", "Tool", "restart_service", "restart_service")
      ]
    }),
    agent({
      fingerprint: "demo:stg:compliance-redteam",
      name: "compliance-redteam-agent",
      category: "framework",
      owner: "grc@example.com",
      department: "Compliance",
      plane: "containerized",
      lane: "staging",
      environment: "staging",
      framework: "LangGraph",
      tools: ["probe_prompt_injection", "score_leakage", "write_finding"],
      channels: ["Slack"],
      identities: ["grc@example.com"],
      dataStores: ["redteam-results"],
      relationships: [rel("INVOKES_MODEL", "Model", "gpt-4o", "gpt-4o")]
    }),
    agent({
      fingerprint: "demo:stg:devops-canary-analyst",
      name: "canary-analyst",
      category: "framework",
      owner: "sre@example.com",
      department: "Devops",
      plane: "containerized",
      lane: "staging",
      environment: "staging",
      framework: "LangGraph",
      tools: ["compare_canary", "recommend_rollback"],
      channels: ["Slack"],
      identities: ["sre@example.com"],
      dataStores: ["prom-metrics"],
      relationships: [rel("INVOKES_MODEL", "Model", "gpt-4o-mini", "gpt-4o-mini")]
    }),
    agent({
      fingerprint: "demo:stg:dataeng-schema-migrator",
      name: "schema-migrator-agent",
      category: "framework",
      owner: "data-eng@example.com",
      department: "Data Engineering",
      plane: "containerized",
      lane: "staging",
      environment: "staging",
      framework: "CrewAI",
      tools: ["propose_migration", "validate_compat", "open_pr"],
      mcp: ["mcp-github"],
      channels: ["GitHub", "Slack"],
      identities: ["data-eng@example.com"],
      dataStores: ["staging-warehouse"],
      relationships: [
        rel("CONNECTS_MCP", "MCPServer", "mcp-github", "mcp-github"),
        rel("INVOKES_MODEL", "Model", "gpt-4o", "gpt-4o")
      ]
    }),

    // ── Development / IDE / endpoints ──
    agent({
      fingerprint: "demo:dev:cursor-mcp-agent",
      name: "Cursor Agent — Engineering Laptop",
      category: "ide",
      owner: "alex.chen@example.com",
      department: "Engineering",
      plane: "endpoint",
      lane: "development",
      environment: "development",
      model: "claude-sonnet",
      provider: "anthropic",
      framework: "cursor-agent",
      deployment_type: "ide",
      ide: "Cursor",
      hostname: "eng-laptop-01",
      tools: ["edit", "terminal", "search", "apply_patch"],
      mcp: ["filesystem", "github", "postgres"],
      channels: ["Cursor"],
      identities: ["alex.chen@example.com"],
      dataStores: ["postgres", "workspace"],
      knowledge: ["workspace"],
      permissions: ["Filesystem.ReadWrite", "GitHub.Read"],
      relationships: [
        rel("RUNS_IN", "IDE", "cursor", "Cursor"),
        rel("INVOKES_MODEL", "Model", "claude-sonnet", "claude-sonnet"),
        rel("CONNECTS_MCP", "MCPServer", "mcp-filesystem", "filesystem"),
        rel("CONNECTS_MCP", "MCPServer", "mcp-github", "github"),
        rel("OWNS", "Developer", "alex.chen", "Alex Chen")
      ]
    }),
    agent({
      fingerprint: "demo:dev:github-mcp-server",
      name: "GitHub MCP Server",
      category: "mcp",
      owner: "devex@example.com",
      department: "Engineering",
      plane: "containerized",
      lane: "development",
      environment: "development",
      framework: "MCP",
      tools: ["list_issues", "create_pr", "search_code", "review_diff"],
      channels: ["GitHub"],
      identities: ["devex@example.com"],
      dataStores: ["github-repos"],
      relationships: [
        rel("EXPOSES_TOOL", "Tool", "list_issues", "list_issues"),
        rel("ACCESSES", "ExternalService", "github", "GitHub")
      ]
    }),
    agent({
      fingerprint: "demo:dev:agents-md-playbook",
      name: "repo/agents-playbook (AGENTS.md)",
      category: "framework",
      owner: null,
      department: "Engineering",
      plane: "endpoint",
      lane: "development",
      environment: "development",
      framework: "GitHub Agents",
      repository: "github.com/example/agents-playbook",
      running_status: "unknown",
      confidence_score: 0.64,
      tools: [],
      shadow: true,
      relationships: [rel("SOURCED_FROM", "Repository", "agents-playbook", "agents-playbook")],
      extraMeta: { inventoryClass: "repo_candidate", agentMarkers: ["AGENTS.md"] }
    }),
    agent({
      fingerprint: "demo:dev:vscode-copilot-workspace",
      name: "VS Code Copilot — Platform Team",
      category: "ide",
      owner: "jordan.lee@example.com",
      department: "Engineering",
      plane: "endpoint",
      lane: "development",
      environment: "development",
      model: "gpt-4o",
      provider: "microsoft",
      framework: "GitHub Copilot",
      deployment_type: "ide",
      ide: "VS Code",
      hostname: "plat-macbook-12",
      tools: ["inline_complete", "chat", "edit_workspace"],
      channels: ["VS Code"],
      identities: ["jordan.lee@example.com"],
      knowledge: ["workspace"],
      relationships: [
        rel("RUNS_IN", "IDE", "vscode", "VS Code"),
        rel("INVOKES_MODEL", "Model", "gpt-4o", "gpt-4o")
      ]
    }),
    agent({
      fingerprint: "demo:dev:a2a-router-local",
      name: "A2A local router",
      category: "framework",
      owner: "platform-ai@example.com",
      department: "AI Platform",
      plane: "containerized",
      lane: "development",
      environment: "development",
      framework: "A2A Protocol",
      tools: ["route_task", "delegate_agent", "collect_result"],
      channels: ["A2A", "Slack"],
      identities: ["platform-ai@example.com"],
      dataStores: ["agent-registry"],
      relationships: [
        rel("USES_TOOL", "Tool", "delegate_agent", "delegate_agent"),
        rel("INVOKES_MODEL", "Model", "gpt-4o-mini", "gpt-4o-mini")
      ]
    }),
    agent({
      fingerprint: "demo:dev:risk-eval-harness",
      name: "risk-eval-harness",
      category: "framework",
      owner: "ml-risk@example.com",
      department: "Risk Management",
      plane: "containerized",
      lane: "development",
      environment: "development",
      framework: "LangGraph",
      tools: ["run_eval_suite", "score_jailbreak", "publish_report"],
      channels: ["Slack"],
      identities: ["ml-risk@example.com"],
      dataStores: ["eval-datasets"],
      relationships: [rel("INVOKES_MODEL", "Model", "gpt-4o", "gpt-4o")]
    }),
    agent({
      fingerprint: "demo:dev:security-prompt-fuzzer",
      name: "prompt-fuzzer",
      category: "framework",
      owner: "secops@example.com",
      department: "Security",
      plane: "containerized",
      lane: "development",
      environment: "development",
      framework: "CrewAI",
      tools: ["mutate_prompt", "detect_leak"],
      channels: ["Slack"],
      identities: ["secops@example.com"],
      relationships: [rel("INVOKES_MODEL", "Model", "gpt-4o-mini", "gpt-4o-mini")]
    }),

    // ── Endpoints / devices ──
    agent({
      fingerprint: "demo:ep:ollama-llama3",
      name: "Ollama llama3 — Desktop",
      category: "local_llm",
      owner: null,
      department: "Engineering",
      plane: "endpoint",
      lane: "endpoints",
      model: "llama3",
      provider: "ollama",
      deployment_type: "local",
      hostname: "dev-desktop-07",
      tools: ["local_infer"],
      shadow: true,
      running_status: "running",
      relationships: [
        rel("RUNS_ON", "Device", "dev-desktop-07", "dev-desktop-07"),
        rel("INVOKES_MODEL", "Model", "llama3", "llama3")
      ]
    }),
    agent({
      fingerprint: "demo:ep:lmstudio-mistral",
      name: "LM Studio mistral — Analyst PC",
      category: "local_llm",
      owner: "analyst@example.com",
      department: "Finance",
      plane: "endpoint",
      lane: "endpoints",
      model: "mistral-7b",
      provider: "lmstudio",
      deployment_type: "local",
      hostname: "fin-win-22",
      tools: ["local_chat"],
      relationships: [rel("RUNS_ON", "Device", "fin-win-22", "fin-win-22")]
    }),
    agent({
      fingerprint: "demo:ep:continue-dev-ext",
      name: "Continue.dev — Mobile eng laptop",
      category: "ide",
      owner: "priya.nair@example.com",
      department: "Engineering",
      plane: "endpoint",
      lane: "endpoints",
      framework: "Continue",
      deployment_type: "ide",
      ide: "JetBrains",
      hostname: "mobile-mbp-09",
      tools: ["complete", "chat"],
      relationships: [rel("RUNS_ON", "Device", "mobile-mbp-09", "mobile-mbp-09")]
    }),
    agent({
      fingerprint: "demo:ep:shadow-chatgpt-desktop",
      name: "ChatGPT Desktop — unsanctioned",
      category: "browser",
      owner: null,
      department: "Sales",
      plane: "endpoint",
      lane: "endpoints",
      model: "gpt-4o",
      provider: "openai",
      deployment_type: "local",
      hostname: "sales-laptop-44",
      shadow: true,
      tools: ["chat", "file_upload"],
      relationships: [rel("RUNS_ON", "Device", "sales-laptop-44", "sales-laptop-44")]
    }),
    agent({
      fingerprint: "demo:ep:claude-desktop",
      name: "Claude Desktop — Design workstation",
      category: "local_llm",
      owner: "design@example.com",
      department: "Marketing",
      plane: "endpoint",
      lane: "endpoints",
      model: "claude-sonnet",
      provider: "anthropic",
      hostname: "design-imac-03",
      tools: ["chat", "projects"],
      relationships: [rel("RUNS_ON", "Device", "design-imac-03", "design-imac-03")]
    }),
    agent({
      fingerprint: "demo:ep:windsurf-cascade",
      name: "Windsurf Cascade — SRE laptop",
      category: "ide",
      owner: "sre@example.com",
      department: "Devops",
      plane: "endpoint",
      lane: "endpoints",
      framework: "Windsurf",
      ide: "Windsurf",
      hostname: "sre-linux-02",
      tools: ["cascade_edit", "terminal"],
      mcp: ["filesystem"],
      relationships: [
        rel("RUNS_IN", "IDE", "windsurf", "Windsurf"),
        rel("CONNECTS_MCP", "MCPServer", "mcp-filesystem", "filesystem")
      ]
    }),
    agent({
      fingerprint: "demo:ep:eddie-browser-agent",
      name: "Browser extension AI helper",
      category: "browser",
      owner: null,
      department: "Customer Support",
      plane: "endpoint",
      lane: "endpoints",
      shadow: true,
      hostname: "cx-chrome-profile-18",
      tools: ["summarize_page", "draft_reply"],
      relationships: [rel("RUNS_ON", "Device", "cx-chrome-profile-18", "cx-chrome-profile-18")]
    }),
    agent({
      fingerprint: "demo:ep:raycast-ai",
      name: "Raycast AI — PM laptop",
      category: "ide",
      owner: "pm@example.com",
      department: "Product",
      plane: "endpoint",
      lane: "endpoints",
      hostname: "pm-macbook-05",
      tools: ["quick_ai", "rewrite"],
      relationships: [rel("RUNS_ON", "Device", "pm-macbook-05", "pm-macbook-05")]
    }),

    // ── SaaS / third-party (incl. shadow) ──
    agent({
      fingerprint: "demo:saas:m365-copilot",
      name: "Microsoft 365 Copilot — Contoso Tenant",
      category: "saas",
      owner: "it-admin@example.com",
      department: "IT",
      plane: "saas_third_party",
      lane: "saas",
      framework: "M365 Copilot",
      deployment_type: "saas",
      provider: "microsoft",
      cloud_provider: "azure",
      model: "gpt-4o",
      tools: ["draft_email", "summarize", "search_files", "schedule_meeting"],
      channels: ["Teams", "Outlook", "Word"],
      identities: ["it-admin@example.com", "Copilot-ServicePrincipal"],
      dataStores: ["SharePoint", "OneDrive"],
      knowledge: ["SharePoint", "OneDrive", "Outlook"],
      permissions: ["Mail.Read", "Files.Read.All", "Sites.Read.All", "User.Read", "Calendars.Read"],
      dataClass: "pii",
      relationships: [
        rel("INVOKES_MODEL", "Model", "copilot-gpt", "gpt-4o"),
        rel("ACCESSES", "ExternalService", "m365", "Microsoft 365"),
        rel("OWNS", "Developer", "it-admin", "it-admin@example.com"),
        rel("USES_IDENTITY", "ServicePrincipal", "copilot-sp", "Copilot-ServicePrincipal")
      ]
    }),
    agent({
      fingerprint: "demo:saas:chatgpt-enterprise",
      name: "ChatGPT Enterprise workspace",
      category: "browser",
      owner: "marketing@example.com",
      department: "Marketing",
      plane: "saas_third_party",
      lane: "saas",
      deployment_type: "saas",
      provider: "openai",
      model: "gpt-4o",
      tools: ["browse", "analyze", "generate"],
      channels: ["web"],
      identities: ["marketing@example.com"],
      knowledge: ["uploaded_files"],
      relationships: [
        rel("INVOKES_MODEL", "Model", "chatgpt-gpt4o", "gpt-4o"),
        rel("PROVIDED_BY", "Provider", "openai", "OpenAI"),
        rel("OWNS", "Developer", "marketing", "marketing@example.com")
      ]
    }),
    agent({
      fingerprint: "demo:saas:glean-assistant",
      name: "Glean enterprise assistant",
      category: "saas",
      owner: "knowledge@example.com",
      department: "IT",
      plane: "saas_third_party",
      lane: "saas",
      framework: "Glean",
      deployment_type: "saas",
      tools: ["enterprise_search", "answer_with_citations"],
      channels: ["Slack", "web"],
      identities: ["knowledge@example.com"],
      dataStores: ["glean-index"],
      knowledge: ["intranet", "drive", "tickets"],
      dataClass: "pii",
      relationships: [
        rel("ACCESSES", "ExternalService", "glean", "Glean"),
        rel("INVOKES_MODEL", "Model", "gpt-4o", "gpt-4o")
      ]
    }),
    agent({
      fingerprint: "demo:saas:copilot-studio-booking",
      name: "Copilot Studio — Booking concierge",
      category: "saas",
      owner: "cx-ops@example.com",
      department: "Customer Support",
      plane: "saas_third_party",
      lane: "saas",
      framework: "Copilot Studio",
      deployment_type: "saas",
      provider: "microsoft",
      tools: ["check_availability", "create_booking", "send_confirmation"],
      channels: ["Teams", "web"],
      identities: ["cx-ops@example.com", "sp-booking-bot"],
      dataStores: ["booking-calendar"],
      dataClass: "pii",
      relationships: [
        rel("ACCESSES", "ExternalService", "m365", "Microsoft 365"),
        rel("INVOKES_MODEL", "Model", "gpt-4o", "gpt-4o")
      ]
    }),
    agent({
      fingerprint: "demo:saas:copilot-cowork-shadow",
      name: "Copilot Cowork — unsanctioned workspace",
      category: "saas",
      owner: null,
      department: "Sales",
      plane: "saas_third_party",
      lane: "saas",
      framework: "Copilot Cowork",
      deployment_type: "saas",
      shadow: true,
      tools: ["draft_proposal", "share_files"],
      channels: ["web"],
      identities: [],
      dataStores: ["shared-uploads"],
      dataClass: "pii",
      relationships: [rel("INVOKES_MODEL", "Model", "gpt-4o", "gpt-4o")]
    }),
    agent({
      fingerprint: "demo:saas:shadow-slack-bot",
      name: "Shadow Slack Bot — Sales Autopilot",
      category: "saas",
      owner: null,
      department: "Sales",
      plane: "saas_third_party",
      lane: "saas",
      framework: "custom-bot",
      deployment_type: "saas",
      provider: "slack",
      model: "gpt-4o-mini",
      shadow: true,
      tools: ["post_message", "read_channel", "crm_lookup"],
      channels: ["#sales-autopilot"],
      identities: [],
      permissions: ["channels:history", "chat:write"],
      dataClass: "pii",
      relationships: [
        rel("ACCESSES", "ExternalService", "slack", "Slack"),
        rel("INVOKES_MODEL", "Model", "gpt-4o-mini", "gpt-4o-mini")
      ]
    }),
    agent({
      fingerprint: "demo:saas:salesforce-agentforce",
      name: "Salesforce Agentforce — Opportunity coach",
      category: "saas",
      owner: "revops@example.com",
      department: "Sales",
      plane: "saas_third_party",
      lane: "saas",
      framework: "Agentforce",
      deployment_type: "saas",
      provider: "salesforce",
      tools: ["coach_rep", "summarize_account", "next_best_action"],
      channels: ["Salesforce"],
      identities: ["revops@example.com"],
      dataStores: ["salesforce-crm"],
      dataClass: "pii",
      relationships: [
        rel("ACCESSES", "ExternalService", "salesforce", "Salesforce"),
        rel("INVOKES_MODEL", "Model", "gpt-4o", "gpt-4o")
      ]
    }),
    agent({
      fingerprint: "demo:saas:servicenow-now-assist",
      name: "ServiceNow Now Assist — ITSM",
      category: "saas",
      owner: "itsm@example.com",
      department: "IT",
      plane: "saas_third_party",
      lane: "saas",
      framework: "Now Assist",
      deployment_type: "saas",
      tools: ["summarize_incident", "suggest_resolution", "update_ticket"],
      channels: ["ServiceNow"],
      identities: ["itsm@example.com"],
      dataStores: ["incident-table"],
      dataClass: "pii",
      relationships: [
        rel("ACCESSES", "ExternalService", "servicenow", "ServiceNow"),
        rel("INVOKES_MODEL", "Model", "gpt-4o", "gpt-4o")
      ]
    }),
    agent({
      fingerprint: "demo:saas:notion-ai",
      name: "Notion AI — Product wiki",
      category: "saas",
      owner: "pm@example.com",
      department: "Product",
      plane: "saas_third_party",
      lane: "saas",
      framework: "Notion AI",
      deployment_type: "saas",
      shadow: true,
      tools: ["summarize_page", "draft_spec"],
      channels: ["Notion"],
      identities: ["pm@example.com"],
      dataStores: ["product-wiki"],
      relationships: [rel("ACCESSES", "ExternalService", "notion", "Notion")]
    }),
    agent({
      fingerprint: "demo:saas:azure-openai-crm",
      name: "Azure OpenAI Customer Assistant",
      category: "cloud",
      owner: "crm-ops@example.com",
      department: "Customer Success",
      plane: "saas_third_party",
      lane: "saas",
      framework: "Azure OpenAI Assistants",
      deployment_type: "saas",
      provider: "azure",
      cloud_provider: "azure",
      region: "eastus",
      tools: ["lookup_customer", "draft_reply"],
      channels: ["Email", "CRM"],
      identities: ["crm-ops@example.com"],
      dataStores: ["CRM contacts"],
      knowledge: ["CRM contacts", "customer tickets"],
      permissions: ["Contacts.Read", "Mail.Read"],
      dataClass: "pii",
      relationships: [
        rel("INVOKES_MODEL", "Model", "gpt-4o-azure", "gpt-4o"),
        rel("DEPLOYED_IN", "CloudResource", "aoai-eastus", "Azure OpenAI")
      ]
    }),

    // Extra production density for mesh feel
    agent({
      fingerprint: "demo:prod:general-meeting-notes",
      name: "meeting-notes-compiler",
      category: "framework",
      owner: "ea@example.com",
      department: "General",
      plane: "containerized",
      lane: "production",
      framework: "LangGraph",
      tools: ["transcribe", "extract_actions", "post_summary"],
      channels: ["Teams", "Email"],
      identities: ["ea@example.com"],
      dataStores: ["meeting-recordings"],
      dataClass: "pii",
      relationships: [rel("INVOKES_MODEL", "Model", "gpt-4o", "gpt-4o")]
    }),
    agent({
      fingerprint: "demo:prod:logistics-slotting",
      name: "warehouse-slotting-agent",
      category: "autonomous",
      owner: "dean.diasti@example.com",
      department: "Logistics",
      plane: "containerized",
      lane: "production",
      framework: "CrewAI",
      cloud_provider: "gcp",
      tools: ["optimize_slots", "publish_pick_path"],
      channels: ["Slack"],
      identities: ["dean.diasti@example.com", "sp-slotting"],
      dataStores: ["wms-inventory"],
      relationships: [
        rel("INVOKES_MODEL", "Model", "gpt-4o-mini", "gpt-4o-mini"),
        rel("ACCESSES", "Database", "wms-inventory", "WMS inventory")
      ]
    }),
    agent({
      fingerprint: "demo:dev:security-codeql-agent",
      name: "codeql-fixing-agent",
      category: "framework",
      owner: "appsec@example.com",
      department: "Security",
      plane: "containerized",
      lane: "development",
      environment: "development",
      framework: "LangGraph",
      tools: ["run_codeql", "triage_sarif", "open_security_pr"],
      mcp: ["mcp-github"],
      channels: ["GitHub", "Slack"],
      identities: ["appsec@example.com"],
      relationships: [
        rel("CONNECTS_MCP", "MCPServer", "mcp-github", "mcp-github"),
        rel("INVOKES_MODEL", "Model", "gpt-4o", "gpt-4o")
      ]
    }),
    agent({
      fingerprint: "demo:dev:marketing-seo-agent",
      name: "seo-content-agent",
      category: "framework",
      owner: "growth@example.com",
      department: "Marketing",
      plane: "containerized",
      lane: "development",
      environment: "development",
      framework: "CrewAI",
      tools: ["keyword_cluster", "draft_outline", "score_readability"],
      channels: ["Slack"],
      identities: ["growth@example.com"],
      relationships: [rel("INVOKES_MODEL", "Model", "gpt-4o-mini", "gpt-4o-mini")]
    }),
    agent({
      fingerprint: "demo:stg:cs-voice-bot",
      name: "voice-intake-bot",
      category: "cloud",
      owner: "cx-ops@example.com",
      department: "Customer Support",
      plane: "serverless",
      lane: "staging",
      environment: "staging",
      framework: "Azure AI Speech + Agents",
      deployment_type: "serverless",
      cloud_provider: "azure",
      tools: ["transcribe_call", "intent_route", "create_case"],
      channels: ["Phone", "ServiceNow"],
      identities: ["cx-ops@example.com"],
      dataStores: ["call-audio"],
      dataClass: "pii",
      relationships: [
        rel("INVOKES_MODEL", "Model", "gpt-4o", "gpt-4o"),
        rel("ACCESSES", "ExternalService", "servicenow", "ServiceNow")
      ]
    })
  ];

  // Stale shadow for change-intelligence demos
  const stale = agent({
    fingerprint: "demo:saas:stale-shadow-bot",
    name: "Shadow Slack Bot — Sales Autopilot (stale)",
    category: "saas",
    owner: null,
    department: "Sales",
    plane: "saas_third_party",
    lane: "saas",
    framework: "custom-bot",
    deployment_type: "saas",
    provider: "slack",
    model: "gpt-4o-mini",
    shadow: true,
    tools: ["post_message", "read_channel"],
    channels: ["#sales-autopilot"],
    running_status: "unknown",
    confidence_score: 0.58,
    relationships: [
      rel("ACCESSES", "ExternalService", "slack", "Slack"),
      rel("INVOKES_MODEL", "Model", "gpt-4o-mini", "gpt-4o-mini")
    ]
  });
  stale.last_seen = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
  stale.first_discovered = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString();

  return [...fleet, stale];
}
