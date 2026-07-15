output "frontend_deploy_role_arn" {
  description = "IAM role ARN for the GitHub Actions frontend deploy workflow (set as repo variable FRONTEND_DEPLOY_ROLE_ARN)"
  value       = aws_iam_role.frontend_deploy.arn
}

output "oidc_provider_arn" {
  value = local.oidc_arn
}
