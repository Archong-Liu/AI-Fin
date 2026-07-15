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

variable "github_owner" {
  description = "GitHub org/user that owns the repo"
  type        = string
  default     = "Archong-Liu"
}

variable "github_repo" {
  description = "GitHub repository name"
  type        = string
  default     = "AI-Fin"
}

variable "github_branch" {
  description = "Branch allowed to assume the deploy role"
  type        = string
  default     = "main"
}

variable "frontend_bucket_arn" {
  description = "ARN of the frontend S3 bucket the pipeline deploys to"
  type        = string
}

variable "cloudfront_distribution_arn" {
  description = "ARN of the CloudFront distribution to invalidate"
  type        = string
}

variable "create_oidc_provider" {
  description = "Create the GitHub OIDC provider. Set false if one already exists in the account."
  type        = bool
  default     = true
}
