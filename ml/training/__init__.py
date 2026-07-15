"""YMINSIGHT fuel-consumption model — training package.

Modules:
    config      feature lists, target, LCV, ship groups, random state
    model       load_processed, add_derived, make_model, train_mask, xy,
                train, predict_submission
    validation  mape, event_holdout_cv, leave_one_ship_out_cv

Minimal end-to-end:
    from ml.training import model, validation
    df = model.load_processed("s3://yminsight-processed-data/.../clean_daily.parquet")
    mdl = model.train(df)
    submission = model.predict_submission(mdl, df)   # 102 rows
"""
from . import config, model, validation  # noqa: F401
