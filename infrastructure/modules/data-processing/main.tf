###############################################################################
# YMINSIGHT — Data Processing Module
# ECR repository + ETL Lambda (container image) + execution role
###############################################################################

# --- ECR repository for the ETL container image ---

resource "aws_ecr_repository" "etl" {
  name                 = "${var.project_prefix}-etl"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Project     = var.project_prefix
    Module      = "data-processing"
    Environment = var.environment
  }
}

# --- ETL Lambda execution role ---

resource "aws_iam_role" "etl_lambda" {
  name = "${var.project_prefix}-etl-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Project     = var.project_prefix
    Module      = "data-processing"
    Environment = var.environment
  }
}

# CloudWatch Logs permissions
resource "aws_iam_role_policy_attachment" "etl_basic" {
  role       = aws_iam_role.etl_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# S3 least-privilege: read raw, write processed
resource "aws_iam_role_policy" "etl_s3" {
  name = "${var.project_prefix}-etl-s3-access"
  role = aws_iam_role.etl_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadRaw"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${var.raw_bucket_arn}/*"
      },
      {
        Sid      = "WriteProcessed"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${var.processed_bucket_arn}/*"
      }
    ]
  })
}

# --- ETL Lambda (container image) ---

resource "aws_lambda_function" "etl" {
  function_name = "${var.project_prefix}-etl"
  role          = aws_iam_role.etl_lambda.arn
  package_type  = "Image"
  image_uri     = var.etl_image_uri
  architectures = [var.lambda_architecture]

  memory_size = 1024
  timeout     = 300

  environment {
    variables = {
      RAW_BUCKET       = var.raw_bucket_id
      PROCESSED_BUCKET = var.processed_bucket_id
      MAINTENANCE_KEY  = var.maintenance_key
    }
  }

  tags = {
    Project     = var.project_prefix
    Module      = "data-processing"
    Environment = var.environment
  }
}

# Allow the raw-data bucket to invoke the ETL Lambda (used by the event module)
resource "aws_lambda_permission" "allow_s3_invoke" {
  statement_id  = "AllowS3Invoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.etl.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = var.raw_bucket_arn
}

###############################################################################
# Inference Lambda (container image) — loads model, predicts, writes results JSON
###############################################################################

resource "aws_ecr_repository" "inference" {
  name                 = "${var.project_prefix}-inference"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Project     = var.project_prefix
    Module      = "data-processing"
    Environment = var.environment
  }
}

resource "aws_iam_role" "inference_lambda" {
  name = "${var.project_prefix}-inference-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Project     = var.project_prefix
    Module      = "data-processing"
    Environment = var.environment
  }
}

resource "aws_iam_role_policy_attachment" "inference_basic" {
  role       = aws_iam_role.inference_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# S3 least-privilege: read processed (parquet) + model + maintenance, write results-json
resource "aws_iam_role_policy" "inference_s3" {
  name = "${var.project_prefix}-inference-s3-access"
  role = aws_iam_role.inference_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadProcessedAndModel"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${var.processed_bucket_arn}/*"
      },
      {
        Sid      = "ReadMaintenance"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${var.raw_bucket_arn}/*"
      },
      {
        Sid      = "WriteResults"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${var.processed_bucket_arn}/*"
      }
    ]
  })
}

resource "aws_lambda_function" "inference" {
  function_name = "${var.project_prefix}-inference"
  role          = aws_iam_role.inference_lambda.arn
  package_type  = "Image"
  image_uri     = var.inference_image_uri
  architectures = [var.lambda_architecture]

  memory_size = 2048
  timeout     = 300

  environment {
    variables = {
      PROCESSED_BUCKET = var.processed_bucket_id
      MODEL_BUCKET     = var.processed_bucket_id
      MODEL_KEY        = "models/model.joblib"
      RESULTS_PREFIX   = "results-json"
      RAW_BUCKET       = var.raw_bucket_id
      MAINTENANCE_KEY  = var.maintenance_key
    }
  }

  tags = {
    Project     = var.project_prefix
    Module      = "data-processing"
    Environment = var.environment
  }
}

# Allow the processed-data bucket to invoke the inference Lambda (used by event module)
resource "aws_lambda_permission" "allow_processed_invoke" {
  statement_id  = "AllowProcessedInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.inference.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = var.processed_bucket_arn
}
