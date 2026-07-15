output "llm_lambda_name" {
  value = aws_lambda_function.llm.function_name
}

output "consult_url" {
  description = "Full URL of the AI consult endpoint"
  value       = "${var.api_endpoint}/api/consult"
}
