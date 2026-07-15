# YMINSIGHT — Feature Specification

> **Version:** 0.2.0-draft  
> **Last Updated:** 2026-07-14

---

## Feature Map

```
┌──────────────────────────────────────────────────────────────────┐
│                        YMINSIGHT Features                         │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─── Event-Driven Layer ────┐  ┌─── Data Processing Layer ───┐  │
│  │                           │  │                              │  │
│  │  F1: Auto ETL Trigger     │  │  F2: Speed Loss Calc        │  │
│  │      • S3 PUT detect      │  │      • ISO 19030            │  │
│  │      • Event routing      │  │      • Baseline compare     │  │
│  │                           │  │                              │  │
│  └───────────────────────────┘  │  F3: Fleet Dashboard Data   │  │
│                                 │      • JSON generation       │  │
│  ┌─── API Layer ─────────────┐  │      • Trend aggregation    │  │
│  │                           │  │                              │  │
│  │  F4: LLM Recommendation  │  │  F7: Fouling Attribution    │  │
│  │      • Bedrock Claude     │  │      • Hull vs Propeller    │  │
│  │      • Cross-dept advice  │  │                              │  │
│  │                           │  └──────────────────────────────┘  │
│  │  F9: Report Generation    │                                    │
│  │      • Data aggregation   │  ┌─── Notification Layer ──────┐  │
│  │      • LLM analysis       │  │                              │  │
│  │                           │  │  F5: SNS Alert               │  │
│  └───────────────────────────┘  │      • Threshold trigger     │  │
│                                 │      • Email / Slack          │  │
│  ┌─── Frontend Layer ────────┐  │                              │  │
│  │                           │  │  F8: Multi-level Alert       │  │
│  │  F6: Maintenance          │  │      • Warning (8%)         │  │
│  │      Timeline Viz         │  │      • Critical (12%)       │  │
│  │                           │  │                              │  │
│  └───────────────────────────┘  └──────────────────────────────┘  │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Feature 優先級

### P0 — MVP 必備（黑客松 Demo）

| # | Feature | 描述 | 涉及 Terraform Module |
|---|---------|------|-----------------------|
| F1 | Event-Driven ETL | CSV 上傳自動觸發清洗 + 過濾 | event, data-processing, data-store |
| F2 | Speed Loss 計算 | ISO 19030 框架下計算 Speed Loss % | data-processing |
| F3 | Fleet Dashboard Data | 產出 JSON 供前端展示船隊總覽 + 趨勢 | data-processing, data-store |
| F4 | LLM 排程建議 | 前端觸發 → Bedrock Claude 產出建議 | api |
| F5 | SNS 告警推播 | Speed Loss 超閾值 → 自動通知 | data-processing, notification |

### P1 — 加分項

| # | Feature | 描述 | 涉及 Terraform Module |
|---|---------|------|-----------------------|
| F6 | 養護事件時序視覺化 | 時間軸 + V 型回升 | frontend, data-store |
| F7 | 髒污歸因分析 | 區分 Hull vs Propeller 貢獻 | data-processing |
| F8 | 多級告警 | 8% 黃燈、12% 紅燈 | data-processing, notification |
| F9 | 報表生成 | LLM 分析 + 資料彙整 → JSON 報表 | api, data-store |

---

## F1: Event-Driven ETL (自動化資料清洗)

### 概要

使用者上傳 CSV 至 S3 raw bucket 後，系統自動觸發清洗 pipeline。

### 觸發條件

- S3 PutObject event on prefix `noon-reports/`
- File suffix: `.csv`

### 處理邏輯

```
1. Load CSV from S3 (raw)
2. Validate schema (40 columns expected)
3. Filter: WIND_SCALE <= 4 (排除極端天氣)
4. Filter: HOURS_FULL_SPEED >= 22 (確保全速基準)
5. Feature Engineering:
   a. Detect active fuel type (5 fuel columns 中取 > 0 者)
   b. days_since_last_cleaning (from maintenance.csv)
   c. days_since_last_propeller_polish
   d. fouling_severity_score (weighted sum of fouling types)
   e. One-hot encode fouling types (slime, algae, barnacle, calcium, tubeworm)
   f. power_speed_ratio = HORSE_POWER / SPEED_THROUGH_WATER
   g. TRIM = AFTER_DRAFT - FORE_DRAFT
   h. propeller_condition_score (Good=1, Fair=2, Poor=3)
