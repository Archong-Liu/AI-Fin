"""
YMINSIGHT - ETL Lambda Handler
Event-Driven Data Cleaning & Feature Engineering Pipeline

Triggered by S3 PutObject event when a new voyage CSV is uploaded to the raw-data
bucket. Produces one row per (ship, day) with modelling features + target, and
writes Parquet to the processed-data bucket.

Design notes (confirmed against EDA — see docs/ml-eda-and-decisions.md):
- The dataset uses HIDDEN / PREDICT string markers in masked windows. These MUST be
  captured BEFORE numeric coercion, otherwise the 102 PREDICT cells (the inference
  targets) are lost to NaN.
- WIND_SCALE <= 4 and HOURS_FULL_SPEED >= 22 are NOT hard filters. They define a
  `steady` flag used (a) as a training sample weight and (b) to select the Speed-Loss
  baseline. Hard-filtering here would discard ~60% of usable training rows AND could
  drop rows we must serve.
- NOON_UTC is a per-ship day index (0..~1825, ~5 years), not a timestamp. Maintenance
  is provided on the SAME integer day-index (`event_day`) and used directly; if only a
  calendar `event_date` is available it is mapped via a fleet epoch as a fallback.
- All maintenance-derived features use only events with event_day <= the row's day
  (no future leakage).
"""

import io
import json
import logging
import os
from datetime import datetime
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_s3_client = None


def s3():
    """Lazy S3 client so the pure transform (run_etl) is importable without boto3."""
    global _s3_client
    if _s3_client is None:
        import boto3
        _s3_client = boto3.client("s3")
    return _s3_client

# ------------------------------------------------------------------ configuration
PROCESSED_BUCKET = os.environ.get("PROCESSED_BUCKET", "yminsight-processed-data")
RAW_BUCKET = os.environ.get("RAW_BUCKET", "yminsight-raw-data")
MAINTENANCE_KEY = os.environ.get("MAINTENANCE_KEY", "maintenance/maintenance.csv")

# `steady` definition (aligns with the PREDICT-day selection & ISO 19030 baseline).
MAX_WIND_SCALE = 4
MIN_HOURS_FULL_SPEED = 22
# Below this many full-speed hours the per-24h fuel extrapolation (x24/h) is unreliable.
MIN_FULLSPEED_HOURS = 4

# Fallback only: if maintenance has a calendar event_date instead of the integer
# event_day, map NOON_UTC=0 to this epoch. Approximate; prefer the event_day form.
NOON_UTC_EPOCH = pd.Timestamp("2021-01-01")

# Lower heating value (MJ/kg). Fuels are folded to VLSFO(40.2)-equivalent so the model
# has one comparable target across fuel types.
LCV = {"HSHFO": 40.2, "ULSFO": 41.2, "VLSFO": 40.2, "LSMGO": 42.7, "BIO_HSFO": 39.4}
FUEL_COLS = [f"ME_FULLSPEED_CONSUMP_{f}" for f in LCV]

W1_SHIPS = {f"S{i}" for i in range(1, 9)} | {"S21"}

# Fouling severity weights (issue's proposed scale; see doc for the caveat that these
# do not materially move the model and are kept mainly for the dashboard narrative).
FOULING_SEVERITY = {"slime": 1, "algae": 2, "barnacle": 3, "calcium": 4, "tubeworm": 5}
HARD_FOULING = ("barnacle", "calcium", "tubeworm")

# Which maintenance types reset which component clock.
RESET = {
    "hull": {"DD", "UWC", "UWC+PP"},
    "prop": {"DD", "PP", "UWI+PP", "UWC+PP"},
    "dd": {"DD"},
}

# Physical sanity ranges: (col, low_exclusive, high_inclusive) -> outside => NaN.
RANGE_RULES = [
    ("SPEED_THROUGH_WATER", 1, 30), ("AVG_SPEED", 1, 30),
    ("FORE_DRAFT", 2, 25), ("AFTER_DRAFT", 2, 25),
    ("DISPLACEMENT", 1000, 400000), ("ME_AVG_RPM", 10, 150),
]
SLIP_COLS = ["FULL_SPD_STW_SLIP", "DIFF_STW_SOG_SLIP", "ME_SLIP"]


