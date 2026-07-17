/**
 * Demo / seed collector — rich multi-category inventory for local MVP UX.
 * Enabled only when DISCOVERY_DEMO_SEED=true (compose default). Never on in production.
 */

export function demoSeedEnabled() {
  return String(process.env.DISCOVERY_DEMO_SEED || "").toLowerCase() === "true";
}

/** Attach explicit Global Agent Mesh plane + lane labels (high confidence). */
function withMesh(meta, agentPlane, environmentLane, environment) {
  return {
    ...meta,
    ...(environment ? { environment } : {}),
    agentPlane,
    environmentLane,
    meshConfidence: "high",
    mesh: {
      agentPlane,
      environmentLane,
      confidence: "high"
    }
  };
}

/**
 * @returns {Array<Record<string, unknown>>}
 */
export function buildDemoObservations() {
  const now = new Date().toISOString();
  return [
    {
      collector_id: "demo",
      fingerprint: "demo:ide:cursor-mcp-agent",
      name: "Cursor Agent — Engineering Laptop",
      category: "ide",
      owner: "alex.chen@example.com",
      hostname: "eng-laptop-01",
      operating_system: "macOS 14",
      department: "Engineering",
      business_unit: "Product",
      ide: "Cursor",
      provider: "cursor",
      model: "claude-sonnet",
      framework: "cursor-agent",
      deployment_type: "ide",
      mcp_connections: ["filesystem", "github", "postgres"],
      tools: ["edit", "terminal", "search"],
      running_status: "running",
      confidence_score: 0.92,
      filesystem_access: true,
      github_access: true,
      internet_access: true,
      relationships: [
        { rel_type: "RUNS_IN", to_type: "IDE", to_key: "cursor", to_name: "Cursor" },
        { rel_type: "INVOKES_MODEL", to_type: "Model", to_key: "claude-sonnet", to_name: "claude-sonnet" },
        { rel_type: "CONNECTS_MCP", to_type: "MCPServer", to_key: "mcp-filesystem", to_name: "filesystem" },
        { rel_type: "OWNS", to_type: "Developer", to_key: "alex.chen", to_name: "Alex Chen" }
      ],
      metadata: withMesh(
        {
          aiRelevant: true,
          inventoryClass: "ide_ai_agent",
          evidenceClass: "ide_agent",
          agentStatus: "confirmed",
          demoSeed: true,
          howIdentified: "Demo seed — Cursor + MCP",
          hasInstructions: true,
          agentConfig: {
            tools: ["edit", "terminal", "search"],
            mcpServers: ["filesystem", "github", "postgres"],
            knowledgeSources: ["workspace"],
            triggers: [],
            memoryStores: [],
            instructionsPresent: true,
            instructionSource: "cursor_rules",
            howConfigured: "Cursor MCP + rules"
          },
          agentAccess: {
            scopes: { filesystem: true, github: true, internet: true, mcp: true, database: true },
            identities: ["alex.chen@example.com"],
            dataStores: ["postgres"],
            connectedApps: ["Cursor", "GitHub"]
          }
        },
        "endpoint",
        "development",
        "development"
      ),
      last_seen: now
    },
    {
      collector_id: "demo",
      fingerprint: "demo:framework:langgraph-support",
      name: "LangGraph Support Triage Agent",
      category: "framework",
      owner: "platform-ai@example.com",
      hostname: "k8s-worker-12",
      department: "AI Platform",
      business_unit: "Platform",
      framework: "LangGraph",
      programming_language: "Python",
      model: "gpt-4o",
      provider: "openai",
      repository: "github.com/example/support-agent",
      deployment_type: "container",
      container: "support-agent:1.4.2",
      cloud_provider: "aws",
      region: "us-east-1",
      running_status: "running",
      confidence_score: 0.88,
      tools: ["ticket_lookup", "kb_search", "escalate"],
      database_access: true,
      vector_database: "pinecone",
      relationships: [
        { rel_type: "INVOKES_MODEL", to_type: "Model", to_key: "gpt-4o", to_name: "gpt-4o" },
        { rel_type: "PROVIDED_BY", to_type: "Provider", to_key: "openai", to_name: "OpenAI" },
        { rel_type: "DEPLOYED_IN", to_type: "CloudResource", to_key: "aws-eks", to_name: "EKS cluster" },
        { rel_type: "SOURCED_FROM", to_type: "Repository", to_key: "support-agent", to_name: "support-agent" }
      ],
      metadata: withMesh(
        {
          aiRelevant: true,
          inventoryClass: "framework_agent",
          evidenceClass: "process_agent",
          agentStatus: "confirmed",
          demoSeed: true
        },
        "containerized",
        "production",
        "production"
      ),
      last_seen: now
    },
    {
      collector_id: "demo",
      fingerprint: "demo:cloud:azure-openai-assistant",
      name: "Azure OpenAI Customer Assistant",
      category: "cloud",
      owner: "crm-ops@example.com",
      department: "Customer Success",
      business_unit: "Go-to-Market",
      model: "gpt-4o",
      provider: "azure",
      cloud_provider: "azure",
      region: "eastus",
      framework: "Azure OpenAI Assistants",
      deployment_type: "saas",
      endpoint: "https://example.openai.azure.com",
      running_status: "running",
      confidence_score: 0.9,
      internet_access: true,
      relationships: [
        { rel_type: "INVOKES_MODEL", to_type: "Model", to_key: "gpt-4o-azure", to_name: "gpt-4o" },
        { rel_type: "DEPLOYED_IN", to_type: "CloudResource", to_key: "aoai-eastus", to_name: "Azure OpenAI" }
      ],
      metadata: withMesh(
        {
          aiRelevant: true,
          inventoryClass: "ai_cloud_resource",
          evidenceClass: "cloud_ai_runtime",
          agentStatus: "confirmed",
          demoSeed: true,
          managedCloudAgent: true,
          howIdentified: "Demo seed — Azure OpenAI CRM assistant",
          agentConfig: {
            tools: ["lookup_customer", "draft_reply"],
            knowledgeSources: ["CRM contacts", "customer tickets"],
            authMode: "managed_identity",
            platform: "azure_openai",
            instructionsPresent: true,
            howConfigured: "Azure OpenAI Assistants"
          },
          agentAccess: {
            scopes: { internet: true, crm: true, email: true },
            identities: ["crm-ops@example.com"],
            dataStores: ["CRM contacts"],
            connectedApps: ["Azure OpenAI", "CRM"],
            permissions: ["Contacts.Read", "Mail.Read"]
          },
          dataClasses: ["pii"],
          primaryDataClass: "pii"
        },
        "saas_third_party",
        "saas"
      ),
      last_seen: now
    },
    {
      collector_id: "demo",
      fingerprint: "demo:mcp:github-mcp-server",
      name: "GitHub MCP Server",
      category: "mcp",
      owner: "devex@example.com",
      department: "Developer Experience",
      provider: "mcp",
      model: "mcp",
      tools: ["list_issues", "create_pr", "search_code"],
      running_status: "running",
      confidence_score: 0.86,
      github_access: true,
      relationships: [
        { rel_type: "EXPOSES_TOOL", to_type: "Tool", to_key: "list_issues", to_name: "list_issues" },
        { rel_type: "ACCESSES", to_type: "ExternalService", to_key: "github", to_name: "GitHub" }
      ],
      metadata: withMesh(
        {
          aiRelevant: true,
          inventoryClass: "mcp_server",
          evidenceClass: "ide_agent",
          agentStatus: "confirmed",
          demoSeed: true
        },
        "containerized",
        "development",
        "development"
      ),
      last_seen: now
    },
    {
      collector_id: "demo",
      fingerprint: "demo:local_llm:ollama-llama3",
      name: "Ollama llama3 — Desktop",
      category: "local_llm",
      owner: null,
      hostname: "dev-desktop-07",
      operating_system: "Linux",
      department: "Engineering",
      model: "llama3",
      provider: "ollama",
      ide: null,
      deployment_type: "local",
      running_status: "running",
      confidence_score: 0.8,
      filesystem_access: true,
      relationships: [
        { rel_type: "RUNS_ON", to_type: "Device", to_key: "dev-desktop-07", to_name: "dev-desktop-07" },
        { rel_type: "INVOKES_MODEL", to_type: "Model", to_key: "llama3", to_name: "llama3" }
      ],
      metadata: withMesh(
        {
          aiRelevant: true,
          inventoryClass: "process_ai_agent",
          evidenceClass: "process_agent",
          agentStatus: "confirmed",
          demoSeed: true,
          shadowAi: true
        },
        "endpoint",
        "endpoints"
      ),
      risk_indicators: ["shadow", "unmanaged", "ownerless"],
      last_seen: now
    },
    {
      collector_id: "demo",
      fingerprint: "demo:saas:m365-copilot",
      name: "Microsoft 365 Copilot — Contoso Tenant",
      category: "saas",
      owner: "it-admin@example.com",
      department: "IT",
      business_unit: "Corporate",
      provider: "microsoft",
      model: "gpt-4o",
      framework: "M365 Copilot",
      cloud_provider: "azure",
      deployment_type: "saas",
      running_status: "running",
      confidence_score: 0.91,
      email_access: true,
      relationships: [
        { rel_type: "INVOKES_MODEL", to_type: "Model", to_key: "copilot-gpt", to_name: "gpt-4o" },
        { rel_type: "ACCESSES", to_type: "ExternalService", to_key: "m365", to_name: "Microsoft 365" },
        { rel_type: "OWNS", to_type: "Developer", to_key: "it-admin", to_name: "it-admin@example.com" },
        { rel_type: "USES_IDENTITY", to_type: "ServicePrincipal", to_key: "copilot-sp", to_name: "Copilot-ServicePrincipal" }
      ],
      metadata: withMesh(
        {
          aiRelevant: true,
          inventoryClass: "saas_platform_agent",
          evidenceClass: "platform_agent",
          agentStatus: "confirmed",
          demoSeed: true,
          hasInstructions: true,
          howIdentified: "Demo seed — M365 Copilot",
          agentConfig: {
            tools: ["draft_email", "summarize", "search_files"],
            knowledgeSources: ["SharePoint", "OneDrive", "Outlook"],
            triggers: ["user_prompt"],
            channels: ["Teams", "Outlook", "Word"],
            authMode: "entra_sso",
            platform: "m365_copilot",
            instructionsPresent: true,
            instructionSource: "copilot_studio",
            howConfigured: "M365 Copilot tenant config"
          },
          agentAccess: {
            scopes: { email: true, sharepoint: true, internet: true, identity: true, calendar: true },
            identities: ["it-admin@example.com", "Copilot-ServicePrincipal"],
            dataStores: ["SharePoint", "OneDrive"],
            connectedApps: ["Microsoft 365"],
            permissions: ["Mail.Read", "Files.Read.All", "Sites.Read.All", "User.Read", "Calendars.Read"]
          },
          dataClasses: ["pii"],
          primaryDataClass: "pii",
          dataAccessClassification: {
            dataClasses: ["pii"],
            primaryDataClass: "pii",
            confidence: "high",
            evidence: [
              { source: "entitlement", signal: "Mail.Read", detail: "PII-related entitlement: Mail.Read" },
              { source: "knowledge", signal: "SharePoint", detail: "Knowledge/data store suggests PII: SharePoint" }
            ]
          },
          ownership: {
            owner: "it-admin@example.com",
            identities: ["it-admin@example.com", "Copilot-ServicePrincipal"],
            identityProvider: "entra",
            ownershipStatus: "owned",
            team: "IT"
          },
          ownershipStatus: "owned",
          authMode: "entra_sso",
          channels: ["Teams", "Outlook", "Word"]
        },
        "saas_third_party",
        "saas"
      ),
      last_seen: now
    },
    {
      collector_id: "demo",
      fingerprint: "demo:browser:chatgpt-enterprise",
      name: "ChatGPT Enterprise workspace",
      category: "browser",
      owner: "marketing@example.com",
      department: "Marketing",
      provider: "openai",
      model: "gpt-4o",
      ide: "ChatGPT",
      deployment_type: "saas",
      running_status: "unknown",
      confidence_score: 0.7,
      internet_access: true,
      relationships: [
        { rel_type: "INVOKES_MODEL", to_type: "Model", to_key: "chatgpt-gpt4o", to_name: "gpt-4o" },
        { rel_type: "PROVIDED_BY", to_type: "Provider", to_key: "openai", to_name: "OpenAI" },
        { rel_type: "OWNS", to_type: "Developer", to_key: "marketing", to_name: "marketing@example.com" }
      ],
      metadata: withMesh(
        {
          aiRelevant: true,
          inventoryClass: "saas_browser_agent",
          evidenceClass: "platform_agent",
          agentStatus: "candidate",
          demoSeed: true,
          howIdentified: "Demo seed — ChatGPT Enterprise",
          agentConfig: {
            tools: ["browse", "analyze", "generate"],
            knowledgeSources: ["uploaded_files"],
            channels: ["web"],
            authMode: "workspace_sso",
            platform: "openai",
            instructionsPresent: false,
            howConfigured: "ChatGPT Enterprise workspace"
          },
          agentAccess: {
            scopes: { internet: true, identity: true },
            identities: ["marketing@example.com"],
            connectedApps: ["ChatGPT Enterprise"]
          },
          ownership: {
            owner: "marketing@example.com",
            ownershipStatus: "owned",
            identityProvider: "openai",
            team: "Marketing"
          },
          ownershipStatus: "owned"
        },
        "saas_third_party",
        "saas"
      ),
      last_seen: now
    },
    {
      collector_id: "demo",
      fingerprint: "demo:saas:stale-shadow-bot",
      name: "Shadow Slack Bot — Sales Autopilot (stale)",
      category: "saas",
      owner: null,
      department: "Sales",
      provider: "slack",
      model: "gpt-4o-mini",
      framework: "custom-bot",
      deployment_type: "saas",
      running_status: "unknown",
      confidence_score: 0.62,
      internet_access: true,
      relationships: [
        { rel_type: "ACCESSES", to_type: "ExternalService", to_key: "slack", to_name: "Slack" },
        { rel_type: "INVOKES_MODEL", to_type: "Model", to_key: "gpt-4o-mini", to_name: "gpt-4o-mini" }
      ],
      metadata: withMesh(
        {
          aiRelevant: true,
          inventoryClass: "saas_platform_agent",
          evidenceClass: "platform_agent",
          agentStatus: "candidate",
          demoSeed: true,
          shadowAi: true,
          howIdentified: "Demo seed — stale unsanctioned Slack bot",
          agentConfig: {
            tools: ["post_message", "read_channel"],
            channels: ["#sales-autopilot"],
            authMode: "bot_token",
            platform: "slack",
            instructionsPresent: true,
            instructionSource: "bot_manifest",
            howConfigured: "Unofficial Slack bot"
          },
          agentAccess: {
            scopes: { internet: true, slack: true },
            identities: [],
            connectedApps: ["Slack"]
          },
          ownership: { owner: null, ownershipStatus: "ownerless", team: "Sales" },
          ownershipStatus: "ownerless"
        },
        "saas_third_party",
        "saas"
      ),
      // Stale last_seen so Change Intelligence marks it disappeared in a 7-day window
      last_seen: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(),
      first_discovered: new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString()
    },
    {
      collector_id: "demo",
      fingerprint: "demo:container:bedrock-agent-runtime",
      name: "Bedrock Agent — Claims Workflow",
      category: "cloud",
      owner: "claims-eng@example.com",
      department: "Insurance Ops",
      cloud_provider: "aws",
      region: "us-west-2",
      framework: "Bedrock Agents",
      model: "anthropic.claude-3-sonnet",
      provider: "aws",
      container: "bedrock-agent-runtime",
      deployment_type: "serverless",
      running_status: "running",
      confidence_score: 0.89,
      database_access: true,
      relationships: [
        { rel_type: "INVOKES_MODEL", to_type: "Model", to_key: "claude-3-sonnet", to_name: "claude-3-sonnet" },
        { rel_type: "DEPLOYED_IN", to_type: "CloudResource", to_key: "bedrock-usw2", to_name: "Amazon Bedrock" },
        { rel_type: "ACCESSES", to_type: "Database", to_key: "claims-ehr", to_name: "Claims EHR store" }
      ],
      metadata: withMesh(
        {
          aiRelevant: true,
          inventoryClass: "ai_cloud_resource",
          evidenceClass: "cloud_ai_runtime",
          agentStatus: "confirmed",
          demoSeed: true,
          managedCloudAgent: true,
          howIdentified: "Demo seed — Bedrock claims / PHI",
          hasInstructions: true,
          agentConfig: {
            tools: ["lookup_claim", "read_clinical_note", "summarize_encounter"],
            knowledgeSources: ["patient-claims-db", "clinical-notes-ehr", "FHIR Patient API"],
            triggers: ["claim_submitted"],
            authMode: "iam_role",
            platform: "bedrock",
            instructionsPresent: true,
            instructionSource: "bedrock_agent_instruction",
            howConfigured: "Bedrock Agents + EHR connector"
          },
          agentAccess: {
            scopes: { database: true, internet: true, phi: true, ehr: true },
            identities: ["claims-eng@example.com"],
            dataStores: ["patient-claims-db", "clinical-notes-ehr"],
            connectedApps: ["Amazon Bedrock", "EHR"],
            permissions: ["FHIR.Patient.Read", "EHR.Clinical.Read", "Claims.Read"]
          },
          dataClasses: ["phi", "pii"],
          primaryDataClass: "phi",
          dataAccessClassification: {
            dataClasses: ["phi", "pii"],
            primaryDataClass: "phi",
            confidence: "high",
            evidence: [
              { source: "entitlement", signal: "FHIR.Patient.Read", detail: "PHI-related entitlement: FHIR.Patient.Read" },
              { source: "knowledge", signal: "clinical-notes-ehr", detail: "Knowledge/data store suggests PHI: clinical-notes-ehr" }
            ]
          }
        },
        "serverless",
        "production",
        "production"
      ),
      last_seen: now
    },
    {
      collector_id: "demo",
      fingerprint: "demo:saas:workday-hr-copilot",
      name: "Workday HR Copilot — Employee Self-Service",
      category: "saas",
      owner: "hr-ops@example.com",
      department: "Human Resources",
      business_unit: "Corporate",
      provider: "workday",
      model: "gpt-4o",
      framework: "Workday AI",
      deployment_type: "saas",
      running_status: "running",
      confidence_score: 0.9,
      email_access: true,
      relationships: [
        { rel_type: "ACCESSES", to_type: "ExternalService", to_key: "workday", to_name: "Workday" },
        { rel_type: "INVOKES_MODEL", to_type: "Model", to_key: "gpt-4o", to_name: "gpt-4o" },
        { rel_type: "OWNS", to_type: "Developer", to_key: "hr-ops", to_name: "hr-ops@example.com" }
      ],
      metadata: withMesh(
        {
          aiRelevant: true,
          inventoryClass: "saas_platform_agent",
          evidenceClass: "platform_agent",
          agentStatus: "confirmed",
          demoSeed: true,
          howIdentified: "Demo seed — Workday HR / PII",
          hasInstructions: true,
          agentConfig: {
            tools: ["lookup_worker", "update_time_off", "answer_policy"],
            knowledgeSources: ["HR employee directory", "payroll summaries", "benefits handbook"],
            channels: ["Workday", "email"],
            authMode: "oauth",
            platform: "workday",
            instructionsPresent: true,
            howConfigured: "Workday AI assistant"
          },
          agentAccess: {
            scopes: { email: true, crm: true, identity: true, internet: true },
            identities: ["hr-ops@example.com"],
            dataStores: ["HR employee directory", "payroll summaries"],
            connectedApps: ["Workday"],
            permissions: ["Worker.Read", "Directory.Read", "Payroll.Read"]
          },
          dataClasses: ["pii", "financial"],
          primaryDataClass: "pii",
          dataAccessClassification: {
            dataClasses: ["pii", "financial"],
            primaryDataClass: "pii",
            confidence: "high",
            evidence: [
              { source: "knowledge", signal: "HR employee directory", detail: "Knowledge/data store suggests PII: HR employee directory" },
              { source: "entitlement", signal: "Payroll.Read", detail: "Financial entitlement: Payroll.Read" }
            ]
          },
          ownership: {
            owner: "hr-ops@example.com",
            ownershipStatus: "owned",
            identityProvider: "workday",
            team: "Human Resources"
          },
          ownershipStatus: "owned"
        },
        "saas_third_party",
        "saas"
      ),
      last_seen: now
    },
    {
      collector_id: "demo",
      fingerprint: "demo:repo:github-agents-md",
      name: "repo/agents-playbook (AGENTS.md)",
      category: "framework",
      owner: null,
      repository: "github.com/example/agents-playbook",
      framework: "GitHub Agents",
      provider: "github",
      programming_language: "TypeScript",
      running_status: "unknown",
      confidence_score: 0.62,
      relationships: [
        { rel_type: "SOURCED_FROM", to_type: "Repository", to_key: "agents-playbook", to_name: "agents-playbook" }
      ],
      metadata: withMesh(
        {
          aiRelevant: true,
          inventoryClass: "repo_candidate",
          evidenceClass: "repo_candidate",
          agentStatus: "candidate",
          demoSeed: true,
          agentMarkers: ["AGENTS.md", ".github/copilot-instructions.md"]
        },
        "endpoint",
        "development",
        "development"
      ),
      risk_indicators: ["unmanaged"],
      last_seen: now
    },
    {
      collector_id: "demo",
      fingerprint: "demo:autonomous:crewai-research",
      name: "CrewAI Research Swarm",
      category: "autonomous",
      owner: "research@example.com",
      department: "R&D",
      framework: "CrewAI",
      model: "gpt-4o-mini",
      provider: "openai",
      programming_language: "Python",
      repository: "github.com/example/research-swarm",
      deployment_type: "container",
      container: "research-swarm:0.9.1",
      running_status: "scheduled",
      confidence_score: 0.84,
      tools: ["web_search", "summarize", "cite"],
      internet_access: true,
      relationships: [
        { rel_type: "INVOKES_MODEL", to_type: "Model", to_key: "gpt-4o-mini", to_name: "gpt-4o-mini" },
        { rel_type: "USES_TOOL", to_type: "Tool", to_key: "web_search", to_name: "web_search" }
      ],
      metadata: withMesh(
        {
          aiRelevant: true,
          inventoryClass: "framework_agent",
          evidenceClass: "process_agent",
          agentStatus: "confirmed",
          demoSeed: true
        },
        "containerized",
        "staging",
        "staging"
      ),
      last_seen: now
    }
  ];
}
