"""Upload the model artifact to S3 for the inference Lambda (issue #4).

Uploads ml/artifacts/{model.joblib, requirements.txt} to
s3://yminsight-processed-data/models/ using credentials from the standard AWS
environment (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN).

Usage (in a terminal where the event credentials are exported):
    export AWS_DEFAULT_REGION="us-east-1"
    export AWS_ACCESS_KEY_ID="..."
    export AWS_SECRET_ACCESS_KEY="..."
    export AWS_SESSION_TOKEN="..."
    python3 ml/upload_to_s3.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import boto3
from botocore.exceptions import ClientError, NoCredentialsError

BUCKET = "yminsight-processed-data"
PREFIX = "models"
REGION = "us-east-1"
EXPECTED_ACCOUNT = "486868043998"

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"
FILES = ["model.joblib", "requirements.txt"]


def main() -> int:
    # confirm every artifact exists before touching the network
    missing = [f for f in FILES if not (ARTIFACTS / f).exists()]
    if missing:
        print(f"[error] missing artifacts: {missing} — run `python3 ml/build_model.py` first")
        return 1

    session = boto3.session.Session(region_name=REGION)
    try:
        ident = session.client("sts").get_caller_identity()
    except (NoCredentialsError, ClientError) as e:
        print(f"[error] no usable AWS credentials in this shell: {e}")
        print("        export AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN first.")
        return 1

    acct = ident["Account"]
    print(f"[auth] account={acct}  arn={ident['Arn']}")
    if acct != EXPECTED_ACCOUNT:
        print(f"[warn] account {acct} != expected {EXPECTED_ACCOUNT}; continuing anyway")

    s3 = session.client("s3")
    for name in FILES:
        path = ARTIFACTS / name
        key = f"{PREFIX}/{name}"
        s3.upload_file(str(path), BUCKET, key)
        size = s3.head_object(Bucket=BUCKET, Key=key)["ContentLength"]
        print(f"[ok] s3://{BUCKET}/{key}  ({size} bytes)")

    print("[done] model artifact uploaded.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
