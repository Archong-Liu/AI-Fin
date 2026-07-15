# ML EDA 與決策紀錄（回應 Issue #1）

本文件回應 Issue #1 的三大決策項與四項期望產出。所有數字均由 `lambdas/etl/handler.py`
(重寫後) 與 `ml/training/` 對 `data/raw/` 實跑驗證得出，非估計值。

**產出對照**

| 期望產出 | 位置 |
|---|---|
| EDA 報告 | 本文件 §0 |
| 確認後的 ETL 邏輯 | `lambdas/etl/handler.py`（已重寫，見 §1） |
| ML 模組介面設計 | `ml/training/{config,model,validation}.py` |
| 部署方案決定 | §3 |

---

## 0. EDA 重點（驗證後數字）

| 項目 | 數值 | 備註 |
|---|---|---|
| 原始航行列數 | 21,282 | 15 艘船 |
| 去重後 | **20,938**（每船每日一列） | 移除 344 列完全/近似重複 |
| PREDICT 儲存格 | **102**（S21:43、S22:24、S23:35） | 推論標的 |
| PREDICT 燃料分布 | HSHFO 91、VLSFO 11 | 只需預測這兩種 |
| HORSE_POWER=HIDDEN 列 | 372 | 遮蔽窗口 |
| 有效訓練標的 `foc_eq24` | 19,412 | 見 §1 |
| 其中穩態日 | ~8,200 | 全速≥22h 且風≤4 |
| 缺失率 | SEA_WATER_TEMP 30.9%、DISPLACEMENT 31% | 皆可補值,見 §1 |

**關鍵發現(影響架構)**

1. **遮蔽的是 `HORSE_POWER` / `SFOC` / `THRUST` 等主機性能欄,但 `ME_AVG_RPM`、
   `PROPELLER_SPEED`、`SPEED_THROUGH_WATER` 在 102 個 PREDICT 列全部可見**。因此
   RPM/航速可安全作為特徵(推論時拿得到),不構成洩漏。
2. **油耗幾乎由引擎轉速決定**:特徵重要性 `ME_AVG_RPM`(0.86)壓倒性領先,養護/汙損/
   天候特徵 permutation importance ≈ 0。物理上 fuel ≈ SFOC × k·RPM³。
3. **NOON_UTC 是每船的「天索引」(0~1825,約 5 年,跨航程連續遞增),不是航程內序列**;
   而 `maintenance.csv` 的 `event_date` 是日曆日期。兩者需對齊(見 §1 養護時鐘)。

---

## 1. ETL 過濾與特徵工程(決策)

> 重寫後的 `handler.py` 已把 `run_etl(voyage_df, maintenance_df)` 拆成純轉換函式
> (boto3 延遲載入),可本地單元測試。以下逐項回應 Issue 清單。

### 1.1 過濾閾值 `WIND_SCALE ≤ 4`, `HOURS_FULL_SPEED ≥ 22`

**改為「旗標」而非「硬過濾」。** 原 handler 直接 `df[mask]` 丟掉不符列,會有兩個嚴重問題:

- 丟掉約 60% 仍可用於訓練的資料(硬過濾後只剩 ~8,200 列,而有效標的有 19,412 列);
- 風險丟掉「必須推論」的列。

決策:保留全部列,產出 `steady = (HOURS_FULL_SPEED≥22) & (WIND_SCALE≤4)` 旗標,
用途為 (a) 訓練樣本加權(穩態 1.0 / 非穩態 0.3,因為 PREDICT 日全是穩態),
(b) Speed Loss baseline 的取樣條件。**過濾閾值本身合適,但用法應是加權/取樣,不是刪列。**

### 1.2 缺失值:補值 vs drop

| 欄位 | 缺失 | 決策 | 方法 |
|---|---|---|---|
| SEA_WATER_TEMP | 30.9% | **補值** | 同船沿天索引內插(海溫連續變化),餘用該船中位數 → 補後 0 缺 |
| DISPLACEMENT | 31% | **補值** | `載貨量 + 同船 median(排水量−載貨量)` offset → 補後 0 缺 |
| SFOC / LOAD_PCT / HORSE_POWER / THRUST | 遮蔽 | **不用作特徵** | 這些在 PREDICT 窗口被遮蔽,推論時拿不到,列為特徵會失效 |
| 養護時鐘(該船無前置事件) | — | **不補** | 留 NaN,HistGradientBoosting 原生支援缺值 |

