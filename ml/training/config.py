"""Feature configuration and modelling constants for the fuel-consumption model.

Single source of truth for feature lists, the prediction target, and the fuel
heating values used to build the VLSFO-equivalent target. Shared by training,
validation, and inference so the ETL output, the model, and the serving path
never drift apart.
"""

# VLSFO(40.2 MJ/kg)-equivalent target. The ETL folds the five per-fuel columns into
# `foc_eq` (equivalent full-speed fuel) and `foc_eq24` (per-24h). See ml-eda doc §2.
TARGET = "foc_eq24"
LOG_TARGET = True  # model learns log(foc_eq24); MAPE is scale-invariant so this is safe

LCV = {"HSHFO": 40.2, "ULSFO": 41.2, "VLSFO": 40.2, "LSMGO": 42.7, "BIO_HSFO": 39.4}

# Numeric features. All are AVAILABLE on masked PREDICT rows (verified): only
# HORSE_POWER / SFOC / THRUST etc. are hidden, and none of those are used here.
NUM_FEATS = [
    "log_v3d23",             # physics anchor: log(STW^3 * displacement^(2/3))
    "SPEED_THROUGH_WATER", "ME_AVG_RPM", "PROPELLER_SPEED",
    "DISPLACEMENT", "MID_DRAFT", "trim", "CARGO_ON_BOARD",
    "WIND_SCALE", "WIND_SPEED", "SEA_HEIGHT", "SWELL_HEIGHT",
    "SEA_WATER_TEMP", "WATER_DEPTH",
    "DIFF_STW_SOG_SLIP",     # reported current proxy
    "FULL_SPD_STW_SLIP",     # slip (fouling signal, visible inside masked windows)
    "days_since_hull", "days_since_prop", "days_since_dd",   # maintenance clock
    "last_event_had_hard_fouling", "fouling_severity_score",
    "HOURS_FULL_SPEED",
]

# Categorical features (HistGradientBoosting handles these natively via dtype).
CAT_FEATS = ["ship", "ship_type", "last_event_type", "last_event_prop_cond"]

FEATURES = NUM_FEATS + CAT_FEATS

TRAIN_SHIPS = [f"S{i}" for i in range(1, 13)]   # S1-S12 have full (unmasked) targets
PREDICT_SHIPS = ["S21", "S22", "S23"]           # masked windows -> the 102 targets

RANDOM_STATE = 42
