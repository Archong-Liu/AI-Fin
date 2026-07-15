# ML — 油耗預測 Pipeline

船殼汙損 / 螺旋槳粗糙度對主機全速油耗的影響建模。本文件說明**資料清理、模型架構、模型輸出**三部分,內容對齊 `lambdas/etl/handler.py` 與 `ml/training/`。

```
data/raw/
├── vt_fd.csv                 原始航行日報(21,282 筆)
└── maintenance.csv           養護事件(77 筆,event_day 為 NOON_UTC 同軸整數 index)
lambdas/etl/handler.py        ETL:清理 + 特徵工程(S3 觸發;run_etl 為可本地跑的純轉換)
ml/
├── build_model.py            ★ 一鍵重現:ETL → 訓練 → 存 model.joblib + submission.csv
├── speed_loss.py             ISO 19030 Speed Loss + 船殼/螺旋槳歸因(前端 Dashboard 用)
├── shap_analysis.py          SHAP 可解釋性:各特徵對油耗的貢獻(簡報歸因用)
├── validate_submission.py    繳交檔硬檢查(102 列/欄位/單位/無金額字樣)
├── training/
│   ├── config.py             特徵清單、標的、燃料熱值、船群、隨機種子(單一真實來源)
│   ├── model.py              load_processed / add_derived / train / predict_submission / HybridModel
│   ├── validation.py         mape / event_holdout_cv / leave_one_ship_out_cv
│   └── __init__.py
├── artifacts/                build_model.py 產物
│   ├── model.joblib          訓練好的 HybridModel(部署 / 推論載入)
│   └── requirements.txt      訓練環境精確版本(pickle 相容性)
└── examples/
    ├── submission.csv        102 個預測(build_model.py 產生,repo 的 source of truth)
    ├── fleet_data.json       前端用完整資料(全船隊逐日 + 養護 + 預測 + 驗證)
    ├── speed_loss.json       ISO 19030 Speed Loss(speed_loss.py 產生,Dashboard 三張圖資料)
    ├── shap_summary.json     SHAP 特徵貢獻 + 分組(shap_analysis.py 產生)
    └── shap_*.png            SHAP 圖(特徵重要性 / 分組貢獻)
requirements.txt              跑 pipeline 的相依套件
docs/ml-eda-and-decisions.md      EDA、清理/建模/部署決策與理由
docs/speed-loss-limitations.md    Speed Loss 已知限制與誠實聲明
```

## Quickstart(clone 下來直接跑)

原始資料已放在 `data/raw/`,所以 clone 完就能一鍵重現整條 pipeline:

```bash
pip install -r requirements.txt
python ml/build_model.py
```

會依序做:ETL 清理(→ `data/processed/clean_daily.csv`)、訓練 hybrid、存 `ml/artifacts/model.joblib` + `requirements.txt`、產生 `ml/examples/submission.csv`(102 個預測),最後做序列化 round-trip 檢查(重載模型須與記憶體模型完全一致)。

若只想拆開來用:

```python
import pandas as pd
from lambdas.etl import handler
from ml.training import model, validation

# 1) ETL:原始 CSV(字串,保留 HIDDEN/PREDICT 標記)→ 每船每日一列
voyage = pd.read_csv("data/raw/vt_fd.csv", dtype=str)
maint  = pd.read_csv("data/raw/maintenance.csv", dtype=str)
clean  = model.add_derived(handler.run_etl(voyage, maint))   # 20,938 列,102 PREDICT

# 2) 訓練 + 預測
mdl = model.train(clean)                          # 物理殘差 hybrid
sub = model.predict_submission(mdl, clean)        # 102 列: ship_id/day/fuel_type/predicted_value

# 3) 驗證(maintenance 對齊到 NOON_UTC day-index)
cv = validation.event_holdout_cv(clean, handler.align_event_day(maint))
print(validation.mape(cv.truth, cv.pred))         # ~4.2%
```

雲端路徑:S3 上傳原始 CSV → 觸發 ETL Lambda(`lambda_handler`)→ 寫 processed Parquet → 推論端 `model.load_processed(s3_uri)` + 載入 `model.joblib`。部署選型見 `docs/ml-eda-and-decisions.md`(採 Lambda container image)。

