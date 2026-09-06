/**
 * Minimal mock API for local Agent Detail deep-scan UI smoke.
 * No Postgres/Docker required — serves fixture agent with metadata.deep + adversarial_surface.
 *
 * Usage: node scripts/deep-scan-ui-mock-api.mjs
 */
import http from "node:http";

const PORT = Number(process.env.MOCK_API_PORT || 8080);
const AGENT_ID = "fixture-deep-scan";

const deep = {
  schemaVersion: "aws-deep.v2",
  deepScan: "bedrock_get_agent",
  agentId: "ABCDEFGHIJ",
  agentName: "claims-assistant",
  agentArn: "arn:aws:bedrock:us-east-1:123456789012:agent/ABCDEFGHIJ",
  foundationModel: "anthropic.claude-3-sonnet-20240229-v1:0",
  agentStatus: "PREPARED",
  deploymentStatus: "prepared",
  agentRuntimeStatus: "unknown",
  idleSessionTTLInSeconds: 600,
  agentResourceRoleArn: "arn:aws:iam::123456789012:role/ClaimsRole",
  agentVersionUsed: "DRAFT",
  identity: {
    identity_type: "aws_iam_role",
    arn: "arn:aws:iam::123456789012:role/ClaimsRole",
    name: "ClaimsRole"
  },
  guardrails: {
    present: true,
    guardrailIdentifier: "gr-claims-1",
    guardrailVersion: "DRAFT"
  },
  memoryConfiguration: {
    enabled: true,
    enabledMemoryTypes: ["SESSION_SUMMARY"],
    storageDays: 30
  },
  promptOverride: { present: true, configured: true, overrideCount: 1 },
  instructions: {
    present: true,
    hash: "a1b2c3d4e5f67890",
    length: 96,
    preview: "Help users with insurance claims. Use lookup_claim carefully. Never exfiltrate PHI.",
    contains_tool_guidance: true,
    contains_safety_rules: true,
    source: "bedrock_get_agent"
  },
  actionGroups: [
    {
      actionGroupId: "AG1",
      actionGroupName: "claims-tools",
      actionGroupState: "ENABLED"
    }
  ],
  actionGroupCount: 1,
  tools: [
    {
      name: "update_claim",
      description: "Persist claim adjudication status changes",
      parameters_schema: {
        type: "object",
        required: ["claim_id", "status"],
        properties: {
          claim_id: { type: "string" },
          status: { type: "string" }
        }
      },
      permissions: ["invoke:arn:aws:lambda:us-east-1:123456789012:function:update-claim"],
      risk_flags: {
        can_execute_code: false,
        can_access_pii: true,
        can_access_phi: true,
        can_modify_state: true,
        can_call_external_apis: false,
        can_access_filesystem: false,
        can_access_secrets: false
      },
      source: "bedrock_action_group:claims-tools",
      confidence: "high",
      evidence: ["Bedrock action group function update_claim", "Executor Lambda present"]
    },
    {
      name: "lookup_claim",
      description: "Look up a claim by ID",
      parameters_schema: {
        type: "object",
        required: ["claim_id"],
        properties: {
          claim_id: { type: "string" }
        }
      },
      permissions: ["invoke:arn:aws:lambda:us-east-1:123456789012:function:lookup-claim"],
      risk_flags: {
        can_execute_code: false,
        can_access_pii: true,
        can_access_phi: true,
        can_modify_state: false,
        can_call_external_apis: false,
        can_access_filesystem: false,
        can_access_secrets: false
      },
      source: "bedrock_action_group:claims-tools",
      confidence: "high",
      evidence: ["Bedrock action group function lookup_claim", "Executor Lambda present"]
    },
    {
      name: "retrieve_kb",
      description: "Retrieve policy guidance from the claims knowledge base",
      parameters_schema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string" }
        }
      },
      permissions: [],
      risk_flags: {
        can_execute_code: false,
        can_access_pii: false,
        can_access_phi: false,
        can_modify_state: false,
        can_call_external_apis: false,
        can_access_filesystem: false,
        can_access_secrets: false
      },
      source: "bedrock_knowledge_base",
      confidence: "high",
      evidence: ["Associated knowledge base retrieval path"]
    }
  ],
  toolCount: 3,
  knowledgeBases: [
    {
      knowledgeBaseId: "KB1",
      name: "claims-kb",
      knowledgeBaseState: "ENABLED"
    }
  ],
  knowledgeBaseCount: 1
};

