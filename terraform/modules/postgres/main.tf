##############################################################
# Module: PostgreSQL Flexible Server
##############################################################
variable "resource_group_name" {}
variable "location" {}
variable "prefix" {}
variable "tags" {}
variable "subnet_id" { default = "" }
variable "admin_password" { sensitive = true }
variable "sku_name" {}
variable "storage_mb" {}
variable "ha_enabled" {}
variable "backup_retention_days" {}

resource "azurerm_postgresql_flexible_server" "main" {
  name                   = lower("psql-${var.prefix}")
  resource_group_name    = var.resource_group_name
  location               = var.location
  version                = "16"
  administrator_login    = "agentradar"
  administrator_password = var.admin_password
  sku_name               = "GP_Standard_D2ds_v5"
  storage_mb             = 131072
  backup_retention_days         = var.backup_retention_days
  public_network_access_enabled = true
  geo_redundant_backup_enabled = false

  dynamic "high_availability" {
    for_each = var.ha_enabled ? [1] : []
    content { mode = "ZoneRedundant" }
  }

  maintenance_window {
    day_of_week  = 0
    start_hour   = 2
    start_minute = 0
  }

  tags = var.tags
  lifecycle { ignore_changes = [zone, high_availability[0].standby_availability_zone] }
}

resource "azurerm_postgresql_flexible_server_database" "agentRadar" {
  name      = "agentradar"
  server_id = azurerm_postgresql_flexible_server.main.id
  collation = "en_US.utf8"
  charset   = "utf8"
}

resource "azurerm_postgresql_flexible_server_configuration" "ssl" {
  name      = "require_secure_transport"
  server_id = azurerm_postgresql_flexible_server.main.id
  value     = "on"
}

output "fqdn"      { value = azurerm_postgresql_flexible_server.main.fqdn }
output "server_id" { value = azurerm_postgresql_flexible_server.main.id }

resource "azurerm_postgresql_flexible_server_firewall_rule" "azure_services" {
  name             = "AllowAzureServices"
  server_id        = azurerm_postgresql_flexible_server.main.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}
