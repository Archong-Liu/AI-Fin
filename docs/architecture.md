# YMINSIGHT — Cloud Architecture

> **Version:** 0.3.0  
> **Last Updated:** 2026-07-14  
> **Status:** Design Phase

---

## 1. System Overview

YMINSIGHT 是陽明海運船隊的智慧效能監控與排程協調系統。  
以 **Event-Driven Serverless** 為核心，自動處理船舶正午報告、計算 Speed Loss、觸發 LLM 決策建議與跨部門告警。

```
┌─────────────────────────────────────────────────────────────┐
│                     Design Principles                        │
├──────────────┬──────────────────────────────────────────────┤
│ Event-Driven │ 資料上傳即觸發，無需人工介入                    │
│ Serverless   │ Lambda 為核心計算，按需付費                    │
│ Modular IaC  │ Terraform modules 拆分，獨立部署               │
│ Static-First │ 前端靜態編譯 → S3 + CloudFront 分發           │
│ Decoupled    │ 團隊間以 S3 路徑 + JSON schema 解耦           │
└──────────────┴──────────────────────────────────────────────┘
```

---

## 2. Architecture Diagram

```
                            ┌──────────────────┐
                            │   User / Ops     │
                            └────────┬─────────┘
                                     │ Upload CSV
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            DATA STORE LAYER                                  │
│                                                                             │
│   ┌─────────────────────┐         ┌─────────────────────────────────┐      │
│   │  S3: raw-data       │         │  S3: processed-data             │      │
│   │  └─ noon-reports/   │         │  ├─ csv/                        │      │
│   │     └─ *.csv        │         │  └─ results-json/               │      │
│   └──────────┬──────────┘         │     ├─ fleet-summary.json       │      │
│              │                    │     ├─ {ship_id}/latest.json    │      │
│              │                    │     ├─ {ship_id}/history.json   │      │
│              │                    │     └─ alerts/active.json       │      │
│              │                    └──────────────┬──────────────────┘      │
│              │                                   │                          │
│   ┌──────────┼───────────────────────────────────┼────────────────┐        │
│   │  S3: frontend (static build)                 │                │        │
│   └──────────────────────┬───────────────────────┘                │        │
│                          │                                        │        │
│                          ▼                                        │        │
│                   CloudFront (*.cloudfront.net)                    │        │
│                   HTTPS / OAI / Edge Cache                        │        │
│                                                                   │        │
└───────────────────────────────────────────────────────────────────┼────────┘
                                                                    │
┌───────────────────────────────────────────────────────────────────┼────────┐
│                            EVENT LAYER                             │        │
│                                                                    │        │
│   S3 PUT Event (prefix: noon-reports/, suffix: .csv)              │        │
│       │                                                            │        │
│       ▼                                                            │        │
│   Trigger → Lambda:ML_Pipeline                                    │        │
│                                                                    │        │
│   S3 PUT Event (prefix: results-json/alerts/)                     │        │
│       │                                                            │        │
│       ▼                                                            │        │
│   Trigger → Lambda:Alert                                          │        │
│                                                                    │        │
└───────────────────────────────────────────────────────────────────┼────────┘
                                                                    │
┌───────────────────────────────────────────────────────────────────┼────────┐
│                       DATA PROCESSING LAYER                        │        │
│                                                                    │        │
│   ┌─────────────────────────────────┐                             │        │
│   │  Lambda: ML Pipeline            │ ← ML 小組撰寫               │        │
│   │  (ETL + Feature Eng + Inference)│                             │        │
│   │                                 │                             │        │
│   │  Input:  s3://raw-data/         │                             │        │
│   │  Output: s3://processed-data/   │                             │        │
│   └─────────────────────────────────┘                             │        │
│                                                                    │        │
│   ┌─────────────────────────────────┐                             │        │
│   │  Lambda: Alert Monitor          │ ← Cloud 小組撰寫            │        │
│   │  (Threshold check + LLM + SNS) │                             │        │
│   │                                 │                             │        │
│   │  Input:  s3://processed-data/   │                             │        │
│   │          results-json/alerts/   │                             │        │
│   │  Output: Bedrock → SNS          │                             │        │
│   └─────────────────────────────────┘                             │        │
│                                                                    │        │
│   ┌─────────────────────────────────┐                             │        │
│   │  Lambda Layer: common-deps      │                             │        │
│   │  (pandas, numpy)               │                             │        │
│   └─────────────────────────────────┘                             │        │
│                                                                    │        │
└────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────┐
│                            API LAYER                                        │
│                                                                            │
│   API Gateway (REST)                                                       │
│   ┌──────────────────────────────────────────────────────────────┐         │
│   │  POST /api/recommend      → Lambda:LLM → Bedrock Claude     │         │
│   │  POST /api/report/generate → Lambda:Report → S3 (reports)   │         │
│   │  POST /api/alert/acknowledge → Lambda:Alert                  │         │
│   └──────────────────────────────────────────────────────────────┘         │
│                                                                            │
│   ┌──────────────────────────┐    ┌─────────────────────┐                 │
│   │  Lambda: LLM Handler     │    │  Lambda: Report Gen │                 │
│   │  → Bedrock InvokeModel   │    │  → S3 read + write  │                 │
│   └──────────────────────────┘    └─────────────────────┘                 │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────┐
│                        NOTIFICATION LAYER                                   │
│                                                                            │
│   ┌──────────────────────────────────────────────────────┐                 │
│   │  SNS Topic: yminsight-alert-critical (≥12%)          │                 │
│   │  SNS Topic: yminsight-alert-warning  (8%~12%)        │                 │
│   │                                                      │                 │
│   │  Subscriptions:                                      │                 │
│   │    → Email (工務部門 / 航線規劃部門)                   │                 │
│   │    → Webhook (Slack / Teams)                         │                 │
│   └──────────────────────────────────────────────────────┘                 │
│                                                                            │
│   ┌──────────────────────────────────────────────────────┐                 │
│   │  Amazon Bedrock (Claude)                             │                 │
│   │  → Alert Lambda 呼叫，生成排程建議摘要               │                 │
│   │  → LLM Lambda 呼叫，生成完整跨部門建議               │                 │
│   └──────────────────────────────────────────────────────┘                 │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Terraform Module Design

```
infrastructure/
├── modules/
│   ├── data-store/          # S3 buckets + CloudFront + Lifecycle
│   ├── event/               # S3 Event Notification + EventBridge
│   ├── data-processing/     # Lambda (ML Pipeline, Alert) + Layer
│   ├── api/                 # API Gateway + Lambda (LLM, Report)
│   └── notification/        # SNS Topics + Subscriptions
├── environments/
│   ├── dev/main.tf
│   └── prod/main.tf
└── backend.tf               # S3 state + DynamoDB lock
```

### Module Dependencies & Deploy Order

```
data-store
    │
    ├── outputs: bucket_arns, bucket_names, cloudfront_domain
    ▼
