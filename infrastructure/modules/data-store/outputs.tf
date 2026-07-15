output "raw_data_bucket_id" {
  value = aws_s3_bucket.raw_data.id
}

output "raw_data_bucket_arn" {
  value = aws_s3_bucket.raw_data.arn
}

output "processed_data_bucket_id" {
  value = aws_s3_bucket.processed_data.id
}

output "processed_data_bucket_arn" {
  value = aws_s3_bucket.processed_data.arn
}

output "frontend_bucket_id" {
  value = aws_s3_bucket.frontend.id
}

output "frontend_bucket_arn" {
  value = aws_s3_bucket.frontend.arn
}

output "reports_bucket_id" {
  value = aws_s3_bucket.reports.id
}

output "reports_bucket_arn" {
  value = aws_s3_bucket.reports.arn
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.frontend.id
}

output "cloudfront_domain_name" {
  value = aws_cloudfront_distribution.frontend.domain_name
}
