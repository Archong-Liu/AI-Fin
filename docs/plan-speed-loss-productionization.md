# Plan — Productionize ISO 19030 Speed Loss + Reframe the Dashboard

> **Status:** Proposed
> **Owners:** Cloud (pipeline/deploy), ML (speed_loss/validation exports), Frontend (chart reframe)
> **Depends on:** PR #12 (`ml/speed_loss.py`, ISO 19030) merged first

---

## 1. Problem

Two issues, one root cause.

1. **Two speed-loss sources of truth.** The **live** pipeline computes speed loss with a rough `admiralty-proxy-v1` inside `lambdas/inference/handler.py::compute_speed_loss` (thresholds 8%/12%). PR #12 adds a rigorous **ISO 19030** implementation (`ml/speed_loss.py`, thresholds 3%/6%, thrust attribution, UWI-trap, confidence flags) — but it's a standalone CLI that writes `ml/examples/speed_loss.json` and is **not wired into the pipeline**.

2. **Several dashboard charts are mock/derived**, not real (scan confirmed):
   - `SlExplorer` (SL main chart) — real, but **noisy/low-signal** (see §2).
   - `attrDonut` (損失歸因) — heuristic on `ship.sl`, **not** real attribution.
   - `focChart` (Daily FOC 實測 vs 模型基準) — **fabricated** (seeded RNG).
   - `stackedFoc` (油耗歸因堆疊) — **fabricated**.
   - `scatterChart` (holdout 預測 vs 實測) — **fabricated** (random cloud, no input).
   - `mapeBars` (各船 MAPE) — **fabricated** (random per ship; only the fleet 4.2% is real).

**Root cause:** the backend doesn't emit the fields these charts need, and the one signal it does emit (proxy speed loss) is noisy because the fouling→fuel signal is genuinely weak in this data (corr ~+0.12; fouling importance <0.005 vs RPM 0.94).

---

## 2. Honest signal reality (drives the reframe)

Per PR #12's `docs/speed-loss-limitations.md` (verified on `data/raw`):
- Real fouling effect ≈ 1–5%; daily speed-loss noise ≈ ±5% → **single-day SL is mostly noise**.
- Well-maintained ships legitimately show **~0 or slightly negative** SL (e.g. S1 latest = −1.88%, `INDETERMINATE` attribution). Negative = "no measurable degradation", **not** "hull got cleaner".
- Robust, defensible signals are: **cross-ship ranking, per-interval fouling accumulation rate, UWI-trap correctness, attribution (when thrust data suffices), dry-dock recommendation** — NOT dramatic daily V-curves.

**Design consequence:** the dashboard must **lead with the robust signals** and treat the daily curve as smoothed, secondary context with an explicit "flat = no measurable degradation" band (−2%…+2%).

---

## 3. Target architecture

```
raw CSV ─► ETL (parquet) ─► Inference Lambda
                                 ├─ model.predict            (fuel, existing)
                                 ├─ ISO 19030 speed loss     (ported from ml/speed_loss.py)  ← NEW in pipeline
                                 └─ writes results-json/
                                       ├─ fleet_data.json     (daily + predicted_mt, existing)
                                       ├─ speed_loss.json     (per-ship ISO 19030 block)      ← NEW served artifact
                                       └─ validation.json     (holdout pred-vs-actual + per-ship MAPE) ← NEW
                                 CloudFront /results-json/* ─► Frontend (api.js auto-detect)
```

Single source of truth for speed loss = **ISO 19030** (`ml/speed_loss.py` logic), computed in the Lambda, served as `speed_loss.json`. `compute_speed_loss` (admiralty-proxy) is **removed** from the handler.

---

## 4. Chart → data mapping (what each needs, and where it comes from)

| Chart | Needs | Source | Action |
|---|---|---|---|
| SL main (SlExplorer) | `history[].roll_speed_loss_pct`, `events[]` w/ UWI flags, `fouling_rate_pct_per_100d`, confidence | PR #12 `speed_loss.json` | **Reframe**: plot smoothed curve, mark UWI correctly, headline the rate + ranking |
| 損失歸因 donut (attrDonut) | `attribution {hull/prop/INDETERMINATE}` | PR #12 `speed_loss.json` | **Rewire** to real attribution; show "資料不足" on INDETERMINATE |
| Dry-dock reco (new) | `drydock_recommendation {recommend, rationale}` | PR #12 `speed_loss.json` | **Add** card |
| Daily FOC 實測 vs 基準 (focChart) | per-day actual `foc_eq24` (have) **+ per-day clean-hull baseline FOC** (missing) | fleet_data daily[] + **new ref-FOC export** | **Backend must add** per-day reference FOC; then rewire |
| 油耗歸因堆疊 (stackedFoc) | per-day component decomposition (clean/wind/draft/hull/prop) | **not produced by anyone** | **Drop or downgrade** to the latest attribution split (per-day decomposition is out of scope / low-signal) |
| holdout 預測 vs 實測 (scatterChart) | exported CV predicted-vs-actual pairs | **new `validation.json`** from `event_holdout_cv` | **Backend must export**; then rewire |
| 各船 MAPE (mapeBars) | per-ship CV MAPE | **new `validation.json`** | **Backend must export**; then rewire |

**Takeaway:** PR #12 fully covers SL curve + attribution + rate + dry-dock. The **FOC-detail** and **model-validation** charts need **new backend exports** (per-day reference FOC, holdout pred/actual pairs, per-ship MAPE) that neither the live pipeline nor PR #12 currently emit. `stackedFoc` per-day decomposition should be dropped (not supportable / low-signal).

---

## 5. `speed_loss.json` contract (from PR #12 output, to be served)

