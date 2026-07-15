# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

YMINSIGHT — a vessel Speed Loss / hull-fouling monitoring system for Yang Ming's fleet
(AWS hackathon project). ML models fuel consumption from noon-report data using a
physics-residual hybrid, ETL/inference run as containerized Lambdas, infra is Terraform,
and a static React dashboard reads pre-generated JSON via CloudFront.

The system has three workstreams that meet at file/schema boundaries, not shared code:
ML (`ml/`, `lambdas/etl`, `lambdas/inference`), Cloud/infra (`infrastructure/`,
`lambdas/notify`), and Dashboard (`frontend/`). See `docs/team-interface.md` for the
interface contracts between them and `docs/architecture.md` for the original design
(note: some of it is aspirational/stale — e.g. it describes SNS + REST API Gateway,
but the actual `infrastructure/modules/` use container-image Lambdas, HTTP API v2, and
an SES-based notify Lambda instead. When infra docs and `infrastructure/modules/*.tf`
disagree, the `.tf` is the source of truth).

## Commands

### ML pipeline (reproduce end-to-end)

```bash
pip install -r requirements.txt
python ml/build_model.py
```

Runs ETL (`lambdas/etl/handler.run_etl`) → feature engineering → trains the hybrid
model → writes `ml/artifacts/model.joblib`, `ml/artifacts/requirements.txt`, and
`ml/examples/submission.csv`, then does a serialization round-trip sanity check
(reloaded model must match the in-memory model exactly). There is no separate test
suite (`tests/` is an empty placeholder) — this script's own round-trip assertion is
currently the correctness check.

To run pieces individually (e.g. in a notebook), see the quickstart in `ml/README.md`:
load `data/raw/*.csv` → `lambdas.etl.handler.run_etl` → `ml.training.model.add_derived`
→ `ml.training.model.train` / `predict_submission`, and
`ml.training.validation.event_holdout_cv` for MAPE validation.

### Frontend

```bash
cd frontend
npm install
npm run dev       # Vite dev server, port 5173
npm run build     # outputs to frontend/dist, deployed by CI to S3 + CloudFront
npm run preview
```

No test/lint scripts are configured. CI (`.github/workflows/frontend-deploy.yml`)
builds and syncs `frontend/dist/` to S3 on push to `main` when `frontend/**` changes,
then invalidates CloudFront. Hashed assets get long-cache immutable headers;
`index.html` is `no-cache`.

### Infrastructure (Terraform)

```bash
cd infrastructure/environments/dev
terraform init
terraform plan
terraform apply
```

Lambda container images (ETL, inference) are built/pushed to ECR separately from
Terraform (see the Dockerfiles under `lambdas/etl/` and `lambdas/inference/` — the
inference image's build context must be the repo root so it can bake in
`ml/training/`, needed to unpickle `model.joblib`). `terraform apply` only picks up a
new image after it's pushed with the `:latest` tag Terraform references.

## Architecture

### Data flow

1. Noon-report CSVs (`vt_fd.csv`-shaped) land in the raw S3 bucket → S3 event
   triggers the ETL Lambda (`lambdas/etl/handler.py`, container image, entrypoint
   `lambda_handler`).
2. ETL cleans + engineers features (`run_etl` — pure, boto3-free, so it's importable
   locally/in `ml/build_model.py` without AWS creds) and writes per-ship-per-day
   Parquet to the processed bucket. Parquet was chosen over CSV specifically to
   preserve dtypes for the model (see `docs/architecture.md` §5's design note).
3. The inference Lambda (`lambdas/inference/handler.py`, container image) has two
   entrypoints on the same image: `lambda_handler` (batch, S3-triggered) and
   `api_handler` (on-demand what-if predictions via HTTP API, no auth — see
   `infrastructure/modules/api/`). It loads `model.joblib` (built by
   `ml/build_model.py`) via `ml.training.model.HybridModel`, and also builds the
   flattened `fleet_data.json` the frontend consumes (`build_fleet_data`).
4. The frontend fetches `results-json/fleet_data.json` directly from CloudFront —
   there is no read API. `POST /api/notify` (SES email) is the only on-demand,
   user-triggered API in the current build; `docs/feature-spec.md`'s other endpoints
   (`/api/recommend`, `/api/report/generate`, Bedrock LLM, SNS alerting) are
   spec/future-work, not implemented.

### ML model (`ml/training/`)

Physics-residual hybrid: an Admiralty-law backbone (`power ∝ Δ^(2/3)·V³`, fit in log
space via `np.polyfit`) supplies the physical prior; a `HistGradientBoostingRegressor`
learns only the residual (fouling/weather/RPM effects). `ml/training/config.py` is the
single source of truth for feature lists, targets, fuel heating values, and the W1/W2
ship groupings — don't duplicate these constants elsewhere. `ml/training/model.py` has
`load_processed`/`add_derived`/`train`/`predict_submission`/`HybridModel`;
`validation.py` has the two CV strategies (`event_holdout_cv` is the primary metric,
`leave_one_ship_out_cv` is the conservative cross-ship bound).

Order-of-operations matters in the ETL and is documented in `lambdas/etl/handler.py`'s
module docstring and `ml/README.md` §1: HIDDEN/PREDICT markers must be captured
*before* numeric coercion (or the 102 prediction targets get coerced to NaN),
`WIND_SCALE ≤ 4` / `HOURS_FULL_SPEED ≥ 22` are a `steady` sample-weight flag — not a
hard filter (hard-filtering would drop ~60% of usable rows and rows that must still be
served) — and maintenance joins only use events with `event_day <= ` the row's day to
avoid future leakage.

`model.joblib` is pickled — the inference container must ship the exact
`ml/training/` code and pinned deps (`ml/artifacts/requirements.txt` /
`requirements.txt`) used when it was built, or unpickling breaks.

### Frontend (`frontend/src/`)

Plain Vite + React (no router, no state library). `src/api.js` is the sole seam
between backend data and components — see `frontend/DATA_CONTRACT.md` for the
mode-detection contract it implements: it prefers a `speed_loss.points[]` block if
present, falls back to per-day `speed_loss_pct`, then to a client-side-derived
estimate, then to mock data if the fetch fails — so components only ever see one
normalized shape (`{id, name, type, sl, trend, daysClean, series: {...}, srcMode}`)
regardless of which upstream stage produced the JSON. When adding a ML-produced field,
prefer extending this contract over adding one-off shapes in components.

### Terraform modules (`infrastructure/modules/`)

Deploy order / dependency chain: `data-store` (S3 buckets + CloudFront) → `event` (S3
event notifications, needs Lambda ARNs from data-processing hence the explicit
`depends_on`) → `data-processing` (ETL + inference Lambdas) → `api` (HTTP API +
on-demand inference) → `notification` (SES + notify Lambda, attaches to the existing
HTTP API from `api`) → `cicd` (GitHub OIDC role for the frontend deploy workflow).
`infrastructure/environments/dev/main.tf` wires these together; `prod/` does not exist
yet.

### Placeholder directories

`config/`, `dashboard/`, `tests/`, and `lambdas/alert/` currently exist but are empty —
they're reserved for `config/thresholds.json`, alerting logic, and a test suite per
the original spec docs, none of which are implemented yet. Don't assume code exists
there just because the directory does.
