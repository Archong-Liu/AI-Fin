output "api_endpoint" {
  description = "Base URL of the HTTP API"
  value       = aws_apigatewayv2_api.this.api_endpoint
}

output "predict_url" {
  description = "Full URL of the what-if inference endpoint"
  value       = "${aws_apigatewayv2_api.this.api_endpoint}/api/predict"
}

output "inference_api_lambda_name" {
  value = aws_lambda_function.inference_api.function_name
}
