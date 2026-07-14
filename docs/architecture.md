# YMINSIGHT — 系統架構設計文件

> **Version:** 0.2.0-draft  
> **Last Updated:** 2026-07-14  
> **Status:** Design Phase

---

## 1. 系統總覽 (System Overview)

YMINSIGHT 是一套針對陽明海運船隊的**智慧船舶效能監控與跨部門排程協調系統**。  
核心能力：透過事件驅動架構自動處理船舶正午報告，計算 ISO 19030 Speed Loss，並結合 LLM 產出跨部門決策建議與告警通知。

### 設計原則

| 原則 | 說明 |
|------|------|
| Event-Driven | 資料上傳即觸發處理，無需人工介入 |
| Serverless-First | 以 Lambda 為核心計算單元，按需付費 |
| Modular IaC | 基礎設施以 Terraform modules 拆分，各模組獨立部署 |
| Static-First Frontend | 靜態編譯部署至 S3 + CloudFront（使用 AWS 預設 *.cloudfront.net 域名） |
| Least Privilege | 每個服務元件僅擁有最小必要 IAM 權限 |

---

## 2. 高階架構圖 (High-Level Architecture)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           YMINSIGHT Architecture                             │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────┐       ┌──────────────┐       ┌──────────────────────┐         │
│  │  User /  │       │   S3 Bucket  │       │   S3 Event           │         │
│  │  Ops     │──CSV──▶  (raw-data)  │──PUT──▶   Notification      │         │
│  └──────────┘       └──────────────┘       └──────────┬───────────┘         │
│                                                        │                     │
│                                                        ▼                     │
│                                            ┌───────────────────────┐         │
│                                            │  Lambda: ETL          │         │
│                                            │  (Filter + Feature    │         │
│                                            │   Engineering)        │         │
│                                            └───────────┬───────────┘         │
│                                                        │                     │
│                                                        ▼                     │
│                                            ┌───────────────────────┐         │
│                                            │  S3 Bucket            │         │
│                                            │  (processed-data)     │         │
│                                            │  ├── csv/             │         │
│                                            │  └── results-json/    │         │
│                                            └───────────┬───────────┘         │
│                                                        │                     │
│                              ┌──────────────────────────┼──────────┐         │
│                              │                          │          │         │
│                              ▼                          ▼          │         │
│                 ┌─────────────────────┐   ┌─────────────────┐     │         │
│                 │  Lambda: Inference  │   │  S3: Static JSON │     │         │
│                 │  (Speed Loss Calc)  │   │  (Dashboard Data)│     │         │
│                 └──────────┬──────────┘   └────────┬────────┘     │         │
│                            │                       │               │         │
│                            ▼                       │               │         │
│               ┌────────────────────────┐           │               │         │
│               │  S3: results-json/     │◀──────────┘               │         │
│               │  ├── fleet-summary.json│                           │         │
│               │  ├── {ship_id}/        │                           │         │
│               │  │   ├── latest.json   │                           │         │
│               │  │   └── history.json  │                           │         │
│               │  └── alerts/           │                           │         │
│               └────────────┬───────────┘                           │         │
│                            │                                       │         │
│         ┌──────────────────┼────────────────────────┐              │         │
│         │                  │                        │              │         │
│         ▼                  ▼                        ▼              │         │
│  ┌─────────────┐  ┌───────────────────┐  ┌──────────────────────┐ │         │
│  │ CloudFront  │  │ API Gateway       │  │ Lambda: Alert        │ │         │
│  │ + S3 Static │  │ (REST API)        │  │ (Threshold Monitor)  │ │         │
│  │ (Frontend)  │  │                   │  └──────────┬───────────┘ │         │
│  │ *.cf.net    │  │ POST /recommend   │             │              │         │
│  └─────────────┘  │ POST /report      │             ▼              │         │
│         ▲          │ GET  /fleet       │  ┌──────────────────────┐ │         │
│         │          └────────┬──────────┘  │ Amazon Bedrock       │ │         │
│         │                   │             │ (Claude - LLM)       │ │         │
│         │                   ▼             └──────────┬───────────┘ │         │
│         │          ┌──────────────────┐              │              │         │
│         │          │ Lambda: LLM      │              ▼              │         │
│         │          │ (Bedrock Invoke) │   ┌──────────────────────┐ │         │
│         │          └────────┬─────────┘   │ Amazon SNS           │ │         │
│         │                   │             │ (Email/Slack/Teams)   │ │         │
│         │                   ▼             └──────────────────────┘ │         │
│         │          ┌──────────────────┐                            │         │
│         └──────────│ S3: reports/     │                            │         │
│                    │ (Generated JSON  │                            │         │
│                    │  reports)        │                            │         │
│                    └──────────────────┘                            │         │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. IaC 模組拆分 (Terraform Modules)

