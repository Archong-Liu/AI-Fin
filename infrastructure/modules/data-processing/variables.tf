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

variable "raw_bucket_arn" {
  description = "ARN of the raw-data bucket"
  type        = string
}

variable "raw_bucket_id" {
  description = "Name of the raw-data bucket"
  type        = string
}

variable "processed_bucket_arn" {
  description = "ARN of the processed-data bucket"
  type        = string
}

variable "processed_bucket_id" {
  description = "Name of the processed-data bucket"
  type        = string
}

variable "etl_image_uri" {
  description = "Full ECR image URI (repo:tag) for the ETL Lambda container"
  type        = string
}

variable "inference_image_uri" {
  description = "Full ECR image URI (repo:tag) for the inference Lambda container"
  type        = string
}

variable "maintenance_key" {
  description = "S3 key of the maintenance CSV within the raw bucket"
  type        = string
  default     = "maintenance/maintenance.csv"
}

variable "lambda_architecture" {
  description = "Lambda architecture (arm64 or x86_64)"
  type        = string
  default     = "arm64"
}
