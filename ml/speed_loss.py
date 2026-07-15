"""ISO 19030 Speed Loss (data-driven, per-ship reference) + thrust-based hull/propeller attribution.

Method (aligned with ISO 19030-1/-2):
- Primary parameters: speed-through-water (STW) + delivered power P_D. With no torque meter,
  ISO 19030-2 §4.2 allows the brake-power route; here fuel (foc_eq24, VLSFO-equivalent /24h)
  is used as the power proxy.
- Displacement normalization: log_v3d23 = log(STW^3 * displacement^(2/3)) is the ISO Admiralty term.
- "Same ship to itself" (ISO mandated): each ship's reference curve is fit on its own post-cleaning
  clean window; later steady days' deviation is the in-service performance loss.
- Per dry-docking interval: each interval's clean window is anchored to SL~=0 (ISO in-service PI).
- Hull vs propeller (ISO §4.3 requires thrust):
    hull = rise in thrust required at a given speed (added resistance)
    prop = rise in power required per unit thrust (efficiency loss)
- UWI trap: a pure UWI (inspection only) resets no maintenance clock, so it starts no new interval
  and the SL curve does NOT drop after it. The structural proof is days_since_hull_at_event
  (=0 for a real hull cleaning, >>0 for a pure UWI).

Consumes the ETL output (lambdas.etl.handler.run_etl) so it stays consistent with the model
pipeline. CLI writes ml/examples/speed_loss.json.

Usage:
    python ml/speed_loss.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

# NOTE: `compute()` depends only on numpy/pandas so it can be imported by the inference
# Lambda (which passes in the ETL frame + aligned maintenance directly). The ETL/model
# imports used only by the CLI live inside main() to keep this module import-light.
ROOT = Path(__file__).resolve().parent.parent          # AI-Fin/
RAW = ROOT / "data" / "raw"
EXAMPLES = ROOT / "ml" / "examples"

# maintenance type -> which clock it resets (identical to the ETL RESET map)
HULL_RESET = {"DD", "UWC", "UWC+PP"}
PROP_RESET = {"DD", "PP", "UWI+PP", "UWC+PP"}

CLEAN_WINDOW = 45     # days after a hull reset counted as the "clean" reference period
EVENT_WINDOW = 30     # before/after window (steady days) for the maintenance-effect recovery
ROLL = 30             # rolling window (steady days) for the SL curve
ATTR_WINDOW = 120     # recent window (steady days) for the latest attribution

# status thresholds on speed_loss_pct (tunable)
WARN_SL, CRIT_SL = 3.0, 6.0


def ols_fit(X: np.ndarray, y: np.ndarray) -> np.ndarray:
    A = np.column_stack([np.ones(len(X)), X])
    coef, *_ = np.linalg.lstsq(A, y, rcond=None)
    return coef


def ols_pred(coef: np.ndarray, X: np.ndarray) -> np.ndarray:
    A = np.column_stack([np.ones(len(X)), X])
    return A @ coef


def _design(df: pd.DataFrame, cols: list, med: dict) -> np.ndarray:
    return np.column_stack([df[c].fillna(med[c]).to_numpy(float) for c in cols])


def reference_mask(g: pd.DataFrame) -> pd.Series:
    """Clean reference period: steady days within CLEAN_WINDOW days after a hull reset.
    Fallbacks: smallest-25% days_since_hull steady days; else earliest 30% steady days."""
    steady = g["steady"] & g["foc_eq24"].notna() & g["log_v3d23"].notna()
    clean = steady & g["days_since_hull"].notna() & (g["days_since_hull"] <= CLEAN_WINDOW)
    if clean.sum() >= 20:
        return clean
    dsh = g["days_since_hull"]
    if dsh.notna().sum() >= 40:
        thr = dsh[steady].quantile(0.25)
        alt = steady & dsh.notna() & (dsh <= thr)
        if alt.sum() >= 20:
            return alt
    idx = g.index[steady].tolist()
    return g.index.isin(idx[: max(20, len(idx) // 3)]) & steady


def fit_ship_references(g: pd.DataFrame) -> dict:
    """Fit three curves on the clean reference period: foc (total), thrust (hull), power/thrust (prop)."""
    ref = g[reference_mask(g)]
    feats_foc = ["log_v3d23", "wind_head", "SEA_HEIGHT"]
    med = {c: float(ref[c].median()) if ref[c].notna().any() else 0.0
           for c in set(feats_foc + ["log_v3d23"])}

    y = np.log(ref["foc_eq24"].to_numpy(float))
    coef_foc = ols_fit(_design(ref, feats_foc, med), y)

    rt = ref[ref["THRUST"].notna() & (ref["THRUST"] > 0)]
    coef_thr = None
    if len(rt) >= 20:
        Xt = np.column_stack([np.log(rt["SPEED_THROUGH_WATER"]), np.log(rt["DISPLACEMENT"])])
        coef_thr = ols_fit(Xt, np.log(rt["THRUST"].to_numpy(float)))

    rp = ref[ref["THRUST"].notna() & (ref["THRUST"] > 0) & ref["ME_AVG_RPM"].notna()]
    coef_ppt = None
    if len(rp) >= 20:
        Xp = np.log(rp["ME_AVG_RPM"].to_numpy(float)).reshape(-1, 1)
        yp = np.log((rp["foc_eq24"] / rp["THRUST"]).to_numpy(float))
        coef_ppt = ols_fit(Xp, yp)

    return {"coef_foc": coef_foc, "feats_foc": feats_foc, "med": med,
            "coef_thr": coef_thr, "coef_ppt": coef_ppt, "n_ref": int(len(ref))}


def _hull_intervals(s: pd.DataFrame) -> np.ndarray:
    """Split into dry-docking intervals by days_since_hull resets (drops). ISO in-service is per interval."""
    dsh = s["days_since_hull"].to_numpy(float)
    interval = np.zeros(len(s), int)
    cur = 0
    for i in range(1, len(s)):
        prev, now = dsh[i - 1], dsh[i]
        if np.isnan(now):
            pass
        elif np.isnan(prev) or now < prev - 1:
            cur += 1
        interval[i] = cur
    return interval


def compute_ship(g: pd.DataFrame, R: dict) -> pd.DataFrame:
    """Per steady day: PV / speed_loss_pct + thrust attribution residuals.

    Per dry-docking interval, the clean window is anchored to SL~=0; fouling rises with days in the
    interval. A pure UWI resets no clock -> no new interval -> SL does not drop (no trap)."""
    s = g[g["steady"] & g["foc_eq24"].notna() & g["log_v3d23"].notna()
          & ~g["speed_suspect"]].sort_values("day").copy()
    resid = np.log(s["foc_eq24"].to_numpy(float)) - ols_pred(R["coef_foc"], _design(s, R["feats_foc"], R["med"]))
    s["_resid"] = resid
    s["interval"] = _hull_intervals(s)
    dsh = s["days_since_hull"]
    adj = np.zeros(len(s))
    global_ic = float(np.median(resid))
    for _, idx in s.groupby("interval").groups.items():
        blk = s.loc[idx]
        clean = blk[dsh.loc[idx].notna() & (dsh.loc[idx] <= CLEAN_WINDOW)]
        if len(clean) >= 5:
            ic = float(clean["_resid"].median())
        elif len(blk) >= 5:
            ic = float(blk["_resid"].iloc[:15].median())
        else:
            ic = global_ic
        adj[s.index.get_indexer(idx)] = ic
    # clip to a sane ISO band: rare per-day measurement blow-ups (exp amplifies to hundreds of %)
    resid_anchored = np.clip(resid - adj, np.log(1 - 0.30), np.log(1 + 0.60))
    s["pv"] = np.exp(resid_anchored) - 1.0
    s["performance_loss_pct"] = s["pv"] * 100
    s["speed_loss_pct"] = s["pv"] / 3.0 * 100            # P proportional to V^3 -> speed loss ~= PV/3

    s["hull_resid"] = np.nan
    s["prop_resid"] = np.nan
    ok = s["THRUST"].notna() & (s["THRUST"] > 0)
    if R["coef_thr"] is not None:
        Xt = np.column_stack([np.log(s.loc[ok, "SPEED_THROUGH_WATER"]), np.log(s.loc[ok, "DISPLACEMENT"])])
        s.loc[ok, "hull_resid"] = np.log(s.loc[ok, "THRUST"].to_numpy(float)) - ols_pred(R["coef_thr"], Xt)
    if R["coef_ppt"] is not None:
        okp = ok & s["ME_AVG_RPM"].notna()
        Xp = np.log(s.loc[okp, "ME_AVG_RPM"].to_numpy(float)).reshape(-1, 1)
        ppt = np.log((s.loc[okp, "foc_eq24"] / s.loc[okp, "THRUST"]).to_numpy(float))
        s.loc[okp, "prop_resid"] = ppt - ols_pred(R["coef_ppt"], Xp)

    s["roll_speed_loss_pct"] = s["speed_loss_pct"].rolling(ROLL, min_periods=5).mean()
    return s


def attribution(s: pd.DataFrame) -> dict:
    """Recent-window hull vs propeller attribution (thrust method), robust to outliers (median)."""
    recent = s.tail(ATTR_WINDOW)
    h = recent["hull_resid"].dropna()
    p = recent["prop_resid"].dropna()
    if len(h) < 10 or len(p) < 10:
        return {"hull_contribution_pct": None, "propeller_contribution_pct": None,
                "primary_cause": "INDETERMINATE", "window_days": int(min(len(h), len(p)))}
    H = max(float(h.median()), 0.0)
    P = max(float(p.median()), 0.0)
    tot = H + P
    if tot <= 1e-9:
        return {"hull_contribution_pct": None, "propeller_contribution_pct": None,
                "primary_cause": "CLEAN", "window_days": int(len(recent))}
    hull = round(H / tot * 100)
    prop = 100 - hull
    cause = "HULL_FOULING" if hull >= 60 else "PROPELLER_ROUGHNESS" if prop >= 60 else "COMBINED"
    return {"hull_contribution_pct": int(hull), "propeller_contribution_pct": int(prop),
            "primary_cause": cause, "window_days": int(len(recent))}


def recovery_for_events(s: pd.DataFrame, events: pd.DataFrame) -> list:
    """Maintenance-effect per event + the structural UWI evidence days_since_hull_at_event.

    days_since_hull_at_event is the strongest UWI-trap proof: a real hull cleaning is 0 (clock reset),
    a pure UWI is a large number (clock not reset). recovery (before/after window diff) is only a weak
    auxiliary here because the fouling->fuel signal in this data is small (low SNR)."""
    hull_days = sorted(events[events["event_type"].isin(HULL_RESET)]["event_day"].tolist())
    out = []
    for _, e in events.iterrows():
        d = int(e["event_day"])
        prior_hull = [h for h in hull_days if h <= d]
        dsh_at = (d - max(prior_hull)) if prior_hull else None
        before = s[(s.day < d) & (s.day >= d - EVENT_WINDOW)]["speed_loss_pct"]
        after = s[(s.day > d) & (s.day <= d + EVENT_WINDOW)]["speed_loss_pct"]
        b, a = before.median(), after.median()
        rec = (b - a) if len(before) >= 5 and len(after) >= 5 else None
        resets = sorted({part for part, types in (("hull", HULL_RESET), ("propeller", PROP_RESET))
                         if e["event_type"] in types})
        out.append({
            "event_day": d,
            "type": e["event_type"],
            "resets": resets,
            "is_inspection_only": len(resets) == 0,
            "days_since_hull_at_event": dsh_at,
            "recovery_pct": None if rec is None else round(float(rec), 3),
            "sl_before_pct": None if b != b else round(float(b), 3),
            "sl_after_pct": None if a != a else round(float(a), 3),
            "hull_fouling_type": e["hull_fouling_type"] if isinstance(e.get("hull_fouling_type"), str) else None,
            "propeller_condition": e["propeller_condition"] if isinstance(e.get("propeller_condition"), str) else None,
        })
    return out


def fouling_rate(s: pd.DataFrame) -> float | None:
    """Fouling accumulation rate: median over intervals of the SL~days_since_hull slope (%/100d).
    Uses the whole interval, far more noise-robust than the before/after window diff."""
    slopes = []
    for _, blk in s.groupby("interval"):
        b = blk[blk["days_since_hull"].notna()]
        if len(b) >= 30 and (b["days_since_hull"].max() - b["days_since_hull"].min()) > 60:
            k = np.polyfit(b["days_since_hull"].to_numpy(float), b["speed_loss_pct"].to_numpy(float), 1)[0]
            slopes.append(k * 100)
    return float(np.median(slopes)) if slopes else None


def drydock_reco(s: pd.DataFrame, fr: float | None) -> dict:
    """Dry-dock recommendation: current speed loss at critical, or fast fouling accumulation."""
    cur = s["roll_speed_loss_pct"].dropna()
    cur_sl = float(cur.iloc[-1]) if len(cur) else None
    recommend, reasons = False, []
    if cur_sl is not None and cur_sl >= CRIT_SL:
        recommend = True
        reasons.append(f"current speed loss {cur_sl:.1f}% >= {CRIT_SL}% critical")
    if fr is not None and fr >= 1.5:
        recommend = True
        reasons.append(f"fouling rate {fr:.1f}%/100d, cleaning-benefit cycle is short")
    rationale = "; ".join(reasons) if reasons else "below critical and slow fouling; keep the underwater-cleaning schedule"
    return {"recommend_drydock": recommend,
            "current_speed_loss_pct": None if cur_sl is None else round(cur_sl, 2),
            "fouling_rate_pct_per_100d": None if fr is None else round(fr, 2),
            "rationale": rationale}


def status_of(sl: float) -> str:
    if sl is None or sl != sl:
        return "unknown"
    return "critical" if sl >= CRIT_SL else "warning" if sl >= WARN_SL else "normal"


def trend_of(s: pd.DataFrame) -> str:
    r = s["roll_speed_loss_pct"].dropna()
    if len(r) < ROLL + 10:
        return "stable"
    slope = np.polyfit(np.arange(len(r.tail(60))), r.tail(60).to_numpy(), 1)[0]
    return "degrading" if slope > 0.02 else "improving" if slope < -0.02 else "stable"


def _clean(o):
    if isinstance(o, float) and (o != o):
        return None
    return o


def _ensure_weather(df: pd.DataFrame) -> pd.DataFrame:
    """The trimmed ETL doesn't emit wind vectors; derive the along-track wind component
    (16-point compass, 0 = from the bow) the same way clean.py does, if absent."""
    if "wind_head" not in df.columns and {"WIND_SPEED", "WIND_DIRECTION"}.issubset(df.columns):
        ang = pd.to_numeric(df["WIND_DIRECTION"], errors="coerce") * (2 * np.pi / 16)
        df["wind_head"] = pd.to_numeric(df["WIND_SPEED"], errors="coerce") * np.cos(ang)
    elif "wind_head" not in df.columns:
        df["wind_head"] = 0.0
    return df


def compute(df: pd.DataFrame, mt: pd.DataFrame) -> dict:
    """Build the full speed-loss payload from an ETL frame (with derived cols) + aligned maintenance."""
    df = df.copy()
    df["ship"] = df["ship"].astype(str)     # avoid categorical groupby edge cases
    df = _ensure_weather(df)
    fleet, ships = [], {}

    for ship, g in df.groupby("ship"):
        g = g.sort_values("day")
        R = fit_ship_references(g)
        s = compute_ship(g, R)
        if s.empty:
            continue
        ev = mt[mt.ship_id == ship].sort_values("event_day")
        events_out = recovery_for_events(s, ev)
        attr = attribution(s)
        fr = fouling_rate(s)
        reco = drydock_reco(s, fr)

        latest = s.iloc[-1]
        cur_sl = (float(s["roll_speed_loss_pct"].dropna().iloc[-1])
                  if s["roll_speed_loss_pct"].notna().any() else float(latest["speed_loss_pct"]))
        dsh = latest["days_since_hull"]
        prop_cond = ev[ev.event_type.isin(PROP_RESET)]["propeller_condition"].dropna()

        history = [{"day": int(r.day),
                    "speed_loss_pct": round(float(r.speed_loss_pct), 3),
                    "performance_loss_pct": round(float(r.performance_loss_pct), 3),
                    "roll_speed_loss_pct": _clean(round(float(r.roll_speed_loss_pct), 3)
                                                  if r.roll_speed_loss_pct == r.roll_speed_loss_pct else np.nan),
                    "days_since_hull": _clean(float(r.days_since_hull)
                                              if r.days_since_hull == r.days_since_hull else np.nan)}
                   for r in s.itertuples()]

        recovery_curve = [{"event_day": e["event_day"], "type": e["type"], "recovery_pct": e["recovery_pct"]}
                          for e in events_out if "hull" in e["resets"] and e["recovery_pct"] is not None]

        ships[ship] = {
            "reference": {"n_ref_days": R["n_ref"], "has_thrust_model": R["coef_thr"] is not None},
            "latest": {
                "day": int(latest["day"]),
                "speed_loss_pct": round(cur_sl, 2),
                "performance_loss_pct": round(cur_sl * 3, 2),
                "status": status_of(cur_sl),
                "days_since_cleaning": _clean(int(dsh) if dsh == dsh else None),
                "propeller_condition": prop_cond.iloc[-1] if len(prop_cond) else None,
                "attribution": attr,
                "fouling_rate_pct_per_100d": None if fr is None else round(fr, 2),
                "trend": trend_of(s),
            },
            "history": history,
            "events": events_out,
            "recovery_curve": recovery_curve,
            "drydock_recommendation": reco,
        }

        fleet.append({
            "ship_id": ship,
            "ship_type": str(g["ship_type"].iloc[0]),
            "latest_speed_loss_pct": round(cur_sl, 2),
            "status": status_of(cur_sl),
            "days_since_cleaning": _clean(int(dsh) if dsh == dsh else None),
            "primary_cause": attr["primary_cause"],
            "hull_contribution_pct": attr["hull_contribution_pct"],
            "propeller_contribution_pct": attr["propeller_contribution_pct"],
            "trend": trend_of(s),
            "recommend_drydock": reco["recommend_drydock"],
        })

    return {
        "generated_at": pd.Timestamp.utcnow().isoformat(),
        "standard": "ISO 19030 (in-service, data-driven per-ship reference)",
        "method": {
            "power_proxy": "foc_eq24 (VLSFO-equivalent fuel /24h) as brake-power proxy (ISO 19030-2 4.2 / Annex C/D)",
            "normalization": "Admiralty log_v3d23 = log(STW^3 * displacement^(2/3)) + wind/sea",
            "reference": f"per-ship clean window: steady days within {CLEAN_WINDOW}d after a hull-reset event",
            "speed_loss_pct": "power increase PV / 3 (P proportional to V^3)",
            "attribution": "thrust-based: hull = thrust-at-speed drift, propeller = power-per-thrust drift",
            "limitations": "see docs/speed-loss-limitations.md",
        },
        "thresholds_speed_loss_pct": {"warning": WARN_SL, "critical": CRIT_SL},
        "fleet_summary": fleet,
        "ships": ships,
    }


def main() -> None:
    sys.path.insert(0, str(ROOT))
    from lambdas.etl import handler                       # noqa: E402
    from ml.training import model                         # noqa: E402
    voyage = pd.read_csv(RAW / "vt_fd.csv", dtype=str)
    maint_raw = pd.read_csv(RAW / "maintenance.csv", dtype=str)
    df = model.add_derived(handler.run_etl(voyage, maint_raw))
    mt = handler.align_event_day(maint_raw)              # normalize event_day (handles event_day or event_date)
    payload = compute(df, mt)
    EXAMPLES.mkdir(parents=True, exist_ok=True)
    (EXAMPLES / "speed_loss.json").write_text(json.dumps(payload, ensure_ascii=False))
    n = len(payload["fleet_summary"])
    rec = sum(r["recommend_drydock"] for r in payload["fleet_summary"])
    print(f"wrote {EXAMPLES/'speed_loss.json'}  ships={n}  drydock_recommended={rec}")


if __name__ == "__main__":
    main()
