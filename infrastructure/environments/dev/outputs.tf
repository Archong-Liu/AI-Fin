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