系統基礎設施以 Terraform modules 拆分，各模組獨立管理 state，透過 `data` sources 或 output variables 互相引用。

```
infrastructure/
├── modules/
│   ├── data-store/         ← S3 buckets, lifecycle, policies
│   ├── event/              ← S3 event notification, EventBridge
│   ├── data-processing/    ← Lambda functions (ETL, Inference, Alert)
│   ├── api/                ← API Gateway + Lambda (LLM, Report)
│   └── notification/       ← SNS topics, subscriptions
├── environments/
│   ├── dev/
│   │   └── main.tf         ← 組裝所有 modules (dev 參數)
│   └── prod/
│       └── main.tf         ← 組裝所有 modules (prod 參數)
├── backend.tf              ← Terraform state backend (S3 + DynamoDB lock)
└── variables.tf            ← 共用變數定義
```

### Module 1: `data-store` — 資料儲存層

| 資源 | 用途 |
|------|------|
| S3 Bucket: `yminsight-raw-data` | 原始 CSV 上傳區 |
| S3 Bucket: `yminsight-processed-data` | 清洗後 CSV + 結果 JSON |
| S3 Bucket: `yminsight-frontend` | 靜態前端 build artifacts |
| S3 Bucket: `yminsight-reports` | LLM 生成報表儲存 |
| CloudFront Distribution | 靜態前端 + JSON 資料分發（使用 `*.cloudfront.net`） |
| CloudFront OAI | 限制 S3 僅透過 CloudFront 存取 |
| S3 Lifecycle Rules | raw: 90 天轉 IA → 180 天刪除；processed: 保留 1 年 |

**輸出**：bucket ARNs, bucket names, CloudFront distribution domain

### Module 2: `event` — 事件路由層

| 資源 | 用途 |
|------|------|
| S3 Event Notification | raw-data bucket PUT 事件偵測（prefix: `noon-reports/`） |
| EventBridge Rule (optional) | 未來擴展用（定時 scan、fan-out） |

**輸入**：raw-data bucket ARN（from data-store）  
**輸出**：event rule ARN

### Module 3: `data-processing` — 資料處理層

| 資源 | 用途 |
|------|------|
| Lambda: ETL | 資料清洗、過濾、特徵工程 |
| Lambda: Inference | Speed Loss 計算 |
| Lambda: Alert Monitor | 閾值偵測，觸發告警 flow |
| Lambda Layer: common-deps | 共用 dependencies (pandas, numpy) |
| CloudWatch Log Groups | 各 Lambda 日誌 |

**輸入**：bucket ARNs, SNS topic ARNs  
**輸出**：Lambda function ARNs

### Module 4: `api` — API 服務層

| 資源 | 用途 |
|------|------|
| API Gateway (REST) | 前端互動 API endpoint |
| Lambda: LLM Handler | 接收前端請求，invoke Bedrock |
| Lambda: Report Generator | 彙整資料產出報表 |
| API Gateway Stage | dev / prod 環境分離 |

**輸入**：bucket ARNs, Bedrock model ARN  
**輸出**：API Gateway invoke URL

### Module 5: `notification` — 通知推播層

| 資源 | 用途 |
|------|------|
| SNS Topic: `yminsight-alert-critical` | Speed Loss ≥ 12% 告警 |
| SNS Topic: `yminsight-alert-warning` | Speed Loss 8-12% 預警 |
| SNS Subscriptions | Email endpoints + Webhook (Slack/Teams) |

**輸入**：Alert Lambda ARN  
**輸出**：SNS topic ARNs

### 模組部署順序

```
data-store → event → data-processing → notification → api
```

各模組透過 Terraform remote state 或 output variables 互相引用，確保解耦。

---

## 4. 資料流設計 (Data Flow)

### 4.1 被動資料流（Event-Driven Pipeline）

