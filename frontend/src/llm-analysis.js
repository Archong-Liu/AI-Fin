/**
 * LLM 驅動的智能分析和運營建議系統
 * 整合數據分析、異常檢測、運營建議生成和部門通知
 */

// 分析類型定義
export const ANALYSIS_TYPES = {
  HULL_CLEANING: 'hull_cleaning',
  DRYDOCK_EVALUATION: 'drydock_evaluation', 
  PERFORMANCE_ANOMALY: 'performance_anomaly',
  FUEL_EFFICIENCY: 'fuel_efficiency',
  MAINTENANCE_SCHEDULING: 'maintenance_scheduling',
  ROUTE_OPTIMIZATION: 'route_optimization'
}

// 部門聯絡資訊
export const DEPARTMENTS = {
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
    email: 'technical@company.com', 
    responsibilities: ['performance_anomaly', 'fuel_efficiency']
  },
  MANAGEMENT: {
    name: '管理層',
    email: 'fleet.management@company.com',
    responsibilities: ['drydock_evaluation', 'fuel_efficiency']
  }
}

// 智能分析引擎
export class FleetIntelligenceEngine {
  constructor(apiClient) {
    this.api = apiClient
    this.analysisHistory = []
  }

  // 主要分析入口
  async analyzeFleetData(ships, historicalData = []) {
    try {
      const analysisResults = []
      
      // 1. 單船分析
      for (const ship of ships) {
        const shipAnalysis = await this.analyzeShip(ship, historicalData)
        if (shipAnalysis.recommendations.length > 0) {
          analysisResults.push(shipAnalysis)
        }
      }
      
      // 2. 船隊整體分析
      const fleetAnalysis = await this.analyzeFleet(ships, historicalData)
      analysisResults.push(fleetAnalysis)
      
      // 3. 生成建議和通知
      const notifications = await this.generateNotifications(analysisResults)
      
      return {
        analyses: analysisResults,
        notifications,
        summary: await this.generateExecutiveSummary(analysisResults),
        timestamp: new Date().toISOString()
      }
    } catch (error) {
      console.error('Fleet analysis failed:', error)
      return { error: error.message }
    }
  }

  // 單船深度分析
  async analyzeShip(ship, historicalData) {
    const context = {
      ship: {
        id: ship.id,
        name: ship.name,
        type: ship.type,
        age: ship.age || 0,
        current_sl: ship.sl,
        threshold: ship.thr,
        days_since_cleaning: ship.daysClean,
        clean_count: ship.cleanCount,
        penalty_fuel: ship.penalty,
        last_drydock: ship.lastDrydock || 'unknown'
      },
      performance_trend: this.calculatePerformanceTrend(ship, historicalData),
      maintenance_history: this.getMaintenanceHistory(ship, historicalData),
      fuel_efficiency_trend: this.calculateFuelTrend(ship, historicalData)
    }

    const prompt = `
作為船隊管理專家，請分析以下船舶數據並提供運營建議：

船舶資訊：
- 船名：${context.ship.name}
- 船型：${context.ship.type}
- 船齡：${context.ship.age} 年
- 當前 Speed Loss：${context.ship.current_sl.toFixed(1)}%
- 警戒線：${context.ship.threshold.toFixed(1)}%
- 距上次清潔：${context.ship.days_since_cleaning} 天
- 清潔次數：${context.ship.clean_count} 次
- 額外燃油消耗：${context.ship.penalty_fuel.toFixed(1)} t/day

性能趨勢：${context.performance_trend}
維修歷史：${JSON.stringify(context.maintenance_history, null, 2)}
燃油效率趨勢：${context.fuel_efficiency_trend}

請基於以下標準提供建議：

1. **船體清潔建議**：
   - Speed Loss > 閾值 + 1%：建議立即安排清潔
   - Speed Loss > 閾值：建議在下個港口清潔
   - 清潔次數 ≥ 3：考慮進塢檢修

2. **進塢評估**：
   - 清潔效果遞減（連續清潔後 SL 仍高）
   - 船齡 > 15年 且 SL 持續惡化
   - 距上次進塢 > 5年

3. **異常檢測**：
   - SL 突然增加 > 2%/月
   - 燃油效率異常波動
   - 維修後性能未改善

請以 JSON 格式回應：
{
  "urgency": "low/medium/high/critical",
  "primary_recommendation": "具體建議",
  "analysis_summary": "分析摘要",
  "recommendations": [
    {
      "type": "hull_cleaning/drydock_evaluation/performance_anomaly/maintenance_scheduling",
      "priority": "low/medium/high/critical", 
      "action": "具體行動",
      "rationale": "建議理由",
      "timeline": "建議時程",
      "departments": ["engine/operations/technical/management"],
      "estimated_cost": "預估成本（如適用）",
      "expected_benefit": "預期效益"
    }
  ],
  "risk_assessment": "風險評估",
  "alternative_options": ["替代方案列表"]
}
`

    try {
      const response = await this.api.consultAI({
        view: 'ship_analysis',
        question: prompt,
        shipContext: context,
        wantDetailed: true
      })

      if (response?.answer) {
        // 嘗試解析 JSON 回應
        try {
          const analysis = JSON.parse(response.answer)
          return {
            ship_id: ship.id,
            ship_name: ship.name,
            ...analysis,
            raw_response: response.answer,
            analysis_time: new Date().toISOString()
          }
        } catch (parseError) {
          // 如果無法解析 JSON，提取關鍵資訊
          return this.extractRecommendations(response.answer, ship)
        }
      }
      
      return { ship_id: ship.id, recommendations: [] }
    } catch (error) {
      console.error(`Ship analysis failed for ${ship.name}:`, error)
      return { ship_id: ship.id, recommendations: [], error: error.message }
    }
  }