# ============================================================== Lambda entry point
def lambda_handler(event, context):
    """Triggered by S3 PutObject. Runs the ETL and writes processed Parquet."""
    logger.info(f"ETL Lambda triggered: {json.dumps(event)}")
    try:
        record = event["Records"][0]
        bucket = record["s3"]["bucket"]["name"]
        key = record["s3"]["object"]["key"]
        logger.info(f"Processing s3://{bucket}/{key}")

        voyage_df = load_csv_from_s3(bucket, key)
        maintenance_df = load_csv_from_s3(RAW_BUCKET, MAINTENANCE_KEY)
        logger.info(f"Loaded {len(voyage_df)} voyage rows, {len(maintenance_df)} maintenance rows")

        cleaning_report = []
        clean_df = run_etl(voyage_df, maintenance_df, report=cleaning_report)

        output_key = generate_output_key(key)
        save_to_s3(clean_df, PROCESSED_BUCKET, output_key)
        logger.info(f"Wrote {len(clean_df)} rows to s3://{PROCESSED_BUCKET}/{output_key}")

        report_key = generate_report_key(key)
        save_cleaning_report(cleaning_report, PROCESSED_BUCKET, report_key)
        logger.info(f"Wrote {len(cleaning_report)} cleaning record(s) to "
                    f"s3://{PROCESSED_BUCKET}/{report_key}")

        return {
            "statusCode": 200,
            "body": json.dumps({
                "message": "ETL pipeline completed successfully",
                "output_records": len(clean_df),
                "predict_cells": int(clean_df["predict_fuel"].notna().sum()),
                "cleaning_records": len(cleaning_report),
                "output_location": f"s3://{PROCESSED_BUCKET}/{output_key}",
                "cleaning_report": f"s3://{PROCESSED_BUCKET}/{report_key}",
            }),
        }
    except Exception as e:
        logger.error(f"ETL pipeline failed: {e}", exc_info=True)
        raise


def run_etl(voyage_df: pd.DataFrame, maintenance_df: pd.DataFrame, report=None) -> pd.DataFrame:
    """Pure transform (no S3) so it can be unit-tested / run locally.

    Order matters: markers are captured first, outliers cleaned before imputation,
    imputation before the physics feature, maintenance join last.

    `report` (optional): a list into which each cleaning decision is appended
    (ship/day/column/original value/reason). Left None by callers that don't need the
    audit trail (e.g. the ML build script), keeping the transform contract unchanged.
    """
    df = dedupe_and_parse(voyage_df)
    df = add_fuel_target(df)
    df = clean_outliers(df, report=report)
    df = impute_sea_temp(df)
    df = impute_displacement(df)
    df = flag_speed_inconsistency(df, report=report)
    df = add_features(df)
    df = join_maintenance(df, maintenance_df)
    return df.rename(columns={"De-identification Name": "ship", "NOON_UTC": "day"})


# ================================================================= 1. parse & dedupe
def dedupe_and_parse(df: pd.DataFrame) -> pd.DataFrame:
    """Drop duplicates (PREDICT rows win), capture HIDDEN/PREDICT markers, then cast.

    The order is critical: `PREDICT`/`HIDDEN` are strings that would coerce to NaN,
    so we record `predict_fuel` (which fuel a PREDICT cell targets) and `is_hidden`
    (HORSE_POWER masked) BEFORE numeric conversion.
    """
    df = df.copy()
    n0 = len(df)

    # exact-duplicate rows, then near-duplicate (ship, day) keeping the PREDICT row
    df = df.drop_duplicates()
    has_predict = df[FUEL_COLS].eq("PREDICT").any(axis=1)
    df = (df.assign(_p=has_predict)
            .sort_values("_p", ascending=False, kind="stable")
            .drop_duplicates(subset=["De-identification Name", "NOON_UTC"], keep="first")
            .sort_index()
            .drop(columns="_p"))
    logger.info(f"dedupe: {n0} -> {len(df)} rows")

    # capture markers before numeric coercion
    predict_fuel = pd.Series(pd.NA, index=df.index, dtype="string")
    for c in FUEL_COLS:
        predict_fuel = predict_fuel.mask(df[c] == "PREDICT", c)
    df["predict_fuel"] = predict_fuel
    df["is_hidden"] = df["HORSE_POWER"] == "HIDDEN"

    keep_str = ["De-identification Name", "VOYAGE", "predict_fuel", "is_hidden"]
    num_cols = [c for c in df.columns if c not in keep_str]
    df[num_cols] = (df[num_cols]
                    .replace({"HIDDEN": None, "PREDICT": None})
                    .apply(pd.to_numeric, errors="coerce"))
    return df