6. Output: Parquet → s3://processed-data/processed/{base}_cleaned_{ts}.parquet (ML-internal, dtype-preserving)
7. Output: Summary JSON → s3://processed-data/results-json/fleet-summary.json
```

### 輸入 Schema

**vt_fd.csv (40 columns)**:
```
De-identification Name, VOYAGE, NOON_UTC, AVG_SPEED, SPEED_THROUGH_WATER,
ME_AVG_RPM, PROPELLER_SPEED, FORE_DRAFT, AFTER_DRAFT, DISPLACEMENT,
CARGO_ON_BOARD, WIND_SCALE, SEA_HEIGHT, SEA_WATER_TEMP, WIND_SPEED,
WIND_DIRECTION, SWELL_HEIGHT, SWELL_DIRECTION, SEA_DIRECTION, WATER_DEPTH,
MID_DRAFT, TOTAL_DISTANCE, SEA_SPEED_DISTANCE, DIFF_STW_SOG_SLIP,
FULL_SPD_STW_SLIP, HORSE_POWER, LOAD_PCT, SFOC, ME_SLIP, THRUST,
THRUST_QUOTIENT, TOTAL_CONSUMP, ME_CONSUMPTION, ME_FULLSPEED_CONSUMP_HSHFO,
ME_FULLSPEED_CONSUMP_ULSFO, ME_FULLSPEED_CONSUMP_VLSFO,
ME_FULLSPEED_CONSUMP_LSMGO, ME_FULLSPEED_CONSUMP_BIO_HSFO,
HOURS_FULL_SPEED, HOURS_TOTAL
```

**maintenance.csv (9 columns)**:
```
ship_id, event_type, event_date, propeller_condition,
hull_fouling_type, hull_coating_condition, cavitation_found,
draft_fwd_m, draft_aft_m
```

### 輸出格式

- **Processed Parquet**：每船每日一列，原始欄位 + 衍生特徵 + foc_eq24 標的（dtype 保真，供 `model.load_processed()` 讀取）
- **fleet-summary.json**：見 F3 規格

### 接受標準

- [ ] CSV 上傳後 < 5 秒觸發 Lambda
- [ ] 過濾後資料僅含 WIND_SCALE ≤ 4 且 HOURS_FULL_SPEED ≥ 22
- [ ] 衍生特徵欄位完整（days_since_cleaning 等無 null）
- [ ] 輸出 CSV 可被 pandas 正確讀取

---

## F2: Speed Loss 計算 (ISO 19030)

### 概要

根據清洗後資料，計算每艘船每筆航行紀錄的 Speed Loss 數值與百分比。

### 計算公式

```
Speed Loss (kts) = V_reference - V_actual
Speed Loss (%)   = (V_reference - V_actual) / V_reference × 100%
```

- **V_actual** = `SPEED_THROUGH_WATER` (STW)
- **V_reference** = 該船在相同 RPM 條件下的基準速度

### 基準線建立（暫定方案：清潔後窗口法）

```
1. 從 maintenance.csv 取每船最近一次清潔事件 (UWC / UWI / DD)
2. 取清潔後 30 天內通過 ETL 篩選的航行資料作為 baseline pool
3. 以 RPM 分群（±2 RPM 為一個 bin），取各 bin 內平均 STW 為 V_reference
4. 新資料根據 RPM 查找對應 bin 的 V_reference
5. 若無對應 bin，用最近 RPM bin 內插
```

### 輸出 Schema (per record)

```json
{
  "ship_id": "S1",
  "date": "2025-06-15",
  "voyage": 28,
  "noon_utc": 5,
  "speed_actual_kts": 18.07,
  "speed_reference_kts": 19.2,
  "speed_loss_kts": 1.13,
  "speed_loss_pct": 5.88,
  "me_avg_rpm": 63.0,
  "days_since_cleaning": 145,
  "fouling_severity": 6,
  "active_fuel": "VLSFO",
  "me_fullspeed_consump": 80.3
}
```

### 接受標準

- [ ] Speed Loss % 數值在合理範圍（-5% ~ 30%，負值代表優於基準）
- [ ] 基準線隨清潔事件重置（清潔後 Speed Loss 趨近 0%）
- [ ] 結果寫入 `results-json/{ship_id}/history.json`
- [ ] fleet-summary.json 更新各船最新 Speed Loss

---

## F3: Fleet Dashboard Data (船隊資料供應)

### 概要

Lambda 產出靜態 JSON 至 S3，前端透過 CloudFront 直接讀取。

### JSON 結構

#### `fleet-summary.json`

```json
{
  "generated_at": "2025-06-15T12:00:00Z",
  "total_vessels": 15,
  "vessels": [
    {
      "ship_id": "S1",
      "latest_speed_loss_pct": 8.5,
      "status": "warning",
      "days_since_cleaning": 180,
      "fouling_severity": 6,
      "primary_fouling": ["barnacle", "slime", "algae"],
      "propeller_condition": "Good",
      "trend": "degrading",
      "last_updated": "2025-06-15"
    }
  ],
  "alerts_active": 3,
  "thresholds": {
    "warning_pct": 8.0,
    "critical_pct": 12.0
  }
}
```

#### `{ship_id}/latest.json`

```json
{
  "ship_id": "S1",
  "voyage": 28,
  "noon_utc": 5,
  "speed_loss_pct": 8.5,
  "speed_loss_kts": 1.6,
  "me_avg_rpm": 64.6,
  "speed_actual_kts": 18.87,
  "speed_reference_kts": 20.47,
  "me_fullspeed_consump": 103.85,
  "active_fuel": "VLSFO",
  "days_since_cleaning": 180,
  "fouling_severity": 6,
  "propeller_condition_score": 1,
  "power_speed_ratio": 1382.0
}
```

#### `{ship_id}/history.json`

```json
{
  "ship_id": "S1",
  "records": [
    {
      "voyage": 28,
      "noon_utc": 3,
      "speed_loss_pct": 5.2,
      "me_avg_rpm": 64.7,
      "me_fullspeed_consump": 111.47,
      "days_since_cleaning": 178
    }
  ],
  "maintenance_events": [
    {
      "date": "2025-04-11",
      "type": "PP",
      "hull_fouling_type": ["slime"],
      "propeller_condition": "Good",
      "cavitation_found": false
    }
  ]
}
```

#### `alerts/active.json`

```json
{
  "generated_at": "2025-06-15T12:00:00Z",
  "alerts": [
    {
      "ship_id": "S4",
      "level": "critical",
      "speed_loss_pct": 14.2,
      "triggered_at": "2025-06-15T11:55:00Z",
      "days_since_cleaning": 250,
      "acknowledged": false
    }
  ]
}
```

### 接受標準

- [ ] 所有 JSON 符合上述 schema
- [ ] 前端可 fetch + 渲染，無需後端 API
- [ ] 每次 pipeline 完成後自動更新
- [ ] CloudFront 可正常分發（CORS 正確）

---

## F4: AI 諮詢顧問 (Bedrock Claude) — v0.2 redesign

> **v0.2 改版說明**：原設計是單船觸發的一次性表單 → `/api/recommend`。實際前端（`frontend/src/App.jsx`）
> 已經做出一個**常駐、跨視圖同步脈絡的 AI 諮詢側欄**（Drawer），且其目前的示意回覆函式
> `aiAnswer()`（`frontend/src/data.js`）的 fallback 文案本身就寫著：「正式版會把『你目前檢視的
> 視圖 + 該船模型輸出 + 養護紀錄摘要』一起送進 Claude API」——也就是說真正的產品設計早就定案，
> 只是尚未接上真實 LLM。本節取代原 F4，讓 spec 對齊已實作的 UI，而非另外憑空做一個表單頁。

### 概要

AI 諮詢側欄在船隊總覽、單船分析、人工比對、資料與報告四個視圖都常駐開啟，並會在使用者切換
視圖/船隻時自動同步脈絡列（`👁 正在追蹤：...`）。對話請求把「目前視圖 + 使用者已經在看的資料」
一併送給 Bedrock Claude，讓回答能引用實際數字，不需要使用者額外填表單。

原 F4 表單蒐集的四個欄位（下一港口／ETA／靠泊時數／清潔成本）沒有被捨棄——它們變成單船分析頁
`RecoCard` 的「排入清潔計畫 →」按鈕觸發的**深度建議**模式：同一支 API，多帶一個
`want_detailed: true` 旗標，請 Claude 額外產出結構化的跨部門排程建議（含 ROI／風險評估），
直接顯示在側欄對話中，而不是跳轉到另一個頁面。

### API

```
POST /api/consult
Content-Type: application/json

