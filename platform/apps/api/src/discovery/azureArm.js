/**
 * Live Azure Resource Manager discovery using connector service-principal credentials.
 */

const AI_TYPE_PATTERNS = [
  "Microsoft.CognitiveServices/accounts",
  "Microsoft.MachineLearningServices/workspaces",
  "Microsoft.App/containerApps",
  "Microsoft.Web/sites",
  "Microsoft.Search/searchServices",
  "Microsoft.BotService/botServices",
  "Microsoft.HealthcareApis/services",
  "Microsoft.HealthcareApis/workspaces",
  "Microsoft.DocumentDB/databaseAccounts",
  "Microsoft.ContainerService/managedClusters",
  "Microsoft.Insights/components"
];

function isAiRelevant(resource) {
  const type = resource.type || "";
  const name = (resource.name || "").toLowerCase();
  if (AI_TYPE_PATTERNS.some((p) => type === p || type.startsWith(p + "/"))) return true;
  if (/openai|ai-|ml-|foundry|copilot|llm|gpt|claude|bedrock|agent/i.test(name)) return true;
  if (/openai|MachineLearning|CognitiveServices|BotService|Search|HealthcareApis/i.test(type)) return true;
  const kind = String(resource.kind || "").toLowerCase();
  if (/openai|ai|ml|bot/.test(kind)) return true;
  return false;
}

export async function getAzureAccessToken({ tenantId, clientId, clientSecret }) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://management.azure.com/.default"
  });

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error_description || json.error || `Azure token failed (${res.status})`);
  }
  return json.access_token;
}

async function listSubscriptionResources(token, subscriptionId) {
  const resources = [];
  let url =
    `https://management.azure.com/subscriptions/${subscriptionId}/resources` +
    `?api-version=2021-04-01`;

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error?.message || `Azure resource list failed (${res.status})`);
    }
    resources.push(...(json.value || []));
    url = json.nextLink || null;
  }
  return resources;
}

function resourceToObservation(resource, conn) {
  const tags = resource.tags || {};
  const type = resource.type || "unknown";
  const shortType = type.split("/").slice(-1)[0];
  return {
    collector_id: "cloud_azure",
    fingerprint: `azure:${resource.id}`,
    name: resource.name || shortType,
    category: "cloud",
    cloud_provider: "azure",
    region: resource.location || null,
    provider: "azure",
    deployment_type: "cloud",
    endpoint: resource.id,
    running_status: "unknown",
    confidence_score: 0.9,
    owner: tags.owner || tags.Owner || null,
    department: tags.department || tags.Department || null,
    business_unit: tags.businessUnit || tags.bu || null,
    metadata: {
      connectorId: conn.id,
      connectorName: conn.name,
      discoveryMode: "azure-arm-live",
      subscriptionId: conn.config.subscriptionId,
      azureResourceId: resource.id,
      azureType: type,
      azureKind: resource.kind || null,
      resourceGroup: (resource.id || "").split("/")[4] || null,
      tags
    },
    relationships: [
      {
        rel_type: "DEPLOYED_IN",
        to_type: "CloudResource",
        to_key: resource.id,
        to_name: resource.name || shortType
      }
    ]
  };
}

/**
 * Discover AI-relevant Azure resources for one connector.
 * Always returns at least a connector health observation when auth succeeds.
 */
export async function discoverAzureConnector(conn) {
  const tenantId = conn.config.tenantId;
  const clientId = conn.config.clientId;
  const subscriptionId = conn.config.subscriptionId;
  const clientSecret = conn.secrets.clientSecret;

  if (!tenantId || !clientId || !clientSecret || !subscriptionId) {
    throw new Error("Azure connector missing tenantId, clientId, clientSecret, or subscriptionId");
  }

  const token = await getAzureAccessToken({ tenantId, clientId, clientSecret });
  const resources = await listSubscriptionResources(token, subscriptionId);
  const aiResources = resources.filter(isAiRelevant);

  const observations = aiResources.map((r) => resourceToObservation(r, conn));

  // Always emit a connector scan summary so the UI shows the connector was used
  observations.unshift({
    collector_id: "cloud_azure",
    fingerprint: `azure-connector-scan:${conn.id}:${subscriptionId}`,
    name: `Azure scan — ${conn.name}`,
    category: "cloud",
    cloud_provider: "azure",
    region: "global",
    provider: "azure",
    deployment_type: "cloud",
    running_status: "running",
    confidence_score: 0.95,
    metadata: {
      connectorId: conn.id,
      connectorName: conn.name,
      discoveryMode: "azure-arm-live",
      subscriptionId,
      totalResourcesScanned: resources.length,
      aiRelevantResources: aiResources.length,
      environment: conn.environment
    },
    relationships: [
      {
        rel_type: "DEPLOYED_IN",
        to_type: "CloudResource",
        to_key: `azure-sub-${subscriptionId}`,
        to_name: `Subscription ${subscriptionId}`
      }
    ]
  });

  return {
    observations,
    stats: {
      totalResourcesScanned: resources.length,
      aiRelevantResources: aiResources.length
    }
  };
}

export async function validateAzureConnector(conn) {
  const token = await getAzureAccessToken({
    tenantId: conn.config.tenantId,
    clientId: conn.config.clientId,
    clientSecret: conn.secrets.clientSecret
  });
  const subscriptionId = conn.config.subscriptionId;
  const res = await fetch(
    `https://management.azure.com/subscriptions/${subscriptionId}?api-version=2020-01-01`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error?.message || `Subscription check failed (${res.status})`);
  }
  return {
    ok: true,
    message: `Authenticated to Azure subscription ${json.displayName || subscriptionId} (${json.state || "unknown"}).`
  };
}
