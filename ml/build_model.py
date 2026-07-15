"""Build the deployable model artifact + reproducible outputs (issues #1, #4).

Runs end-to-end on the raw CSVs in data/raw so anyone who clones the repo can
reproduce everything with a single command:

    pip install -r requirements.txt
    python ml/build_model.py

Produces:
    data/processed/clean_daily.csv   the ETL output (one row per ship/day)  [gitignored]
    ml/artifacts/model.joblib        the trained HybridModel (ml.training.model.HybridModel)
    ml/artifacts/requirements.txt    exact training dependency versions (pickle compatibility)
    ml/examples/submission.csv       the 102 predictions this model produces (repo source of truth)

The pickle stores an `ml.training.model.HybridModel`; the inference image must contain
this same `ml/training/` code and the pinned dependency versions to unpickle it.

Sanity check is a serialization round-trip: the reloaded model must reproduce the
in-memory model's predictions exactly (Δ = 0), proving the artifact is faithful.
"""
from __future__ import annotations

import platform
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent   # AI-Fin/
sys.path.insert(0, str(ROOT))

from lambdas.etl import handler                  # noqa: E402
from ml.training import model                    # noqa: E402  (pickle path: ml.training.model.HybridModel)

RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"
ARTIFACTS = ROOT / "ml" / "artifacts"
EXAMPLES = ROOT / "ml" / "examples"


def build() -> None:
    for d in (PROCESSED, ARTIFACTS, EXAMPLES):
        d.mkdir(parents=True, exist_ok=True)

    # 1) ETL: raw voyage + maintenance CSV -> one row per (ship, day) + features/target
    voyage = pd.read_csv(RAW / "vt_fd.csv", dtype=str)
    maint = pd.read_csv(RAW / "maintenance.csv", dtype=str)
    df = model.add_derived(handler.run_etl(voyage, maint))
    df.to_csv(PROCESSED / "clean_daily.csv", index=False)
    print(f"[etl] {len(df)} rows, {int(df['predict_fuel'].notna().sum())} PREDICT cells "
          f"-> data/processed/clean_daily.csv")

    # 2) train the hybrid on all usable rows, then serialise
    mdl = model.train(df)
    print(f"[train] backbone: log(foc_eq24) ~= {mdl.a:.3f} + {mdl.b:.3f}*log_v3d23")
    artifact = ARTIFACTS / "model.joblib"
    joblib.dump(mdl, artifact)
    print(f"[save] {artifact.relative_to(ROOT)}  ({artifact.stat().st_size/1024:.0f} KB)")

    # 3) pin exact training dependency versions (sklearn pickles are version-sensitive)
    reqs = ARTIFACTS / "requirements.txt"
    import sklearn
    reqs.write_text(
        "# Training environment for model.joblib (issue #4).\n"
        "# sklearn pickles are version-sensitive: the inference image MUST match these\n"
        "# exactly to unpickle ml.training.model.HybridModel.\n"
        f"# Python {platform.python_version()}\n"
        f"scikit-learn=={sklearn.__version__}\n"
        f"numpy=={np.__version__}\n"
        f"pandas=={pd.__version__}\n"
        f"joblib=={joblib.__version__}\n"
    )
    print(f"[save] {reqs.relative_to(ROOT)}")

    # 4) write the canonical submission this model produces (repo source of truth)
    sub = model.predict_submission(mdl, df)
    assert len(sub) == 102, f"expected 102 predictions, got {len(sub)}"
    sub.to_csv(EXAMPLES / "submission.csv", index=False)
    print(f"[save] {(EXAMPLES/'submission.csv').relative_to(ROOT)}  "
          f"({len(sub)} preds, {sub.predicted_value.min():.1f}-{sub.predicted_value.max():.1f} MT)")

    # 5) sanity: reloaded artifact must reproduce the in-memory model exactly (round-trip)
    reloaded = joblib.load(artifact)
    got = model.predict_submission(reloaded, df)
    max_abs = float(np.max(np.abs(sub.predicted_value.to_numpy() - got.predicted_value.to_numpy())))
    print(f"[sanity] round-trip max |Δ| = {max_abs:.6f} MT")
    assert max_abs == 0.0, "reloaded model does not match in-memory model — serialization issue"
    print("[sanity] OK: model.joblib faithfully reproduces ml/examples/submission.csv")


if __name__ == "__main__":
    build()
