##############################################################
# AgentRadar Standalone — Variable Definitions
##############################################################

variable "subscription_id" {
  description = "Azure subscription ID to deploy into"
  type        = string
}

variable "location" {
  description = "Azure region (e.g. westeurope, eastus)"
  type        = string
  default     = "westeurope"
}

variable "location_short" {
  description = "Short location code for resource naming"
  type        = string
  default     = "we"
}

variable "project" {
  description = "Project name used in all resource names"
  type        = string
  default     = "agentRadar"
}

variable "env" {
  description = "Environment: prod | staging | dev"
  type        = string
  default     = "prod"
}

variable "domain" {
  description = "Public domain for the platform (e.g. agentRadar.company.com)"
  type        = string
}

variable "alert_email" {
  description = "Email for Azure Monitor alerts"
  type        = string
}

variable "image_tag" {
  description = "Docker image tag to deploy"
  type        = string
  default     = "latest"
}

# ── Networking ────────────────────────────────────────────
variable "create_vnet" {
  description = "Create a new VNet (true) or use existing (false)"
  type        = bool
  default     = true
}

variable "vnet_address_space" {
  description = "VNet CIDR (only used when create_vnet = true)"
  type        = string
  default     = "10.1.0.0/16"
}

variable "aks_subnet_cidr" {
  type    = string
  default = "10.1.0.0/22"
}

variable "data_subnet_cidr" {
  type    = string
  default = "10.1.8.0/24"
}

variable "appgw_subnet_cidr" {
  type    = string
  default = "10.1.9.0/24"
}

variable "existing_vnet_id" {
  description = "Existing VNet resource ID (when create_vnet = false)"
  type        = string
  default     = ""
}

variable "existing_aks_subnet_id" {
  description = "Existing subnet ID for AKS nodes"
  type        = string
  default     = ""
}

variable "existing_data_subnet_id" {
  description = "Existing subnet ID for data services"
  type        = string
  default     = ""
}

# ── AKS ───────────────────────────────────────────────────
variable "kubernetes_version" {
  type    = string
  default = "1.28"
}

variable "aks_system_vm_size" {
  type    = string
  default = "Standard_D2s_v3"
}

variable "aks_system_node_count" {
  type    = number
  default = 1
}

variable "aks_app_vm_size" {
  type    = string
  default = "Standard_D4s_v3"
}

variable "aks_app_min_count" {
  type    = number
  default = 2
}

variable "aks_app_max_count" {
  type    = number
  default = 8
}

# ── Postgres ──────────────────────────────────────────────
variable "postgres_sku" {
  description = "PostgreSQL Flexible Server SKU"
  type        = string
  default     = "GP_Standard_D2ds_v5"
}

variable "postgres_storage_mb" {
  type    = number
  default = 131072   # 100GB
}

variable "postgres_ha_enabled" {
  type    = bool
  default = true
}

variable "postgres_backup_days" {
  type    = number
  default = 35
}

# ── Redis ─────────────────────────────────────────────────
variable "redis_sku" {
  type    = string
  default = "Standard"
}

variable "redis_family" {
  type    = string
  default = "C"
}

variable "redis_capacity" {
  type    = number
  default = 2
}

# ── ACR ───────────────────────────────────────────────────
variable "acr_sku" {
  type    = string
  default = "Basic"
}

# ── Scanner ───────────────────────────────────────────────
variable "scan_ranges" {
  description = "Comma-separated CIDR ranges for network scanner"
  type        = string
  default     = "10.0.0.0/8"
}

# ── Secrets (sensitive — pass via env var or tfvars.secret) ─
variable "anthropic_api_key" {
  description = "Anthropic / OpenAI / Azure OAI key for AI Agent panel"
  type        = string
  sensitive   = true
  default     = ""
}