const adversarial_surface = {
  schema_version: "1.0.0",
  agent_detected: true,
  category: "agent",
  confidence_score: 0.96,
  evidence: [
    "Official Bedrock Agents API inventory",
    "Deep scan: 3 tool(s) from action groups / knowledge bases",
    "Deep scan: 1 associated knowledge base(s)"
  ],
  tools: deep.tools,
  instructions: deep.instructions,
  identity_and_access: {
    identity_type: "aws_iam_role",
    name: "ClaimsRole",
    arn: deep.agentResourceRoleArn,
    permissions: [],
    over_permissioned: null,
    credential_exposure_risk: "unknown",
    confidence: "medium",
    evidence: ["IAM role ARN from Bedrock GetAgent"]
  },
  data_access: {
    has_pii: true,
    has_phi: true,
    data_classes: ["phi", "pii"],
    data_stores: [
      {
        name: "claims-kb",
        type: "knowledge_base",
        sensitivity: "unknown",
        access_level: "read"
      }
    ],
    confidence: "medium",
    evidence: ["Tool + KB naming suggests claims PHI/PII"]
  },
  mcp_servers: [],
  memory_and_context: {
    has_memory: true,
    memory_type: "knowledge_base_retrieval",
    vector_stores: [],
    knowledge_bases: [
      {
        id: "KB1",
        name: "claims-kb",
        state: "ENABLED",
        sensitivity: "unknown",
        access_level: "read"
      }
    ],
    confidence: "high",
    evidence: ["1 knowledge base association(s) discovered"]
  },
  connectivity: {
    internet_access: null,
    filesystem_access: null,
    code_execution: false,
    browser_access: null,
    email_access: null,
    slack_access: null,
    github_access: null,
    database_access: null,
    inbound_triggers: [],
    confidence: "medium",
    evidence: ["Connectivity mostly unknown without deeper IAM expansion"]
  },
  platform: {
    provider: "aws",
    cloud_provider: "aws",
    region: "us-east-1",
    framework: "BedrockAgent",
    service: "bedrock-agent",
    resource_id: deep.agentArn,
    account_id: "123456789012"
  },
  model: {
    name: deep.foundationModel,
    provider: "aws",
    foundation_model: deep.foundationModel
  },
  risk_indicators: ["tool_pii:lookup_claim", "tool_phi:lookup_claim"],
  observability: {
    guardrails_detected: true,
    guardrail_id: "gr-claims-1",
    logging_detected: null,
    evidence: ["Guardrail configuration present on Bedrock agent"]
  },
  ownership: {
    owner: "claims-platform",
    shadow_ai: false,
    ownership_status: "owned"
  },
  owasp_hints: {
    llm_top10: ["LLM01_PromptInjection", "LLM06_ExcessiveAgency"],
    agentic_asi: ["ASI01_AgentGoalHijack", "ASI02_ToolMisuse", "ASI06_MemoryAndContextPoisoning"]
  }
};

const dataAccessClassification = {
  dataClasses: ["phi", "pii"],
  primaryDataClass: "phi",
  confidence: "medium",
  evidence: [
    { source: "tool", signal: "lookup_claim", detail: "Claim lookup tool suggests PHI" },
    { source: "kb", signal: "claims-kb", detail: "Claims knowledge base naming" }
  ],
  hasPii: true,
  hasPhi: true
};