---

## 1. 資料清理(`lambdas/etl/handler.py`,`run_etl`)

輸入 `vt_fd.csv` + `maintenance.csv`,輸出每船每日一列。順序很重要:**標記先擷取 → 離群清理 → 補值 → 物理特徵 → 養護 join**。

| 步驟 | 函式 | 內容 |
|------|------|------|
| 去重 + 解析標記 | `dedupe_and_parse` | 移除完全重複與同船同日近似重複(帶 `PREDICT` 的列優先);**在數值轉換前**先記錄 `predict_fuel`(每個 PREDICT 儲存格對應的燃料)與 `is_hidden`,否則 102 個預測目標會被 coerce 成 NaN |
| 燃料當量 | `add_fuel_target` | 5 種燃料依熱值折算成 VLSFO(40.2)當量 `foc_eq`,再 /全速時數 ×24 得每 24h 標的 `foc_eq24` |
| 離群處理 | `clean_outliers` | 滑差壞值(\|·\|>50)、航速/吃水/排水量/RPM sanity 範圍外設 NaN;全速卻油耗 ≤0 視為缺漏;全速時數 < 4h 標的不可靠設 NaN。**不刪列,只把儲存格設 NaN** |
| 海溫補值 | `impute_sea_temp` | 缺值 ~31%:同船沿 day-index 內插,餘用該船中位數 |
| 排水量補值 | `impute_displacement` | 缺值 ~31%:排水量 = 載貨 + 同船 `median(DISPLACEMENT − CARGO_ON_BOARD)` offset 回推。讓物理特徵 `v3d23` 在缺排水量的列(含 PREDICT 列)仍可算 |
| 航速一致性 | `flag_speed_inconsistency` | STW/SOG 速差 >3 節且與日報洋流欄不吻合 → `speed_suspect`(不進訓練) |
| 衍生特徵 | `add_features` | `trim`、物理基線 `v3d23 = STW³ · DISPLACEMENT^(2/3)`、船型 `ship_type`(W1/W2)、穩態日 `steady`(全速 ≥22h 且風力 ≤4 級) |
| 養護 join | `join_maintenance` | 先 `align_event_day`(直接用 maintenance 的整數 `event_day`,與 NOON_UTC 同軸;若只有日曆 `event_date` 才用 epoch 換算當 fallback),再算距上次船殼清洗/螺旋槳拋光/進塢天數、上次事件類型/螺旋槳狀態、硬質汙損旗標、`fouling_severity_score`。只用 `event_day ≤ 當日` 的事件(無未來洩漏) |

**燃料熱值 (MJ/kg,折 VLSFO 當量):** HSHFO 40.2 / ULSFO 41.2 / VLSFO 40.2 / LSMGO 42.7 / BIO_HSFO 39.4

**過濾閾值的關鍵決策:** `WIND_SCALE ≤ 4` 與 `HOURS_FULL_SPEED ≥ 22` **不是硬過濾**,而是 `steady` 旗標——用作訓練樣本權重與 Speed Loss baseline 選擇。硬過濾會丟掉 ~60% 可用訓練列,也可能丟掉必須服務的列。

清理結果:20,938 列 / 15 艘船,102 個 PREDICT(S21:43、S22:24、S23:35)。

---

## 2. 模型架構(`ml/training/model.py`)

**物理殘差 hybrid(physics-residual)** — 物理律當顯式骨幹,ML 只學殘差。

```
log(foc_eq24) = [ a + b · log_v3d23 ]  +  GBT_residual(features)
                 └─ Admiralty 物理主幹 ─┘   └─ 學汙損/天候/RPM 等殘差 ─┘
```

**物理主幹:** Admiralty 定律 `功率 ∝ Δ^(2/3) · V³`。在 log 空間用 `np.polyfit` 擬合 `log(foc) ≈ a + b·log_v3d23`,`b` 為海試綜合次方(理論 ≈1,由資料估)。物理律因此是結構性先驗,而非只是一個特徵。

**殘差 ML:** `HistGradientBoostingRegressor`(`loss=absolute_error`, `max_iter=600`, `lr=0.05`, `max_leaf_nodes=63`, `min_samples_leaf=40`, `l2=1.0`)只學「對物理基線的殘差」——來源即船體/螺旋槳汙損、天候與 RPM。原生支援缺值與類別特徵;`absolute_error` 在 log 標的上 ≈ 最小化相對誤差(對齊 MAPE)。