排水量補值的實質收益:讓物理特徵 `v3d23/log_v3d23` 在缺排水量的列(含 6 個 PREDICT 列)
仍可計算,PREDICT 列的 `v3d23` 缺值由 7 降為 1。

### 1.3 重複列

**去重**,且採「PREDICT 優先」:先移除完全重複,再對 (船, 日) 近似重複只留一列;
同 (船,日) 若同時存在「全 HIDDEN」與「帶 PREDICT」兩列時,保留帶 PREDICT 的(否則會漏預測格)。
21,282 → 20,938,102 個 PREDICT 格完整保留。

### 1.4 額外 outlier detection

新增物理範圍檢查(超出 → NaN,不刪列):

- 滑差 `FULL_SPD_STW_SLIP` / `DIFF_STW_SOG_SLIP` / `ME_SLIP`:|值| > 50%(S10 有 ±數千壞值)
- `SPEED_THROUGH_WATER` / `AVG_SPEED`:(1, 30] 節
- `FORE_DRAFT` / `AFTER_DRAFT`:(2, 25] m;`DISPLACEMENT`:(1000, 400000] MT;`ME_AVG_RPM`:(10, 150]
- `foc_eq ≤ 0` 但整天全速 → 視為缺漏
- 另新增 STW/SOG 交叉檢查 `speed_suspect`(速差>3節且與洋流欄不吻合),訓練時排除(PREDICT 日 0 命中)

> AVG_SPEED 確有異常(原始 max 97.8 節)、WIND_SPEED 有 157 節等,已被上表範圍規則處理。

### 1.5 `days_since_last_cleaning` 計算(重要修正)

**原實作有 bug**:`pd.Timestamp.now() - event_date`。問題有二:
(1) `maintenance.csv` 欄位是 `event_date`,原碼卻讀不存在的欄,且 (2) 用「距今天數」會讓每船
變成一個常數、且與 NOON_UTC 天索引不同基準,養護時鐘完全失效。

**修正**:NOON_UTC=0 對應船隊曆法起點 **≈ 2021-01-01**(由 event_date 對齊天索引反推,
67/77 事件落在 2021-01-01±3 天)。故
`event_day = (event_date − 2021-01-01).days`,再 `days_since = NOON_UTC − event_day`,
**兩側同基準**。並依部位分三個時鐘(只回溯「該日之前」的事件,無未來洩漏):

- `days_since_dd`(重置:DD)、`days_since_hull`(DD/UWC/UWC+PP)、`days_since_prop`(DD/PP/UWI+PP/UWC+PP)

驗證:全部 ≥ 0,且每船逐日變動(S1 的 hull 時鐘有 701 個相異值,不再是常數)。

### 1.6 `fouling_severity_score` 權重

保留 Issue 提議的 slime=1…tubeworm=5 加權(逗號解析後加總),但**取「該日之前最近一次
實體事件」的汙損記錄**,不是原碼的「全期最新一次」(後者會把未來汙損洩漏到過去列)。
另加二元 `last_event_had_hard_fouling`(barnacle/calcium/tubeworm)。

**誠實提醒**:經 ablation,養護/汙損類特徵對油耗 MAPE 的貢獻 ≈ 0.07%(見 §2 特徵重要性)。
權重數字合不合理對「油耗預測」影響很小;它們的價值主要在 **Speed Loss Dashboard 的歸因敘事**,
而非預測精度。建議照用,不需為此調參。

### 1.7 交互特徵(RPM×draft、fouling×days_since)

**實測不需要。** 對照實驗:加 `log(RPM)`、`log(prop)` 無改善或更差;移除全部養護特徵僅 +0.07% MAPE。
GBT 本身會學特徵交互,額外手造交互項無增益。維持現況特徵集(RPM-only 6.2% → 完整 4.3%,
證明特徵集整體有效、非臃腫,但不需再加交互項)。

---

## 2. ML 模組函式設計(決策)

### 2.1 預測標的 → **方案 A(油耗)**

預測 **VLSFO 當量的每 24h 全速油耗 `foc_eq24`**,再:
(a) 乘回燃料實際質量係數 `40.2/LCV`、乘當日實際全速時數/24 → 得該燃料 MT/day(提交值);
(b) 供 Dashboard 反推 Speed Loss。

