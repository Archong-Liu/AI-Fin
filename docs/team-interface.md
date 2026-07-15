# YMINSIGHT — 團隊分工與介面合約

> **Version:** 0.1.0  
> **Last Updated:** 2026-07-14

---

## 1. 團隊職責總覽

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  ┌─── ML 小組 ──────────────────────────────────────────────────┐   │
│  │                                                              │   │
│  │  INPUT:  S3 raw-data (vt_fd.csv + maintenance.csv)          │   │
│  │                                                              │   │
│  │  工作內容:                                                    │   │
│  │    1. 資料清洗 (ETL)                                         │   │
│  │    2. 特徵工程                                               │   │
│  │    3. 模型訓練 & 推論                                        │   │
│  │    4. 產出結果寫入 S3                                        │   │
│  │                                                              │   │
│  │  OUTPUT: S3 processed-data (results JSON / CSV)             │   │
│  │                                                              │   │
│  └──────────────────────────┬───────────────────────────────────┘   │
│                             │                                       │
│                             ▼ (ML 輸出的 JSON/CSV)                  │
│                                                                     │
│  ┌─── Dashboard 小組 ──────────────────────────────────────────┐   │
│  │                                                              │   │
│  │  INPUT:  S3 results-json (ML 小組的輸出)                     │   │
│  │                                                              │   │
│  │  工作內容:                                                    │   │
│  │    1. 根據 ML 輸出欄位設計業務邏輯                            │   │
│  │    2. 規劃 User Case (頁面/互動/視覺化)                      │   │
│  │    3. 前端實作 (靜態框架 → S3 + CloudFront)                  │   │
│  │                                                              │   │
│  │  OUTPUT: 靜態前端 + 對 API Gateway 的 fetch 呼叫             │   │
│  │                                                              │   │
│  └──────────────────────────┬───────────────────────────────────┘   │
│                             │                                       │
│                             ▼ (API 呼叫)                            │
│                                                                     │
│  ┌─── Cloud 小組 ──────────────────────────────────────────────┐   │
│  │                                                              │   │
│  │  工作內容:                                                    │   │
│  │    1. Event-Driven 架構 (S3 event → Lambda 觸發串接)         │   │
│  │    2. 外部服務串接:                                           │   │
│  │       - API Gateway (前端 → Lambda 路由)                     │   │
│  │       - Amazon Bedrock (LLM 排程建議)                        │   │
│  │       - Amazon SNS (告警推播)                                │   │
│  │    3. Terraform IaC (全部基礎設施)                            │   │
│  │    4. 整體系統整合 & 部署                                     │   │
│  │                                                              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 資料流與介面邊界

```
S3 (raw-data)
    │
    │  ← Cloud 小組設定 S3 Event Notification
    ▼
Lambda: ML Pipeline (ML 小組撰寫)
    │
    │  清洗 → 特徵工程 → 模型推論
    ▼
S3 (processed-data/results-json/)    ← 介面合約：ML 輸出 schema
    │
    ├──→ CloudFront → Dashboard 前端 (Dashboard 小組)
    │
    └──→ Lambda: Alert (Cloud 小組)
              │
              ├─ 閾值判斷
              ├─ Bedrock LLM 建議
              └─ SNS 告警推播
```

---

## 3. 各組交付物與時程依賴

### ML 小組

| 交付物 | 說明 | 下游依賴 |
|--------|------|----------|
| Lambda handler (Python) | 包含 ETL + 推論邏輯的 handler.py | Cloud 小組部署 |
| requirements.txt | Lambda dependencies | Cloud 小組打包 Layer |
| **輸出 JSON schema** | 定義 results-json 的欄位與結構 | Dashboard 小組、Cloud 小組 |
| 模型檔 (.pkl / .joblib) | 訓練好的模型 artifact | 放 S3 或 Lambda Layer |
| EDA 報告 | 資料探索結論、特徵選擇理由 | 團隊共識 |

### Dashboard 小組

| 交付物 | 說明 | 下游依賴 |
|--------|------|----------|
| User Case 文件 | 頁面規劃、互動設計 | Cloud 小組提供 API spec |
| 靜態前端 build | 編譯後的 HTML/JS/CSS | Cloud 小組部署至 S3 |
| API 呼叫需求 | 需要哪些 endpoint、request/response | Cloud 小組實作 API |

### Cloud 小組

| 交付物 | 說明 | 下游依賴 |
|--------|------|----------|
| Terraform IaC | 全部基礎設施（S3, Lambda, API GW, SNS, CloudFront） | — |
| S3 bucket 規範 | bucket name、prefix 結構、權限 | ML 小組寫入、Dashboard 小組讀取 |
| API endpoint spec | `/api/recommend`, `/api/report/generate` 等 | Dashboard 小組 fetch |
| Event trigger 設定 | S3 event → ML Lambda 觸發條件 | ML 小組配合檔案命名 |
| Alert + LLM + SNS | 告警閾值判斷、Bedrock 呼叫、通知推播 | — |

---

## 4. 介面合約定義

### 4.1 ML 小組 → S3 輸出路徑規範

由 Cloud 小組提供，ML 小組遵循：

```
s3://yminsight-processed-data/
├── results-json/
│   ├── fleet-summary.json              ← 船隊總覽
│   ├── {ship_id}/
│   │   ├── latest.json                 ← 最新推論結果
│   │   ├── history.json                ← 歷史 Speed Loss 序列
│   │   └── maintenance-timeline.json   ← 養護事件
│   └── alerts/
│       └── active.json                 ← 超閾值船舶列表
└── csv/
    └── {ship_id}/                      ← 清洗後中間資料 (optional debug 用)
```