**特徵(`config.py`,單一真實來源)**
- 數值:`log_v3d23`(物理核心)、STW、RPM、螺旋槳轉速、排水量、吃水、trim、載貨、風/浪/湧、海溫、水深、洋流代理 `DIFF_STW_SOG_SLIP`、滑差 `FULL_SPD_STW_SLIP`(汙損訊號)、養護時鐘 `days_since_*`、`last_event_had_hard_fouling`、全速時數。
- 類別:`ship`、`ship_type`、`last_event_type`、`last_event_prop_cond`。
- 全部特徵在遮蔽的 PREDICT 列皆可取得(只有 HORSE_POWER / SFOC / THRUST 等被隱藏,均未使用)。
- `fouling_severity_score` 由 ETL 算出並保留在輸出供 dashboard 用,但**刻意不當模型特徵**(對精度無幫助,見決策文件;排除它可讓 pipeline 精確重現 submission)。

**訓練樣本篩選(`train_mask`):** `foc_eq24` 有效且 >3、`log_v3d23` 非空、全速時數 ≥6h、非 `speed_suspect`。穩態日權重 1.0、非穩態 0.3(每個 PREDICT 日都是穩態)。

**設計取捨(已實測)**
- hybrid vs「log_v3d23 只當特徵」:MAPE 幾乎相同(4.16 vs 4.17),但物理骨幹外插更穩、可解釋 → **採用**。
- 單調約束(fuel↑ vs 速度/RPM/排水量):反而略降精度(4.31)→ **不採用**。
- 主幹單變量斜率 `b≈0.605`(< 理想立方律 1.0):誠實反映此資料中 RPM 才是主要驅動,殘差 GBT 承接。

驗證(見 `docs/ml-eda-and-decisions.md`):

| 方法 | 說明 | 結果 |
|------|------|------|
| 事件後窗口 holdout(主指標) | 藏訓練船養護後 35 天穩態日,與 S21–S23 遮蔽窗口同構,事件分 5-fold | **MAPE ~4.2%**,RMSE ~3.5 MT/day |
| Leave-one-ship-out | 完全排除被測船的跨船穩健度下界 | **MAPE ~5.3%** |
| 物理基線對照 | 只用物理特徵 + 船型 | MAPE ~7.4% |

---

## 3. 模型輸出

### `submission.csv`(範例見 `ml/examples/`)— 提交檔,僅 102 個預測

```csv
ship_id,day,fuel_type,predicted_value
S21,136,ME_FULLSPEED_CONSUMP_VLSFO,29.18
...
```

| 欄位 | 說明 |
|------|------|
| `ship_id` | 預測船(S21–S23) |
| `day` | NOON_UTC 相對天數 |
| `fuel_type` | 該 PREDICT 儲存格對應的燃料欄位 |
| `predicted_value` | 預測全速油耗(MT/day)。已從 VLSFO 當量換回該燃料實際質量,並乘回當日實際全速時數 |

由 `python ml/build_model.py` 產生(內部呼叫 `model.predict_submission`),與 `ml/artifacts/model.joblib` 一致。

### `model.joblib`(`ml/artifacts/`)— 部署用序列化模型

`build_model.py` 用 `joblib` 把訓練好的 `ml.training.model.HybridModel` 存下來,供推論 Lambda 載入。**pickle 對版本敏感**,推論映像的相依套件須與 `ml/artifacts/requirements.txt` 完全一致,且映像內要有 `ml/training/` 這份程式碼才能反序列化。issue #4 的部署方案是把它上傳到 `s3://yminsight-processed-data/models/`。

### `fleet_data.json`(範例見 `ml/examples/`)— 前端用完整資料

> **格式:** 這是**壓縮成單行的 minified JSON**(無縮排,~32 MB),刻意如此以最小化傳輸體積。它「看起來是一整行」是正常的,不是資料損壞。內容為完整清理後的全船隊逐日資料,供前端繪製 Speed Loss 時序、養護時間軸、汙損歸因等。

**頂層結構**

