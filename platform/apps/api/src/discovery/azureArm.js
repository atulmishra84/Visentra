import { safeFetch, assertAllowedUrl, ALLOW } from "../utils/http.js";
import {
  DISCOVERY_AI_ONLY,
  isAzureAiResource,
  shouldIngestAiOnly
} from "./aiRelevance.js";

/**
 * Live Azure Resource Manager discovery using connector service-principal credentials.
 * AI-agents / AI workloads only when DISCOVERY_AI_ONLY is enabled (default).
 */

const MAX_RESOURCES = Number(process.env.AZURE_DISCOVERY_MAX_RESOURCES || 500);

/** @deprecated use isAzureAiResource — kept for tests/callers */
export function isAiRelevant(resource) {
  return isAzureAiResource(resource);
}

export async function getAzureAccessToken({ tenantId, clientId, clientSecret }) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://management.azure.com/.default"
  });

  const res = await safeFetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    },
    ALLOW.microsoftLogin
  );
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
    assertAllowedUrl(url, ALLOW.azureArm);
    const res = await safeFetch(
      url,
      {
        headers: { Authorization: `Bearer ${token}` }
      },
      ALLOW.azureArm
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error?.message || `Azure resource list failed (${res.status})`);
    }
    resources.push(...(json.value || []));
    url = json.nextLink || null;
  }
  return resources;
}

function resourceToObservation(resource, conn, aiRelevant) {
  const tags = resource.tags || {};
  const type = resource.type || "unknown";
  const shortType = type.split("/").slice(-1)[0];
  const displayName = resource.name || shortType;
  return {
    collector_id: "cloud_azure",
    fingerprint: `azure:${resource.id}`,
    name: aiRelevant ? `${displayName} (AI)` : displayName,
    category: "cloud",
    cloud_provider: "azure",
    region: resource.location || null,
    provider: "azure",
    deployment_type: "cloud",
    endpoint: resource.id,
    running_status: "unknown",
    confidence_score: aiRelevant ? 0.92 : 0.8,
    owner: tags.owner || tags.Owner || null,
    department: tags.department || tags.Department || null,
    business_unit: tags.businessUnit || tags.bu || null,
    framework: shortType,
    model: aiRelevant ? "ai-relevant" : null,
    metadata: {
      connectorId: conn.id,
      connectorName: conn.name,
      discoveryMode: "azure-arm-live",
      subscriptionId: conn.config.subscriptionId,
      azureResourceId: resource.id,
      azureType: type,
      azureKind: resource.kind || null,
      resourceGroup: (resource.id || "").split("/")[4] || null,
      aiRelevant,
      inventoryClass: aiRelevant ? "ai_cloud_resource" : "cloud_resource",
      evidenceClass: aiRelevant ? "cloud_ai_runtime" : null,
      agentStatus: aiRelevant
        ? /Microsoft\.(CognitiveServices|MachineLearningServices|BotService|Search)\//i.test(type) ||
          /openai|bot|foundry|ai\.services|agents?/i.test(String(resource.kind || "")) ||
          /\/projects$|\/agents|Foundry|AIServices/i.test(type)
          ? "confirmed"
          : "candidate"
        : null,
      managedCloudAgent:
        /Microsoft\.(CognitiveServices|MachineLearningServices|BotService)\//i.test(type) ||
        /openai|foundry|agents?/i.test(String(resource.kind || "")) ||
        /\/projects$|\/agents|Foundry|AIServices/i.test(type),
      tags
    },
    relationships: [
      {
        rel_type: "DEPLOYED_IN",
        to_type: "CloudResource",
        to_key: resource.id,
        to_name: displayName
      }
    ]
  };
}

/**
 * Discover Azure subscription resources for one connector.
 * When DISCOVERY_AI_ONLY (default), only AI-relevant resources are ingested.
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

  const aiResources = [];
  const otherResources = [];
  for (const r of resources) {
    if (isAzureAiResource(r)) aiResources.push(r);
    else otherResources.push(r);
  }

  let selected = [...aiResources];
  if (!DISCOVERY_AI_ONLY) {
    for (const r of otherResources) {
      if (selected.length >= MAX_RESOURCES) break;
      selected.push(r);
    }
  }
  selected = selected.slice(0, MAX_RESOURCES);

  const observations = selected
    .filter((r) => shouldIngestAiOnly(isAzureAiResource(r)) || !DISCOVERY_AI_ONLY)
    .map((r) => resourceToObservation(r, conn, isAzureAiResource(r)));

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
    framework: "subscription-scan",
    metadata: {
      connectorId: conn.id,
      connectorName: conn.name,
      discoveryMode: "azure-arm-live",
      subscriptionId,
      totalResourcesScanned: resources.length,
      aiRelevantResources: aiResources.length,
      nonAiResourcesSkipped: DISCOVERY_AI_ONLY ? otherResources.length : 0,
      cloudResourcesIngested: selected.length,
      inventoryClass: "connector_scan",
      aiOnly: DISCOVERY_AI_ONLY,
      environment: conn.environment,
      maxResources: MAX_RESOURCES
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
      aiRelevantResources: aiResources.length,
      nonAiResourcesSkipped: DISCOVERY_AI_ONLY ? otherResources.length : 0,
      cloudResourcesIngested: selected.length
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
  const res = await safeFetch(
    `https://management.azure.com/subscriptions/${subscriptionId}?api-version=2020-01-01`,
    { headers: { Authorization: `Bearer ${token}` } },
    ALLOW.azureArm
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
