variable "project_prefix" {
  description = "Prefix for all resource names"
  type        = string
  default     = "yminsight"
}

variable "environment" {
  description = "Environment name (dev/prod)"
  type        = string
  default     = "dev"
}