Request:
{
  "view": "fleet" | "ship" | "verify" | "data",   // 必填，對應目前的主導航分頁
  "question": "為什麼這艘船速度損失突然上升？",           // 必填
  "history": [{"role": "user" | "ai", "text": "..."}], // 選填，近幾輪對話（不含本次 question）
  "want_detailed": false,                          // 選填，RecoCard CTA 觸發時為 true

  // view == "ship" 時，前端已在記憶體中的單船資料（不含前端示意生成、非後台真實輸出的欄位，
  // 例如 attrDonut 的歸因百分比目前是前端公式估算值，故不隨 context 送出，避免 LLM 誤把示意值
  // 當成模型正式輸出來推理）
  "ship_context": {
    "ship_id": "S1", "current_pct": 8.7, "thr": 8,
    "days_since_cleaning": 180, "clean_count": 2, "penalty_t_per_day": 4.8,
    "recent_trend_pct": [6.1, 6.4, 7.0, 7.6, 8.1, 8.7],
    "src_mode": "processed",
    // 僅 want_detailed 且使用者於對話中提供時才會出現：
    "next_port": "Kaohsiung", "eta_days": 10, "berth_hours": 30, "cleaning_cost_usd": 45000
  },

  // view == "fleet" 時
  "fleet_context": {
    "avg_sl_pct": 6.3, "total_vessels": 15, "mape_pct": 4.2,
    "over_threshold": [{"ship_id": "S4", "pct": 14.2, "thr": 12}, ...]
  }
}
```

回應永遠是 200——Bedrock 逾時或輸出無法解析時，回傳的是一段降級文字而不是 5xx，前端側欄因此
不需要另外處理錯誤狀態（與現有 `fetchFleetData()` 多來源降級的設計精神一致）：

```
Response:
{
  "answer": "...",                    // 一律有值，繁體中文，引用 context 中的實際數字
  "suggested_action": {                // 由後端依 ship_context 規則決定，不是模型輸出
    "type": "SCHEDULE_CLEANING" | "ESCALATE_DRYDOCK" | "MONITOR",
    "ship_id": "S1",
    "summary": "S1 目前 8.7% 已超過警戒線 8%，建議安排水下清潔"
  } | null,
  "detailed_recommendation": {          // 僅 want_detailed 時嘗試附上；解析失敗則為 null
    "recommendation": "CLEAN_NOW | DEFER | MONITOR",
    "confidence": 0.85,
    "details": {
      "for_technical_dept": "...", "for_route_planning": "...",
      "roi_analysis": "...", "risk_if_deferred": "..."
    }
  } | null,
  "generated_at": "2025-06-15T14:30:00Z"
}
```

`suggested_action` 刻意用 Python 規則算（與 `RecoCard` 現有的 `st`/`dock` 判斷同一套邏輯），
不倚賴模型輸出——側欄裡的行動 chip 因此在 Bedrock 呼叫失敗時也還能顯示，只有 `answer` 這段文字
會降級。

### 前端整合點

| UI 元件 | 現況（v0.1） | 改版後 |
|---|---|---|
| `Drawer`（`App.jsx`） | `onAsk` 呼叫本地關鍵字比對 `aiAnswer()` | 呼叫 `consultAI()`（`api.js`），失敗才退回 `aiAnswer()` 當離線示意 |
| `RecoCard` CTA 按鈕 | 純 UI，無 `onClick` | 開啟側欄並帶 `want_detailed: true` 送出深度建議請求 |
| 側欄訊息 | 純文字氣泡 | AI 訊息可附一顆 `suggested_action` chip |

### 接受標準

- [ ] API 回應時間 < 15 秒（含 Bedrock invoke）
- [ ] `want_detailed` 模式下 `detailed_recommendation` 為可解析的結構化 JSON；解析失敗時整體
      回應仍是 200 且 `answer` 有可讀內容
- [ ] 一般問答模式下 `answer` 會引用 `ship_context`/`fleet_context` 中的實際數字，而非泛泛而談
- [ ] Bedrock timeout / malformed response 有 fallback，`suggested_action` 不受影響

---

## F5: SNS 自動告警推播

### 概要

Speed Loss 超過設定閾值時，自動推播通知。

### 觸發邏輯

```python
thresholds = load_config("config/thresholds.json")