```
CSV Upload → S3 (raw) → S3 Event → Lambda:ETL → S3 (processed/csv + results-json)
                                                → Lambda:Inference → S3 (results-json/)
                                                                   → Lambda:Alert
                                                                       ├─ (if warning) → SNS:warning
                                                                       └─ (if critical) → Bedrock → SNS:critical
```

**觸發條件**：S3 PutObject on prefix `noon-reports/`, suffix `.csv`  
**延遲目標**：上傳後 < 30 秒完成 ETL + Inference pipeline

### 4.2 靜態資料供應（Dashboard Consumption）

ETL + Inference 完成後，Lambda 產出 JSON 至：

```
s3://yminsight-processed-data/results-json/
├── fleet-summary.json              ← 15 艘船總覽
├── {ship_id}/
│   ├── latest.json                 ← 最新單筆結果
│   ├── history.json                ← Speed Loss 時間序列
│   └── maintenance-timeline.json   ← 養護事件軸
└── alerts/
    └── active.json                 ← 目前未處理告警
```

前端透過 CloudFront（`*.cloudfront.net`）直讀 JSON，**無需 API call** 即可渲染 dashboard 基本頁面。

### 4.3 主動操作流（User-Triggered via API）

| Endpoint | Method | 用途 | Lambda |
|----------|--------|------|--------|
| `/api/recommend` | POST | 觸發 LLM 產出排程建議 | LLM Handler |
| `/api/report/generate` | POST | 觸發報表生成 | Report Generator |
| `/api/alert/acknowledge` | POST | 確認告警已處理 | Alert Monitor |
| `/api/fleet/status` | GET | 備援：回傳 fleet-summary（正常走 CloudFront） | — (S3 proxy) |

---

## 5. 資料格式決策

### 儲存格式選型

| 階段 | 格式 | 理由 |
|------|------|------|
| Raw → Processed（tabular） | **CSV** | 資料量 ~21K 筆，CSV 足夠；Lambda 處理簡單；Debug 方便直接開啟 |
| Dashboard 消費 | **JSON** | 前端可直接 fetch；結構化 schema；支援巢狀資料 |
| 報表輸出 | **JSON** | 結構化可被前端渲染為報表頁面 |

### 不使用 Parquet 的理由

- 資料規模（15 船 × 日報 = ~5K 筆/年清洗後）不需要列式壓縮
- Lambda 內 Parquet 讀寫需額外 `pyarrow` dependency（增加冷啟動時間與 Layer 大小）
- CSV/JSON 可直接用 S3 console 或任何工具檢視，降低 debug 門檻
- 未來若擴展至 100+ 船，可再考慮切換 Parquet

---

## 6. 前端部署架構

### 方案：S3 + CloudFront（無自有域名）

```
[Static Frontend Build] → S3 Bucket (yminsight-frontend)
                              │
                              ▼
                      CloudFront Distribution
                      (自動分配 d1234abcd.cloudfront.net)
                              ▼
                         End Users
```

**特性**：
- HTTPS 自動提供（AWS 預設 certificate for `*.cloudfront.net`）
- CloudFront OAI 確保 S3 bucket 不公開暴露
- 全球邊緣快取，前端載入快速
- 不需要 Route53 或任何 DNS 設定
- 前端框架：**Placeholder**（編譯為靜態檔案即可）

**前端存取 API 的 CORS 設定**：
- API Gateway 設定 CORS allow origin: `https://*.cloudfront.net`
- S3 results-json bucket 設定 CORS 允許 GET

---

## 7. AWS 服務元件清單

| 類別 | 服務 | 用途 | Terraform Module |
|------|------|------|-----------------|
| Storage | S3 (×4 buckets) | raw / processed / frontend / reports | data-store |
| CDN | CloudFront | 靜態前端 + JSON 分發（`*.cloudfront.net`） | data-store |
| Compute | Lambda (×6) | ETL, Inference, Alert, LLM, Report, (Status) | data-processing, api |
| Event | S3 Event Notification | 觸發 ETL | event |
| API | API Gateway (REST) | 前端互動端點 | api |
| GenAI | Bedrock (Claude) | 決策建議生成 | api |
| Notification | SNS (×2 topics) | Email / Webhook 推播 | notification |
| Monitoring | CloudWatch | Lambda logs + metrics | data-processing |

---

