variable "resource_group_name" {}
variable "location" {}
variable "prefix" {}
variable "tags" {}
variable "sku" { default = "Basic" }

resource "azurerm_container_registry" "main" {
  name                = replace("acr${var.prefix}", "-", "")
  resource_group_name = var.resource_group_name
  location            = var.location
  sku                 = var.sku
  admin_enabled       = false
  tags                = var.tags
}

output "id"           { value = azurerm_container_registry.main.id }
output "name"         { value = azurerm_container_registry.main.name }
output "login_server" { value = azurerm_container_registry.main.login_server }
