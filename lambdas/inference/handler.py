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

# Offline cross-validation metrics of the trained model (see docs/ml-eda-and-decisions.md).
# Surfaced in the dashboard KPI (frontend DATA_CONTRACT). Update when the model is retrained.
VALIDATION = {
    "event_holdout_mape_pct": 4.16,
    "leave_one_ship_out_mape_pct": 5.33,
    "rmse_mt_per_day": 3.5,
}

# Maintenance types that reset the hull/performance baseline (UWI is inspection-only).
HULL_EVENTS = {"DD", "UWC", "PP", "UWC+PP", "UWI+PP"}
DAY_MAX = 1825  # ~5-year day-index horizon


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


# ============================================================== API entry point
# On-demand "what-if" inference: POST feature values -> predicted fuel.
# Served via API Gateway (HTTP API). Uses the SAME image as the batch handler; the
# Lambda is created with image_config command = ["handler.api_handler"].
_model_cache = None


def _get_model():
    """Load the model once per warm container (avoids re-download on every request)."""
    global _model_cache
    if _model_cache is None:
        _model_cache = load_model()
    return _model_cache


def _resp(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def _predict_row(payload: dict) -> dict:
    """Build a 1-row feature frame from a what-if payload and run the model.

    Accepts any subset of model features; missing ones are left NaN (the
    HistGradientBoosting residual handles them natively). The Admiralty physics term
    log_v3d23 is derived from SPEED_THROUGH_WATER + DISPLACEMENT when both are given.
    """
    row = {f: np.nan for f in C.FEATURES}
    # Categorical defaults: HistGBR's category encoder rejects all-NaN category columns,
    # so give each categorical a training-seen fallback (overridden by the payload).
    cat_defaults = {"ship": "S1", "ship_type": "W1",
                    "last_event_type": "NONE", "last_event_prop_cond": "Good"}
    row.update(cat_defaults)
    for k, v in payload.items():
        if k in row and v is not None:
            row[k] = v

    stw = payload.get("SPEED_THROUGH_WATER")
    disp = payload.get("DISPLACEMENT")
    if stw and disp:
        row["log_v3d23"] = float(np.log((float(stw) ** 3) * (float(disp) ** (2 / 3))))

    df = pd.DataFrame([row])
    df[C.NUM_FEATS] = df[C.NUM_FEATS].apply(pd.to_numeric, errors="coerce")
    for c in C.CAT_FEATS:
        df[c] = df[c].astype("category")

    eq24 = float(_get_model().predict(df)[0])
    fuel = str(payload.get("fuel_type") or "VLSFO").upper()
    lcv = C.LCV.get(fuel, 40.2)
    return {
        "foc_eq24_vlsfo": round(eq24, 2),          # VLSFO-equivalent full-speed fuel / 24h
        "fuel_type": fuel,
        "predicted_mt_per_day": round(eq24 * (40.2 / lcv), 2),
    }


def api_handler(event, context):
    """API Gateway (HTTP API) entrypoint for on-demand what-if fuel inference.

    Request body (JSON): any subset of model features. For a meaningful prediction
    provide at least SPEED_THROUGH_WATER, ME_AVG_RPM and DISPLACEMENT; optional
    fuel_type (default VLSFO) selects the mass conversion.
    """
    logger.info(f"api_handler event: {json.dumps(event.get('rawPath', ''))}")
    try:
        body = event.get("body") or "{}"
        if event.get("isBase64Encoded"):
            import base64
            body = base64.b64decode(body).decode("utf-8")
        payload = json.loads(body) if isinstance(body, str) else body
        if not isinstance(payload, dict):
            return _resp(400, {"error": "request body must be a JSON object"})
        prediction = _predict_row(payload)
        echo = {k: payload[k] for k in payload if k in C.FEATURES or k == "fuel_type"}
        return _resp(200, {"input_echo": echo, "prediction": prediction})
    except Exception as e:
        logger.error(f"api_handler failed: {e}", exc_info=True)
        return _resp(500, {"error": str(e)})


# ================================================================= submission
def submission_payload(submission: pd.DataFrame) -> dict:
    """Canonical prediction output (the 102 masked-window cells)."""
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "n_predictions": int(len(submission)),
        "predictions": submission.to_dict(orient="records"),
    }


