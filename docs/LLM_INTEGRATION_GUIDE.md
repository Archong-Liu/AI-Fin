# AI-Fin LLM 整合指南

## 概述

AI-Fin 系統整合了 LLM (Large Language Model) 智能分析功能，用於：
- 船隊數據深度分析
- 自動生成運營建議
- 多部門通知分發
- 異常檢測和預警

## 功能架構

### 前端組件
```
src/llm-analysis.js          # 核心分析引擎
src/App.jsx (DataView)       # UI 界面
src/api.js                   # API 整合層
```

### 後端 API 需求
```
/api/consult                 # LLM 諮詢端點
/api/notify                  # 通知發送端點
```

## API 規格

### 1. LLM 諮詢 API (`/api/consult`)

**請求格式:**
```json
{
  "view": "ship_analysis|fleet_analysis|data",
  "question": "分析提示詞",
  "ship_context": {
    "ship": {
      "id": "船舶ID",
      "name": "船舶名稱",
      "type": "船型",
      "current_sl": 7.2,
      "threshold": 6.0,
      "days_since_cleaning": 45,
      "clean_count": 2,
      "penalty_fuel": 3.5
    },
    "performance_trend": "性能趨勢描述",
    "maintenance_history": "維修歷史",
    "fuel_efficiency_trend": "燃油效率趨勢"
  },
  "fleet_context": {
    "ships": {
      "total_ships": 15,
      "avg_speed_loss": 5.8,
      "ships_over_threshold": 3,
      "total_extra_fuel": 12.5,
      "high_risk_ships": 1,
      "maintenance_due": 2
    }
  },
  "want_detailed": true
}
```

**回應格式:**
```json
{
  "answer": "LLM 生成的分析結果",
  "metadata": {
    "model": "使用的模型",
    "timestamp": "2024-12-16T10:30:00Z",
    "tokens_used": 1500
  }
}
```

### 2. 通知發送 API (`/api/notify`)

**請求格式:**
```json
{
  "ship_id": "船舶名稱",
  "current_pct": 7.2,
  "days_since_hull": 45,
  "note": "詳細通知內容",
  "recipients": "email1@company.com,email2@company.com"
}
```

**回應格式:**
```json
{
  "sent": true,
  "message_id": "ses-message-id",
  "timestamp": "2024-12-16T10:30:00Z"
}
```

## AWS 整合建議

### 1. Amazon Bedrock 整合

**推薦模型:**
- Claude 3 Sonnet (平衡性能和成本)
- Claude 3.5 Sonnet (最高性能)

**Lambda 函數範例:**
```python
import boto3
import json

def lambda_handler(event, context):
    bedrock = boto3.client('bedrock-runtime')
    
    # 解析請求
    body = json.loads(event['body'])
    
    # 構建 prompt
    prompt = build_analysis_prompt(body)
    
    # 調用 Bedrock
    response = bedrock.invoke_model(
        modelId='anthropic.claude-3-sonnet-20240229-v1:0',
        body=json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 4000,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.1
        })
    )
    
    # 處理回應
    result = json.loads(response['body'].read())
    
    return {
        'statusCode': 200,
        'headers': {'Content-Type': 'application/json'},
        'body': json.dumps({
            'answer': result['content'][0]['text'],
            'metadata': {
                'model': 'claude-3-sonnet',
                'timestamp': datetime.utcnow().isoformat(),
                'tokens_used': result.get('usage', {}).get('output_tokens', 0)
            }
        })
    }
```

### 2. Amazon SES 整合

**通知發送範例:**
```python
import boto3

def send_notification(recipients, subject, content):
    ses = boto3.client('ses')
    
    return ses.send_email(
        Source='fleet-system@company.com',
        Destination={'ToAddresses': recipients.split(',')},
        Message={
            'Subject': {'Data': subject},
            'Body': {'Text': {'Data': content}}
        }
    )
```

## 部門通知配置

### 部門責任映射
```json
{
  "DEPARTMENTS": {
    "ENGINE": {
      "name": "輪機部",
      "email": "marine.engineering@company.com",
      "responsibilities": ["hull_cleaning", "drydock_evaluation", "performance_anomaly"]
    },
    "OPERATIONS": {
      "name": "船務部",
      "email": "ship.operations@company.com", 
      "responsibilities": ["maintenance_scheduling", "route_optimization"]
    },
    "TECHNICAL": {
      "name": "技術部",
      "email": "technical@company.com",
      "responsibilities": ["performance_anomaly", "fuel_efficiency"]
    },
    "MANAGEMENT": {
      "name": "管理層",
      "email": "fleet.management@company.com",
      "responsibilities": ["drydock_evaluation", "fuel_efficiency"]
    }
  }
}
```

## Prompt 模板

