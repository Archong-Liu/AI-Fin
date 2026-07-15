"""繳交檔硬檢查(分水嶺保險)。格式錯一格 = 該項分數直接崩且賽後無法補救,故獨立把關。

檢查:
  1. 恰好 102 資料列(不含表頭)
  2. 欄位名精確 = ship_id, day, fuel_type, predicted_value(順序也檢查)
  3. 無任何缺漏值 / 空白
  4. ship_id 僅限預測船 {S21, S22, S23}
  5. day 為整數
  6. fuel_type 為合法燃料欄名 ME_FULLSPEED_CONSUMP_{HSHFO|ULSFO|VLSFO|LSMGO|BIO_HSFO}
  7. predicted_value 為有限正數且落在合理油耗範圍(0 < v < 500 MT/day)—— 純數值、無單位字串
  8. (ship_id, day, fuel_type) 不得重複
  9. 全檔掃描:不得出現 $ / cost / USD / price / dollar / 成本 / 油價 等金額字樣
     (命題要求輸出油耗量,不得混入成本/金額)

綠燈 → exit 0;任一紅燈 → 印出所有問題並 exit 1。

用法:
    python ml/validate_submission.py                       # 預設 ml/examples/submission.csv
    python ml/validate_submission.py path/to/submission.csv
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pandas as pd

DEFAULT = Path(__file__).resolve().parent / "examples" / "submission.csv"

EXPECTED_COLS = ["ship_id", "day", "fuel_type", "predicted_value"]
EXPECTED_ROWS = 102
PREDICT_SHIPS = {"S21", "S22", "S23"}
FUELS = {"HSHFO", "ULSFO", "VLSFO", "LSMGO", "BIO_HSFO"}
FUEL_RE = re.compile(r"^ME_FULLSPEED_CONSUMP_(" + "|".join(FUELS) + r")$")
VAL_MIN, VAL_MAX = 0.0, 500.0        # MT/day 合理範圍(嚴格 > VAL_MIN)

# 禁字:金額 / 成本 / 幣別(全檔 raw text 掃描,case-insensitive)
FORBIDDEN = ["$", "usd", "cost", "price", "dollar", "€", "£", "¥",
             "成本", "金額", "油價", "價格", "費用"]


def validate(path: Path) -> list[str]:
    errs: list[str] = []
    if not path.exists():
        return [f"檔案不存在: {path}"]

    raw = path.read_text(encoding="utf-8", errors="replace")

    # 9. 禁字掃描(對原始文字,最保險)
    low = raw.lower()
    for tok in FORBIDDEN:
        if tok.lower() in low:
            errs.append(f"[禁字] 檔案出現金額/成本字樣 '{tok}' — 繳交檔只能有油耗量,不得含成本")

    try:
        df = pd.read_csv(path, dtype=str)     # 先以字串讀,自行驗型別,避免 pandas 靜默轉換
    except Exception as e:
        return errs + [f"CSV 無法解析: {e}"]

    # 2. 欄位名 + 順序
    if list(df.columns) != EXPECTED_COLS:
        errs.append(f"[欄位] 欄位名/順序錯誤: 得到 {list(df.columns)},應為 {EXPECTED_COLS}")
        return errs      # 欄位不對,後續逐欄檢查無意義

    # 1. 列數
    if len(df) != EXPECTED_ROWS:
        errs.append(f"[列數] 應為 {EXPECTED_ROWS} 列,實際 {len(df)} 列")

    # 3. 缺漏 / 空白
    for c in EXPECTED_COLS:
        blank = df[c].isna() | (df[c].astype(str).str.strip() == "")
        if blank.any():
            errs.append(f"[缺漏] 欄位 '{c}' 有 {int(blank.sum())} 個空值")

    # 4. ship_id
    bad_ship = set(df["ship_id"].dropna().unique()) - PREDICT_SHIPS
    if bad_ship:
        errs.append(f"[ship_id] 出現非預測船: {sorted(bad_ship)}(應僅 {sorted(PREDICT_SHIPS)})")

    # 5. day 為整數
    day_num = pd.to_numeric(df["day"], errors="coerce")
    non_int = day_num.isna() | (day_num % 1 != 0)
    if non_int.any():
        errs.append(f"[day] 有 {int(non_int.sum())} 列非整數")

    # 6. fuel_type 格式
    bad_fuel = ~df["fuel_type"].astype(str).str.match(FUEL_RE)
    if bad_fuel.any():
        sample = df.loc[bad_fuel, "fuel_type"].head(3).tolist()
        errs.append(f"[fuel_type] 有 {int(bad_fuel.sum())} 列格式錯誤,例如 {sample}")

    # 7. predicted_value 純數值 + 範圍
    val = pd.to_numeric(df["predicted_value"], errors="coerce")
    nan_val = val.isna()
    if nan_val.any():
        sample = df.loc[nan_val, "predicted_value"].head(3).tolist()
        errs.append(f"[predicted_value] 有 {int(nan_val.sum())} 列非純數值(疑含單位字串),例如 {sample}")
    ok = ~nan_val
    oob = ok & ((val <= VAL_MIN) | (val >= VAL_MAX))
    if oob.any():
        errs.append(f"[predicted_value] 有 {int(oob.sum())} 列超出合理範圍 ({VAL_MIN}, {VAL_MAX}) MT/day")

    # 8. 重複
    dup = df.duplicated(subset=["ship_id", "day", "fuel_type"])
    if dup.any():
        errs.append(f"[重複] 有 {int(dup.sum())} 列 (ship_id, day, fuel_type) 重複")

    return errs


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT
    errs = validate(path)
    print(f"檢查繳交檔: {path}")
    if errs:
        print(f"\n🔴 紅燈 — {len(errs)} 個問題:")
        for e in errs:
            print(f"  - {e}")
        return 1
    df = pd.read_csv(path)
    per = df.groupby("ship_id").size().to_dict()
    print("\n🟢 綠燈 — 全部通過")
    print(f"  102 列、欄位/單位正確、無金額字樣;各船預測數 = {per}")
    print(f"  predicted_value 範圍 = {df.predicted_value.min():.2f} – {df.predicted_value.max():.2f} MT/day")
    return 0


if __name__ == "__main__":
    sys.exit(main())
