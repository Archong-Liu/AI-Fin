variable "raw_bucket_id" {
  description = "Name of the raw-data bucket (source of ETL trigger)"
  type        = string
}

variable "processed_bucket_id" {
  description = "Name of the processed-data bucket (source of inference trigger)"
  type        = string
}

variable "etl_lambda_arn" {
  description = "ARN of the ETL Lambda invoked on raw CSV upload"
  type        = string
}

variable "inference_lambda_arn" {
  description = "ARN of the inference Lambda invoked on processed parquet write"
  type        = string
}
