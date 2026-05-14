variable "resource_group_name" {}
variable "location"            {}
variable "prefix"              {}
variable "tags"                {}
variable "subnet_id"           {}
variable "sku_name"            { default = "Standard" }
variable "family"              { default = "C" }
variable "capacity"            { default = 1 }

resource "azurerm_redis_cache" "main" {
  name                          = "redis-${var.prefix}"
  resource_group_name           = var.resource_group_name
  location                      = var.location
  capacity                      = var.capacity
  family                        = var.family
  sku_name                      = var.sku_name
  non_ssl_port_enabled          = false
  minimum_tls_version           = "1.2"
  public_network_access_enabled = true
  tags                          = var.tags

  redis_configuration {
    authentication_enabled = true
    maxmemory_policy       = "allkeys-lru"
  }
}

output "hostname" {
  value = azurerm_redis_cache.main.hostname
}

output "ssl_port" {
  value = azurerm_redis_cache.main.ssl_port
}

output "primary_key" {
  value     = azurerm_redis_cache.main.primary_access_key
  sensitive = true
}
