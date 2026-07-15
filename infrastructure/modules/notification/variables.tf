variable "project_prefix" {
  type    = string
  default = "yminsight"
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "api_id" {
  description = "HTTP API id to attach the /api/notify route to"
  type        = string
}

variable "api_execution_arn" {
  description = "HTTP API execution ARN (for the lambda invoke permission)"
  type        = string
}

variable "ses_sender" {
  description = "Verified SES sender email"
  type        = string
  default     = "aaarrchong@gmail.com"
}

variable "ses_recipient" {
  description = "Default recipient (must be SES-verified while in sandbox)"
  type        = string
  default     = "aaarrchong@gmail.com"
}

variable "sender_name" {
  description = "Friendly From display name"
  type        = string
  default     = "YMINSIGHT 效能告警"
}
