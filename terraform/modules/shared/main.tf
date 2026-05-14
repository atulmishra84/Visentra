##############################################################
# Module: Azure Cache for Redis
##############################################################
variable "resource_group_name" {}
variable "location" {}
variable "prefix" {}
variable "tags" {}
variable "subnet_id" {}
variable "sku_name" {}
variable "family" {}
variable "capacity" {}

resource "azurerm_redis_cache" "main" {
  name                          = "redis-${var.prefix}"
  resource_group_name           = var.resource_group_name
  location                      = var.location
  capacity                      = var.capacity
  family                        = var.family
  sku_name                      = var.sku_name
  enable_non_ssl_port           = false
  minimum_tls_version           = "1.2"
  public_network_access_enabled = false
  tags                          = var.tags

  redis_configuration {
    enable_authentication = true
    maxmemory_policy      = "allkeys-lru"
  }
}

resource "azurerm_private_endpoint" "redis" {
  name                = "pe-redis-${var.prefix}"
  resource_group_name = var.resource_group_name
  location            = var.location
  subnet_id           = var.subnet_id
  tags                = var.tags

  private_service_connection {
    name                           = "psc-redis-${var.prefix}"
    private_connection_resource_id = azurerm_redis_cache.main.id
    subresource_names              = ["redisCache"]
    is_manual_connection           = false
  }
}

output "hostname"     { value = azurerm_redis_cache.main.hostname }
output "ssl_port"     { value = azurerm_redis_cache.main.ssl_port }
output "primary_key"  { value = azurerm_redis_cache.main.primary_access_key sensitive = true }


##############################################################
# Module: Azure Key Vault
##############################################################
variable "resource_group_name" {}
variable "location" {}
variable "prefix" {}
variable "tags" {}
variable "tenant_id" {}
variable "subnet_id" {}
variable "vnet_id" {}
variable "secrets" { type = map(string) sensitive = true }

resource "azurerm_key_vault" "main" {
  name                          = "kv-${var.prefix}"
  resource_group_name           = var.resource_group_name
  location                      = var.location
  tenant_id                     = var.tenant_id
  sku_name                      = "standard"
  soft_delete_retention_days    = 7
  purge_protection_enabled      = true
  public_network_access_enabled = false

  network_acls {
    default_action             = "Deny"
    bypass                     = "AzureServices"
    virtual_network_subnet_ids = [var.subnet_id]
  }

  tags = var.tags
}

# Store all secrets
resource "azurerm_key_vault_secret" "secrets" {
  for_each     = var.secrets
  name         = each.key
  value        = each.value
  key_vault_id = azurerm_key_vault.main.id
}

resource "azurerm_private_endpoint" "keyvault" {
  name                = "pe-kv-${var.prefix}"
  resource_group_name = var.resource_group_name
  location            = var.location
  subnet_id           = var.subnet_id
  tags                = var.tags

  private_service_connection {
    name                           = "psc-kv-${var.prefix}"
    private_connection_resource_id = azurerm_key_vault.main.id
    subresource_names              = ["vault"]
    is_manual_connection           = false
  }
}

output "id"  { value = azurerm_key_vault.main.id }
output "uri" { value = azurerm_key_vault.main.vault_uri }
output "name" { value = azurerm_key_vault.main.name }


##############################################################
# Module: Azure Container Registry
##############################################################
variable "resource_group_name" {}
variable "location" {}
variable "prefix" {}
variable "tags" {}
variable "sku" {}

resource "azurerm_container_registry" "main" {
  name                     = replace("acr${var.prefix}", "-", "")
  resource_group_name      = var.resource_group_name
  location                 = var.location
  sku                      = var.sku
  admin_enabled            = false
  zone_redundancy_enabled  = false
  tags                     = var.tags
}

output "id"           { value = azurerm_container_registry.main.id }
output "name"         { value = azurerm_container_registry.main.name }
output "login_server" { value = azurerm_container_registry.main.login_server }


##############################################################
# Module: Monitoring (Log Analytics + App Insights + Alerts)
##############################################################
variable "resource_group_name" {}
variable "location" {}
variable "prefix" {}
variable "tags" {}
variable "aks_id" {}
variable "alert_email" {}

resource "azurerm_log_analytics_workspace" "main" {
  name                = "law-${var.prefix}"
  resource_group_name = var.resource_group_name
  location            = var.location
  sku                 = "PerGB2018"
  retention_in_days   = 90
  tags                = var.tags
}

resource "azurerm_application_insights" "main" {
  name                = "appi-${var.prefix}"
  resource_group_name = var.resource_group_name
  location            = var.location
  workspace_id        = azurerm_log_analytics_workspace.main.id
  application_type    = "web"
  tags                = var.tags
}

# Action group for alerts
resource "azurerm_monitor_action_group" "main" {
  name                = "ag-${var.prefix}"
  resource_group_name = var.resource_group_name
  short_name          = "agentRadar"
  tags                = var.tags

  email_receiver {
    name                    = "security-team"
    email_address           = var.alert_email
    use_common_alert_schema = true
  }
}

# Alert: AKS node CPU > 80%
resource "azurerm_monitor_metric_alert" "cpu" {
  name                = "alert-aks-cpu-${var.prefix}"
  resource_group_name = var.resource_group_name
  scopes              = [var.aks_id]
  description         = "AKS node CPU over 80% for 5 minutes"
  severity            = 2
  frequency           = "PT5M"
  window_size         = "PT15M"
  tags                = var.tags

  criteria {
    metric_namespace = "Microsoft.ContainerService/managedClusters"
    metric_name      = "node_cpu_usage_percentage"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 80
  }

  action { action_group_id = azurerm_monitor_action_group.main.id }
}

output "log_analytics_id"               { value = azurerm_log_analytics_workspace.main.id }
output "app_insights_connection_string" { value = azurerm_application_insights.main.connection_string sensitive = true }
output "app_insights_key"               { value = azurerm_application_insights.main.instrumentation_key sensitive = true }