event
    │
    ├── inputs: raw_bucket_arn
    ├── outputs: (event config applied to bucket)
    ▼
data-processing
    │
    ├── inputs: raw_bucket, processed_bucket, sns_topic_arns
    ├── outputs: lambda_arns
    ▼
notification
    │
    ├── inputs: (standalone, alert_lambda references it)
    ├── outputs: sns_topic_arns
    ▼
api
    │
    ├── inputs: processed_bucket, reports_bucket, bedrock_model_id
    └── outputs: api_gateway_url
```

### Module Resources

| Module | Resources |
|--------|-----------|
| **data-store** | S3 × 4 (raw, processed, frontend, reports), CloudFront Distribution, OAI, Lifecycle Rules, Bucket Policies, CORS config |
| **event** | S3 Event Notification (PUT trigger), Lambda permission for S3 invoke |
| **data-processing** | Lambda: ML_Pipeline, Lambda: Alert, Lambda Layer (common-deps), CloudWatch Log Groups |
| **api** | API Gateway (REST), Lambda: LLM Handler, Lambda: Report Generator, API Stage (dev/prod) |
| **notification** | SNS Topic × 2 (critical, warning), SNS Subscriptions (Email, Webhook) |

---

## 4. Data Flow

### 4.1 Event-Driven Pipeline (被動)

```
[CSV Upload]
     │
     ▼
