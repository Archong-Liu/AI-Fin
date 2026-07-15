"""
YMINSIGHT - Inference Lambda Handler
Model Load + Prediction + Results Store

Triggered by S3 PutObject event when the ETL Lambda writes a processed Parquet
to the processed-data bucket. Steps:
1. Download the processed Parquet (ETL output) and the trained model.joblib from S3
2. Load the HybridModel (physics-residual hybrid) and run predictions
3. Write results JSON to the results-json/ prefix for the dashboard to consume:
     - results-json/submission.json   (canonical 102 masked-window predictions)
     - results-json/fleet_data.json   (full fleet daily dataset + predicted_mt merged)

The model is a scikit-learn based custom class (ml.training.model.HybridModel). The
image bakes in ml/training/ so joblib can unpickle it, and pins the exact training
dependency versions (see requirements.txt).
"""

import io
import json
import logging
import os
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd

from ml.training import config as C
from ml.training import model as M

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_s3_client = None


def s3():
    global _s3_client
    if _s3_client is None:
        import boto3
        _s3_client = boto3.client("s3")
    return _s3_client


# ------------------------------------------------------------------ configuration
PROCESSED_BUCKET = os.environ.get("PROCESSED_BUCKET", "yminsight-processed-data")
MODEL_BUCKET = os.environ.get("MODEL_BUCKET", "yminsight-processed-data")
MODEL_KEY = os.environ.get("MODEL_KEY", "models/model.joblib")
RESULTS_PREFIX = os.environ.get("RESULTS_PREFIX", "results-json")
RAW_BUCKET = os.environ.get("RAW_BUCKET", "yminsight-raw-data")
MAINTENANCE_KEY = os.environ.get("MAINTENANCE_KEY", "maintenance/maintenance.csv")

# Weather-vector columns the dashboard expects; produced here if the inputs exist.
NOON_UTC_EPOCH = pd.Timestamp("2021-01-01")


# ============================================================== Lambda entry point
def lambda_handler(event, context):
    """Triggered by S3 PutObject on a processed Parquet. Runs inference + writes JSON."""
    logger.info(f"Inference Lambda triggered: {json.dumps(event)}")
    try:
        record = event["Records"][0]
        bucket = record["s3"]["bucket"]["name"]
        key = record["s3"]["object"]["key"]
        logger.info(f"Processing processed parquet s3://{bucket}/{key}")

        # 1. Load processed data (ETL output) + model
        df = load_processed_from_s3(bucket, key)
        mdl = load_model()
        logger.info(f"Loaded {len(df)} processed rows + model")

        # 2. Predict the masked-window cells (the canonical submission)
        submission = M.predict_submission(mdl, df)
        logger.info(f"Generated {len(submission)} predictions")

        # 3. Build outputs and write to results-json/
        write_json(submission_payload(submission), f"{RESULTS_PREFIX}/submission.json")
        fleet = build_fleet_data(df, mdl, submission)
        write_json(fleet, f"{RESULTS_PREFIX}/fleet_data.json")

        return {
            "statusCode": 200,
            "body": json.dumps({
                "message": "Inference completed successfully",
                "predictions": len(submission),
                "results": [
                    f"s3://{PROCESSED_BUCKET}/{RESULTS_PREFIX}/submission.json",
                    f"s3://{PROCESSED_BUCKET}/{RESULTS_PREFIX}/fleet_data.json",
                ],
            }),
        }
    except Exception as e:
        logger.error(f"Inference failed: {e}", exc_info=True)
        raise


# ================================================================= loading
def load_processed_from_s3(bucket: str, key: str) -> pd.DataFrame:
    """Download the processed Parquet from S3 and apply model-side derived columns."""
    obj = s3().get_object(Bucket=bucket, Key=key)
    df = pd.read_parquet(io.BytesIO(obj["Body"].read()))
    return M.add_derived(df)


def load_model() -> "M.HybridModel":
    """Download and unpickle the trained HybridModel from S3."""
    local = "/tmp/model.joblib"
    s3().download_file(MODEL_BUCKET, MODEL_KEY, local)
    return joblib.load(local)


# ================================================================= submission
def submission_payload(submission: pd.DataFrame) -> dict:
    """Canonical prediction output (the 102 masked-window cells)."""
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "n_predictions": int(len(submission)),
        "predictions": submission.to_dict(orient="records"),
    }


# ================================================================= fleet dataset
def build_fleet_data(df: pd.DataFrame, mdl, submission: pd.DataFrame) -> dict:
    """Full fleet daily dataset with predicted_mt merged in, grouped per ship.

    Mirrors the ML team's fleet_data.json structure so the dashboard can consume it.
    Weather-vector columns are derived here if the source columns are present.
    """
    df = df.copy()

    # Merge predicted_mt onto the predict rows (keyed by ship/day/fuel).
    pred_key = {
        (r["ship_id"], int(r["day"]), r["fuel_type"]): r["predicted_value"]
        for _, r in submission.iterrows()
    }
    df["predicted_mt"] = [
        pred_key.get((row["ship"], int(row["day"]), row["predict_fuel"]))
        if pd.notna(row.get("predict_fuel")) else None
        for _, row in df.iterrows()
    ]

    maintenance_by_ship = load_maintenance_by_ship()

    ships = []
    for ship_id, g in df.groupby("ship", sort=True):
        g = g.sort_values("day")
        daily = json.loads(g.to_json(orient="records"))  # NaN -> null, native types
        ships.append({
            "ship_id": ship_id,
            "ship_type": g["ship_type"].iloc[0] if "ship_type" in g else None,
            "n_days": int(len(g)),
            "n_predictions": int(g["predict_fuel"].notna().sum()),
            "maintenance": maintenance_by_ship.get(ship_id, []),
            "daily": daily,
        })

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model": "physics-residual hybrid: Admiralty backbone + HistGradientBoosting",
        "target": "ME_FULLSPEED_CONSUMP_[fuel] (MT/day, full speed); foc_eq24 = VLSFO-eq/24h",
        "n_ships": int(df["ship"].nunique()),
        "n_rows": int(len(df)),
        "n_predictions": int(len(submission)),
        "daily_columns": list(df.columns),
        "ships": ships,
    }


def load_maintenance_by_ship() -> dict:
    """Read maintenance CSV, align event_date -> day-index, group per ship.

    Best-effort: if the maintenance file is missing, returns empty (fleet_data still
    valid, just without maintenance events).
    """
    try:
        obj = s3().get_object(Bucket=RAW_BUCKET, Key=MAINTENANCE_KEY)
        mt = pd.read_csv(io.BytesIO(obj["Body"].read()))
    except Exception as e:
        logger.warning(f"maintenance load skipped: {e}")
        return {}

    mt["event_date"] = pd.to_datetime(mt["event_date"], errors="coerce")
    mt = mt.dropna(subset=["event_date"])
    mt["event_day"] = (mt["event_date"] - NOON_UTC_EPOCH).dt.days
    mt = mt.drop(columns=["event_date"]).sort_values("event_day")

    out = {}
    for ship_id, g in mt.groupby("ship_id"):
        out[ship_id] = json.loads(g.to_json(orient="records"))
    return out


# ================================================================= S3 write
def write_json(payload: dict, key: str):
    """Write a JSON payload to the processed-data bucket (minified)."""
    body = json.dumps(payload, separators=(",", ":"), allow_nan=False).encode("utf-8")
    s3().put_object(
        Bucket=PROCESSED_BUCKET, Key=key, Body=body,
        ContentType="application/json",
    )
    logger.info(f"Wrote s3://{PROCESSED_BUCKET}/{key} ({len(body)} bytes)")
