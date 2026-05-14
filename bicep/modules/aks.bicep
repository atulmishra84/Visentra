// Module: AKS Cluster + node pools + Helm deploy
param prefix string
param location string
param tags object
param subnetId string
param acrId string
param keyvaultId string
param logAnalyticsId string
param vmSize string
param minNodes int
param maxNodes int
param scanRanges string
param imageTag string
param domain string
param postgresHost string
param redisHost string
param redisPort int
param keyvaultUri string

var aksName = 'aks-${prefix}'

resource aks 'Microsoft.ContainerService/managedClusters@2024-02-01' = {
  name: aksName
  location: location
  tags: tags

  identity: { type: 'SystemAssigned' }

  properties: {
    dnsPrefix: prefix
    enableRBAC: true

    // System node pool
    agentPoolProfiles: [
      {
        name: 'system'
        mode: 'System'
        count: 1
        vmSize: 'Standard_D2s_v3'
        vnetSubnetID: subnetId
        osDiskSizeGB: 50
        type: 'VirtualMachineScaleSets'
        nodeTaints: ['CriticalAddonsOnly=true:NoSchedule']
        upgradeSettings: { maxSurge: '10%' }
      }
      {
        name: 'app'
        mode: 'User'
        minCount: minNodes
        maxCount: maxNodes
        enableAutoScaling: true
        vmSize: vmSize
        vnetSubnetID: subnetId
        osDiskSizeGB: 100
        type: 'VirtualMachineScaleSets'
        nodeLabels: { workload: 'app' }
        upgradeSettings: { maxSurge: '33%' }
      }
    ]

    networkProfile: {
      networkPlugin: 'azure'
      networkPolicy: 'calico'
      loadBalancerSku: 'standard'
      outboundType: 'userAssignedNATGateway'
    }

    // Workload identity (Managed Identity — no stored secrets)
    oidcIssuerProfile: { enabled: true }
    securityProfile: { workloadIdentity: { enabled: true } }

    // Key Vault CSI driver
    addonProfiles: {
      azureKeyvaultSecretsProvider: {
        enabled: true
        config: {
          enableSecretRotation: 'true'
          rotationPollInterval: '2m'
        }
      }
      omsAgent: {
        enabled: true
        config: { logAnalyticsWorkspaceResourceID: logAnalyticsId }
      }
      azurepolicy: { enabled: true }
    }
  }
}

// ACR pull permission
resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acrId, aks.properties.identityProfile.kubeletidentity.objectId, 'AcrPull')
  scope: resourceGroup()
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: aks.properties.identityProfile.kubeletidentity.objectId
    principalType: 'ServicePrincipal'
  }
}

// Key Vault Secrets User permission
resource kvUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyvaultId, aks.properties.identityProfile.kubeletidentity.objectId, 'KeyVaultSecretsUser')
  scope: resourceGroup()
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: aks.properties.identityProfile.kubeletidentity.objectId
    principalType: 'ServicePrincipal'
  }
}

output aksId       string = aks.id
output aksName     string = aks.name
output oidcIssuer  string = aks.properties.oidcIssuerProfile.issuerURL
output kubeletClientId string = aks.properties.identityProfile.kubeletidentity.clientId
