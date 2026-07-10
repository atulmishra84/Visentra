@description('Azure region')
param location string = resourceGroup().location

@description('Name prefix for resources')
param prefix string = 'agentradar'

@description('Unique suffix to avoid global name collisions')
param uniqueSuffix string = uniqueString(resourceGroup().id)

@secure()
@description('PostgreSQL admin password')
param postgresPassword string

@secure()
@description('JWT signing secret (reserved for app deploy step)')
param jwtSecret string = 'unused-in-infra-phase'

@secure()
@description('Bootstrap admin password (reserved for app deploy step)')
param bootstrapAdminPassword string = 'unused-in-infra-phase'

@description('Bootstrap admin email')
param bootstrapAdminEmail string = 'admin@agentradar.local'

var name = toLower('${prefix}${uniqueSuffix}')
var neo4jPassword = 'AgentRadar!${take(uniqueSuffix, 8)}'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: 'log-${name}'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'acr${take(name, 40)}'
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: true
    publicNetworkAccess: 'Enabled'
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = {
  name: 'psql-${name}'
  location: location
  sku: {
    name: 'Standard_B2s'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: 'agentradar'
    administratorLoginPassword: postgresPassword
    storage: { storageSizeGB: 32 }
    backup: { backupRetentionDays: 7 }
    highAvailability: { mode: 'Disabled' }
  }
}

resource postgresDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-12-01-preview' = {
  parent: postgres
  name: 'agentradar'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource postgresFirewallAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-12-01-preview' = {
  parent: postgres
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource cae 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${name}'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

resource redis 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'redis-${name}'
  location: location
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 6379
        transport: 'tcp'
        allowInsecure: true
      }
    }
    template: {
      containers: [
        {
          name: 'redis'
          image: 'redis:7-alpine'
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
}

resource neo4j 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'neo4j-${name}'
  location: location
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 7687
        transport: 'tcp'
        allowInsecure: true
      }
    }
    template: {
      containers: [
        {
          name: 'neo4j'
          image: 'neo4j:5-community'
          env: [
            { name: 'NEO4J_AUTH', value: 'neo4j/${neo4jPassword}' }
            { name: 'NEO4J_server_memory_heap_initial__size', value: '256m' }
            { name: 'NEO4J_server_memory_heap_max__size', value: '512m' }
          ]
          resources: { cpu: json('0.5'), memory: '1Gi' }
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
}

output resourceGroupName string = resourceGroup().name
output location string = location
output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output postgresFqdn string = postgres.properties.fullyQualifiedDomainName
output containerAppsEnvName string = cae.name
output redisAppName string = redis.name
output neo4jAppName string = neo4j.name
output neo4jPassword string = neo4jPassword
output namePrefix string = name
output bootstrapAdminEmail string = bootstrapAdminEmail
output jwtSecretProvided bool = !empty(jwtSecret)
output bootstrapPasswordProvided bool = !empty(bootstrapAdminPassword)
