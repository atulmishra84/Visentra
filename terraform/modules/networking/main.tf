variable "resource_group_name" {}
variable "location" {}
variable "prefix" {}
variable "tags" {}
variable "vnet_address_space" {}
variable "aks_subnet_cidr" {}
variable "data_subnet_cidr" {}
variable "appgw_subnet_cidr" {}
variable "create_vnet" { default = true }
variable "existing_vnet_id" { default = "" }
variable "existing_aks_subnet_id" { default = "" }
variable "existing_data_subnet_id" { default = "" }

# ── Create or reference VNet ──────────────────────────────
resource "azurerm_virtual_network" "main" {
  count               = var.create_vnet ? 1 : 0
  name                = "vnet-${var.prefix}"
  resource_group_name = var.resource_group_name
  location            = var.location
  address_space       = [var.vnet_address_space]
  tags                = var.tags
}

locals {
  vnet_id = var.create_vnet ? azurerm_virtual_network.main[0].id : var.existing_vnet_id
}

# ── Subnets ───────────────────────────────────────────────
resource "azurerm_subnet" "aks" {
  count                = var.create_vnet ? 1 : 0
  name                 = "snet-aks-${var.prefix}"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.main[0].name
  address_prefixes     = [var.aks_subnet_cidr]
  service_endpoints    = ["Microsoft.ContainerRegistry", "Microsoft.KeyVault"]
}

resource "azurerm_subnet" "data" {
  count                = var.create_vnet ? 1 : 0
  name                 = "snet-data-${var.prefix}"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.main[0].name
  address_prefixes     = [var.data_subnet_cidr]
  service_endpoints    = ["Microsoft.KeyVault", "Microsoft.Storage"]
  delegation {
    name = "fs"
    service_delegation {
      name    = "Microsoft.DBforPostgreSQL/flexibleServers"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

resource "azurerm_subnet" "appgw" {
  count                = var.create_vnet ? 1 : 0
  name                 = "snet-appgw-${var.prefix}"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.main[0].name
  address_prefixes     = [var.appgw_subnet_cidr]
}

# ── NAT Gateway (scanner egress) ─────────────────────────
resource "azurerm_public_ip" "nat" {
  name                = "pip-nat-${var.prefix}"
  resource_group_name = var.resource_group_name
  location            = var.location
  allocation_method   = "Static"
  sku                 = "Standard"
  tags                = var.tags
}

resource "azurerm_nat_gateway" "main" {
  name                = "natgw-${var.prefix}"
  resource_group_name = var.resource_group_name
  location            = var.location
  sku_name            = "Standard"
  tags                = var.tags
}

resource "azurerm_nat_gateway_public_ip_association" "main" {
  nat_gateway_id       = azurerm_nat_gateway.main.id
  public_ip_address_id = azurerm_public_ip.nat.id
}

resource "azurerm_subnet_nat_gateway_association" "aks" {
  count          = var.create_vnet ? 1 : 0
  subnet_id      = azurerm_subnet.aks[0].id
  nat_gateway_id = azurerm_nat_gateway.main.id
}

# ── Network Security Groups ───────────────────────────────
resource "azurerm_network_security_group" "aks" {
  name                = "nsg-aks-${var.prefix}"
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags

  security_rule {
    name                       = "AllowHTTPS"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "AllowScannerAPI"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "8910"
    source_address_prefix      = "VirtualNetwork"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "DenyAllInbound"
    priority                   = 4000
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
}

resource "azurerm_network_security_group" "data" {
  name                = "nsg-data-${var.prefix}"
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags

  security_rule {
    name                       = "AllowAKStoPostgres"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "5432"
    source_address_prefix      = var.aks_subnet_cidr
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "AllowAKStoRedis"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "6380"
    source_address_prefix      = var.aks_subnet_cidr
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "DenyAllInbound"
    priority                   = 4000
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "Internet"
    destination_address_prefix = "*"
  }
}

# ── Subnet NSG associations ───────────────────────────────
resource "azurerm_subnet_network_security_group_association" "aks" {
  count                     = var.create_vnet ? 1 : 0
  subnet_id                 = azurerm_subnet.aks[0].id
  network_security_group_id = azurerm_network_security_group.aks.id
}

resource "azurerm_subnet_network_security_group_association" "data" {
  count                     = var.create_vnet ? 1 : 0
  subnet_id                 = azurerm_subnet.data[0].id
  network_security_group_id = azurerm_network_security_group.data.id
}

# ── Private DNS zones (for private endpoints) ─────────────
resource "azurerm_private_dns_zone" "postgres" {
  name                = "privatelink.postgres.database.azure.com"
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "postgres" {
  name                  = "pdnslink-pg-${var.prefix}"
  resource_group_name   = var.resource_group_name
  private_dns_zone_name = azurerm_private_dns_zone.postgres.name
  virtual_network_id    = local.vnet_id
  registration_enabled  = false
}

# ── Outputs ───────────────────────────────────────────────
output "vnet_id"              { value = local.vnet_id }
output "aks_subnet_id"        { value = var.create_vnet ? azurerm_subnet.aks[0].id  : var.existing_aks_subnet_id }
output "data_subnet_id"       { value = var.create_vnet ? azurerm_subnet.data[0].id : var.existing_data_subnet_id }
output "appgw_subnet_id"      { value = var.create_vnet ? azurerm_subnet.appgw[0].id : "" }
output "nat_public_ip"        { value = azurerm_public_ip.nat.ip_address }
output "pg_private_dns_zone_id" { value = azurerm_private_dns_zone.postgres.id }
