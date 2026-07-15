terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
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

# --- API Module (on-demand what-if inference endpoint) ---
module "api" {
  source = "../../modules/api"

  project_prefix = var.project_prefix
  environment    = var.environment

  inference_image_uri  = "${var.aws_account_id}.dkr.ecr.${var.aws_region}.amazonaws.com/${var.project_prefix}-inference:latest"
  processed_bucket_arn = module.data_store.processed_data_bucket_arn
  processed_bucket_id  = module.data_store.processed_data_bucket_id
}

# --- Notification Module (on-demand emailing via SES) ---
module "notification" {
  source = "../../modules/notification"

  project_prefix = var.project_prefix
  environment    = var.environment

  api_id            = module.api.api_id
  api_execution_arn = module.api.api_execution_arn
  ses_sender        = var.ses_email
  ses_recipient     = var.ses_email
}

# --- CI/CD Module (GitHub OIDC + frontend deploy role) ---
module "cicd" {
  source = "../../modules/cicd"

  project_prefix = var.project_prefix
  environment    = var.environment

  frontend_bucket_arn         = module.data_store.frontend_bucket_arn
  cloudfront_distribution_arn = module.data_store.cloudfront_distribution_arn

  # Flip to false if the account already has a GitHub OIDC provider
  create_oidc_provider = var.create_github_oidc_provider
}
