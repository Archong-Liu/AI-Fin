output "raw_data_bucket" {
  value = module.data_store.raw_data_bucket_id
}

output "processed_data_bucket" {
  value = module.data_store.processed_data_bucket_id
}

output "frontend_bucket" {
  value = module.data_store.frontend_bucket_id
}

output "reports_bucket" {
  value = module.data_store.reports_bucket_id
}

output "cloudfront_domain" {
  value = module.data_store.cloudfront_domain_name
}

output "ecr_repository_url" {
  value = module.data_processing.ecr_repository_url
}

output "etl_lambda_name" {
  value = module.data_processing.etl_lambda_name
}

output "inference_ecr_repository_url" {
  value = module.data_processing.inference_ecr_repository_url
}

output "inference_lambda_name" {
  value = module.data_processing.inference_lambda_name
}

output "frontend_deploy_role_arn" {
  value = module.cicd.frontend_deploy_role_arn
}

output "api_predict_url" {
  value = module.api.predict_url
}

output "notify_lambda_name" {
  value = module.notification.notify_lambda_name
}

output "ses_verified_identities" {
  value = module.notification.verified_identities
}

output "consult_url" {
  value = module.llm.consult_url
}

output "llm_lambda_name" {
  value = module.llm.llm_lambda_name
}
