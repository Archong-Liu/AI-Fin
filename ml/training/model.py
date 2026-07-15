"""Fuel-consumption model: physics-prior + gradient boosting (hybrid).

The model learns `log(foc_eq24)` — the log of VLSFO-equivalent per-24h full-speed
fuel — with `log_v3d23` (the Admiralty physics term) as the main feature. Learning
in log space against a physics anchor means the tree ensemble effectively models the
*deviation from the physical baseline*, whose main drivers are hull/propeller fouling
and weather.

Estimator: HistGradientBoostingRegressor
  - native NaN + categorical support (no imputation/one-hot plumbing needed)
  - absolute_error loss on the log target ≈ minimising relative error (MAPE-aligned)

Typical interface:
    df = load_processed(path)               # ETL output (clean_daily parquet/csv)
    df = add_derived(df)                    # log_v3d23 etc.
    model = train(df)                       # fit on all usable training rows
    submission = predict_submission(model, df)   # the 102 masked-window predictions
"""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

from . import config as C


def load_processed(path: str) -> pd.DataFrame:
    """Load the ETL output (one row per ship/day) and prepare dtypes.

    Args:
        path: local path or s3:// URI to the processed parquet/csv from the ETL Lambda.
    Returns:
        DataFrame with categorical columns cast and derived columns added.
    """
    df = pd.read_parquet(path) if path.endswith(".parquet") else pd.read_csv(path)
    return add_derived(df)


def add_derived(df: pd.DataFrame) -> pd.DataFrame:
    """Add model-only derived columns (log_v3d23) and cast categoricals in place-safe copy."""
    df = df.copy()
    df["log_v3d23"] = np.log(df["v3d23"])
    for c in C.CAT_FEATS:
        df[c] = df[c].astype("category")
    return df


def make_model(random_state: int = C.RANDOM_STATE) -> HistGradientBoostingRegressor:
    """Construct the estimator with the tuned hyperparameters.

    absolute_error + log target keeps the optimisation aligned with MAPE; l2 + a
    min-leaf floor guard against overfitting the ~19k training rows.
    """
    return HistGradientBoostingRegressor(
        loss="absolute_error", max_iter=600, learning_rate=0.05,
        max_leaf_nodes=63, min_samples_leaf=40, l2_regularization=1.0,
        categorical_features="from_dtype", random_state=random_state,
    )


def train_mask(df: pd.DataFrame) -> pd.Series:
    """Boolean mask of rows eligible for training.

    Keeps rows with a reliable target and physics anchor, enough full-speed hours,
    and excludes STW/SOG-inconsistent days. This is a *quality* gate, distinct from
    the `steady` weighting below.
    """
    return (df["foc_eq24"].notna() & (df["foc_eq24"] > 3)
            & df["log_v3d23"].notna() & (df["HOURS_FULL_SPEED"] >= 6)
            & ~df["speed_suspect"].fillna(False))


def sample_weight(df: pd.DataFrame) -> np.ndarray:
    """Steady days (full-speed >=22h, wind <=4) up-weighted 1.0 vs 0.3.

    Every PREDICT day is steady, so the model should prioritise that regime.
    """
    return np.where(df["steady"], 1.0, 0.3)


class HybridModel:
    """Physics-residual hybrid.

    An explicit Admiralty backbone `log(foc_eq24) ~= a + b*log_v3d23` (the V^3 . Δ^(2/3)
    law) is fitted first; the gradient-boosted tree then learns only the *residual*
    (deviation from the physical baseline — driven by fouling, weather, and RPM). The
    physics law is therefore a structural prior, not just one feature among many.

    Note: MAPE is essentially identical to using log_v3d23 as a plain feature
    (~4.16% vs 4.17%), but the physics term is explicit, giving steadier extrapolation
    and a clearer story. The univariate backbone slope b is ~0.6 (below the ideal cubic-law
    1.0), which honestly reflects that RPM — carried by the residual GBT — is the dominant
    driver in this data. Monotonic constraints were tested and rejected (they cost ~0.14%).
    """

    def __init__(self, a: float, b: float, gbt: HistGradientBoostingRegressor, med: float):
        self.a, self.b, self.gbt, self.med = a, b, gbt, med

    def phys_log(self, d: pd.DataFrame) -> np.ndarray:
        """Physics backbone's prediction of log(foc_eq24). NaN anchors -> training median."""
        return self.a + self.b * d["log_v3d23"].fillna(self.med).to_numpy()

    def predict_log(self, d: pd.DataFrame) -> np.ndarray:
        return self.phys_log(d) + self.gbt.predict(d[C.FEATURES])

    def predict(self, d: pd.DataFrame) -> np.ndarray:
        """Predict foc_eq24 (VLSFO-equivalent per-24h fuel)."""
        return np.exp(self.predict_log(d))


def fit_hybrid(tr: pd.DataFrame, random_state: int = C.RANDOM_STATE) -> HybridModel:
    """Fit the physics backbone + residual GBT. `tr` must pass train_mask (log_v3d23 present)."""
    y = np.log(tr[C.TARGET]).to_numpy()
    w = sample_weight(tr)
    b, a = np.polyfit(tr["log_v3d23"].to_numpy(), y, 1)      # backbone a + b*log_v3d23
    med = float(tr["log_v3d23"].median())
    resid = y - (a + b * tr["log_v3d23"].to_numpy())
    gbt = make_model(random_state).fit(tr[C.FEATURES], resid, sample_weight=w)
    return HybridModel(a, b, gbt, med)


def train(df: pd.DataFrame, random_state: int = C.RANDOM_STATE) -> HybridModel:
    """Fit the hybrid model on all rows passing `train_mask`.

    Args:
        df: processed frame with derived columns (see add_derived).
    Returns:
        A fitted HybridModel (physics backbone + residual GBT).
    """
    return fit_hybrid(df[train_mask(df)], random_state)


def predict_submission(model: HybridModel, df: pd.DataFrame) -> pd.DataFrame:
    """Predict the masked PREDICT cells and convert back to per-fuel MT/day.

    The model predicts VLSFO-equivalent per-24h fuel; we convert to the actual fuel's
    mass (× 40.2/LCV) and scale by that day's real full-speed hours (× hours/24).

    Returns:
        DataFrame[ship_id, day, fuel_type, predicted_value] with one row per PREDICT cell.
    """
    rows = df[df["predict_fuel"].notna()].copy()
    eq24 = model.predict(rows)
    fuel = rows["predict_fuel"].str.replace("ME_FULLSPEED_CONSUMP_", "", regex=False)
    lcv = fuel.map(C.LCV).to_numpy()
    mt = eq24 * (40.2 / lcv) * (rows["HOURS_FULL_SPEED"].to_numpy() / 24)
    return (pd.DataFrame({
        "ship_id": rows["ship"].to_numpy(),
        "day": rows["day"].astype(int).to_numpy(),
        "fuel_type": rows["predict_fuel"].to_numpy(),
        "predicted_value": np.round(mt, 2),
    }).sort_values(["ship_id", "day"]).reset_index(drop=True))