理由:標的即競賽要求的 `ME_FULLSPEED_CONSUMP_[fuel]`;用「當量 + 每24h 歸一化」讓五種燃料、
不同全速時數可比,單一模型即可涵蓋(不需分 HSHFO/VLSFO 模型——VLSFO 僅 11 格,分開反而不穩)。
方案 B/C 需先有可靠 baseline 才能算 Speed Loss,對「油耗」這個直接標的是繞路。

### 2.2 模型架構 → **全域模型,`ship` 作為 categorical**

- 估計器:`HistGradientBoostingRegressor`(loss=absolute_error,學 log 標的 ≈ 對齊 MAPE;
  原生支援缺值與類別特徵)。
- 為何全域:每船獨立 → S21–S23 遮蔽窗口資料太少;全域 + `ship`/`ship_type` 類別特徵可跨船
  共享物理規律,又保留個船校準。LOSO 實測證明跨船可泛化(見 2.5)。

### 2.3 Speed Loss Baseline → **方案 3(模型預測理想狀態)**

用模型在「剛養護、無汙損」條件下的預測值當 baseline,再與實際比較。理由:方案 1/2 的
「相同 RPM bin」在遮蔽窗口 RPM 分布有限時不穩;方案 3 直接複用已驗證的油耗模型,一致性最好。
(此為 Dashboard 用途,不影響提交檔。)

### 2.4 最終特徵與重要性排序

特徵清單見 `ml/training/config.py`。permutation importance(前 5):

| 特徵 | 重要性 |
|---|---|
| `ME_AVG_RPM` | 0.94 |
| `SPEED_THROUGH_WATER` | 0.34 |
| `log_v3d23`（物理項） | 0.09 |
| `ship` | 0.005 |
| `FULL_SPD_STW_SLIP` | 0.004 |

養護時鐘、天候、吃水皆 < 0.005(但整體特徵集仍有效:RPM-only 6.2% → 完整 4.3%)。

### 2.5 評估指標與目標值

主指標 **MAPE**(競賽相關且尺度不變)。實測(對 `data/raw/`):

| 驗證法 | MAPE | 說明 |
|---|---|---|
| Event-holdout(船已知、窗口遮蔽,對應真實任務) | **4.30%** | 主估計 |
| Leave-one-ship-out(完全排除該船,跨船下界) | **5.41%** | 壓力測試;S8 為離群(需留意) |
| 物理基線(僅物理特徵,無 RPM) | ~7.4% | 對照 |

輔助:RMSE ≈ 3.5 MT/day。目標:MAPE < 5%(已達)。

---

## 3. 部署方案決定 → **方案 B:Lambda(容器映像)**

| 考量 | 評估 |
|---|---|
| 模型大小 | sklearn `HistGradientBoostingRegressor`,序列化僅數 MB;依賴(sklearn+numpy+pandas+pyarrow)超過 250MB zip 上限 → **用 Lambda 容器映像(上限 10GB)** 即可解 |
| 推論頻率 | 每日批次,一次 102 格(或每船每日),非高併發即時 → 不需 endpoint 常駐 |
| 時程/一致性 | 與現有 event-driven / serverless 架構一致,無需引入 SageMaker;demo 時程壓力下最快 |
| 成本 | Lambda 依呼叫計費,批次任務近乎零成本;SageMaker endpoint 需常駐付費 |

**結論**:SageMaker 對「小型 sklearn 模型 + 每日批次」是殺雞用牛刀。選 **Lambda 容器映像**:
訓練離線產出 `model.joblib` 存 S3,推論 Lambda 載入並對 ETL 產出的 processed 資料跑
`predict_submission`。未來若需 A/B、model registry、線上重訓再升級 SageMaker。

---

## 附:端到端 I/O 契約

```
raw CSV (S3 PutObject)
  └─► ETL Lambda  run_etl(voyage_df, maintenance_df)
        input : vt_fd.csv(含 HIDDEN/PREDICT 標記,dtype=str)+ maintenance.csv(event_date)
        output: processed parquet — 每船每日一列,含 FEATURES + foc_eq24 標的 + predict_fuel 標記
  └─► Inference Lambda  ml.training.model
        load_processed(parquet) → train(df) 或載入 model.joblib
        predict_submission(model, df)
        output: 102 列 [ship_id, day, fuel_type, predicted_value]
                fuel_type = 完整欄名 ME_FULLSPEED_CONSUMP_*(與提交格式一致)
```