# ================================================================= 2. fuel target
def add_fuel_target(df: pd.DataFrame) -> pd.DataFrame:
    """VLSFO-equivalent full-speed fuel (foc_eq), normalised to per-24h (foc_eq24)."""
    eq = sum(df[f"ME_FULLSPEED_CONSUMP_{f}"].fillna(0) * lcv / 40.2 for f, lcv in LCV.items())
    n_fuels = sum((df[f"ME_FULLSPEED_CONSUMP_{f}"].fillna(0) > 0).astype(int) for f in LCV)
    df["foc_eq"] = eq.where(~df["is_hidden"])       # hidden rows: the 0-sum is fake
    df["n_fuels"] = n_fuels.where(~df["is_hidden"])
    df["foc_eq24"] = df["foc_eq"] / df["HOURS_FULL_SPEED"] * 24
    fuel_mat = df[FUEL_COLS].fillna(0)
    df["main_fuel"] = (fuel_mat.idxmax(axis=1)
                       .where(fuel_mat.max(axis=1) > 0)
                       .str.replace("ME_FULLSPEED_CONSUMP_", "", regex=False))
    return df


# ================================================================= 3. outliers
def _record_cleaning(report, df: pd.DataFrame, mask: pd.Series, col: str,
                     reason_code: str, reason: str, action: str = "scrubbed_to_nan"):
    """Log a summary line and (if `report` is not None) append one audit row per
    affected datapoint capturing the ship, day-index, column and ORIGINAL value.

    Call this BEFORE assigning NaN so the original value is still present. The
    detailed rows go to the S3 cleaning report (CSV); CloudWatch only gets the count.
    """
    n = int(mask.sum())
    if n == 0:
        return
    logger.info(f"[clean] {action}: {n} datapoint(s) in {col} | {reason_code}: {reason}")
    if report is None:
        return
    affected = df.loc[mask, ["De-identification Name", "NOON_UTC", col]]
    for _, r in affected.iterrows():
        report.append({
            "ship": r["De-identification Name"],
            "day": r["NOON_UTC"],
            "column": col,
            "original_value": r[col],
            "action": action,
            "reason_code": reason_code,
            "reason": reason,
        })


def clean_outliers(df: pd.DataFrame, report=None) -> pd.DataFrame:
    """Physical sanity checks + bad-value scrubbing (no rows dropped, only cells NaN'd).

    Each scrub is recorded (ship/day/column/original value/reason) into `report`, which
    the handler flushes to a CSV cleaning report in S3 for a durable data-quality audit.
    """
    for c in SLIP_COLS:
        mask = df[c].abs() > 50                        # S10 shows +/- thousands
        _record_cleaning(report, df, mask, c, "SLIP_IMPLAUSIBLE",
                         "slip magnitude > 50% (physically implausible)")
        df.loc[mask, c] = np.nan
    for c, lo, hi in RANGE_RULES:
        mask = (df[c] <= lo) | (df[c] > hi)
        _record_cleaning(report, df, mask, c, "OUT_OF_RANGE",
                         f"outside physical range ({lo}, {hi}]")
        df.loc[mask, c] = np.nan
    # full speed but no fuel logged => missing, not zero (only non-hidden rows)
    mask = (~df["is_hidden"]) & (df["foc_eq"] <= 0)
    _record_cleaning(report, df, mask, "foc_eq", "FUEL_ZERO_AT_FULL_SPEED",
                     "full-speed day but fuel <= 0 (treated as missing, not zero)")
    df.loc[mask, ["foc_eq", "foc_eq24"]] = np.nan
    # too few full-speed hours => per-24h extrapolation unreliable => drop target only
    mask = (~df["is_hidden"]) & (df["HOURS_FULL_SPEED"] < MIN_FULLSPEED_HOURS)
    _record_cleaning(report, df, mask, "HOURS_FULL_SPEED", "INSUFFICIENT_FULL_SPEED_HOURS",
                     f"full-speed hours < {MIN_FULLSPEED_HOURS}h -> per-24h fuel extrapolation "
                     f"unreliable (foc_eq24 scrubbed)")
    df.loc[mask, "foc_eq24"] = np.nan
    return df