S3: raw-data/noon-reports/*.csv
     │
     │ S3 PUT Event
     ▼
Lambda: ML_Pipeline (ML 小組)
     │
     ├─→ S3: processed-data/csv/{ship_id}/
     │       (清洗後 tabular data)
     │
     └─→ S3: processed-data/results-json/
             ├─ fleet-summary.json
             ├─ {ship_id}/latest.json
             ├─ {ship_id}/history.json
             └─ alerts/active.json
                    │
                    │ S3 PUT Event (alerts/active.json updated)
                    ▼
              Lambda: Alert (Cloud 小組)
                    │
                    ├─ speed_loss < 8%  → no action
                    ├─ 8% ≤ sl < 12%   → SNS:warning
                    └─ sl ≥ 12%        → Bedrock → SNS:critical
```

### 4.2 Static Data Serving (Dashboard 讀取)

```
S3: processed-data/results-json/
     │
     │ (CloudFront cache)
     ▼
Frontend (*.cloudfront.net)
     │
     └─ fetch('/results-json/fleet-summary.json')
     └─ fetch('/results-json/S1/history.json')
```

無需 API call，前端直讀 CloudFront 分發的靜態 JSON。

### 4.3 User-Triggered Operations (主動)

```
Frontend
     │
     │ POST /api/recommend {ship_id, context}
     ▼
API Gateway → Lambda:LLM → Bedrock Claude
                              │
                              └─→ Response JSON (排程建議)

Frontend
     │
     │ POST /api/report/generate {ship_id, date_range}
     ▼
API Gateway → Lambda:Report → S3:reports/
                              │
                              └─→ Response {report_url}
```

---

## 5. Data Format

| Stage | Format | Reason |
|-------|--------|--------|
| Raw input | CSV | 正午報告原始格式 |
| Processed (tabular) | CSV | 規模小、debug 方便、無需額外 dependency |
| Dashboard consumption | JSON | 前端直接 fetch、支援巢狀結構 |
| Report output | JSON | 結構化，可被前端渲染 |

---

## 6. Frontend Deployment

```
Static Build (framework TBD)
     │
     ▼
S3: yminsight-frontend/
     │
     ▼
CloudFront Distribution
  • URL: d1234abcd.cloudfront.net (AWS 自動分配，無需自有域名)
  • HTTPS: AWS default certificate
  • Access: OAI restricts S3 direct access
  • CORS: API Gateway allows *.cloudfront.net origin
```

---

## 7. AWS Service Inventory

| Category | Service | Usage | Module |
|----------|---------|-------|--------|
| Storage | S3 (×4) | raw / processed / frontend / reports | data-store |
| CDN | CloudFront | Static frontend + JSON delivery | data-store |
| Compute | Lambda (×4) | ML_Pipeline, Alert, LLM, Report | data-processing, api |
| Compute | Lambda Layer | pandas, numpy shared deps | data-processing |
| Event | S3 Event Notification | Trigger ML pipeline + Alert | event |
| API | API Gateway (REST) | Frontend interaction endpoints | api |
| GenAI | Amazon Bedrock (Claude) | Decision recommendation | api, data-processing |
| Notification | SNS (×2 topics) | Email + Webhook alerts | notification |
| Monitoring | CloudWatch | Lambda logs + metrics | all |

---

## 8. Security

> IAM Role / Policy 細節待實作階段定義。

### Data Classification

| Level | Data | Protection |
|-------|------|-----------|
| Confidential | Raw voyage data | S3 SSE-S3 encryption |
| Internal | Processed CSV/JSON, Speed Loss results | S3 SSE-S3, CloudFront OAI access only |
| Public | Frontend static assets | CloudFront distribution |

### Access Control Principles

- 每支 Lambda 獨立 IAM Role，僅授予所需 S3/SNS/Bedrock 權限
- S3 bucket 不開放 public access（透過 OAI 或 pre-signed URL）
- API Gateway 端點未來可加 Cognito 認證（MVP 暫略）

---

## 9. Deployment

### Terraform Workflow

```bash
cd infrastructure/environments/dev
terraform init
terraform apply
```

### Environment Isolation

| Env | Purpose | State Backend |
|-----|---------|---------------|
| dev | Development & testing | s3://yminsight-tfstate/dev/ |
| prod | Production | s3://yminsight-tfstate/prod/ |

### Deploy Pipeline (future)

```
git push
  → GitHub Actions
    → terraform plan / apply
    → Lambda zip → S3
    → Frontend build → S3 → CloudFront invalidation
```

---

## 10. Project Structure

```
aifin/
├── docs/
│   ├── architecture.md             ← 本文件 (Cloud Architecture)
│   ├── feature-spec.md             ← Feature 規格
│   └── team-interface.md           ← 團隊分工與介面合約
├── infrastructure/
│   ├── modules/
│   │   ├── data-store/
│   │   ├── event/
│   │   ├── data-processing/
│   │   ├── api/
│   │   └── notification/
│   └── environments/
│       ├── dev/
│       └── prod/
├── lambdas/
│   ├── etl/                        ← ML 小組（清洗 + 推論）
│   ├── alert/                      ← Cloud 小組（閾值 + 告警）
│   ├── llm/                        ← Cloud 小組（Bedrock 呼叫）
│   └── report/                     ← Cloud 小組（報表生成）
├── frontend/                       ← Dashboard 小組（框架 TBD）
├── data/
│   ├── raw/                        ← vt_fd.csv, maintenance.csv
│   └── processed/
├── config/
│   └── thresholds.json
└── tests/
```

---

## 11. Open Questions

| # | Question | Status |
|---|----------|--------|
| Q1 | Speed Loss baseline 定義方式 | Pending (ML 小組) |
| Q2 | ML 模型架構（全域 vs 每船） | Pending (ML 小組) |
| Q3 | 前端框架選型 | Placeholder |
| Q4 | LLM 上下文中航線/靠泊資料來源 | Pending |
| Q5 | ML pipeline 拆分方式（一支 or 兩支 Lambda） | Pending (ML 小組) |
| Q6 | Terraform state backend 建立方式 | Pending |