### 船舶分析 Prompt
```
作為船隊管理專家，請分析以下船舶數據並提供運營建議：

船舶資訊：
- 船名：{ship_name}
- 船型：{ship_type}
- 當前 Speed Loss：{current_sl}%
- 警戒線：{threshold}%
- 距上次清潔：{days_since_cleaning} 天
- 清潔次數：{clean_count} 次
- 額外燃油消耗：{penalty_fuel} t/day

請基於以下標準提供建議：

1. **船體清潔建議**：
   - Speed Loss > 閾值 + 1%：建議立即安排清潔
   - Speed Loss > 閾值：建議在下個港口清潔
   - 清潔次數 ≥ 3：考慮進塢檢修

2. **進塢評估**：
   - 清潔效果遞減
   - 船齡 > 15年 且 SL 持續惡化
   - 距上次進塢 > 5年

3. **異常檢測**：
   - SL 突然增加 > 2%/月
   - 燃油效率異常波動

請以 JSON 格式回應，包含：urgency, recommendations, analysis_summary, risk_assessment
```

### 船隊分析 Prompt
```
作為船隊運營總監，請分析整體船隊狀況：

船隊概況：
- 總船數：{total_ships}
- 平均 Speed Loss：{avg_speed_loss}%
- 超標船數：{ships_over_threshold}
- 總額外燃油：{total_extra_fuel} t/day
- 高風險船舶：{high_risk_ships}

請提供：
1. 船隊整體健康評估
2. 優先處理順序  
3. 資源分配建議
4. 成本效益分析
5. 風險管控策略
```

## 環境變數配置

```bash
# AWS 配置
AWS_REGION=ap-southeast-1
BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0

# API 配置  
VITE_API_BASE=https://your-api-gateway-url.com
API_TIMEOUT_MS=30000

# 通知配置
SES_SOURCE_EMAIL=fleet-system@company.com
NOTIFICATION_TEMPLATE_BUCKET=your-template-bucket
```

## 成本估算

### Bedrock 成本 (Claude 3 Sonnet)
- 輸入: $3.00 / 1M tokens
- 輸出: $15.00 / 1M tokens
- 每次分析約 2000 tokens (輸入) + 1000 tokens (輸出)
- 估算成本: $0.021 / 次分析

### SES 成本
- $0.10 / 1000 封郵件
- 每次分析可能發送 1-5 封通知
- 估算成本: $0.0005 / 次分析

## 安全考量

1. **API 認證**: 使用 AWS IAM 或 API Gateway 認證
2. **資料隱私**: 避免在 prompt 中包含敏感個人資訊
3. **輸出過濾**: 對 LLM 輸出進行安全檢查
4. **存取控制**: 限制不同部門的資料存取權限

## 測試指南

### 單元測試
```javascript
// 測試分析引擎
describe('FleetIntelligenceEngine', () => {
  it('應該生成船舶清潔建議', async () => {
    const ship = { name: 'TEST_SHIP', sl: 8.0, thr: 6.0 }
    const analysis = await engine.analyzeShip(ship, [])
    expect(analysis.recommendations).toContainEqual(
      expect.objectContaining({ type: 'hull_cleaning' })
    )
  })
})
```

### 整合測試
```bash
# 測試 LLM API
curl -X POST https://api-url/api/consult \
  -H "Content-Type: application/json" \
  -d '{"view":"ship_analysis","question":"test"}'

# 測試通知 API  
curl -X POST https://api-url/api/notify \
  -H "Content-Type: application/json" \
  -d '{"ship_id":"TEST_SHIP","current_pct":8.0}'
```

## 部署檢查清單

- [ ] Bedrock 模型權限配置
- [ ] SES 發送域名驗證  
- [ ] Lambda 函數部署
- [ ] API Gateway 設定
- [ ] 環境變數配置
- [ ] 部門郵件清單更新
- [ ] 測試端到端流程
- [ ] 監控和日誌設定

## 故障排除

### 常見問題
1. **LLM 回應格式錯誤**: 檢查 prompt 模板和輸出解析邏輯
2. **通知發送失敗**: 確認 SES 權限和收件人驗證
3. **API 逾時**: 調整 Lambda 逾時設定或優化 prompt 長度
4. **成本超預算**: 實施請求限制和緩存機制

### 監控指標
- API 調用次數和成功率
- LLM token 使用量
- 通知發送成功率
- 分析準確性回饋

## 未來擴展

1. **多語言支援**: 中英文報告切換
2. **自定義 Prompt**: 讓用戶配置分析邏輯
3. **歷史分析**: 趨勢預測和模式識別  
4. **整合更多數據源**: 天氣、市場、港口數據
5. **工作流自動化**: 與企業系統整合

## 聯絡資訊

技術支援: tech-support@company.com  
文檔更新: 2024-12-16  
版本: v1.0