## 8. 安全性設計 (Security)
## 8. 安全性設計 (Security)

> IAM Role / Policy 設計待實作階段細化，此處僅列資料分級原則。

### 資料分級

| 等級 | 資料 | 處理方式 |
|------|------|----------|
| 內部機密 | 原始航行資料 | S3 SSE-S3 加密 |
| 內部使用 | 處理後 CSV/JSON、Speed Loss 結果 | S3 SSE-S3、透過 CloudFront OAI 存取 |
| 可公開 | 前端靜態資源 | CloudFront 分發 |
---

## 9. 部署策略

### Terraform 工作流

```bash
# 初始化 backend
cd infrastructure/environments/dev
terraform init

# 部署順序（modules 透過 depends_on 或 data source 串接）
terraform apply -target=module.data_store
terraform apply -target=module.event
terraform apply -target=module.data_processing
terraform apply -target=module.notification
terraform apply -target=module.api

# 或一次全部
terraform apply
```

### 環境隔離

| 環境 | 用途 | State 位置 |
|------|------|-----------|
| dev | 開發測試 | `s3://yminsight-tfstate/dev/terraform.tfstate` |
| prod | 正式環境 | `s3://yminsight-tfstate/prod/terraform.tfstate` |

### CI/CD（黑客松可手動）

```
git push → (future: GitHub Actions) → terraform plan → terraform apply
                                     → Lambda zip upload → S3
                                     → Frontend build → S3 + CloudFront invalidation
```

---

## 10. 目錄結構（最終）

```
aifin/
├── docs/
│   ├── architecture.md              ← 本文件
│   ├── feature-spec.md              ← Feature 規格
│   └── api-spec.md                  ← API endpoint 規格（待產出）
├── infrastructure/
│   ├── modules/
│   │   ├── data-store/
│   │   │   ├── main.tf
│   │   │   ├── variables.tf
│   │   │   └── outputs.tf
│   │   ├── event/
│   │   │   ├── main.tf
│   │   │   ├── variables.tf
│   │   │   └── outputs.tf
│   │   ├── data-processing/
│   │   │   ├── main.tf
│   │   │   ├── variables.tf
│   │   │   └── outputs.tf
│   │   ├── api/
│   │   │   ├── main.tf
│   │   │   ├── variables.tf
│   │   │   └── outputs.tf
│   │   └── notification/
│   │       ├── main.tf
│   │       ├── variables.tf
│   │       └── outputs.tf
│   ├── environments/
│   │   ├── dev/
│   │   │   ├── main.tf
│   │   │   ├── variables.tf
│   │   │   └── terraform.tfvars
│   │   └── prod/
│   │       ├── main.tf
│   │       ├── variables.tf
│   │       └── terraform.tfvars
│   └── backend.tf
├── lambdas/
│   ├── etl/
│   │   ├── handler.py
│   │   └── requirements.txt
│   ├── inference/
│   │   ├── handler.py
│   │   └── requirements.txt
│   ├── alert/
│   │   ├── handler.py
│   │   └── requirements.txt
│   ├── llm/
│   │   ├── handler.py
│   │   └── requirements.txt
│   └── report/
│       ├── handler.py
│       └── requirements.txt
├── frontend/                        ← Framework TBD (靜態編譯)
│   ├── src/
│   ├── public/
│   └── package.json
├── data/
│   ├── raw/
│   │   ├── vt_fd.csv               ← 航行正午報告原始資料
│   │   └── maintenance.csv         ← 養護事件記錄
│   └── processed/
├── config/
│   └── thresholds.json
├── tests/
└── README.md
```

---

## 11. 開放議題 (Open Questions)

| # | 議題 | 狀態 |
|---|------|------|
| Q1 | Speed Loss baseline 定義方式（清潔後 30 天平均 vs 歷史 top 10%） | 待決 |
| Q2 | ML 模型架構（全域 vs 每船獨立） | 待決 |
| Q3 | 前端框架選型（Next.js / Vite+React / Vue） | Placeholder |
| Q4 | LLM 上下文資料來源（航線排程、靠泊時間窗口）如何輸入 | 待確認 |
| Q5 | 告警閾值是否可由前端動態調整（寫回 config/thresholds.json） | 待決 |
| Q6 | Terraform state backend bucket 是否需要獨立建立 | 待決 |
