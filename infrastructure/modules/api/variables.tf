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

variable "inference_image_uri" {
  description = "ECR image URI (same image as the batch inference Lambda; CMD overridden to handler.api_handler)"
  type        = string
}

variable "processed_bucket_arn" {
  description = "ARN of the processed-data bucket (model artifact lives here)"
  type        = string
}

variable "processed_bucket_id" {
  description = "Name of the processed-data bucket"
  type        = string
}

variable "model_key" {
  description = "S3 key of the model artifact"
  type        = string
  default     = "models/model.joblib"
}

variable "lambda_architecture" {
  description = "Lambda architecture"
  type        = string
  default     = "arm64"
}
