# YMINSIGHT — 智慧船舶效能監控與跨部門排程協調系統

> AWS 百工百業瘋 AI 黑客松提案專案

## Overview

YMINSIGHT 是一套針對陽明海運船隊的智慧效能監控系統，透過事件驅動架構自動處理船舶正午報告、計算 ISO 19030 Speed Loss，並結合 LLM 產出跨部門決策建議與告警通知。

## Architecture

- **Event-Driven**：CSV 上傳至 S3 即觸發自動化 ETL pipeline
- **Serverless**：Lambda 為核心計算單元
- **Modular IaC**：Terraform modules 拆分（data-store / event / data-processing / api / notification）
- **Static Frontend**：編譯為靜態檔案，部署至 S3 + CloudFront（`*.cloudfront.net`）

## Features

| Priority | Feature | Description |
|----------|---------|-------------|
| P0 | Event-Driven ETL | 自動清洗 + 過濾（風力≤4、全速≥22h） |
| P0 | Speed Loss Calc | ISO 19030 框架計算 Speed Loss % |
| P0 | Fleet Dashboard Data | 靜態 JSON 供前端渲染 |
| P0 | LLM Recommendation | Bedrock Claude 產出跨部門排程建議 |
| P0 | SNS Alert | Speed Loss 超閾值自動告警推播 |
| P1 | Maintenance Timeline | 養護事件時序 + V 型回升視覺化 |
| P1 | Fouling Attribution | Hull vs Propeller 歸因分析 |
| P1 | Multi-level Alert | 8% 預警 / 12% 告警 |
| P1 | Report Generation | 資料彙整 + LLM 分析報表 |

## Project Structure

```
aifin/
├── docs/                    # 系統設計文件
│   ├── architecture.md      # 架構設計
│   └── feature-spec.md      # Feature 規格
├── infrastructure/          # Terraform IaC (modules)
│   ├── modules/
│   │   ├── data-store/
│   │   ├── event/
│   │   ├── data-processing/
│   │   ├── api/
│   │   └── notification/
│   └── environments/
├── lambdas/                 # Lambda function source
│   ├── etl/
│   ├── inference/
│   ├── alert/
│   ├── llm/
│   └── report/
├── frontend/                # Static frontend (TBD)
├── data/
│   ├── raw/                 # 原始 CSV 資料
│   └── processed/           # 處理後資料（local dev）
├── config/                  # 設定檔
└── tests/
```

## Data

- `data/raw/vt_fd.csv` — 15 艘船航行正午報告（21,282 筆）
- `data/raw/maintenance.csv` — 養護事件記錄（77 筆，涵蓋 DD/UWI/UWC/PP）

## Tech Stack

| Layer | Service |
|-------|---------|
| Storage | Amazon S3 |
| CDN | CloudFront |
| Compute | AWS Lambda |
| Event | S3 Event Notification |
| API | API Gateway (REST) |
| GenAI | Amazon Bedrock (Claude) |
| Notification | Amazon SNS |
| IaC | Terraform |
| Frontend | TBD (static build) |

## Getting Started

```bash
# 查看系統架構設計
cat docs/architecture.md

# 查看 Feature 規格
cat docs/feature-spec.md
```

## License

2026 AWS Summit Hackathon
