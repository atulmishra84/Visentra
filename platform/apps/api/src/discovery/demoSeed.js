/**
 * Demo / seed collector — rich multi-category inventory for local MVP UX.
 * Enabled only when DISCOVERY_DEMO_SEED=true (compose default). Never on in production.
 */

export function demoSeedEnabled() {
  return String(process.env.DISCOVERY_DEMO_SEED || "").toLowerCase() === "true";
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
      metadata: {
        aiRelevant: true,
        inventoryClass: "ide_ai_agent",
        evidenceClass: "ide_agent",
        agentStatus: "confirmed",
        demoSeed: true,
        howIdentified: "Demo seed — Cursor + MCP"
      },
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
      metadata: {
        aiRelevant: true,
        inventoryClass: "framework_agent",
        evidenceClass: "process_agent",
        agentStatus: "confirmed",
        demoSeed: true
      },
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
      metadata: {
        aiRelevant: true,
        inventoryClass: "ai_cloud_resource",
        evidenceClass: "cloud_ai_runtime",
        agentStatus: "confirmed",
        demoSeed: true,
        managedCloudAgent: true
      },
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
      metadata: {
        aiRelevant: true,
        inventoryClass: "mcp_server",
        evidenceClass: "ide_agent",
        agentStatus: "confirmed",
        demoSeed: true
      },
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
      metadata: {
        aiRelevant: true,
        inventoryClass: "process_ai_agent",
        evidenceClass: "process_agent",
        agentStatus: "confirmed",
        demoSeed: true,
        shadowAi: true
      },
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
        { rel_type: "ACCESSES", to_type: "ExternalService", to_key: "m365", to_name: "Microsoft 365" }
      ],
      metadata: {
        aiRelevant: true,
        inventoryClass: "saas_platform_agent",
        evidenceClass: "platform_agent",
        agentStatus: "confirmed",
        demoSeed: true
      },
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
        { rel_type: "PROVIDED_BY", to_type: "Provider", to_key: "openai", to_name: "OpenAI" }
      ],
      metadata: {
        aiRelevant: true,
        inventoryClass: "saas_browser_agent",
        evidenceClass: "platform_agent",
        agentStatus: "candidate",
        demoSeed: true
      },
      last_seen: now
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
      relationships: [
        { rel_type: "INVOKES_MODEL", to_type: "Model", to_key: "claude-3-sonnet", to_name: "claude-3-sonnet" },
        { rel_type: "DEPLOYED_IN", to_type: "CloudResource", to_key: "bedrock-usw2", to_name: "Amazon Bedrock" }
      ],
      metadata: {
        aiRelevant: true,
        inventoryClass: "ai_cloud_resource",
        evidenceClass: "cloud_ai_runtime",
        agentStatus: "confirmed",
        demoSeed: true,
        managedCloudAgent: true
      },
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
      metadata: {
        aiRelevant: true,
        inventoryClass: "repo_candidate",
        evidenceClass: "repo_candidate",
        agentStatus: "candidate",
        demoSeed: true,
        agentMarkers: ["AGENTS.md", ".github/copilot-instructions.md"]
      },
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
      running_status: "scheduled",
      confidence_score: 0.84,
      tools: ["web_search", "summarize", "cite"],
      internet_access: true,
      relationships: [
        { rel_type: "INVOKES_MODEL", to_type: "Model", to_key: "gpt-4o-mini", to_name: "gpt-4o-mini" },
        { rel_type: "USES_TOOL", to_type: "Tool", to_key: "web_search", to_name: "web_search" }
      ],
      metadata: {
        aiRelevant: true,
        inventoryClass: "framework_agent",
        evidenceClass: "process_agent",
        agentStatus: "confirmed",
        demoSeed: true
      },
      last_seen: now
    }
  ];
}
