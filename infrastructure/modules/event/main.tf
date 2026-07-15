###############################################################################
# YMINSIGHT — Event Module
# S3 event notifications wiring the pipeline:
#   raw CSV upload      -> ETL Lambda
#   processed parquet   -> inference Lambda
#
# NOTE: aws_s3_bucket_notification REPLACES all notifications on a bucket, so we
# use exactly one resource per bucket. The lambda invoke permissions
# (allow_s3_invoke, allow_processed_invoke) live in the data-processing module;
# the caller must order this module after data_processing via depends_on so the
# permissions exist before S3 validates the notification target.
###############################################################################

# raw-data bucket -> ETL Lambda on noon-reports/*.csv
resource "aws_s3_bucket_notification" "raw_to_etl" {
  bucket = var.raw_bucket_id

  lambda_function {
    lambda_function_arn = var.etl_lambda_arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "noon-reports/"
    filter_suffix       = ".csv"
  }
}

# processed-data bucket -> inference Lambda on processed/*.parquet
resource "aws_s3_bucket_notification" "processed_to_inference" {
  bucket = var.processed_bucket_id

  lambda_function {
    lambda_function_arn = var.inference_lambda_arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "processed/"
    filter_suffix       = ".parquet"
  }
}