# ================================================================= speed loss
def _median(a: list) -> float:
    s = sorted(a)
    return s[len(s) // 2] if s else float("nan")


def _fit_seg(days: list, vals: list) -> dict:
    """Least-squares line over a maintenance interval -> trend segment endpoints."""
    n = len(days)
    sx, sy = sum(days), sum(vals)
    sxx = sum(d * d for d in days)
    sxy = sum(d * v for d, v in zip(days, vals))
    den = n * sxx - sx * sx
    b = (n * sxy - sx * sy) / den if den else 0.0
    a = sy / n - b * (sx / n)
    d0, d1 = days[0], days[-1]
    return {"d0": int(d0), "d1": int(d1),
            "p0": round(max(0.0, a + b * d0), 3), "p1": round(max(0.0, a + b * d1), 3)}


def compute_speed_loss(g: pd.DataFrame, events: list) -> "dict | None":
    """Backend Speed-Loss proxy (authoritative source for the dashboard's tier-1 path).

    Mirrors the previously-validated frontend derivation so the numbers are consistent:
    comparability filter (modal speed band +/-1.5kn, displacement median +/-25%),
    Admiralty normalisation idx = foc_eq24 / (displacement^(2/3) * STW^3), a clean
    baseline from the lowest quartile of each post-maintenance window's early days, and
    a 7-point rolling median. Returns the DATA_CONTRACT `speed_loss` block or None when
    a ship lacks enough comparable steady days (frontend then falls back gracefully).
    """
    steady = g["steady"].fillna(False) if "steady" in g else False
    sub = g[steady & g["foc_eq24"].notna()
            & (g["SPEED_THROUGH_WATER"] > 8) & g["DISPLACEMENT"].notna()].sort_values("day")
    if len(sub) < 20:
        return None

    mode = sub["SPEED_THROUGH_WATER"].round().value_counts().idxmax()
    rows = sub[(sub["SPEED_THROUGH_WATER"] - mode).abs() <= 1.5]
    disp_med = rows["DISPLACEMENT"].median()
    if disp_med and disp_med > 0:
        rows = rows[((rows["DISPLACEMENT"] - disp_med).abs() / disp_med) <= 0.25]
    if len(rows) < 20:
        rows = sub
    rows = rows.sort_values("day").to_dict("records")

    def idx(r):
        return r["foc_eq24"] / ((r["DISPLACEMENT"] ** (2 / 3)) * r["SPEED_THROUGH_WATER"] ** 3) * 1e9

    ev_days = sorted(int(e["event_day"]) for e in events)
    bounds = [0, *ev_days, DAY_MAX + 1]
    points, segments = [], []
    for bi in range(len(bounds) - 1):
        seg = [r for r in rows if bounds[bi] <= r["day"] < bounds[bi + 1]]
        if len(seg) < 5:
            continue
        idxs = [idx(r) for r in seg]
        early = sorted(idxs[:max(5, len(seg) // 5)])
        k = max(2, len(early) // 4)
        base = sum(early[:k]) / k
        if base <= 0:
            continue
        raw = [max(0.0, (v / base - 1) * 100) for v in idxs]
        seg_days = [int(r["day"]) for r in seg]
        seg_v = [_median(raw[max(0, n - 3):n + 4]) for n in range(len(seg))]
        points.extend({"day": d, "pct": round(v, 3)} for d, v in zip(seg_days, seg_v))
        if len(seg) >= 3:
            segments.append(_fit_seg(seg_days, seg_v))

    if len(points) < 20:
        return None
    current = _median([p["pct"] for p in points[-15:]])
    return {
        "method": "admiralty-proxy-v1",
        "current_pct": round(current, 3),
        "points": points,
        "segments": segments,
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
        maint = maintenance_by_ship.get(ship_id, [])
        hull_events = [e for e in maint
                       if e.get("event_type") in HULL_EVENTS and e.get("event_day") is not None]
        speed_loss = compute_speed_loss(g, hull_events)  # None if insufficient data
        ships.append({
            "ship_id": ship_id,
            "ship_type": g["ship_type"].iloc[0] if "ship_type" in g else None,
            "n_days": int(len(g)),
            "n_predictions": int(g["predict_fuel"].notna().sum()),
            "maintenance": maint,
            "speed_loss": speed_loss,
            "daily": daily,
        })

    n_sl = sum(1 for s in ships if s["speed_loss"])
    logger.info(f"Computed speed_loss for {n_sl}/{len(ships)} ships")

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model": "physics-residual hybrid: Admiralty backbone + HistGradientBoosting",
        "target": "ME_FULLSPEED_CONSUMP_[fuel] (MT/day, full speed); foc_eq24 = VLSFO-eq/24h",
        "validation": VALIDATION,
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

    # Prefer the exact integer event_day (same per-ship day-index as NOON_UTC); fall
    # back to mapping a calendar event_date via the fleet epoch. Mirrors the ETL
    # handler's align_event_day so both stages agree on the maintenance timeline.
    if "event_day" in mt.columns:
        mt["event_day"] = pd.to_numeric(mt["event_day"], errors="coerce")
        mt = mt.dropna(subset=["event_day"])
        mt["event_day"] = mt["event_day"].astype(int)
        mt = mt.sort_values("event_day")
    else:
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
