###############################################################################
# YMINSIGHT — CI/CD Module
# GitHub Actions OIDC provider + repo-scoped IAM role for frontend deployment.
# No long-lived AWS credentials are stored in GitHub; Actions federates via OIDC.
###############################################################################

locals {
  oidc_url  = "token.actions.githubusercontent.com"
  oidc_arn  = var.create_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn
  subject   = "repo:${var.github_owner}/${var.github_repo}:ref:refs/heads/${var.github_branch}"
}

# Fetch GitHub's OIDC TLS thumbprint (robust vs hardcoding).
data "tls_certificate" "github" {
  count = var.create_oidc_provider ? 1 : 0
  url   = "https://${local.oidc_url}"
}

resource "aws_iam_openid_connect_provider" "github" {
  count           = var.create_oidc_provider ? 1 : 0
  url             = "https://${local.oidc_url}"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github[0].certificates[0].sha1_fingerprint]

  tags = {
    Project     = var.project_prefix
    Module      = "cicd"
    Environment = var.environment
  }
}

# Reference an existing provider instead of creating one.
data "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 0 : 1
  url   = "https://${local.oidc_url}"
}

# --- Deploy role assumed by the GitHub Actions workflow ---

data "aws_iam_policy_document" "assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_url}:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_url}:sub"
      values   = [local.subject]
    }
  }
}

resource "aws_iam_role" "frontend_deploy" {
  name               = "${var.project_prefix}-frontend-deploy"
  assume_role_policy = data.aws_iam_policy_document.assume.json

  tags = {
    Project     = var.project_prefix
    Module      = "cicd"
    Environment = var.environment
  }
}

data "aws_iam_policy_document" "deploy" {
  statement {
    sid     = "ListFrontendBucket"
    effect  = "Allow"
    actions = ["s3:ListBucket"]
    resources = [var.frontend_bucket_arn]
  }

  statement {
    sid     = "WriteFrontendObjects"
    effect  = "Allow"
    actions = ["s3:PutObject", "s3:DeleteObject"]
    resources = ["${var.frontend_bucket_arn}/*"]
  }

  statement {
    sid       = "InvalidateCloudFront"
    effect    = "Allow"
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [var.cloudfront_distribution_arn]
  }
}

resource "aws_iam_role_policy" "frontend_deploy" {
  name   = "${var.project_prefix}-frontend-deploy-policy"
  role   = aws_iam_role.frontend_deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
