"""
YMINSIGHT - ETL Lambda Handler
Event-Driven Data Cleaning & Feature Engineering Pipeline

Triggered by S3 PutObject event when new CSV is uploaded to raw-data bucket.
Performs:
1. Data validation & type casting
2. Weather filtering (WIND_SCALE <= 4)
3. Full speed filtering (HOURS_FULL_SPEED >= 22)
4. Feature engineering (days since last maintenance, fouling severity, fuel type detection)
5. Saves processed data to S3 processed-data bucket
"""

import json
import os
import logging
from datetime import datetime
from typing import Optional

import boto3
import pandas as pd
import numpy as np

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3_client = boto3.client("s3")

# Configuration
PROCESSED_BUCKET = os.environ.get("PROCESSED_BUCKET", "yminsight-processed-data")
RAW_BUCKET = os.environ.get("RAW_BUCKET", "yminsight-raw-data")
MAINTENANCE_KEY = os.environ.get("MAINTENANCE_KEY", "maintenance/maintenance.csv")

# Filtering thresholds (ISO 19030 compliant)
MAX_WIND_SCALE = 4
MIN_HOURS_FULL_SPEED = 22

# Fouling severity mapping
FOULING_SEVERITY = {
    "slime": 1,
    "algae": 2,
    "barnacle": 3,
    "calcium": 4,
    "tubeworm": 5,
}


def lambda_handler(event, context):
    """
    Main Lambda entry point. Triggered by S3 PutObject event.
    """
    logger.info(f"ETL Lambda triggered with event: {json.dumps(event)}")

    try:
        # Extract S3 event info
        record = event["Records"][0]
        bucket = record["s3"]["bucket"]["name"]
        key = record["s3"]["object"]["key"]

        logger.info(f"Processing file: s3://{bucket}/{key}")

        # Load raw voyage data
        voyage_df = load_csv_from_s3(bucket, key)
        logger.info(f"Loaded {len(voyage_df)} raw records")

        # Load maintenance history
        maintenance_df = load_csv_from_s3(RAW_BUCKET, MAINTENANCE_KEY)
        logger.info(f"Loaded {len(maintenance_df)} maintenance records")

        # Step 1: Data validation & type casting
        voyage_df = validate_and_cast(voyage_df)

        # Step 2: Apply weather filter (WIND_SCALE <= 4)
        voyage_df = filter_weather(voyage_df)
        logger.info(f"After weather filter: {len(voyage_df)} records")

        # Step 3: Apply full speed filter (HOURS_FULL_SPEED >= 22)
        voyage_df = filter_full_speed(voyage_df)
        logger.info(f"After full speed filter: {len(voyage_df)} records")

        # Step 4: Feature engineering
        voyage_df = engineer_features(voyage_df, maintenance_df)
        logger.info(f"Feature engineering complete: {voyage_df.shape[1]} columns")

        # Step 5: Save processed data to S3
        output_key = generate_output_key(key)
        save_to_s3(voyage_df, PROCESSED_BUCKET, output_key)
        logger.info(f"Saved processed data to s3://{PROCESSED_BUCKET}/{output_key}")

        return {
            "statusCode": 200,
            "body": json.dumps({
                "message": "ETL pipeline completed successfully",
                "input_records": len(event["Records"]),
                "output_records": len(voyage_df),
                "output_location": f"s3://{PROCESSED_BUCKET}/{output_key}",
            }),
        }

    except Exception as e:
        logger.error(f"ETL pipeline failed: {str(e)}", exc_info=True)
        raise


def load_csv_from_s3(bucket: str, key: str) -> pd.DataFrame:
    """Load a CSV file from S3 into a pandas DataFrame."""
    response = s3_client.get_object(Bucket=bucket, Key=key)
    return pd.read_csv(response["Body"])


def validate_and_cast(df: pd.DataFrame) -> pd.DataFrame:
    """Validate data schema and cast columns to appropriate types."""
    df = df.copy()

    # Rename for consistency
    df = df.rename(columns={"De-identification Name": "ship_id"})

    # Numeric columns that should be float
    numeric_cols = [
        "AVG_SPEED", "SPEED_THROUGH_WATER", "ME_AVG_RPM", "PROPELLER_SPEED",
        "FORE_DRAFT", "AFTER_DRAFT", "DISPLACEMENT", "CARGO_ON_BOARD",
        "WIND_SCALE", "SEA_HEIGHT", "SEA_WATER_TEMP", "WIND_SPEED",
        "WATER_DEPTH", "MID_DRAFT", "TOTAL_DISTANCE", "SEA_SPEED_DISTANCE",
        "HORSE_POWER", "LOAD_PCT", "SFOC", "ME_SLIP", "THRUST",
        "THRUST_QUOTIENT", "TOTAL_CONSUMP", "ME_CONSUMPTION",
        "ME_FULLSPEED_CONSUMP_HSHFO", "ME_FULLSPEED_CONSUMP_ULSFO",
        "ME_FULLSPEED_CONSUMP_VLSFO", "ME_FULLSPEED_CONSUMP_LSMGO",
        "ME_FULLSPEED_CONSUMP_BIO_HSFO",
        "HOURS_FULL_SPEED", "HOURS_TOTAL",
    ]

    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # Drop rows with critical missing values
    critical_cols = ["ship_id", "AVG_SPEED", "ME_AVG_RPM", "HOURS_FULL_SPEED"]
    df = df.dropna(subset=[c for c in critical_cols if c in df.columns])

    logger.info(f"After validation: {len(df)} records remain")
    return df