if speed_loss_pct >= thresholds["critical_pct"]:   # >= 12%
    level = "critical"
    # 觸發 LLM 生成簡要建議後發送
elif speed_loss_pct >= thresholds["warning_pct"]:   # >= 8%
    level = "warning"
    # 發送制式警告
else:
    return  # no alert
```

### 通知流程

```
Lambda:Alert 偵測超閾值
    ↓
(Critical only) → Invoke Bedrock 生成簡要建議
    ↓
組裝 SNS message
    ↓
Publish to SNS Topic (critical 或 warning)
    ↓
SNS 分發至：
  • Email (工務主管、航線規劃主管)
  • Webhook (Slack / Teams)
```

### SNS Message Schema

```json
{
  "alert_level": "critical",
  "ship_id": "S1",
  "speed_loss_pct": 13.5,
  "speed_loss_kts": 2.7,
  "days_since_cleaning": 210,
  "fouling_types": ["barnacle", "slime", "algae"],
  "fouling_severity": "HIGH (score: 6/15)",
  "recommendation_summary": "建議於 10 天後高雄港靠泊時安排水下清潔",
  "dashboard_url": "https://d1234abcd.cloudfront.net/vessel/S1",
  "generated_at": "2025-06-15T12:05:00Z"
}
```

### 去重複邏輯

- 同一船同一 level：24 小時內不重發
- Level 升級（warning → critical）：立即觸發
- 使用 S3 `alerts/sent-log.json` 記錄已發送告警時間戳

### 接受標準

- [ ] 超閾值後 < 60 秒完成推播
- [ ] Email 可正常收取，格式可讀
- [ ] 24 小時去重複正常運作
- [ ] 閾值可透過 `config/thresholds.json` 調整

---

## F6: 養護事件時序視覺化 (P1)

### 概要

Dashboard 以時間軸呈現養護歷史，並 overlay Speed Loss 趨勢，展現「V 型效能恢復」。

### 資料來源

- `{ship_id}/history.json` → Speed Loss 時間序列
- `{ship_id}/maintenance-timeline.json` → 養護事件

### 視覺化規格

- X 軸：時間（voyage / noon_utc 序列）
- Y 軸 (primary)：Speed Loss %
- Y 軸 (secondary)：油耗 (MT/day)
- 養護事件：垂直標記線 + 圖示（DD=藍、UWC=綠、UWI=橙、PP=紫）
- 互動：hover 事件標記展開詳情

---

## F7: 髒污歸因分析 (P1)

### 概要

區分 Speed Loss 惡化主因：船體生物汙損 vs 螺旋槳粗糙。

### 歸因邏輯

```python
def attribute_speed_loss(fouling_severity, propeller_condition_score):
    """
    fouling_severity: 0-15 (sum of fouling weights)
    propeller_condition_score: 1=Good, 2=Fair, 3=Poor
    """
    propeller_penalty = (propeller_condition_score - 1) * 4  # Good=0, Fair=4, Poor=8
    total = fouling_severity + propeller_penalty

    if total == 0:
        return {"primary": "NONE", "hull_pct": 0, "propeller_pct": 0}

    hull_pct = round(fouling_severity / total * 100)
    propeller_pct = 100 - hull_pct

    if hull_pct >= 70:
        primary = "HULL_FOULING"
    elif propeller_pct >= 70:
        primary = "PROPELLER_ROUGHNESS"
    else:
        primary = "COMBINED"

    return {
        "primary": primary,
        "hull_contribution_pct": hull_pct,
        "propeller_contribution_pct": propeller_pct
    }
