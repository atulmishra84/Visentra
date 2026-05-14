terraform {
  required_version = ">= 1.6"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.100"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 2.50"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  backend "azurerm" {
    resource_group_name  = "rg-agentRadar-tfstate-we"
    storage_account_name = "staragentradartfwe643555"
    container_name       = "tfstate"
    key                  = "agentRadar/prod/terraform.tfstate"
  }
}

provider "azurerm" {
  features {
    resource_group {
      prevent_deletion_if_contains_resources = false
    }
    key_vault {
      purge_soft_delete_on_destroy    = true
      recover_soft_deleted_key_vaults = true
    }
  }
  subscription_id = var.subscription_id
}

provider "azuread" {}
provider "random"   {}

data "azurerm_client_config" "current" {}
data "azurerm_subscription"  "current" {}

resource "azurerm_resource_group" "main" {
  name     = "rg-${var.project}-${var.env}-${var.location_short}"
  location = var.location
  tags     = local.tags
}

locals {
  prefix = "${var.project}-${var.env}"
  tags = {
    project     = var.project
    environment = var.env
    managed_by  = "terraform"
  }
}

module "networking" {
  source = "../modules/networking"

  resource_group_name     = azurerm_resource_group.main.name
  location                = var.location
  prefix                  = local.prefix
  tags                    = local.tags
  vnet_address_space      = var.vnet_address_space
  aks_subnet_cidr         = var.aks_subnet_cidr
  data_subnet_cidr        = var.data_subnet_cidr
  appgw_subnet_cidr       = var.appgw_subnet_cidr
  create_vnet             = var.create_vnet
  existing_vnet_id        = var.existing_vnet_id
  existing_aks_subnet_id  = var.existing_aks_subnet_id
  existing_data_subnet_id = var.existing_data_subnet_id
}

module "acr" {
  source = "../modules/acr"

  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  prefix              = local.prefix
  tags                = local.tags
  sku                 = var.acr_sku
}

module "keyvault" {
  source = "../modules/keyvault"

  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  prefix              = local.prefix
  tags                = local.tags
  tenant_id           = data.azurerm_client_config.current.tenant_id
  subnet_id           = module.networking.data_subnet_id
  vnet_id             = module.networking.vnet_id

  secrets = {
    db-password       = random_password.db.result
    jwt-secret        = random_password.jwt.result
    encryption-key    = random_password.enc.result
    redis-password    = random_password.redis.result
    internal-api-key  = random_password.api.result
    scanner-api-key   = random_password.scanner.result
    anthropic-api-key = var.anthropic_api_key
  }
}

module "postgres" {
  source = "../modules/postgres"

  resource_group_name   = azurerm_resource_group.main.name
  location              = var.location
  prefix                = local.prefix
  tags                  = local.tags
  admin_password        = random_password.db.result
  sku_name              = var.postgres_sku
  storage_mb            = var.postgres_storage_mb
  ha_enabled            = var.postgres_ha_enabled
  backup_retention_days = var.postgres_backup_days
}

module "redis" {
  source = "../modules/redis"

  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  prefix              = local.prefix
  tags                = local.tags
  subnet_id           = module.networking.data_subnet_id
  sku_name            = var.redis_sku
  family              = var.redis_family
  capacity            = var.redis_capacity
}

module "monitoring" {
  source = "../modules/monitoring"

  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  prefix              = local.prefix
  tags                = local.tags
  aks_id              = module.aks.id
  alert_email         = var.alert_email
}

module "aks" {
  source = "../modules/aks"

  resource_group_name  = azurerm_resource_group.main.name
  location             = var.location
  prefix               = local.prefix
  tags                 = local.tags
  subnet_id            = module.networking.aks_subnet_id
  acr_id               = module.acr.id
  kubernetes_version   = var.kubernetes_version
  system_node_vm_size  = var.aks_system_vm_size
  system_node_count    = var.aks_system_node_count
  app_node_vm_size     = var.aks_app_vm_size
  app_node_min_count   = var.aks_app_min_count
  app_node_max_count   = var.aks_app_max_count
  keyvault_id          = module.keyvault.id
  tenant_id            = data.azurerm_client_config.current.tenant_id
  log_analytics_id     = module.monitoring.log_analytics_id
}

resource "random_password" "db" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "random_password" "jwt" {
  length  = 64
  special = false
}

resource "random_password" "enc" {
  length  = 32
  special = false
}

resource "random_password" "redis" {
  length  = 32
  special = false
}

resource "random_password" "api" {
  length  = 32
  special = false
}

resource "random_password" "scanner" {
  length  = 32
  special = false
}