```jsonc
{
  "generated_at": "2026-07-14T07:50:24Z",
  "model": "physics-residual hybrid: Admiralty backbone + HistGradientBoosting",
  "target": "ME_FULLSPEED_CONSUMP_[fuel] ...",
  "n_ships": 15, "n_rows": 20938, "n_predictions": 102,
  "fuel_distribution": { "HSHFO": 91, "VLSFO": 11 },
  "validation": { "event_holdout_mape_pct": 4.16,
                  "leave_one_ship_out_mape_pct": 5.33,
                  "rmse_mt_per_day": 3.5 },
  "daily_columns": [ /* 67 個欄位名,前端可當表頭 */ ],
  "ships": [ /* 15 艘船 */ ]
}
```

**每艘船物件:** `ship_id, ship_type(W1/W2), n_days, n_predictions, maintenance[], daily[]`

**`maintenance[]`:** `ship_id, event_type, event_day, propeller_condition, hull_fouling_type, hull_coating_condition, cavitation_found, draft_fwd_m, draft_aft_m`(UWI 僅檢查事件多為 null)

**`daily[]`(67 欄,依語意分組)**

| 分組 | 欄位 |
|------|------|
| 識別 | `ship`, `VOYAGE`, `day`, `ship_type` |
| 航速/轉速 | `AVG_SPEED`(SOG), `SPEED_THROUGH_WATER`(STW), `ME_AVG_RPM`, `PROPELLER_SPEED` |
| 吃水/載重 | `FORE_DRAFT`, `AFTER_DRAFT`, `MID_DRAFT`, `trim`, `DISPLACEMENT`, `CARGO_ON_BOARD` |
| 環境 | `WIND_SCALE`, `WIND_SPEED`, `WIND_DIRECTION`, `SEA_HEIGHT`, `SEA_DIRECTION`, `SWELL_HEIGHT`, `SWELL_DIRECTION`, `SEA_WATER_TEMP`, `WATER_DEPTH` |
| 天候向量(衍生) | `wind_head`, `wind_beam`, `sea_head`, `sea_beam`, `swell_head`, `swell_beam` |
| 距離/滑差 | `TOTAL_DISTANCE`, `SEA_SPEED_DISTANCE`, `DIFF_STW_SOG_SLIP`, `FULL_SPD_STW_SLIP`, `stw_sog_gap` |
| 主機性能(遮蔽日為 null) | `HORSE_POWER`, `LOAD_PCT`, `SFOC`, `ME_SLIP`, `THRUST`, `THRUST_QUOTIENT` |
| 油耗 | `TOTAL_CONSUMP`, `ME_CONSUMPTION`, `ME_FULLSPEED_CONSUMP_{HSHFO,ULSFO,VLSFO,LSMGO,BIO_HSFO}`, `main_fuel` |
| 時數 | `HOURS_FULL_SPEED`, `HOURS_TOTAL` |
| 建模標的/中間量 | `foc_eq`, `foc_eq24`, `n_fuels`, `v3d23` |
| 旗標 | `predict_fuel`, `is_hidden`, `swt_imputed`, `disp_imputed`, `speed_suspect`, `steady` |
| 養護時鐘 | `days_since_hull`, `days_since_prop`, `days_since_dd`, `last_event_type`, `last_event_prop_cond`, `last_event_had_hard_fouling` |
| **預測值** | `predicted_mt` |

**前端須知**
- `predicted_mt`:僅在 PREDICT 的日子有值,其餘日子為 `null`,可與 `day` 對齊疊在同一時間軸。
- `is_hidden == true`(S21–S23 遮蔽窗口):主機性能與非預測燃料的油耗欄為 `null`,`foc_eq24` 也是 `null`。
- 缺失值一律為 `null`;`swt_imputed` / `disp_imputed == true` 表示該列海溫 / 排水量為補值。
- Speed Loss:用 `SPEED_THROUGH_WATER` 搭配 `steady` 旗標篩穩態日,對照 `days_since_*` 與 `maintenance[]` 做汙損歸因。

---

## 4. Speed Loss(ISO 19030,`ml/speed_loss.py`)

前端 Dashboard 的資料來源。用 ISO 19030 in-service 方法量測船殼/螺旋槳效能隨時間的退化,產出 `ml/examples/speed_loss.json`。