def filter_weather(df: pd.DataFrame) -> pd.DataFrame:
    """Filter for calm weather conditions (WIND_SCALE <= 4)."""
    mask = df["WIND_SCALE"] <= MAX_WIND_SCALE
    return df[mask].copy()


def filter_full_speed(df: pd.DataFrame) -> pd.DataFrame:
    """Filter for full speed sailing periods (HOURS_FULL_SPEED >= 22)."""
    mask = df["HOURS_FULL_SPEED"] >= MIN_HOURS_FULL_SPEED
    return df[mask].copy()


def engineer_features(df: pd.DataFrame, maintenance_df: pd.DataFrame) -> pd.DataFrame:
    """
    Feature engineering pipeline:
    - Detect active fuel type
    - Calculate days since last maintenance event
    - Compute fouling severity score
    - Calculate power-speed ratio (efficiency indicator)
    - Derive mid-draft if missing
    """
    df = df.copy()

    # 1. Detect active fuel type for each row
    fuel_cols = [
        "ME_FULLSPEED_CONSUMP_HSHFO",
        "ME_FULLSPEED_CONSUMP_ULSFO",
        "ME_FULLSPEED_CONSUMP_VLSFO",
        "ME_FULLSPEED_CONSUMP_LSMGO",
        "ME_FULLSPEED_CONSUMP_BIO_HSFO",
    ]
    df["active_fuel_type"] = df[fuel_cols].apply(detect_fuel_type, axis=1)
    df["me_fullspeed_consump"] = df[fuel_cols].max(axis=1)

    # 2. Days since last maintenance event per ship
    maintenance_df = preprocess_maintenance(maintenance_df)
    df["days_since_last_cleaning"] = df.apply(
        lambda row: calc_days_since_maintenance(
            row["ship_id"], row.get("NOON_UTC"), maintenance_df, event_type="cleaning"
        ),
        axis=1,
    )
    df["days_since_last_propeller_polish"] = df.apply(
        lambda row: calc_days_since_maintenance(
            row["ship_id"], row.get("NOON_UTC"), maintenance_df, event_type="propeller"
        ),
        axis=1,
    )

    # 3. Fouling severity score from latest inspection
    df["fouling_severity_score"] = df["ship_id"].apply(
        lambda sid: get_fouling_severity(sid, maintenance_df)
    )

    # 4. Hull fouling types (one-hot encoded)
    df = encode_fouling_types(df, maintenance_df)

    # 5. Power-speed efficiency ratio
    df["power_speed_ratio"] = np.where(
        df["SPEED_THROUGH_WATER"] > 0,
        df["HORSE_POWER"] / df["SPEED_THROUGH_WATER"],
        np.nan,
    )

    # 6. Derive mid-draft
    df["MID_DRAFT"] = df.apply(
        lambda row: row["MID_DRAFT"]
        if pd.notna(row.get("MID_DRAFT"))
        else (row.get("FORE_DRAFT", 0) + row.get("AFTER_DRAFT", 0)) / 2,
        axis=1,
    )

    # 7. Trim (draft difference)
    df["TRIM"] = df["AFTER_DRAFT"] - df["FORE_DRAFT"]

    # 8. Propeller condition encoding from maintenance
    df["propeller_condition_score"] = df["ship_id"].apply(
        lambda sid: get_propeller_condition_score(sid, maintenance_df)
    )

    return df


def detect_fuel_type(row: pd.Series) -> str:
    """Detect which fuel type is active based on consumption values."""
    fuel_map = {
        "ME_FULLSPEED_CONSUMP_HSHFO": "HSHFO",
        "ME_FULLSPEED_CONSUMP_ULSFO": "ULSFO",
        "ME_FULLSPEED_CONSUMP_VLSFO": "VLSFO",
        "ME_FULLSPEED_CONSUMP_LSMGO": "LSMGO",
        "ME_FULLSPEED_CONSUMP_BIO_HSFO": "BIO_HSFO",
    }
    for col, fuel_name in fuel_map.items():
        if col in row.index and pd.notna(row[col]) and row[col] > 0:
            return fuel_name
    return "UNKNOWN"


