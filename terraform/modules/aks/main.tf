variable "resource_group_name"  {}
variable "location"             {}
variable "prefix"               {}
variable "tags"                 {}
variable "subnet_id"            {}
variable "acr_id"               {}
variable "kubernetes_version"   { default = "1.28" }
variable "system_node_vm_size"  { default = "Standard_D2s_v3" }
variable "system_node_count"    { default = 1 }
variable "app_node_vm_size"     { default = "Standard_D4s_v3" }
variable "app_node_min_count"   { default = 2 }
variable "app_node_max_count"   { default = 8 }
variable "keyvault_id"          {}
variable "tenant_id"            {}
variable "log_analytics_id"     {}

resource "azurerm_kubernetes_cluster" "main" {
  name                = "aks-${var.prefix}"
  resource_group_name = var.resource_group_name
  location            = var.location
  dns_prefix          = var.prefix
  kubernetes_version  = var.kubernetes_version
  tags                = var.tags

  default_node_pool {
    name                         = "system"
    vm_size                      = var.system_node_vm_size
    node_count                   = var.system_node_count
    vnet_subnet_id               = var.subnet_id
    os_disk_size_gb              = 50
    type                         = "VirtualMachineScaleSets"
    only_critical_addons_enabled = true
    upgrade_settings { max_surge = "10%" }
  }

  identity { type = "SystemAssigned" }

  workload_identity_enabled = true
  oidc_issuer_enabled       = true

  network_profile {
    network_plugin    = "azure"
    network_policy    = "calico"
    load_balancer_sku = "standard"
    outbound_type     = "userAssignedNATGateway"
  }

  oms_agent {
    log_analytics_workspace_id = var.log_analytics_id
  }

  key_vault_secrets_provider {
    secret_rotation_enabled  = true
    secret_rotation_interval = "2m"
  }

  azure_policy_enabled = true

  lifecycle { ignore_changes = [default_node_pool[0].node_count] }
}

resource "azurerm_kubernetes_cluster_node_pool" "app" {
  name                  = "app"
  kubernetes_cluster_id = azurerm_kubernetes_cluster.main.id
  vm_size               = var.app_node_vm_size
  enable_auto_scaling   = true
  min_count             = var.app_node_min_count
  max_count             = var.app_node_max_count
  vnet_subnet_id        = var.subnet_id
  os_disk_size_gb       = 100
  node_labels           = { workload = "app" }
  upgrade_settings      { max_surge = "33%" }
  tags                  = var.tags
}

resource "azurerm_role_assignment" "acr_pull" {
  scope                = var.acr_id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_kubernetes_cluster.main.kubelet_identity[0].object_id
}

resource "azurerm_role_assignment" "kv_secrets_user" {
  scope                = var.keyvault_id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_kubernetes_cluster.main.kubelet_identity[0].object_id
}

output "id" {
  value = azurerm_kubernetes_cluster.main.id
}
output "name" {
  value = azurerm_kubernetes_cluster.main.name
}
output "kube_config" {
  value     = azurerm_kubernetes_cluster.main.kube_config[0]
  sensitive = true
}
output "kubelet_identity_client_id" {
  value = azurerm_kubernetes_cluster.main.kubelet_identity[0].client_id
}
output "kubelet_identity_object_id" {
  value = azurerm_kubernetes_cluster.main.kubelet_identity[0].object_id
}
output "oidc_issuer_url" {
  value = azurerm_kubernetes_cluster.main.oidc_issuer_url
}
output "ingress_ip" {
  value = ""
}
