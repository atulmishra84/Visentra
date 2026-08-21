/**
 * Adversarial inventory types for agentic red-team consumers.
 * Mirrors platform/apps/api/src/discovery/adversarialInventory.js
 */

export type AssetCategory =
  | "agent"
  | "ai_resource"
  | "tool"
  | "knowledge_base"
  | "model_endpoint"
  | "mcp_server"
  | "runtime"
  | "unknown";

export type OrdinalConfidence = "low" | "medium" | "high";

export interface ToolRiskFlags {
  can_execute_code: boolean;
  can_access_pii: boolean;
  can_access_phi: boolean;
  can_modify_state: boolean;
  can_call_external_apis: boolean;
  can_access_filesystem: boolean;
  can_access_secrets: boolean;
}

export interface AdversarialTool {
  name: string | null;
  description: string | null;
  /** JSON-schema-ish parameters; may be null when only OpenAPI/ref is known */
  parameters_schema: Record<string, unknown> | null;
  permissions: string[];
  risk_flags: ToolRiskFlags;
  source: string | null;
  confidence: OrdinalConfidence;
  evidence: string[];
}

export interface InstructionsSurface {
  present: boolean;
  source: string | null;
  hash: string | null;
  length: number | null;
  preview: string | null;
  contains_tool_guidance: boolean | null;
  contains_safety_rules: boolean | null;
  confidence: OrdinalConfidence;
  evidence: string[];
}

export interface IdentityAndAccess {
  identity_type: string | null;
  name: string | null;
  arn: string | null;
  permissions: string[];
  over_permissioned: boolean | null;
  credential_exposure_risk: "unknown" | "low" | "medium" | "high";
  confidence: OrdinalConfidence;
  evidence: string[];
}

export interface DataStoreRef {
  name?: string | null;
  id?: string | null;
  type?: string | null;
  sensitivity?: string | null;
  access_level?: string | null;
  evidence?: string[];
}

export interface DataAccessSurface {
  has_pii: boolean | null;
  has_phi: boolean | null;
  data_classes: string[];
  data_stores: DataStoreRef[];
  confidence: OrdinalConfidence;
  evidence: string[];
}

export interface McpServerSurface {
  name: string | null;
  endpoint: string | null;
  tools_exposed: string[];
  auth: { type: string | null; details_present: boolean };
  confidence: OrdinalConfidence;
  evidence: string[];
}

export interface MemoryAndContext {
  has_memory: boolean | null;
  memory_type: string | null;
  vector_stores: DataStoreRef[];
  knowledge_bases: DataStoreRef[];
  confidence: OrdinalConfidence;
  evidence: string[];
}

export interface ConnectivitySurface {
  internet_access: boolean | null;
  filesystem_access: boolean | null;
  code_execution: boolean | null;
  browser_access: boolean | null;
  email_access: boolean | null;
  slack_access: boolean | null;
  github_access: boolean | null;
  database_access: boolean | null;
  inbound_triggers: unknown[];
  confidence: OrdinalConfidence;
  evidence: string[];
}

/** P0–P2 attack-surface block attached at metadata.adversarial_surface */
export interface AdversarialSurface {
  schema_version: string;
  agent_detected: boolean;
  category: AssetCategory;
  confidence_score: number;
  evidence: string[];
  tools: AdversarialTool[];
  instructions: InstructionsSurface;
  identity_and_access: IdentityAndAccess;
  data_access: DataAccessSurface;
  mcp_servers: McpServerSurface[];
  memory_and_context: MemoryAndContext;
  connectivity: ConnectivitySurface;
  platform: {
    provider: string | null;
    cloud_provider: string | null;
    region: string | null;
    framework: string | null;
    service: string | null;
    resource_id: string | null;
    account_id: string | null;
  };
  model: {
    name: string | null;
    provider: string | null;
    foundation_model: string | null;
  };
  risk_indicators: string[];
  observability: {
    guardrails_detected: boolean | null;
    guardrail_id: string | null;
    logging_detected: boolean | null;
    evidence: string[];
  };
  ownership: {
    owner: string | null;
    shadow_ai: boolean | null;
    ownership_status: string | null;
  };
  owasp_hints: {
    llm_top10: string[];
    agentic_asi: string[];
  };
}