```jsonc
{
  "standard": "ISO 19030 (in-service, data-driven per-ship reference)",
  "thresholds_speed_loss_pct": { "warning": 3.0, "critical": 6.0 },
  "fleet_summary": [ { "ship_id", "ship_type", "latest_speed_loss_pct", "status",
                       "days_since_cleaning", "primary_cause", "hull_contribution_pct",
                       "propeller_contribution_pct", "trend", "recommend_drydock" } ],
  "ships": {
    "S1": {
      "reference": { "n_ref_days", "has_thrust_model" },          // confidence flags
      "latest":    { "day", "speed_loss_pct", "performance_loss_pct", "status",
                     "days_since_cleaning", "attribution": { "hull_contribution_pct",
                        "propeller_contribution_pct", "primary_cause", "window_days" },
                     "fouling_rate_pct_per_100d", "trend" },
      "history":   [ { "day", "speed_loss_pct", "performance_loss_pct",
                       "roll_speed_loss_pct", "days_since_hull" } ],
      "events":    [ { "event_day", "type", "resets", "is_inspection_only",
                       "days_since_hull_at_event", "recovery_pct",
                       "sl_before_pct", "sl_after_pct" } ],
      "drydock_recommendation": { "recommend_drydock", "current_speed_loss_pct",
                                  "fouling_rate_pct_per_100d", "rationale" }
    }
  }
}
```

Frontend `api.js` adds a **tier-0 (`iso19030`)** source that reads `speed_loss.json` when present, ahead of the existing tiers.

---

## 6. Phased plan

### Phase 0 — Merge PR #12 (no live impact)
- Additive only; merge to `main`. Captures `speed_loss.py`, `validate_submission.py`, SHAP, docs.

### Phase 1 — Port ISO 19030 into the inference Lambda (Cloud + ML)
1. Move `ml/speed_loss.py`'s core into an importable module the inference image bakes in (it already imports `lambdas.etl.handler` + `ml.training.model`, consistent with the Lambda).
2. In `inference/handler.py`: after loading the processed df, compute the per-ship ISO 19030 blocks and write `results-json/speed_loss.json`.
3. **Remove** `compute_speed_loss` (admiralty-proxy) and the `speed_loss` block from `fleet_data.json` (or keep `fleet_data.json` for daily/predicted_mt only). One source of truth.
4. Rebuild + push inference image; update Lambda; re-run; verify `speed_loss.json` in S3.

### Phase 2 — New validation + reference-FOC exports (ML + Cloud)
1. ML: add a small exporter that dumps `event_holdout_cv` predicted-vs-actual pairs + per-ship MAPE → `validation.json`; and per-day clean-hull reference FOC → into `speed_loss.json` history (or fleet_data).
2. Cloud: have the inference Lambda emit `validation.json` (static, model-version-scoped) and the ref-FOC field.

### Phase 3 — Frontend reframe (Frontend)
1. `api.js`: add tier-0 `iso19030` reader for `speed_loss.json`; map to internal shape (use `roll_speed_loss_pct`, `fouling_rate`, `attribution`, `events` w/ `is_inspection_only`, confidence).
2. Charts:
   - SlExplorer: smoothed curve + UWI-correct event markers + "flat band" (−2…+2%); headline **fouling rate + ranking**.
   - attrDonut: real attribution; `INDETERMINATE` → "歸因資料不足".
   - Add **dry-dock recommendation** card.
   - focChart: real actual `foc_eq24` bars + real reference-FOC line (once Phase 2 lands); else keep clearly labeled "示意".
   - scatterChart / mapeBars: read `validation.json`; else remove.
   - **Drop** `stackedFoc` per-day decomposition (or downgrade to a single attribution split).
3. Thresholds: default **3%/6%** (ISO scale) per `ship_type`; update `DEFAULT_THR` and the alert copy.

### Phase 4 — Deploy + verify (Cloud)
- Follow the proven flow: rebuild/push inference image → update Lambda → re-run on latest parquet → verify `speed_loss.json` + `validation.json` in S3 → CloudFront invalidate `/results-json/*` → frontend auto-deploys via CI on merge.
- E2E: upload a raw CSV, confirm the cascade regenerates all three JSONs and the dashboard shows real attribution + rate + validation.

---

## 7. Threshold change (call out)
ISO SL% is a **smaller scale** than the fuel-proxy. Warning/critical move **8%/12% → 3%/6%**. This changes: frontend `DEFAULT_THR`, per-ship threshold defaults, the notify email status bands (`_status`/`_color` in `lambdas/notify/handler.py`), and any alert copy. Must be updated together to stay consistent.

---

## 8. Risks / open questions
- **Signal is weak by nature** — even ISO 19030 will show many ships near 0/negative. The dashboard must frame this honestly (ranking/rate/attribution), not promise dramatic curves. This is a *framing* deliverable, not a data fix.
- **Per-day reference FOC + per-day component stack** may not be reliably derivable — scope `stackedFoc` out unless ML confirms a defensible decomposition.
- **`validation.json` is model-version-scoped**, not per-upload — regenerate it when the model is retrained, not on every CSV.
- **Notify thresholds** must move to 3/6 in lockstep, or alerts fire on the wrong scale.
- Cold-start: inference image already heavy; adding ISO computation is cheap (pandas/numpy), no new deps.

---

## 9. Suggested issues to file
1. **ML**: export `validation.json` (holdout pred-vs-actual pairs + per-ship MAPE) and per-day clean-hull reference FOC.
2. **Cloud**: port `ml/speed_loss.py` into inference Lambda; emit `speed_loss.json`; remove admiralty-proxy; redeploy.
3. **Frontend**: reframe charts around ISO signals; add tier-0 reader + dry-dock card; move thresholds to 3/6; drop/downgrade `stackedFoc`, `scatterChart`, `mapeBars` until backed by real data.
