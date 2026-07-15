output "notify_lambda_name" {
  value = aws_lambda_function.notify.function_name
}

output "verified_identities" {
  description = "SES identities that must be confirmed via the verification email"
  value       = [for k in aws_ses_email_identity.verified : k.email]
}
