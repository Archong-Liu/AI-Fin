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
