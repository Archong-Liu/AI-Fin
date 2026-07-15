variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "us-east-1"
}

variable "project_prefix" {
  description = "Prefix for all resource names"
  type        = string
  default     = "yminsight"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "dev"
}

variable "aws_account_id" {
  description = "AWS account ID (for constructing the ECR image URI)"
  type        = string
  default     = "486868043998"
}

variable "create_github_oidc_provider" {
  description = "Create the GitHub Actions OIDC provider (set false if it already exists in the account)"
  type        = bool
  default     = true
}

variable "ses_email" {
  description = "SES sender/recipient email for on-demand notifications (verified in sandbox)"
  type        = string
  default     = "aaarrchong@gmail.com"
}

variable "bedrock_model_id" {
  description = "Bedrock model/inference-profile id used for the AI consult Lambda"
  type        = string
  default     = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
}
