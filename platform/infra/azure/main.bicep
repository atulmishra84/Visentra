@description('Azure region')
param location string = resourceGroup().location

@description('Name prefix for resources')
param prefix string = 'agentradar'

@description('Unique suffix to avoid global name collisions')
param uniqueSuffix string = uniqueString(resourceGroup().id)

@secure()
@description('PostgreSQL password')
param postgresPassword string

@secure()
@description('JWT signing secret (used by deploy.sh)')
param jwtSecret string = ''

@secure()
@description('Bootstrap admin password (used by deploy.sh)')
param bootstrapAdminPassword string = ''

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
  name: 'acr${take(replace(name, '-', ''), 40)}'
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: true
    publicNetworkAccess: 'Enabled'
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

resource postgres 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'postgres-${name}'
  location: location
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 5432
        transport: 'tcp'
      }
    }
    template: {
      containers: [
        {
          name: 'postgres'
          image: 'postgres:16-alpine'
          env: [
            { name: 'POSTGRES_USER', value: 'agentradar' }
            { name: 'POSTGRES_PASSWORD', value: postgresPassword }
            { name: 'POSTGRES_DB', value: 'agentradar' }
          ]
          resources: { cpu: json('0.5'), memory: '1Gi' }
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 1 }
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
output containerAppsEnvName string = cae.name
output postgresAppName string = postgres.name
output redisAppName string = redis.name
output neo4jAppName string = neo4j.name
output neo4jPassword string = neo4jPassword
output namePrefix string = name
output bootstrapAdminEmail string = bootstrapAdminEmail
output jwtSecretProvided bool = !empty(jwtSecret)
output bootstrapPasswordProvided bool = !empty(bootstrapAdminPassword)
