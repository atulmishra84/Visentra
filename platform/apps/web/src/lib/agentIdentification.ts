import { valueAt, type Agent } from "./api";

export type IdentificationRow = { label: string; value: string };

function asRec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      const joined = value.map(String).filter(Boolean).join(", ");
      if (joined) return joined;
      continue;
    }
    const text = String(value).trim();
    if (text && text !== "—" && text !== "null") return text;
  }
  return "";
}

export function resolveAgentIdentification(
  agent: Agent,
  extras: Record<string, unknown> = {}
): Record<string, string> {
  const meta = asRec(agent.metadata);
  const deep = asRec(meta.deep);
  const ownership = asRec(extras.ownership || agent.ownership || meta.ownership);
  const identification = asRec(extras.identification || agent.identification);
  const agentBlock = asRec(meta.agent);
  const runtime = asRec(meta.runtime);

  return {
    provider: firstText(
      identification.provider,
      agent.cloud_provider,
      agent.provider,
      meta.awsType ? "aws" : "",
      meta.azureType || meta.foundrySource ? "azure" : ""
    ),
    howIdentified: firstText(identification.howIdentified, meta.howIdentified, extras.howIdentified),
    detectionMethod: firstText(
      identification.detectionMethod,
      meta.agentDetectionMethod,
      agentBlock.detectionMethod
    ),
    agentId: firstText(identification.agentId, meta.agentId, deep.agentId, agentBlock.agentId),
    agentName: firstText(identification.agentName, meta.agentName, deep.agentName, deep.displayName),
    agentArn: firstText(
      identification.agentArn,
      meta.agentArn,
      deep.agentArn,
      String(agent.endpoint || "").startsWith("arn:") ? agent.endpoint : ""
    ),
    accountId: firstText(identification.accountId, meta.accountId, ownership.accountId),
    subscriptionId: firstText(
      identification.subscriptionId,
      meta.subscriptionId,
      ownership.subscriptionId
    ),
    tenantId: firstText(identification.tenantId, meta.tenantId, ownership.tenantId),
    resourceGroup: firstText(identification.resourceGroup, meta.resourceGroup, ownership.resourceGroup),
    azureResourceId: firstText(
      identification.azureResourceId,
      meta.azureResourceId,
      String(agent.endpoint || "").startsWith("/subscriptions/") ? agent.endpoint : "",
      runtime.resourceId
    ),
    projectName: firstText(identification.projectName, meta.projectName, deep.projectName),
    region: firstText(identification.region, agent.region, meta.region, deep.region),
    aliases: firstText(identification.aliases, meta.aliases),
    objectId: firstText(identification.objectId, ownership.objectId, meta.objectId),
    appId: firstText(identification.appId, ownership.appId, meta.appId),
    executionRole: firstText(
      identification.executionRole,
      asRec(deep.identity).arn,
      deep.agentResourceRoleArn
    )
  };
}

export function hasCloudIdentification(ids: Record<string, string>): boolean {
  return Boolean(
    ids.agentId ||
      ids.agentArn ||
      ids.accountId ||
      ids.subscriptionId ||
      ids.azureResourceId ||
      ids.resourceGroup ||
      ids.objectId ||
      ids.appId ||
      ids.aliases
  );
}

export function agentIdentificationRows(
  agent: Agent,
  extras: Record<string, unknown> = {}
): IdentificationRow[] {
  const ids = resolveAgentIdentification(agent, extras);
  const rows: Array<[string, string]> = [
    ["Provider", ids.provider],
    ["How identified", ids.howIdentified],
    ["Detection method", ids.detectionMethod],
    ["Agent ID", ids.agentId],
    ["Agent name", ids.agentName],
    ["Agent ARN", ids.agentArn],
    ["AWS account", ids.accountId],
    ["Azure subscription", ids.subscriptionId],
    ["Azure tenant", ids.tenantId],
    ["Resource group", ids.resourceGroup],
    ["Azure resource ID", ids.azureResourceId],
    ["Foundry project", ids.projectName],
    ["Region", ids.region],
    ["Aliases", ids.aliases],
    ["Entra object ID", ids.objectId],
    ["Entra app ID", ids.appId],
    ["Execution role", ids.executionRole]
  ];
  return rows
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => ({ label, value }));
}

export function inventoryCloudId(agent: Agent): string {
  const ids = resolveAgentIdentification(agent);
  return firstText(
    ids.agentId,
    ids.accountId && ids.agentId ? `${ids.accountId}/${ids.agentId}` : "",
    ids.subscriptionId,
    valueAt(agent, ["endpoint"])
  );
}
