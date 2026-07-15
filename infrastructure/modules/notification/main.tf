###############################################################################
# YMINSIGHT — Notification Module
# On-demand emailing (trigger model C): POST /api/notify -> notify Lambda -> SES.
# Attaches to the existing HTTP API. Lightweight zip Lambda (boto3 only).
###############################################################################

# SES identities to verify (sender + default recipient). In sandbox both must be
# verified; applying this triggers AWS verification emails — click the link once.
resource "aws_ses_email_identity" "verified" {
  for_each = toset(distinct([var.ses_sender, var.ses_recipient]))
  email    = each.value
}

# --- notify Lambda (zip) ---

data "archive_file" "notify" {
  type        = "zip"
  source_file = "${path.module}/../../../lambdas/notify/handler.py"
  output_path = "${path.module}/.build/notify.zip"
}

resource "aws_iam_role" "notify" {
  name = "${var.project_prefix}-notify-role"

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
    Module      = "notification"
    Environment = var.environment
  }
}

resource "aws_iam_role_policy_attachment" "notify_basic" {
  role       = aws_iam_role.notify.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "notify_ses" {
  name = "${var.project_prefix}-notify-ses-send"
  role = aws_iam_role.notify.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "SendEmail"
      Effect   = "Allow"
      Action   = ["ses:SendEmail", "ses:SendRawEmail"]
      Resource = "*"
    }]
  })
}

resource "aws_lambda_function" "notify" {
  function_name    = "${var.project_prefix}-notify"
  role             = aws_iam_role.notify.arn
  runtime          = "python3.12"
  handler          = "handler.lambda_handler"
  filename         = data.archive_file.notify.output_path
  source_code_hash = data.archive_file.notify.output_base64sha256
  timeout          = 15
  memory_size      = 256

  environment {
    variables = {
      SES_SENDER      = var.ses_sender
      SES_RECIPIENT   = var.ses_recipient
      SES_SENDER_NAME = var.sender_name
    }
  }

  tags = {
    Project     = var.project_prefix
    Module      = "notification"
    Environment = var.environment
  }
}

# --- attach POST /api/notify to the existing HTTP API ---

resource "aws_apigatewayv2_integration" "notify" {
  api_id                 = var.api_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.notify.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "notify" {
  api_id    = var.api_id
  route_key = "POST /api/notify"
  target    = "integrations/${aws_apigatewayv2_integration.notify.id}"
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.notify.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*/*"
}