def preprocess_maintenance(df: pd.DataFrame) -> pd.DataFrame:
    """Parse and enrich maintenance dataframe."""
    df = df.copy()
    df["event_date"] = pd.to_datetime(df["event_date"], errors="coerce")
    df = df.dropna(subset=["event_date"])

    # Classify event types
    df["is_cleaning"] = df["event_type"].str.contains("UWC|UWI|DD", na=False)
    df["is_propeller"] = df["event_type"].str.contains("PP", na=False)

    return df


def calc_days_since_maintenance(
    ship_id: str,
    noon_utc: Optional[int],
    maintenance_df: pd.DataFrame,
    event_type: str = "cleaning",
) -> float:
    """
    Calculate days since last maintenance event for a given ship.
    Uses NOON_UTC as a sequential day index within voyage.
    Falls back to latest event date if no temporal alignment possible.
    """
    col = "is_cleaning" if event_type == "cleaning" else "is_propeller"
    ship_events = maintenance_df[
        (maintenance_df["ship_id"] == ship_id) & (maintenance_df[col])
    ].sort_values("event_date", ascending=False)

    if ship_events.empty:
        return 999.0  # No maintenance record - assume long overdue

    last_event_date = ship_events.iloc[0]["event_date"]
    # Use current date as reference since NOON_UTC is a sequence index
    days_diff = (pd.Timestamp.now() - last_event_date).days
    return float(max(days_diff, 0))


def get_fouling_severity(ship_id: str, maintenance_df: pd.DataFrame) -> float:
    """
    Calculate fouling severity score from latest inspection.
    Score = sum of individual fouling type severities.
    """
    ship_events = maintenance_df[
        (maintenance_df["ship_id"] == ship_id)
        & (maintenance_df["hull_fouling_type"].notna())
    ].sort_values("event_date", ascending=False)

    if ship_events.empty:
        return 0.0

    latest_fouling = ship_events.iloc[0]["hull_fouling_type"]
    if pd.isna(latest_fouling):
        return 0.0

    # Parse comma-separated fouling types
    fouling_types = [f.strip().lower() for f in str(latest_fouling).split(",")]
    score = sum(FOULING_SEVERITY.get(ft, 0) for ft in fouling_types)
    return float(score)


def encode_fouling_types(df: pd.DataFrame, maintenance_df: pd.DataFrame) -> pd.DataFrame:
    """One-hot encode fouling types from latest inspection per ship."""
    fouling_types = ["slime", "algae", "barnacle", "calcium", "tubeworm"]

    for ft in fouling_types:
        df[f"fouling_{ft}"] = 0

    for ship_id in df["ship_id"].unique():
        ship_events = maintenance_df[
            (maintenance_df["ship_id"] == ship_id)
            & (maintenance_df["hull_fouling_type"].notna())
        ].sort_values("event_date", ascending=False)

        if ship_events.empty:
            continue

        latest_fouling = str(ship_events.iloc[0]["hull_fouling_type"]).lower()
        for ft in fouling_types:
            if ft in latest_fouling:
                df.loc[df["ship_id"] == ship_id, f"fouling_{ft}"] = 1

    return df


def get_propeller_condition_score(ship_id: str, maintenance_df: pd.DataFrame) -> float:
    """Encode propeller condition: Good=1, Fair=2, Poor=3, Unknown=0."""
    condition_map = {"good": 1.0, "fair": 2.0, "poor": 3.0}

    ship_events = maintenance_df[
        (maintenance_df["ship_id"] == ship_id)
        & (maintenance_df["propeller_condition"].notna())
    ].sort_values("event_date", ascending=False)

    if ship_events.empty:
        return 0.0

    condition = str(ship_events.iloc[0]["propeller_condition"]).strip().lower()
    return condition_map.get(condition, 0.0)


def generate_output_key(input_key: str) -> str:
    """Generate output S3 key with timestamp."""
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    base_name = os.path.splitext(os.path.basename(input_key))[0]
    return f"processed/{base_name}_cleaned_{timestamp}.parquet"


def save_to_s3(df: pd.DataFrame, bucket: str, key: str):
    """Save DataFrame to S3 as Parquet for efficient downstream processing."""
    import io

    buffer = io.BytesIO()
    df.to_parquet(buffer, index=False, engine="pyarrow")
    buffer.seek(0)

    s3_client.put_object(
        Bucket=bucket,
        Key=key,
        Body=buffer.getvalue(),
        ContentType="application/octet-stream",
    )
