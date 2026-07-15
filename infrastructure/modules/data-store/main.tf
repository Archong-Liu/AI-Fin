###############################################################################
# YMINSIGHT — Data Store Module
# S3 Buckets + CloudFront Distribution
###############################################################################

# --- S3 Buckets ---

resource "aws_s3_bucket" "raw_data" {
  bucket = "${var.project_prefix}-raw-data"

  tags = {
    Project     = var.project_prefix
    Module      = "data-store"
    Environment = var.environment
  }
}

resource "aws_s3_bucket" "processed_data" {
  bucket = "${var.project_prefix}-processed-data"

  tags = {
    Project     = var.project_prefix
    Module      = "data-store"
    Environment = var.environment
  }
}

resource "aws_s3_bucket" "frontend" {
  bucket = "${var.project_prefix}-frontend"

  tags = {
    Project     = var.project_prefix
    Module      = "data-store"
    Environment = var.environment
  }
}

resource "aws_s3_bucket" "reports" {
  bucket = "${var.project_prefix}-reports"

  tags = {
    Project     = var.project_prefix
    Module      = "data-store"
    Environment = var.environment
  }
}

# --- Encryption (SSE-S3) ---

resource "aws_s3_bucket_server_side_encryption_configuration" "raw_data" {
  bucket = aws_s3_bucket.raw_data.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "processed_data" {
  bucket = aws_s3_bucket.processed_data.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "reports" {
  bucket = aws_s3_bucket.reports.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# --- Block Public Access (all buckets) ---

resource "aws_s3_bucket_public_access_block" "raw_data" {
  bucket = aws_s3_bucket.raw_data.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "processed_data" {
  bucket = aws_s3_bucket.processed_data.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "reports" {
  bucket = aws_s3_bucket.reports.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# --- CORS for processed-data (Dashboard reads JSON via CloudFront) ---

resource "aws_s3_bucket_cors_configuration" "processed_data" {
  bucket = aws_s3_bucket.processed_data.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

# --- CloudFront OAC (Origin Access Control) ---

resource "aws_cloudfront_origin_access_control" "frontend_oac" {
  name                              = "${var.project_prefix}-frontend-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_origin_access_control" "data_oac" {
  name                              = "${var.project_prefix}-data-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# --- CloudFront Distribution (Frontend) ---

resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  default_root_object = "index.html"
  comment             = "YMINSIGHT Frontend Distribution"

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "s3-frontend"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend_oac.id
  }

  # Second origin: processed-data bucket for results-json
  origin {
    domain_name              = aws_s3_bucket.processed_data.bucket_regional_domain_name
    origin_id                = "s3-data"
    origin_access_control_id = aws_cloudfront_origin_access_control.data_oac.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-frontend"
    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 86400
    max_ttl     = 31536000
  }

  # Cache behavior for /results-json/* → processed-data bucket
  ordered_cache_behavior {
    path_pattern           = "/results-json/*"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-data"
    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 60
    max_ttl     = 300
  }

  # SPA fallback: return index.html for 404s
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = {
    Project     = var.project_prefix
    Module      = "data-store"
    Environment = var.environment
  }
}

# --- S3 Bucket Policy: Allow CloudFront OAC access ---

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontOAC"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.frontend.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn
          }
        }
      }
    ]
  })
}

resource "aws_s3_bucket_policy" "processed_data" {
  bucket = aws_s3_bucket.processed_data.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontOAC"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.processed_data.arn}/results-json/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn
          }
        }
      }
    ]
  })
}

# --- Lifecycle Rules ---

resource "aws_s3_bucket_lifecycle_configuration" "raw_data" {
  bucket = aws_s3_bucket.raw_data.id

  rule {
    id     = "transition-to-ia"
    status = "Enabled"

    filter {}

    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }

    expiration {
      days = 180
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "processed_data" {
  bucket = aws_s3_bucket.processed_data.id

  rule {
    id     = "retain-one-year"
    status = "Enabled"

    filter {}

    expiration {
      days = 365
    }
  }
}