  // 船隊整體分析
  async analyzeFleet(ships, historicalData) {
    const fleetMetrics = {
      total_ships: ships.length,
      avg_speed_loss: ships.reduce((sum, s) => sum + s.sl, 0) / ships.length,
      ships_over_threshold: ships.filter(s => s.sl >= s.thr).length,
      total_extra_fuel: ships.reduce((sum, s) => sum + s.penalty, 0),
      high_risk_ships: ships.filter(s => s.sl > s.thr + 2).length,
      maintenance_due: ships.filter(s => s.cleanCount >= 3 && s.sl > s.thr).length
    }

    const prompt = `
作為船隊運營總監，請分析整體船隊狀況並提供策略建議：

船隊概況：
- 總船數：${fleetMetrics.total_ships}
- 平均 Speed Loss：${fleetMetrics.avg_speed_loss.toFixed(1)}%
- 超標船數：${fleetMetrics.ships_over_threshold}
- 總額外燃油：${fleetMetrics.total_extra_fuel.toFixed(1)} t/day
- 高風險船舶：${fleetMetrics.high_risk_ships}
- 需要進塢評估：${fleetMetrics.maintenance_due}

請提供：
1. 船隊整體健康評估
2. 優先處理順序
3. 資源分配建議
4. 成本效益分析
5. 風險管控策略

以 JSON 格式回應，包含 fleet_recommendations 和 strategic_insights。
`

    try {
      const response = await this.api.consultAI({
        view: 'fleet_analysis',
        question: prompt,
        fleetContext: { ships: fleetMetrics, historical: historicalData },
        wantDetailed: true
      })

      return {
        type: 'fleet_analysis',
        metrics: fleetMetrics,
        analysis: response?.answer || '分析生成失敗',
        timestamp: new Date().toISOString()
      }
    } catch (error) {
      return {
        type: 'fleet_analysis', 
        error: error.message,
        metrics: fleetMetrics
      }
    }
  }

  // 生成通知和工作指派
  async generateNotifications(analysisResults) {
    const notifications = []
    
    for (const analysis of analysisResults) {
      if (analysis.recommendations) {
        for (const rec of analysis.recommendations) {
          // 確定負責部門
          const responsibleDepts = this.getDepartmentsForRecommendation(rec.type)
          
          // 生成通知內容
          const notification = {
            id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            ship_id: analysis.ship_id,
            ship_name: analysis.ship_name,
            type: rec.type,
            priority: rec.priority,
            subject: this.generateNotificationSubject(rec, analysis.ship_name),
            content: await this.generateNotificationContent(rec, analysis),
            recipients: responsibleDepts.map(dept => DEPARTMENTS[dept]),
            action_required: rec.action,
            timeline: rec.timeline,
            created_at: new Date().toISOString(),
            status: 'pending'
          }
          
          notifications.push(notification)
        }
      }
    }
    
    return notifications
  }

  // 生成通知主旨
  generateNotificationSubject(recommendation, shipName) {
    const subjectMap = {
      [ANALYSIS_TYPES.HULL_CLEANING]: `【船體清潔】${shipName} - ${recommendation.priority.toUpperCase()} 優先級`,
      [ANALYSIS_TYPES.DRYDOCK_EVALUATION]: `【進塢評估】${shipName} - 需要技術評估`,
      [ANALYSIS_TYPES.PERFORMANCE_ANOMALY]: `【性能異常】${shipName} - 數據異常警示`,
      [ANALYSIS_TYPES.FUEL_EFFICIENCY]: `【燃油效率】${shipName} - 效率下降警告`,
      [ANALYSIS_TYPES.MAINTENANCE_SCHEDULING]: `【維修排程】${shipName} - 維修計劃調整`,
      [ANALYSIS_TYPES.ROUTE_OPTIMIZATION]: `【航線優化】${shipName} - 路線效率建議`
    }
    
    return subjectMap[recommendation.type] || `【船隊通知】${shipName} - 需要關注`
  }

  // 生成詳細通知內容
  async generateNotificationContent(recommendation, analysis) {
    const template = `
船舶：${analysis.ship_name}
優先級：${recommendation.priority.toUpperCase()}
建議行動：${recommendation.action}
理由：${recommendation.rationale}
時程：${recommendation.timeline}
預期效益：${recommendation.expected_benefit || '待評估'}
風險評估：${analysis.risk_assessment || '正常'}

詳細分析：
${analysis.analysis_summary || '請查看系統詳細報告'}

替代方案：
${analysis.alternative_options ? analysis.alternative_options.join('\n- ') : '無'}

請在收到此通知後 48 小時內回覆處理計劃。

---
此郵件由船隊智能分析系統自動生成
系統時間：${new Date().toLocaleString('zh-TW')}
`
    return template
  }