```bash
python ml/speed_loss.py        # ETL → 每船 speed loss → ml/examples/speed_loss.json
```

**方法(對齊 ISO 19030-1/-2)**
- **功率代理**:無扭矩計,依 ISO 19030-2 §4.2 走 brake-power 路徑,以 `foc_eq24` 當交付功率代理。
- **正規化**:Admiralty 項 `log_v3d23 = log(STW³·排水量^(2/3))` + 風/浪。
- **同船對自己 + per 乾塢間隔**:每個乾塢間隔以「清洗後 45 天乾淨窗口」錨定為 SL≈0,汙損隨間隔內天數上升。
- **speed_loss_pct** = 功率增幅 ÷ 3(P ∝ V³)。
- **船殼 vs 螺旋槳歸因**(ISO §4.3 需 thrust):hull = 定速下所需推力上升;propeller = 單位推力所需功率上升。

**輸出 `speed_loss.json` 結構**
- `fleet_summary[]`:每船最新 speed loss、狀態(normal/warning/critical)、歸因、趨勢、進塢建議。
- `ships[<id>]`:
  - `history[]` — 逐穩態日 `speed_loss_pct` + 平滑曲線 + `days_since_hull`(**圖 a:時序**)
  - `events[]` — 養護事件,含 `days_since_hull_at_event`(**UWI 陷阱結構性證據**:清洗=0、純 UWI≫0)
  - `latest.attribution` — 船殼 vs 螺旋槳 %(**圖 b:歸因**)
  - `fouling_rate_pct_per_100d` + `drydock_recommendation`(**圖 c:汙損累積率 → 進塢建議**)

**🎯 UWI 陷阱**:純 UWI(僅檢查)不重置任何維護時鐘 → 不開新乾塢間隔 → speed loss 曲線在 UWI 後**不會**虛假下降。`days_since_hull_at_event` 提供不可辯駁的結構性證據(hull 清洗當天=0,純 UWI 當天中位數約 668 天)。

> ⚠️ **重要**:這批資料的汙損訊號本質偏弱,speed loss 的**趨勢/排序/UWI 判斷可信**,但**單日絕對值、弱訊號船的 recovery 需保守解讀**。完整說明見 [`docs/speed-loss-limitations.md`](../docs/speed-loss-limitations.md)。

---

## 5. SHAP 可解釋性(`ml/shap_analysis.py`)

拆出各特徵對油耗的貢獻,給簡報做歸因。因 SHAP 不支援 HistGradientBoosting 的原生類別特徵,分析時把 4 個類別特徵轉整數 codes、以相同超參 fit 一個**等價樹模型**解釋殘差(與部署 GBT 預測相關 **0.95**,高保真),再加回物理主幹 `log_v3d23` 的線性 SHAP,得到完整 hybrid 的分解。

```bash
python ml/shap_analysis.py     # → ml/examples/shap_summary.json + 2 張 PNG
```

**結果(mean|SHAP|,log 油耗空間)**

| 分組 | 佔比 |
|---|---|
| operation_physics(RPM、`log_v3d23` 物理項、速度、排水量…) | **85.4%** |
| current_slip(洋流代理、滑差) | 6.9% |
| environment(風/浪/海溫/水深) | 3.7% |
| vessel_id(ship / ship_type / 上次事件型) | 2.0% |
| **hull_fouling(`days_since_hull/dd`、硬質汙損)** | **1.5%** |
| **propeller_fouling(`days_since_prop`、螺旋槳狀態)** | **0.5%** |

**關鍵解讀(誠實,且是簡報彈藥)**:油耗預測由 **RPM + 物理項主導(85%)**,符合船舶工程直覺,這也是模型準(MAPE 4.2%)的原因。**汙損類特徵對油耗的 SHAP 貢獻僅 2%** —— 所以「做清洗能省多少油」不能靠這個油耗模型回答,必須用 `speed_loss.py` 的 **ISO 19030 thrust 法**做船殼/螺旋槳歸因。SHAP 與 Speed Loss 兩者互補:前者證明模型物理合理,後者做汙損量化歸因。詳見 [`docs/speed-loss-limitations.md`](../docs/speed-loss-limitations.md)。