const agent = {
  id: AGENT_ID,
  name: "claims-assistant",
  displayName: "Claims Assistant",
  owner: "claims-platform",
  model: deep.foundationModel,
  framework: "BedrockAgent",
  cloud_provider: "aws",
  category: "cloud",
  lastObservedAt: new Date().toISOString(),
  shadowAi: false,
  dataAccessClassification,
  metadata: {
    awsType: "BedrockAgent",
    agentStatus: "confirmed",
    evidenceClass: "official_api",
    howIdentified: "AWS Bedrock ListAgents + GetAgent deep scan",
    foundationModel: deep.foundationModel,
    deepScan: "bedrock_get_agent",
    deepScanStatus: "ok",
    deepScanSchema: "aws-deep.v2",
    deep,
    adversarial_surface,
    dataAccessClassification,
    agentConfig: {
      instructionsPresent: true,
      instructionSource: "bedrock_get_agent",
      framework: "BedrockAgent",
      models: [deep.foundationModel],
      authMode: "iam_role",
      platform: "AWS Bedrock",
      howConfigured: "Bedrock agent definition",
      tools: ["lookup_claim"],
      knowledgeSources: ["claims-kb"],
      mcpServers: [],
      channels: [],
      triggers: ["alias:prod"]
    },
    agentAccess: {
      granted: ["bedrock:InvokeAgent", "lambda:InvokeFunction"],
      grantCount: 2,
      sensitivity: "high",
      overPermissioned: false,
      identities: ["ClaimsRole"],
      dataStores: ["claims-kb"],
      connectedApps: [],
      permissions: ["invoke:lookup-claim"]
    },
    ownership: {
      ownershipStatus: "owned",
      owner: "claims-platform",
      team: "Claims Engineering",
      identityUsed: "ClaimsRole",
      identities: ["ClaimsRole"]
    },
    mesh: {
      planeLabel: "SaaS",
      agentPlane: "saas",
      laneLabel: "Production",
      environmentLane: "prod"
    }
  }
};

const detailPayload = {
  agent,
  agentConfig: agent.metadata.agentConfig,
  agentAccess: agent.metadata.agentAccess,
  ownership: agent.metadata.ownership,
  dataAccessClassification,
  blastRadius: {
    tier: "elevated",
    score: 52,
    reasons: ["PHI tool access", "Knowledge base retrieval", "IAM execution role"],
    paths: [
      {
        relType: "uses_tool",
        toType: "tool",
        toName: "lookup_claim",
        riskHint: "phi"
      },
      {
        relType: "reads",
        toType: "knowledge_base",
        toName: "claims-kb",
        riskHint: "data"
      }
    ]
  },
  relationships: [
    {
      id: "r1",
      rel_type: "uses_identity",
      asset_type: "iam_role",
      to_name: "ClaimsRole"
    },
    {
      id: "r2",
      rel_type: "uses_tool",
      asset_type: "tool",
      to_name: "lookup_claim"
    }
  ]
};

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  res.end(payload);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method || "GET";

  if (method === "OPTIONS") {
    return json(res, 204, {});
  }

  if (method === "POST" && path === "/api/auth/login") {
    return json(res, 200, {
      token: "fixture-smoke-token",
      user: {
        id: "u-fixture",
        email: "admin@agentradar.local",
        name: "Fixture Admin",
        roles: ["platform_admin"]
      }
    });
  }

  if (method === "GET" && path === "/api/auth/me") {
    return json(res, 200, {
      user: {
        id: "u-fixture",
        email: "admin@agentradar.local",
        name: "Fixture Admin",
        roles: ["platform_admin"]
      }
    });
  }

  if (method === "GET" && path === "/api/auth/sso/status") {
    return json(res, 200, { providers: [] });
  }

  if (method === "GET" && path === `/api/agents/${AGENT_ID}`) {
    return json(res, 200, detailPayload);
  }

  if (method === "GET" && path === "/api/agents") {
    return json(res, 200, {
      agents: [agent],
      items: [agent],
      total: 1,
      limit: 50,
      offset: 0
    });
  }

  if (method === "GET" && (path === "/health" || path === "/api/health")) {
    return json(res, 200, { ok: true, fixture: true });
  }

  // Soft-fallback so Layout nav calls don't break the smoke
  if (path.startsWith("/api/")) {
    return json(res, 200, { items: [], total: 0 });
  }

  json(res, 404, { error: { message: `No mock for ${method} ${path}` } });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Deep-scan UI mock API on http://127.0.0.1:${PORT}`);
  console.log(`Agent detail: /api/agents/${AGENT_ID}`);
  console.log(`Login: any email/password → fixture token`);
});