### 4.2 ML 輸出 JSON Schema（待 ML 小組確認）

**`fleet-summary.json`**

```json
{
  "generated_at": "ISO8601 timestamp",
  "total_vessels": 15,
  "vessels": [
    {
      "ship_id": "string",
      "latest_speed_loss_pct": "float",
      "status": "normal | warning | critical",
      "days_since_cleaning": "int",
      "fouling_severity": "int (0-15)",
      "primary_fouling": ["string"],
      "propeller_condition": "Good | Fair | Poor",
      "trend": "stable | degrading | improving",
      "last_updated": "ISO8601 date"
    }
  ]
}
```

**`{ship_id}/latest.json`**

```json
{
  "ship_id": "string",
  "voyage": "int",
  "speed_loss_pct": "float",
  "speed_loss_kts": "float",
  "speed_actual_kts": "float",
  "speed_reference_kts": "float",
  "me_avg_rpm": "float",
  "me_fullspeed_consump": "float",
  "active_fuel": "string",
  "days_since_cleaning": "int",
  "fouling_severity": "int",
  "propeller_condition_score": "int (1-3)",
  "power_speed_ratio": "float",
  "speed_loss_attribution": {
    "primary_cause": "HULL_FOULING | PROPELLER_ROUGHNESS | COMBINED",
    "hull_contribution_pct": "int",
    "propeller_contribution_pct": "int"
  }
}
```

**`{ship_id}/history.json`**

```json
{
  "ship_id": "string",
  "records": [
    {
      "voyage": "int",
      "noon_utc": "int",
      "speed_loss_pct": "float",
      "me_avg_rpm": "float",
      "me_fullspeed_consump": "float",
      "days_since_cleaning": "int"
    }
  ],
  "maintenance_events": [
    {
      "date": "ISO8601 date",
      "type": "DD | UWC | UWI | PP | UWI+PP | UWC+PP",
      "hull_fouling_type": ["string"],
      "propeller_condition": "Good | Fair | Poor | null",
      "cavitation_found": "boolean | null"
    }
  ]
}
```

### 4.3 S3 Raw Data 上傳規範

ML Lambda 觸發條件（Cloud 小組設定）：

| 項目 | 規範 |
|------|------|
| Bucket | `yminsight-raw-data` |
| Prefix | `noon-reports/` |
| Suffix | `.csv` |
| 命名格式 | `noon-reports/{filename}.csv` |

ML 小組的 Lambda 會從同 bucket 的 `maintenance/maintenance.csv` 讀取養護記錄。

### 4.4 API Endpoint（Cloud 小組提供 → Dashboard 小組呼叫）

| Endpoint | Method | 用途 | Request | Response |
|----------|--------|------|---------|----------|
| `/api/recommend` | POST | 觸發 LLM 排程建議 | `{ship_id, context: {next_port, eta_days, berth_hours, cleaning_cost_usd}}` | `{recommendation, summary, details}` |
| `/api/report/generate` | POST | 觸發報表生成 | `{ship_id, date_range, include_llm_analysis}` | `{report_url, generated_at}` |
| `/api/alert/acknowledge` | POST | 確認告警已處理 | `{ship_id, alert_id}` | `{success}` |

---

## 5. 工作流程時序

```
Phase 1: 基礎建設 (Cloud 小組先行)
  → 建立 S3 buckets、設定 event trigger、部署空殼 Lambda
  → 產出 bucket name、prefix 規範、API spec 文件

Phase 2: 平行開發
  → ML 小組：EDA → 模型開發 → 輸出 handler + schema 確認
  → Dashboard 小組：依 schema 設計 UI → 實作前端
  → Cloud 小組：LLM Lambda、Alert Lambda、SNS、Terraform 完善

Phase 3: 整合測試
  → ML handler 部署至 Lambda
  → 前端 build 上傳 S3
  → End-to-end 測試（上傳 CSV → 結果 → Dashboard → 告警）
```

---

## 6. 溝通介面 Checklist

### ML 小組需要從 Cloud 小組獲得：

- [ ] S3 raw-data bucket name & prefix
- [ ] S3 processed-data bucket name & prefix 結構
- [ ] Lambda runtime 規格（Python 版本、memory、timeout）
- [ ] Lambda Layer 是否提供 pandas/numpy（還是 ML 自行打包）

### Dashboard 小組需要從 ML 小組獲得：

- [ ] 確認版 JSON schema（欄位名稱、型別、可能的值域）
- [ ] 資料更新頻率（每次上傳更新 or 定時 batch）
- [ ] 各欄位的業務含義說明

### Dashboard 小組需要從 Cloud 小組獲得：

- [ ] CloudFront distribution URL（`*.cloudfront.net`）
- [ ] API Gateway base URL
- [ ] API endpoint 詳細 spec（request/response schema）
- [ ] CORS 設定確認

### Cloud 小組需要從 ML 小組獲得：

- [ ] handler.py（符合 Lambda handler 簽名）
- [ ] requirements.txt
- [ ] 模型檔大小（決定 Layer vs S3 載入）
- [ ] 確認觸發方式（整合一支 or ETL + Inference 拆兩支）

### Cloud 小組需要從 Dashboard 小組獲得：

- [ ] 前端 build 產出物（靜態檔案）
- [ ] 需要的 API endpoint 清單
- [ ] 是否需要認證（MVP 先略 or 加 Cognito）