# ================================================================= 4. imputation
def impute_sea_temp(df: pd.DataFrame) -> pd.DataFrame:
    """Sea temp (~31% missing): per-ship interpolation along the day index, then median."""
    df = df.sort_values(["De-identification Name", "NOON_UTC"])
    df["swt_imputed"] = df["SEA_WATER_TEMP"].isna()

    def fill(g):
        s = g.set_index("NOON_UTC")["SEA_WATER_TEMP"]
        s = s.interpolate(method="index", limit=45, limit_direction="both")
        return s.fillna(s.median()).to_numpy()

    df["SEA_WATER_TEMP"] = np.concatenate(
        [fill(g) for _, g in df.groupby("De-identification Name", sort=False)])
    n_imp = int(df["swt_imputed"].sum())
    if n_imp:
        logger.info(f"[impute] SEA_WATER_TEMP: filled {n_imp} missing value(s) via per-ship "
                    f"day-index interpolation (fallback: ship median)")
    return df


def impute_displacement(df: pd.DataFrame) -> pd.DataFrame:
    """Displacement (~31% missing) = cargo + per-ship median(displacement - cargo) offset.

    Recovers the physics feature v3d23/log_v3d23 for rows (incl. PREDICT rows) that
    would otherwise be dropped by the model's train mask.
    """
    offset = df["DISPLACEMENT"] - df["CARGO_ON_BOARD"]
    ship_off = offset.groupby(df["De-identification Name"]).transform("median")
    est = df["CARGO_ON_BOARD"] + ship_off.fillna(offset.median())
    df["disp_imputed"] = df["DISPLACEMENT"].isna() & est.notna()
    df["DISPLACEMENT"] = df["DISPLACEMENT"].fillna(est)
    n_imp = int(df["disp_imputed"].sum())
    if n_imp:
        logger.info(f"[impute] DISPLACEMENT: filled {n_imp} missing value(s) via "
                    f"cargo + per-ship median(displacement - cargo) offset")
    return df


# ================================================================= 5. speed check
def flag_speed_inconsistency(df: pd.DataFrame, report=None) -> pd.DataFrame:
    """Flag STW/SOG gaps that the reported current column does not corroborate."""
    gap = df["SPEED_THROUGH_WATER"] - df["AVG_SPEED"]
    df["stw_sog_gap"] = gap
    corroborated = (df["DIFF_STW_SOG_SLIP"] - gap).abs() <= 1.5
    df["speed_suspect"] = (gap.abs() > 3) & ~corroborated.fillna(False)
    _record_cleaning(report, df, df["speed_suspect"], "stw_sog_gap", "SPEED_INCONSISTENT",
                     "STW/SOG gap > 3kn not corroborated by reported current",
                     action="flagged_excluded_from_training")
    return df


# ================================================================= 6. derived feats
def add_features(df: pd.DataFrame) -> pd.DataFrame:
    df["trim"] = df["AFTER_DRAFT"] - df["FORE_DRAFT"]
    df["MID_DRAFT"] = df["MID_DRAFT"].fillna((df["FORE_DRAFT"] + df["AFTER_DRAFT"]) / 2)
    # Admiralty physics term: P ~ displacement^(2/3) * STW^3 (linear in log space)
    df["v3d23"] = df["SPEED_THROUGH_WATER"] ** 3 * df["DISPLACEMENT"] ** (2 / 3)
    df["ship_type"] = np.where(df["De-identification Name"].isin(W1_SHIPS), "W1", "W2")
    df["steady"] = (df["HOURS_FULL_SPEED"] >= MIN_HOURS_FULL_SPEED) & (df["WIND_SCALE"] <= MAX_WIND_SCALE)
    return df


# ================================================================= 7. maintenance
def align_event_day(maintenance_df: pd.DataFrame) -> pd.DataFrame:
    """Put maintenance events on the NOON_UTC day-index.

    Preferred: the maintenance file already carries an integer `event_day` on the
    same per-ship day-index as NOON_UTC (the exact competition format) — used as-is.

    Fallback: only a calendar `event_date` is available, so map it via the fleet epoch
    (NOON_UTC=0 ~= NOON_UTC_EPOCH). This is approximate (the epoch is inferred), so the
    integer `event_day` form is preferred whenever present.
    """
    mt = maintenance_df.copy()
    if "event_day" in mt.columns:
        mt["event_day"] = pd.to_numeric(mt["event_day"], errors="coerce")
        mt = mt.dropna(subset=["event_day"])
        mt["event_day"] = mt["event_day"].astype(int)
        return mt.sort_values("event_day")
    mt["event_date"] = pd.to_datetime(mt["event_date"], errors="coerce")
    mt = mt.dropna(subset=["event_date"])
    mt["event_day"] = (mt["event_date"] - NOON_UTC_EPOCH).dt.days
    return mt.sort_values("event_day")


