output "raw_notification_id" {
  value = aws_s3_bucket_notification.raw_to_etl.id
}

output "processed_notification_id" {
  value = aws_s3_bucket_notification.processed_to_inference.id
}
