output "ecr_repository_url" {
  value = aws_ecr_repository.etl.repository_url
}

output "etl_lambda_arn" {
  value = aws_lambda_function.etl.arn
}

output "etl_lambda_name" {
  value = aws_lambda_function.etl.function_name
}

output "etl_lambda_role_arn" {
  value = aws_iam_role.etl_lambda.arn
}

output "inference_ecr_repository_url" {
  value = aws_ecr_repository.inference.repository_url
}

output "inference_lambda_arn" {
  value = aws_lambda_function.inference.arn
}

output "inference_lambda_name" {
  value = aws_lambda_function.inference.function_name
}