def _had_hard_fouling(val) -> int:
    return int(isinstance(val, str) and any(k in val.lower() for k in HARD_FOULING))


def _fouling_severity(val) -> float:
    if not isinstance(val, str):
        return 0.0
    return float(sum(FOULING_SEVERITY.get(f.strip().lower(), 0) for f in val.split(",")))


def join_maintenance(df: pd.DataFrame, maintenance_df: pd.DataFrame) -> pd.DataFrame:
    """Per (ship, day): maintenance clock + last PAST event diagnostics (no leakage)."""
    mt = align_event_day(maintenance_df)
    feats = []
    for ship, g in df.groupby("De-identification Name"):
        ev = mt[mt["ship_id"] == ship]
        for day in g["NOON_UTC"]:
            row = {"De-identification Name": ship, "NOON_UTC": day}
            past = ev[ev["event_day"] <= day]                       # PAST events only
            for part, types in RESET.items():
                sel = past[past["event_type"].isin(types)]
                row[f"days_since_{part}"] = day - sel["event_day"].iloc[-1] if len(sel) else np.nan
            phys = past[past["event_type"] != "UWI"]                # UWI = inspection only
            if len(phys):
                last = phys.iloc[-1]
                row["last_event_type"] = last["event_type"]
                row["last_event_prop_cond"] = last["propeller_condition"]
                row["last_event_had_hard_fouling"] = _had_hard_fouling(last["hull_fouling_type"])
                row["fouling_severity_score"] = _fouling_severity(last["hull_fouling_type"])
            else:
                row["last_event_type"] = "NONE"
                row["last_event_prop_cond"] = np.nan
                row["last_event_had_hard_fouling"] = np.nan
                row["fouling_severity_score"] = np.nan
            feats.append(row)
    return df.merge(pd.DataFrame(feats), on=["De-identification Name", "NOON_UTC"], how="left")


# ================================================================= S3 helpers
def load_csv_from_s3(bucket: str, key: str) -> pd.DataFrame:
    """Load a CSV from S3 as strings (dtype=str) so HIDDEN/PREDICT markers survive."""
    response = s3().get_object(Bucket=bucket, Key=key)
    return pd.read_csv(response["Body"], dtype=str)


def generate_output_key(input_key: str) -> str:
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    base_name = os.path.splitext(os.path.basename(input_key))[0]
    return f"processed/{base_name}_cleaned_{timestamp}.parquet"


def generate_report_key(input_key: str) -> str:
    """Cleaning-report key under a distinct prefix (NOT processed/*.parquet, so it does
    not trigger the inference Lambda)."""
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    base_name = os.path.splitext(os.path.basename(input_key))[0]
    return f"cleaning-reports/{base_name}_cleaning_{timestamp}.csv"


def save_to_s3(df: pd.DataFrame, bucket: str, key: str):
    buffer = io.BytesIO()
    df.to_parquet(buffer, index=False, engine="pyarrow")
    buffer.seek(0)
    s3().put_object(Bucket=bucket, Key=key, Body=buffer.getvalue(),
                    ContentType="application/octet-stream")


# Stable column order for the cleaning-report CSV (audit trail of scrubbed/flagged data).
REPORT_COLUMNS = ["ship", "day", "column", "original_value", "action", "reason_code", "reason"]


def save_cleaning_report(records: list, bucket: str, key: str):
    """Write the per-datapoint cleaning audit as CSV. Always writes a header (even with
    zero records) so each run has a corresponding, self-describing report object."""
    df = pd.DataFrame(records, columns=REPORT_COLUMNS)
    df = df.sort_values(["ship", "day", "column"]) if not df.empty else df
    csv_bytes = df.to_csv(index=False).encode("utf-8")
    s3().put_object(Bucket=bucket, Key=key, Body=csv_bytes, ContentType="text/csv")
