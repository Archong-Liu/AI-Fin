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
