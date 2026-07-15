variable "project_prefix" {
  type    = string
  default = "yminsight"
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "api_id" {
  description = "HTTP API id to attach the /api/consult route to"
  type        = string
}

variable "api_execution_arn" {
  description = "HTTP API execution ARN (for the lambda invoke permission)"
  type        = string
}

variable "api_endpoint" {
  description = "HTTP API base URL (for the consult_url output only)"
  type        = string
}

variable "bedrock_model_id" {
  description = "Bedrock model/inference-profile id used for AI consult"
  type        = string
  default     = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
}
