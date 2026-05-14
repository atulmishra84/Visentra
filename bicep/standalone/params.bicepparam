// AgentRadar Standalone — Bicep Parameters
// Usage: az deployment sub create --location westeurope \
//          --template-file main.bicep --parameters @params.bicepparam

using './main.bicep'

// ── Required — fill these in ──────────────────────────────
param domain     = 'agentRadar.yourcompany.com'
param alertEmail = 'security-team@yourcompany.com'

// ── Region & naming ───────────────────────────────────────
param location      = 'westeurope'
param locationShort = 'we'
param env           = 'prod'
param project       = 'agentRadar'

// ── Networking ────────────────────────────────────────────
// Set createVnet = false and fill existing*Id to reuse your VNet
param createVnet        = true
param vnetAddressSpace  = '10.1.0.0/16'
param aksSubnetCidr     = '10.1.0.0/22'
param dataSubnetCidr    = '10.1.8.0/24'
// param existingVnetId        = '/subscriptions/.../virtualNetworks/your-vnet'
// param existingAksSubnetId   = '/subscriptions/.../subnets/aks'
// param existingDataSubnetId  = '/subscriptions/.../subnets/data'

// ── Compute ───────────────────────────────────────────────
param aksVmSize   = 'Standard_D4s_v3'   // Standard_D2s_v3 for pilot
param aksMinNodes = 2
param aksMaxNodes = 8

// ── Database ──────────────────────────────────────────────
param postgresSku = 'Standard_D2ds_v5'
param postgresHa  = true                // false saves ~$90/mo on pilot

// ── Redis ─────────────────────────────────────────────────
param redisCapacity = 2

// ── Scanner ───────────────────────────────────────────────
param scanRanges = '10.0.0.0/8,192.168.0.0/16'

// ── AI API key (stored in Key Vault — not in state file) ──
// Pass via: --parameters aiApiKey='sk-ant-...'
// Or: export BICEP_PARAM_aiApiKey='sk-ant-...'
param aiApiKey = ''

// ── Image tag ─────────────────────────────────────────────
param imageTag = 'latest'
