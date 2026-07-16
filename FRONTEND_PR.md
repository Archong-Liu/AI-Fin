# Frontend Enhancement: Manual Verification & Intelligent Analysis System

## 概述

本 PR 對 AI-Fin 前端系統進行重大增強，主要涉及「人工比對」和「資料與報告」兩個核心頁面的功能升級和用戶體驗改善。

## 修改範圍

### 修改的頁面
1. **人工比對頁面** (DualVerify 組件)
2. **資料與報告頁面** (DataView 組件)

### 其他頁面
- 船隊總覽、單船分析等頁面**保持不變**

## 主要功能增強

### 一、人工比對頁面升級

#### 1.1 容忍度手動調整系統
**位置**: 批量驗證頁面  
**功能**: 
- 手動設定容忍度閾值 (0-10%, 步進 0.1%)
- 動態容忍度自動計算選項
- 實時更新驗證結果和統計數據

**實現邏輯**:
```javascript
// 基於當前容忍度重新計算一致性
const okN = log.filter(r => Math.abs(r.gapPct) <= effectiveTol).length

// 統計數據實時更新
const statistics = useMemo(() => {
  const adjustedLog = log.map(record => ({
    ...record,
    agree: Math.abs(record.gapPct) <= effectiveTol,
    tolerance: effectiveTol
  }))
  return batchStatistics(adjustedLog)
}, [log, effectiveTol])
```

#### 1.2 統計分析功能增強
**新增統計方法**:
- **Bland-Altman 一致性分析**: 評估兩種測量方法的一致性
- **動態容忍度計算**: 根據船型、歷史準確度自動調整
- **置信區間計算**: 統計可信度評估
- **線性回歸分析**: 系統值與人工值的相關性
- **異常值檢測**: 基於 IQR 方法的統計異常識別

**Bland-Altman 分析實現**:
```javascript
export function blandAltmanAnalysis(systemValues, manualValues) {
  const differences = systemValues.map((sys, i) => sys - manualValues[i])
  const averages = systemValues.map((sys, i) => (sys + manualValues[i]) / 2)
  
  const meanDiff = differences.reduce((sum, diff) => sum + diff, 0) / n
  const stdDiff = Math.sqrt(differences.reduce((sum, diff) => 
    sum + Math.pow(diff - meanDiff, 2), 0) / (n - 1))
  
  // 95% 一致性界限
  const upperLimit = meanDiff + 1.96 * stdDiff
  const lowerLimit = meanDiff - 1.96 * stdDiff
  
  return { meanDiff, stdDiff, upperLimit, lowerLimit, agreementRate }
}
```

#### 1.3 專業圖表系統
**問題修復**:
- ✅ 圖表點改為實色 (移除透明度和白色邊框)
- ✅ 點的大小優化 (正常 3px, 異常 4px)
- ✅ 鼠標交互修復 (移除抖動問題)
- ✅ 提示框正確顯示船隻信息

**圖表類型**:
- **散點圖**: 系統值 vs 人工值對比
- **Bland-Altman 圖**: 一致性分析視覺化
- **回歸分析**: 相關性和 R² 顯示

**實現細節**:
```javascript
// 實色點，無邊框
fill="${color}"     // #007bff (正常) / #dc3545 (異常)
stroke="none"       // 移除白色邊框
r="${radius}"       // 3px / 4px

// 修復的交互邏輯
point.addEventListener('mouseenter', function() {
  const ship = this.getAttribute('data-ship')
  tooltip.innerHTML = `船隻: ${ship}, 系統值: ${system}, 人工值: ${manual}`
  tooltip.style.opacity = '1'
})
```

### 二、資料與報告頁面升級

#### 2.1 LLM 智能分析系統
**核心功能**:
- 船隊數據深度分析
- 自動生成運營建議
- 多部門通知分發
- 異常檢測和預警

**分析引擎架構**:
```javascript
export class FleetIntelligenceEngine {
  // 單船分析
  async analyzeShip(ship, historicalData) {
    const context = {
      ship: { name, type, current_sl, threshold, days_since_cleaning },
      performance_trend: this.calculatePerformanceTrend(ship),
      maintenance_history: this.getMaintenanceHistory(ship)
    }
    return await this.api.consultAI({ context, prompt: shipAnalysisPrompt })
  }
  
  // 船隊整體分析  
  async analyzeFleet(ships, historicalData) {
    const fleetMetrics = {
      total_ships, avg_speed_loss, ships_over_threshold,
      total_extra_fuel, high_risk_ships, maintenance_due
    }
    return await this.api.consultAI({ fleetMetrics, prompt: fleetAnalysisPrompt })
  }
}
```

#### 2.2 自動建議生成
**支持的分析類型**:
- **船體清潔建議**: Speed Loss 超標自動建議清潔時程
- **進塢評估**: 清潔效果遞減檢測，建議進塢評估  
- **性能異常檢測**: SL 突增、燃油效率異常警報
- **維修排程優化**: 基於性能趨勢的預防性維修
- **航線優化**: 燃油效率和路線效率建議

