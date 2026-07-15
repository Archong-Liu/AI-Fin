terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# --- Data Store Module ---
module "data_store" {
  source = "../../modules/data-store"

  project_prefix = var.project_prefix
  environment    = var.environment
}

# --- Data Processing Module (ETL Lambda) ---
module "data_processing" {
  source = "../../modules/data-processing"

  project_prefix = var.project_prefix
  environment    = var.environment

  raw_bucket_arn       = module.data_store.raw_data_bucket_arn
  raw_bucket_id        = module.data_store.raw_data_bucket_id
  processed_bucket_arn = module.data_store.processed_data_bucket_arn
  processed_bucket_id  = module.data_store.processed_data_bucket_id

  etl_image_uri       = "${var.aws_account_id}.dkr.ecr.${var.aws_region}.amazonaws.com/${var.project_prefix}-etl:latest"
  inference_image_uri = "${var.aws_account_id}.dkr.ecr.${var.aws_region}.amazonaws.com/${var.project_prefix}-inference:latest"
}

# --- Event Module (S3 -> Lambda notifications) ---
module "event" {
  source = "../../modules/event"

  raw_bucket_id        = module.data_store.raw_data_bucket_id
  processed_bucket_id  = module.data_store.processed_data_bucket_id
  etl_lambda_arn       = module.data_processing.etl_lambda_arn
  inference_lambda_arn = module.data_processing.inference_lambda_arn

  # Ensure the S3->Lambda invoke permissions exist before S3 validates targets
  depends_on = [module.data_processing]
}
