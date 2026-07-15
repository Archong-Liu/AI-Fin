###############################################################################
# YMINSIGHT — API Module
# HTTP API (API Gateway v2) -> on-demand what-if inference Lambda.
# Reuses the inference container image with the CMD overridden to handler.api_handler.
# NOTE: open (no authorizer) per current requirement — anyone with the URL can call it.
###############################################################################

# --- Inference-API Lambda (same image, different entrypoint) ---

resource "aws_iam_role" "api_lambda" {
  name = "${var.project_prefix}-inference-api-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = {
    Project     = var.project_prefix
    Module      = "api"
    Environment = var.environment
  }
}

resource "aws_iam_role_policy_attachment" "api_basic" {
  role       = aws_iam_role.api_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Least-privilege: read the model artifact only.
resource "aws_iam_role_policy" "api_model_read" {
  name = "${var.project_prefix}-inference-api-model-read"
  role = aws_iam_role.api_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "ReadModel"
      Effect   = "Allow"
      Action   = ["s3:GetObject"]
      Resource = "${var.processed_bucket_arn}/*"
    }]
  })
}

resource "aws_lambda_function" "inference_api" {
  function_name = "${var.project_prefix}-inference-api"
  role          = aws_iam_role.api_lambda.arn
  package_type  = "Image"
  image_uri     = var.inference_image_uri
  architectures = [var.lambda_architecture]

  # Override the container CMD to the HTTP entrypoint (batch path uses lambda_handler).
  image_config {
    command = ["handler.api_handler"]
  }

  memory_size = 2048
  timeout     = 30

  environment {
    variables = {
      MODEL_BUCKET = var.processed_bucket_id
      MODEL_KEY    = var.model_key
    }
  }

  tags = {
    Project     = var.project_prefix
    Module      = "api"
    Environment = var.environment
  }
}

# --- HTTP API ---

resource "aws_apigatewayv2_api" "this" {
  name          = "${var.project_prefix}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["POST", "OPTIONS"]
    allow_headers = ["content-type"]
    max_age       = 3600
  }

  tags = {
    Project     = var.project_prefix
    Module      = "api"
    Environment = var.environment
  }
}

resource "aws_apigatewayv2_integration" "predict" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.inference_api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "predict" {
  api_id    = aws_apigatewayv2_api.this.id
  route_key = "POST /api/predict"
  target    = "integrations/${aws_apigatewayv2_integration.predict.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.inference_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}