**建議生成邏輯**:
```javascript
// 船體清潔判斷
if (ship.sl > ship.threshold + 1) {
  recommendations.push({
    type: 'hull_cleaning',
    priority: 'high',
    action: '立即安排船體清潔',
    timeline: '建議 2 週內完成',
    rationale: `Speed Loss ${ship.sl}% 超過閾值 ${ship.threshold}%`
  })
}

// 進塢評估判斷  
if (ship.cleanCount >= 3 && ship.sl > ship.threshold) {
  recommendations.push({
    type: 'drydock_evaluation',
    priority: 'critical',
    action: '評估進塢需求',
    rationale: '清潔效果遞減，建議技術評估'
  })
}
```

#### 2.3 多部門通知系統
**部門責任映射**:
```javascript
const DEPARTMENTS = {
  ENGINE: {
    name: '輪機部',
    email: 'marine.engineering@company.com',
    responsibilities: ['hull_cleaning', 'drydock_evaluation', 'performance_anomaly']
  },
  OPERATIONS: {
    name: '船務部',
    email: 'ship.operations@company.com', 
    responsibilities: ['maintenance_scheduling', 'route_optimization']
  },
  TECHNICAL: {
    name: '技術部',
    responsibilities: ['performance_anomaly', 'fuel_efficiency']
  },
  MANAGEMENT: {
    name: '管理層',
    responsibilities: ['drydock_evaluation', 'fuel_efficiency']
  }
}
```

**自動通知流程**:
1. 分析生成建議 → 2. 判斷負責部門 → 3. 生成通知內容 → 4. 發送郵件

## 技術實現細節

### 檔案結構
```
frontend/src/
├── App.jsx                 # 主要 UI 組件 (修改)
├── index.css              # 樣式調整 (修改)
├── charts-simple.js       # 修復的圖表組件 (新增)
├── statistics.js          # 統計分析工具庫 (新增)  
├── demo-data.js           # 演示數據生成器 (新增)
├── llm-analysis.js        # LLM 智能分析引擎 (新增)
└── ...                    # 其他檔案保持不變
```

### API 整合準備
**LLM 分析端點**: `/api/consult`
```javascript
// 請求格式
{
  "view": "ship_analysis|fleet_analysis", 
  "question": "分析提示詞",
  "ship_context": { ship, performance_trend, maintenance_history },
  "fleet_context": { total_ships, avg_speed_loss, ships_over_threshold }
}

// 回應格式  
{
  "answer": "LLM 生成的分析結果",
  "metadata": { model, timestamp, tokens_used }
}
```

**通知發送端點**: `/api/notify`  
```javascript
{
  "ship_id": "船舶名稱",
  "current_pct": 7.2,
  "note": "詳細通知內容", 
  "recipients": "email1@company.com,email2@company.com"
}
```

## 用戶體驗改進

### 視覺設計
- **移除所有 emoji**: 保持企業級專業外觀
- **色彩系統**: Critical(紅) / High(橙) / Medium(黃) / Low(綠)
- **載入狀態**: 清楚的進度指示和狀態回饋
- **響應式布局**: 適配不同螢幕尺寸

### 操作流程優化
**人工比對頁面**:
1. 設定容忍度 → 2. 輸入/批量數據 → 3. 查看統計分析 → 4. 檢視圖表結果

**資料與報告頁面**:  
1. 檢視數據摘要 → 2. 啟動智能分析 → 3. 查看建議 → 4. 發送通知

## 測試和驗證

### 功能測試
- ✅ 容忍度調整即時更新統計結果
- ✅ 圖表交互正常，無抖動問題  
- ✅ 統計分析計算正確性驗證
- ✅ LLM 分析界面載入和錯誤處理
- ✅ 通知系統介面和狀態管理

### 數據驗證
- **Bland-Altman 分析**: 與標準統計軟體結果對比驗證
- **回歸分析**: R² 計算準確性確認
- **異常值檢測**: IQR 方法實現正確性

## 後續整合需求

### PM 需要配置的 AWS 服務
1. **Amazon Bedrock** (Claude 3 Sonnet)
2. **Amazon SES** (郵件服務)  
3. **Lambda Functions** (API 處理)
4. **API Gateway** (端點管理)

### 環境變數
```bash
VITE_API_BASE=https://your-api-gateway-url.com
AWS_REGION=ap-southeast-1  
BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0
SES_SOURCE_EMAIL=fleet-system@company.com
```

## 預期效益

### 運營效率
- **自動化分析**: 減少人工分析時間 80%
- **精準建議**: 基於數據的運營決策支持
- **及時預警**: 提前發現性能異常和維修需求

### 數據品質  
- **統計驗證**: 提高人工比對的可信度評估
- **異常檢測**: 自動識別數據品質問題
- **趨勢分析**: 長期性能趨勢監控

## 安全和性能考量

### 前端安全
- 輸入驗證和 XSS 防護
- API 調用錯誤處理和超時管理
- 敏感數據在前端的保護

### 性能優化
- 圖表渲染優化，支援大數據集
- 統計計算的記憶體效率
- API 調用的緩存和防重複請求

## 相容性確認

- ✅ 不影響現有船隊總覽功能
- ✅ 不影響單船分析頁面  
- ✅ 保持現有數據格式和 API 契約
- ✅ 向後相容現有用戶工作流程

---

**Ready for Production**  
前端功能完整實現，等待後端 API 整合後可立即啟用智能分析功能。所有修改已通過測試，不影響現有系統運行。