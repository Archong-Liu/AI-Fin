###############################################################################
# YMINSIGHT — LLM Module
# On-demand AI consult (F4 v0.2, docs/feature-spec.md): POST /api/consult -> llm
# Lambda -> Bedrock Claude. Attaches to the existing HTTP API. Lightweight zip
# Lambda (boto3 only) -- same shape as the notification module.
###############################################################################

data "archive_file" "llm" {
  type        = "zip"
  source_file = "${path.module}/../../../lambdas/llm/handler.py"
  output_path = "${path.module}/.build/llm.zip"
}

resource "aws_iam_role" "llm" {
  name = "${var.project_prefix}-llm-role"

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
    Module      = "llm"
    Environment = var.environment
  }
}

resource "aws_iam_role_policy_attachment" "llm_basic" {
  role       = aws_iam_role.llm.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Resource = "*" because the default model id is a cross-region inference profile,
# whose invoke permission spans the underlying foundation-model resources across
# regions (same pragmatic wildcard-by-action tradeoff as notify's ses:SendEmail).
resource "aws_iam_role_policy" "llm_bedrock" {
  name = "${var.project_prefix}-llm-bedrock-invoke"
  role = aws_iam_role.llm.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "InvokeBedrock"
      Effect   = "Allow"
      Action   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
      Resource = "*"
    }]
  })
}

resource "aws_lambda_function" "llm" {
  function_name    = "${var.project_prefix}-llm-consult"
  role             = aws_iam_role.llm.arn
  runtime          = "python3.12"
  handler          = "handler.lambda_handler"
  filename         = data.archive_file.llm.output_path
  source_code_hash = data.archive_file.llm.output_base64sha256
  timeout          = 20
  memory_size      = 256

  environment {
    variables = {
      BEDROCK_MODEL_ID = var.bedrock_model_id
    }
  }

  tags = {
    Project     = var.project_prefix
    Module      = "llm"
    Environment = var.environment
  }
}

# --- attach POST /api/consult to the existing HTTP API ---

resource "aws_apigatewayv2_integration" "consult" {
  api_id                 = var.api_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.llm.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "consult" {
  api_id    = var.api_id
  route_key = "POST /api/consult"
  target    = "integrations/${aws_apigatewayv2_integration.consult.id}"
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.llm.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*/*"
}