  // 確定負責部門
  getDepartmentsForRecommendation(recommendationType) {
    const departments = []
    
    for (const [deptKey, deptInfo] of Object.entries(DEPARTMENTS)) {
      if (deptInfo.responsibilities.includes(recommendationType)) {
        departments.push(deptKey)
      }
    }
    
    return departments.length > 0 ? departments : ['TECHNICAL'] // 預設技術部
  }

  // 輔助函數：計算性能趨勢
  calculatePerformanceTrend(ship, historicalData) {
    // 簡化實作，實際應該基於歷史數據
    const trend = ship.sl > ship.thr + 1 ? '惡化' : ship.sl > ship.thr ? '警戒' : '正常'
    return `當前趨勢：${trend}，Speed Loss ${ship.sl.toFixed(1)}%`
  }

  // 輔助函數：獲取維修歷史
  getMaintenanceHistory(ship, historicalData) {
    return {
      last_cleaning: `${ship.daysClean} 天前`,
      clean_count: ship.cleanCount,
      last_drydock: ship.lastDrydock || '未知'
    }
  }

  // 輔助函數：計算燃油趨勢
  calculateFuelTrend(ship, historicalData) {
    return `額外燃油消耗：${ship.penalty.toFixed(1)} t/day`
  }

  // 提取建議（當 JSON 解析失敗時的備用方案）
  extractRecommendations(textResponse, ship) {
    // 簡化實作：基於關鍵詞提取
    const recommendations = []
    
    if (textResponse.includes('清潔') || textResponse.includes('cleaning')) {
      recommendations.push({
        type: ANALYSIS_TYPES.HULL_CLEANING,
        priority: ship.sl > ship.thr + 1 ? 'high' : 'medium',
        action: '安排船體清潔',
        rationale: `Speed Loss ${ship.sl.toFixed(1)}% 超過閾值`,
        timeline: '建議 2 週內完成'
      })
    }
    
    if (textResponse.includes('進塢') || textResponse.includes('drydock')) {
      recommendations.push({
        type: ANALYSIS_TYPES.DRYDOCK_EVALUATION,
        priority: 'high',
        action: '評估進塢需求',
        rationale: '清潔效果遞減或船體狀況需評估',
        timeline: '建議 1 個月內評估'
      })
    }
    
    return {
      ship_id: ship.id,
      ship_name: ship.name,
      recommendations,
      analysis_summary: textResponse.substring(0, 500) + '...',
      raw_response: textResponse
    }
  }

  // 生成執行摘要
  async generateExecutiveSummary(analysisResults) {
    const totalRecommendations = analysisResults.reduce(
      (sum, analysis) => sum + (analysis.recommendations?.length || 0), 0
    )
    
    const criticalIssues = analysisResults.filter(
      analysis => analysis.recommendations?.some(rec => rec.priority === 'critical')
    ).length
    
    return {
      total_analyses: analysisResults.length,
      total_recommendations: totalRecommendations,
      critical_issues: criticalIssues,
      summary: `分析了 ${analysisResults.length} 項，生成 ${totalRecommendations} 項建議，其中 ${criticalIssues} 項需要緊急處理。`
    }
  }
}

// 通知發送器
export class NotificationDispatcher {
  constructor(apiClient) {
    this.api = apiClient
  }

  // 發送所有通知
  async dispatchNotifications(notifications) {
    const results = []
    
    for (const notification of notifications) {
      try {
        const result = await this.sendNotification(notification)
        results.push({ ...result, notification_id: notification.id })
      } catch (error) {
        results.push({ 
          notification_id: notification.id, 
          success: false, 
          error: error.message 
        })
      }
    }
    
    return results
  }

  // 發送單個通知
  async sendNotification(notification) {
    const recipients = notification.recipients.map(dept => dept.email).join(',')
    
    return await this.api.sendNotify({
      shipId: notification.ship_name,
      currentPct: 0, // 這裡需要從 notification 中提取實際數據
      daysSinceHull: 0,
      note: `${notification.subject}\n\n${notification.content}`,
      recipients: recipients
    })
  }
}

// 使用範例
export async function runFleetIntelligenceAnalysis(ships, apiClient, historicalData = []) {
  const engine = new FleetIntelligenceEngine(apiClient)
  const dispatcher = new NotificationDispatcher(apiClient)
  
  // 1. 執行分析
  const analysisResults = await engine.analyzeFleetData(ships, historicalData)
  
  // 2. 發送通知（如果有建議）
  if (analysisResults.notifications?.length > 0) {
    const notificationResults = await dispatcher.dispatchNotifications(analysisResults.notifications)
    analysisResults.notification_results = notificationResults
  }
  
  return analysisResults
}