output "resource_group_name" {
  value = azurerm_resource_group.main.name
}

output "aks_name" {
  value = module.aks.name
}

output "acr_login_server" {
  value = module.acr.login_server
}

output "acr_name" {
  value = module.acr.name
}

output "keyvault_uri" {
  value = module.keyvault.uri
}

output "postgres_fqdn" {
  value = module.postgres.fqdn
}

output "redis_hostname" {
  value = module.redis.hostname
}

output "ingress_ip" {
  description = "Point your DNS A record to this IP"
  value       = module.aks.ingress_ip
}

output "platform_url" {
  value = "https://${var.domain}"
}

output "kube_config_command" {
  value = "az aks get-credentials --resource-group ${azurerm_resource_group.main.name} --name ${module.aks.name}"
}

output "acr_push_command" {
  value = "az acr login --name ${module.acr.name} && docker tag agentRadar:latest ${module.acr.login_server}/agentRadar:latest && docker push ${module.acr.login_server}/agentRadar:latest"
}

output "kubelet_identity_client_id" {
  value = module.aks.kubelet_identity_client_id
}
