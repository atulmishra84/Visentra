variable "resource_group_name" {}
variable "location"            {}
variable "prefix"              {}
variable "tags"                {}
variable "tenant_id"           {}
variable "subnet_id"           {}
variable "vnet_id"             {}
variable "secrets" {
  type    = map(string)
  default = {}
}

resource "azurerm_key_vault" "main" {
  name                          = "kv-${var.prefix}"
  resource_group_name           = var.resource_group_name
  location                      = var.location
  tenant_id                     = var.tenant_id
  sku_name                      = "standard"
  soft_delete_retention_days    = 7
  purge_protection_enabled      = true
  public_network_access_enabled = true
  tags                          = var.tags
}

resource "azurerm_key_vault_access_policy" "terraform" {
  key_vault_id = azurerm_key_vault.main.id
  tenant_id    = var.tenant_id
  object_id    = "8c71f75f-03af-4a61-bbaa-7009f9706e27"

  secret_permissions = [
    "Get", "List", "Set", "Delete", "Purge", "Recover", "Backup", "Restore"
  ]
}

resource "azurerm_key_vault_secret" "db_password" {
  name         = "db-password"
  value        = lookup(var.secrets, "db-password", "")
  key_vault_id = azurerm_key_vault.main.id
  depends_on   = [azurerm_key_vault_access_policy.terraform]
}

resource "azurerm_key_vault_secret" "jwt_secret" {
  name         = "jwt-secret"
  value        = lookup(var.secrets, "jwt-secret", "")
  key_vault_id = azurerm_key_vault.main.id
  depends_on   = [azurerm_key_vault_access_policy.terraform]
}

resource "azurerm_key_vault_secret" "encryption_key" {
  name         = "encryption-key"
  value        = lookup(var.secrets, "encryption-key", "")
  key_vault_id = azurerm_key_vault.main.id
  depends_on   = [azurerm_key_vault_access_policy.terraform]
}

resource "azurerm_key_vault_secret" "redis_password" {
  name         = "redis-password"
  value        = lookup(var.secrets, "redis-password", "")
  key_vault_id = azurerm_key_vault.main.id
  depends_on   = [azurerm_key_vault_access_policy.terraform]
}

resource "azurerm_key_vault_secret" "internal_api_key" {
  name         = "internal-api-key"
  value        = lookup(var.secrets, "internal-api-key", "")
  key_vault_id = azurerm_key_vault.main.id
  depends_on   = [azurerm_key_vault_access_policy.terraform]
}

resource "azurerm_key_vault_secret" "scanner_api_key" {
  name         = "scanner-api-key"
  value        = lookup(var.secrets, "scanner-api-key", "")
  key_vault_id = azurerm_key_vault.main.id
  depends_on   = [azurerm_key_vault_access_policy.terraform]
}

resource "azurerm_key_vault_secret" "anthropic_api_key" {
  name         = "anthropic-api-key"
  value        = lookup(var.secrets, "anthropic-api-key", "")
  key_vault_id = azurerm_key_vault.main.id
  depends_on   = [azurerm_key_vault_access_policy.terraform]
}

output "id"   { value = azurerm_key_vault.main.id }
output "uri"  { value = azurerm_key_vault.main.vault_uri }
output "name" { value = azurerm_key_vault.main.name }
