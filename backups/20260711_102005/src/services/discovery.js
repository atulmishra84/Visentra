'use strict';
const { detectPHI } = require('./phi');

const AI_TYPE_KEYWORDS = [
  'microsoft.cognitiveservices',
  'microsoft.machinelearningservices',
  'microsoft.search/searchservices',
  'microsoft.botservice',
  'microsoft.synapse',
  'microsoft.databricks',
  'microsoft.app/containerapps',
  'microsoft.securitycopilot',
];

const AI_NAME_KEYWORDS = [
  'openai','aoai','gpt','llm','cognitive','orchestrator',
  'hub','foundry','jarvis','copilot','aiservice',
];

const EXCLUDE_TYPES = [
  'microsoft.network/','microsoft.compute/disks',
  'microsoft.operationsmanagement','microsoft.insights/actiongroups',
  'microsoft.cache/redis','microsoft.operationalinsights',
  'microsoft.dbforpostgresql','microsoft.storage/storageaccounts',
  'microsoft.keyvault/vaults','microsoft.containerregistry',
  'microsoft.managedidentity','microsoft.app/managedenvironments',
];

function classifyResource(res) {
  const type = (res.type || '').toLowerCase();
  const name = (res.name || '').toLowerCase();
  const kind = (res.kind || '').toLowerCase();

  const phi = detectPHI(res);

  if (kind === 'aiservices')
    return { agentType:'ai-foundry', risk:'high', pii:true, phi, label:'Azure AI Foundry' };
  if (type.includes('cognitiveservices/accounts/projects'))
    return { agentType:'ai-project', risk:'high', pii:true, phi, label:'AI Foundry Project' };
  if (type.includes('cognitiveservices') || kind.includes('openai'))
    return { agentType:'llm', risk:'high', pii:true, phi, label:'Azure OpenAI' };
  if (type.includes('microsoft.app/containerapps'))
    return { agentType:'agent', risk:'high', pii:true, phi, label:'AI Container Agent' };
  if (type.includes('microsoft.securitycopilot'))
    return { agentType:'copilot', risk:'high', pii:true, phi:false, label:'Security Copilot' };
  if (type.includes('machinelearning') && kind === 'hub')
    return { agentType:'ml-hub', risk:'high', pii:true, phi, label:'Azure ML Hub' };
  if (type.includes('machinelearning') && kind === 'project')
    return { agentType:'ml-project', risk:'high', pii:true, phi, label:'Azure ML Project' };
  if (type.includes('machinelearning'))
    return { agentType:'ml-workspace', risk:'high', pii:true, phi, label:'Azure ML Workspace' };
  if (type.includes('search'))
    return { agentType:'ai-search', risk:'medium', pii:true, phi:false, label:'Azure AI Search' };
  if (type.includes('botservice'))
    return { agentType:'chatbot', risk:'high', pii:true, phi, label:'Azure Bot Service' };
  
  return { agentType:'azure-service', risk:'low', pii:false, phi:false, label:res.type };
}

function isAiResource(res) {
  const type = (res.type || '').toLowerCase();
  const name = (res.name || '').toLowerCase();
  const kind = (res.kind || '').toLowerCase();

  if (EXCLUDE_TYPES.some(e => type.startsWith(e))) return false;
  if (AI_TYPE_KEYWORDS.some(k => type.includes(k))) return true;
  if (['openai','aiservices','hub','project'].some(k => kind.includes(k))) return true;
  
  const isInfra = ['microsoft.network','microsoft.compute/disk',
    'microsoft.storage','microsoft.keyvault'].some(t => type.includes(t));
  if (!isInfra && AI_NAME_KEYWORDS.some(k => name.includes(k))) return true;

  return false;
}

async function getAzureToken(tenantId, clientId, clientSecret, scope) {
  const resp = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: scope || 'https://management.azure.com/.default',
        grant_type: 'client_credentials',
      }),
    }
  ).then(r => r.json());

  if (!resp.access_token) {
    throw new Error('Azure auth failed: ' + (resp.error_description || resp.error));
  }
  return resp.access_token;
}

async function discoverAzure({ tenantId, clientId, clientSecret, subscriptionId }) {
  const log = [];
  const agents = [];
  const scanners = new Set();

  try {
    const token = await getAzureToken(tenantId, clientId, clientSecret);
    log.push({ step:'auth', status:'ok', msg:'Azure authenticated' });

    // Paginate through all resources
    let allResources = [];
    let nextLink = `https://management.azure.com/subscriptions/${subscriptionId}/resources?api-version=2021-04-01&$top=1000`;
    
    while (nextLink) {
      const page = await fetch(nextLink, {
        headers: { 'Authorization': 'Bearer ' + token }
      }).then(r => r.json()).catch(() => ({ value: [] }));
      
      allResources = allResources.concat(page.value || []);
      nextLink = page.nextLink || null;
    }

    log.push({ step:'inventory', status:'ok', msg:`Found ${allResources.length} resources` });

    const aiResources = allResources.filter(isAiResource);
    log.push({ step:'filter', status:'ok', msg:`Identified ${aiResources.length} AI resources` });

    for (const res of aiResources) {
      const rg = res.resourceGroup || res.id?.split('/')[4] || 'unknown';
      const cls = classifyResource(res);
      
      agents.push({
        name:      res.name,
        type:      cls.agentType,
        env:       'Cloud',
        risk:      cls.risk,
        shadow:    false,
        phi:       cls.phi,
        pii:       cls.pii,
        protocols: ['Azure REST API'],
        detect:    'Azure auto-discovery',
        notes:     `${cls.label} | RG: ${rg} | Region: ${res.location || 'unknown'} | Type: ${res.type}`,
        controls:  buildControls(cls),
      });
      log.push({ step:'found', status:'found', msg:`${res.name} (${cls.label}) in ${rg}` });
    }

    // Tag-based discovery
    const taggedAI = allResources.filter(r => {
      const tags = JSON.stringify(r.tags || {}).toLowerCase();
      return ['ai','ml','agent','llm','copilot','foundry'].some(t => tags.includes(t));
    }).filter(r => !aiResources.find(a => a.name === r.name));

    for (const res of taggedAI) {
      const cls = classifyResource(res);
      agents.push({
        name: res.name, type:'tagged-ai-resource', env:'Cloud',
        risk:'medium', shadow:true, phi:cls.phi, pii:true,
        protocols:['Azure REST API'], detect:'Tag-based discovery',
        notes:`Tagged AI | Tags: ${JSON.stringify(res.tags)} | Type: ${res.type}`,
        controls: buildControls({ agentType:'tagged', phi:cls.phi }),
      });
    }

    log.push({ step:'summary', status:'ok', msg:`Discovery complete: ${agents.length} agents` });
  } catch (err) {
    log.push({ step:'error', status:'error', msg: err.message });
  }

  return { cloud: 'azure', agents, scanners: [...scanners], log };
}

function buildControls({ agentType, phi }) {
  const isHighRisk = ['llm','ml-workspace','agent','ai-foundry'].includes(agentType);
  return {
    soc2:     'warn',
    iso27001: 'warn',
    gdpr:     'warn',
    nist:     'warn',
    euai:     isHighRisk ? 'fail' : 'warn',
    hipaa:    phi ? 'fail' : 'pass',
    hitrust:  phi ? 'fail' : 'warn',
    fda_samd: agentType === 'medical-device' ? 'warn' : 'pass',
  };
}

module.exports = { discoverAzure, classifyResource, isAiResource, buildControls };
