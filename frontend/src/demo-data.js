/**
 * 演示數據生成器
 * 用於展示統計分析功能
 */

// 生成模擬的驗證記錄
export function generateMockVerificationData(count = 20) {
  const ships = ['EVER_GIVEN', 'COSCO_SHANGHAI', 'MSC_OSCAR', 'MAERSK_MADRID', 'CMA_ANTOINE']
  const mockData = []
  
  for (let i = 0; i < count; i++) {
    const ship = ships[i % ships.length]
    const baseFoc = 45 + Math.random() * 20 // 基礎 FOC 45-65
    
    // 系統值：添加一些隨機誤差
    const systemFoc = baseFoc * (1 + (Math.random() - 0.5) * 0.1)
    
    // 人工值：通常與系統值相近，但有一定差異
    const isOutlier = Math.random() < 0.1 // 10% 機率產生異常值
    const errorRange = isOutlier ? 0.2 : 0.05 // 異常值有更大差異
    const manualFoc = systemFoc * (1 + (Math.random() - 0.5) * errorRange)
    
    // 計算差異百分比
    const gapPct = ((manualFoc - systemFoc) / systemFoc) * 100
    
    // 動態容忍度（基於船型）
    const tolerance = ship.includes('EVER') ? 1.5 : ship.includes('COSCO') ? 2.0 : 2.5
    const agree = Math.abs(gapPct) <= tolerance
    
    mockData.push({
      id: i + 1,
      name: ship,
      shipId: i % ships.length + 1,
      foc: systemFoc,
      m: manualFoc,
      gapPct,
      agree,
      tolerance,
      timestamp: new Date(Date.now() - (count - i) * 24 * 60 * 60 * 1000).toISOString(),
      batch: i % 4 === 0 // 25% 為批量數據
    })
  }
  
  return mockData
}

// 批量 CSV 範例數據
export const BATCH_CSV_EXAMPLE = `EVER_GIVEN,58.2,22.5,15.1,62.8
COSCO_SHANGHAI,61.5,21.8,14.9,66.2
MSC_OSCAR,55.7,23.1,15.4,59.3
MAERSK_MADRID,63.2,20.9,14.6,68.7
CMA_ANTOINE,57.9,22.7,15.2,61.4`

// 船舶類型配置
export const SHIP_TYPE_CONFIG = {
  'EVER_GIVEN': { type: 'container', age: 8 },
  'COSCO_SHANGHAI': { type: 'container', age: 12 },
  'MSC_OSCAR': { type: 'container', age: 6 },
  'MAERSK_MADRID': { type: 'container', age: 15 },
  'CMA_ANTOINE': { type: 'container', age: 10 }
}