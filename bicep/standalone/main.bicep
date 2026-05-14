// AgentRadar — Standalone Azure Deployment (Bicep)
// Usage:
//   az deployment sub create \
//     --location westeurope \
//     --template-file main.bicep \
//     --parameters @params.bicepparam

targetScope = 'subscription'

// ── Parameters ──────────────────────────────────────────
@description('Azure region to deploy into')
param location string = 'westeurope'

@description('Short location code for naming')
param locationShort string = 'we'

@description('Environment: prod | staging | dev')
@allowed(['prod', 'staging', 'dev'])
param env string = 'prod'

@description('Project name prefix for all resources')
param project string = 'agentRadar'

@description('Public domain — point DNS here after deploy')
param domain string

@description('Alert email for Azure Monitor')
param alertEmail string

@description('Create new VNet or use existing')
param createVnet bool = true

@description('VNet CIDR (when createVnet = true)')
param vnetAddressSpace string = '10.1.0.0/16'

@description('AKS subnet CIDR')
param aksSubnetCidr string = '10.1.0.0/22'

@description('Data subnet CIDR (Postgres, Redis)')
param dataSubnetCidr string = '10.1.8.0/24'

@description('Existing VNet resource ID (when createVnet = false)')
param existingVnetId string = ''

@description('Existing AKS subnet ID')
param existingAksSubnetId string = ''

@description('Existing data subnet ID')
param existingDataSubnetId string = ''

@description('AKS VM size')
param aksVmSize string = 'Standard_D4s_v3'

@description('Min AKS app nodes')
param aksMinNodes int = 2

@description('Max AKS app nodes')
param aksMaxNodes int = 8

@description('PostgreSQL SKU')
param postgresSku string = 'Standard_D2ds_v5'

@description('Enable PostgreSQL Zone HA')
param postgresHa bool = true

@description('Redis cache capacity')
param redisCapacity int = 2

@description('Scanner CIDR ranges (comma-separated)')
param scanRanges string = '10.0.0.0/8'

@description('AI provider API key — stored in Key Vault')
@secure()
param aiApiKey string = ''

@description('Docker image tag')
param imageTag string = 'latest'

// ── Variables ────────────────────────────────────────────
var prefix = '${project}-${env}-${locationShort}'
var rgName = 'rg-${prefix}'

var tags = {
  project: project
  environment: env
  managedBy: 'bicep'
}

// ── Resource Group ────────────────────────────────────────
resource rg 'Microsoft.Resources/resourceGroups@2023-07-01' = {
  name: rgName
  location: location
  tags: tags
}

// ── Log Analytics (deployed first — other resources depend on it) ─
module law 'modules/loganalytics.bicep' = {
  name: 'law'
  scope: rg
  params: {
    prefix: prefix
    location: location
    tags: tags
  }
}

// ── Networking ────────────────────────────────────────────
module networking 'modules/networking.bicep' = {
  name: 'networking'
  scope: rg
  params: {
    prefix: prefix
    location: location
    tags: tags
    createVnet: createVnet
    vnetAddressSpace: vnetAddressSpace
    aksSubnetCidr: aksSubnetCidr
    dataSubnetCidr: dataSubnetCidr
    existingVnetId: existingVnetId
    existingAksSubnetId: existingAksSubnetId
    existingDataSubnetId: existingDataSubnetId
  }
}

// ── Key Vault ─────────────────────────────────────────────
module keyvault 'modules/keyvault.bicep' = {
  name: 'keyvault'
  scope: rg
  params: {
    prefix: prefix
    location: location
    tags: tags
    subnetId: networking.outputs.dataSubnetId
    vnetId: networking.outputs.vnetId
    aiApiKey: aiApiKey
  }
}

// ── Container Registry ────────────────────────────────────
module acr 'modules/acr.bicep' = {
  name: 'acr'
  scope: rg
  params: {
    prefix: prefix
    location: location
    tags: tags
  }
}

// ── PostgreSQL ────────────────────────────────────────────
module postgres 'modules/postgres.bicep' = {
  name: 'postgres'
  scope: rg
  params: {
    prefix: prefix
    location: location
    tags: tags
    subnetId: networking.outputs.dataSubnetId
    privateDnsZoneId: networking.outputs.pgPrivateDnsZoneId
    skuName: postgresSku
    haEnabled: postgresHa
    adminPasswordSecretUri: keyvault.outputs.dbPasswordSecretUri
  }
}

// ── Redis ─────────────────────────────────────────────────
module redis 'modules/redis.bicep' = {
  name: 'redis'
  scope: rg
  params: {
    prefix: prefix
    location: location
    tags: tags
    subnetId: networking.outputs.dataSubnetId
    capacity: redisCapacity
  }
}

// ── AKS ───────────────────────────────────────────────────
module aks 'modules/aks.bicep' = {
  name: 'aks'
  scope: rg
  params: {
    prefix: prefix
    location: location
    tags: tags
    subnetId: networking.outputs.aksSubnetId
    acrId: acr.outputs.acrId
    keyvaultId: keyvault.outputs.keyvaultId
    logAnalyticsId: law.outputs.workspaceId
    vmSize: aksVmSize
    minNodes: aksMinNodes
    maxNodes: aksMaxNodes
    scanRanges: scanRanges
    imageTag: imageTag
    domain: domain
    postgresHost: postgres.outputs.fqdn
    redisHost: redis.outputs.hostname
    redisPort: redis.outputs.sslPort
    keyvaultUri: keyvault.outputs.vaultUri
  }
  dependsOn: [postgres, redis, keyvault]
}

// ── Monitoring & Alerts ───────────────────────────────────
module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  scope: rg
  params: {
    prefix: prefix
    location: location
    tags: tags
    aksId: aks.outputs.aksId
    lawId: law.outputs.workspaceId
    alertEmail: alertEmail
  }
}

// ── Outputs ───────────────────────────────────────────────
output resourceGroupName  string = rgName
output aksName            string = aks.outputs.aksName
output acrLoginServer     string = acr.outputs.loginServer
output keyvaultUri        string = keyvault.outputs.vaultUri
output platformUrl        string = 'https://${domain}'
output natPublicIp        string = networking.outputs.natPublicIp
output getCredentialsCmd  string = 'az aks get-credentials --resource-group ${rgName} --name ${aks.outputs.aksName}'
output acrPushCmd         string = 'az acr login --name ${acr.outputs.acrName} && docker tag agentRadar:latest ${acr.outputs.loginServer}/agentRadar:${imageTag} && docker push ${acr.outputs.loginServer}/agentRadar:${imageTag}'