```

### 輸出（追加至 latest.json）

```json
{
  "speed_loss_attribution": {
    "primary_cause": "HULL_FOULING",
    "hull_contribution_pct": 72,
    "propeller_contribution_pct": 28
  }
}
```

---

## F8: 多級告警 (P1)

### 等級定義

| Level | Speed Loss 閾值 | Dashboard 顯示 | 通知動作 |
|-------|----------------|---------------|---------|
| Normal | < 8% | 🟢 綠燈 | — |
| Warning | 8% ~ <12% | 🟡 黃燈 | SNS:warning topic |
| Critical | ≥ 12% | 🔴 紅燈 | LLM 建議 + SNS:critical topic |

### 升降級規則

- 升級（normal→warning, warning→critical）：即時觸發通知
- 降級（critical→warning, warning→normal）：僅更新 dashboard 狀態，不發通知
- 同級持續：24 小時 dedup

---

## F9: 報表生成 (P1)

### API

```
POST /api/report/generate
{
  "ship_id": "S1",
  "date_range": {"from": "2025-01-01", "to": "2025-06-15"},
  "include_llm_analysis": true
}

Response:
{
  "report_url": "https://d1234abcd.cloudfront.net/reports/S1/20250615_143000.json",
  "generated_at": "2025-06-15T14:30:00Z"
}
```

### 報表內容結構

```json
{
  "metadata": {"ship_id": "S1", "period": "2025-01-01 ~ 2025-06-15"},
  "summary": {
    "avg_speed_loss_pct": 7.3,
    "max_speed_loss_pct": 12.1,
    "total_maintenance_events": 2,
    "estimated_fuel_waste_mt": 45.2
  },
  "speed_loss_trend": [...],
  "maintenance_events": [...],
  "llm_analysis": "..." 
}
```

---

## 附錄：閾值配置

### `config/thresholds.json`

```json
{
  "speed_loss": {
    "warning_pct": 8.0,
    "critical_pct": 12.0
  },
  "etl_filters": {
    "max_wind_scale": 4,
    "min_hours_full_speed": 22
  },
  "alert": {
    "dedup_window_hours": 24,
    "max_alerts_per_day_per_ship": 3
  }
}
```
