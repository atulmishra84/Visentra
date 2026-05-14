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

resource "azurerm_monitor_action_group" "main" {
  name                = "ag-${var.prefix}"
  resource_group_name = var.resource_group_name
  short_name          = "agntRadar"
  tags                = var.tags

  email_receiver {
    name                    = "security-team"
    email_address           = var.alert_email
    use_common_alert_schema = true
  }
}

resource "azurerm_monitor_metric_alert" "cpu" {
  name                = "alert-aks-cpu-${var.prefix}"
  resource_group_name = var.resource_group_name
  scopes              = [var.aks_id]
  description         = "AKS node CPU over 80%"
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

output "log_analytics_id" { value = azurerm_log_analytics_workspace.main.id }
output "app_insights_connection_string" {
  value     = azurerm_application_insights.main.connection_string
  sensitive = true
}
