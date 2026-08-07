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

@description('Data plane: eval = container Postgres/Neo4j; production = Flexible Server + Key Vault + durable Neo4j volume')
@allowed(['eval', 'production'])
param dataPlaneMode string = 'eval'

@description('Administrator login for Flexible Server (production mode)')
param postgresAdminLogin string = 'agentradar'

var name = toLower('${prefix}${uniqueSuffix}')
var neo4jPassword = 'AgentRadar!${take(uniqueSuffix, 8)}'
var isProduction = dataPlaneMode == 'production'
var kvName = 'kv${take(replace(name, '-', ''), 20)}'
var pgServerName = 'psql-${take(name, 50)}'
var storageName = take('st${replace(name, '-', '')}', 24)

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

// ----- Eval data plane: containerized Postgres -----
resource postgresContainer 'Microsoft.App/containerApps@2024-03-01' = if (!isProduction) {
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

// ----- Production data plane: Flexible Server -----
resource postgresFlexible 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = if (isProduction) {
  name: pgServerName
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresPassword
    storage: { storageSizeGB: 32 }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: { mode: 'Disabled' }
    authConfig: {
      activeDirectoryAuth: 'Disabled'
      passwordAuth: 'Enabled'
    }
  }
}

resource postgresFirewallAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-12-01-preview' = if (isProduction) {
  parent: postgresFlexible
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource postgresDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-12-01-preview' = if (isProduction) {
  parent: postgresFlexible
  name: 'agentradar'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// ----- Key Vault (production) -----
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = if (isProduction) {
  name: kvName
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    publicNetworkAccess: 'Enabled'
  }
}

// ----- Durable Neo4j volume (production) -----
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = if (isProduction) {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource fileShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = if (isProduction) {
  name: '${storageAccount.name}/default/neo4j-data'
  properties: {
    shareQuota: 100
  }
}

resource neo4jStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = if (isProduction) {
  parent: cae
  name: 'neo4jfiles'
  properties: {
    azureFile: {
      accountName: storageAccount.name
      accountKey: storageAccount.listKeys().keys[0].value
      shareName: 'neo4j-data'
      accessMode: 'ReadWrite'
    }
  }
  dependsOn: [
    fileShare
  ]
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
          env: concat(
            [
              { name: 'NEO4J_AUTH', value: 'neo4j/${neo4jPassword}' }
              { name: 'NEO4J_server_memory_heap_initial__size', value: '256m' }
              { name: 'NEO4J_server_memory_heap_max__size', value: '512m' }
            ],
            isProduction
              ? [
                  { name: 'NEO4J_server_directories_data', value: '/data/data' }
                  { name: 'NEO4J_server_directories_logs', value: '/data/logs' }
                ]
              : []
          )
          resources: { cpu: json('0.5'), memory: '1Gi' }
          volumeMounts: isProduction
            ? [
                {
                  volumeName: 'neo4j-data'
                  mountPath: '/data'
                }
              ]
            : []
        }
      ]
      volumes: isProduction
        ? [
            {
              name: 'neo4j-data'
              storageType: 'AzureFile'
              storageName: 'neo4jfiles'
            }
          ]
        : []
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
  dependsOn: isProduction ? [neo4jStorage] : []
}

output resourceGroupName string = resourceGroup().name
output location string = location
output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output containerAppsEnvName string = cae.name
output postgresAppName string = isProduction ? pgServerName : 'postgres-${name}'
output postgresHost string = isProduction ? '${pgServerName}.postgres.database.azure.com' : 'postgres-${name}'
output postgresPort int = 5432
output postgresUser string = isProduction ? postgresAdminLogin : 'agentradar'
output postgresDbName string = 'agentradar'
output dataPlaneMode string = dataPlaneMode
output keyVaultName string = isProduction ? kvName : ''
output keyVaultUri string = isProduction ? 'https://${kvName}${environment().suffixes.keyvaultDns}/' : ''

output neo4jAppName string = neo4j.name
output neo4jPassword string = neo4jPassword
output namePrefix string = name
output bootstrapAdminEmail string = bootstrapAdminEmail
output jwtSecretProvided bool = !empty(jwtSecret)
output bootstrapPasswordProvided bool = !empty(bootstrapAdminPassword)
