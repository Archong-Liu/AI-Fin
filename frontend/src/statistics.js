/**
 * 統計分析工具庫
 * 用於人工比對頁面的高級統計功能
 */

// Bland-Altman 分析
export function blandAltmanAnalysis(systemValues, manualValues) {
  if (systemValues.length !== manualValues.length || systemValues.length < 3) {
    return null
  }

  const n = systemValues.length
  const differences = systemValues.map((sys, i) => sys - manualValues[i])
  const averages = systemValues.map((sys, i) => (sys + manualValues[i]) / 2)
  
  // 差值的均值和標準差
  const meanDiff = differences.reduce((sum, diff) => sum + diff, 0) / n
  const stdDiff = Math.sqrt(
    differences.reduce((sum, diff) => sum + Math.pow(diff - meanDiff, 2), 0) / (n - 1)
  )
  
  // 95% 一致性界限 (Limits of Agreement)
  const upperLimit = meanDiff + 1.96 * stdDiff
  const lowerLimit = meanDiff - 1.96 * stdDiff
  
  // 在界限內的點數比例
  const withinLimits = differences.filter(diff => diff >= lowerLimit && diff <= upperLimit).length
  const agreementRate = withinLimits / n
  
  return {
    meanDiff,
    stdDiff,
    upperLimit,
    lowerLimit,
    agreementRate,
    differences,
    averages,
    n
  }
}

// 動態容忍度計算（根據船型、歷史準確度）
export function calculateDynamicTolerance(ship, historicalData = []) {
  const baselineTolerances = {
    'container': 1.5,    // 貨櫃船：較精確
    'bulk': 2.0,         // 散裝船：中等
    'tanker': 2.5,       // 油輪：較寬鬆
    'general': 2.0       // 一般貨船：預設
  }
  
  const shipType = ship.type?.toLowerCase() || 'general'
  let tolerance = baselineTolerances[shipType] || 2.0
  
  // 根據歷史準確度調整
  if (historicalData.length >= 10) {
    const recentAccuracy = historicalData.slice(-10)
    const accuracyRate = recentAccuracy.filter(r => r.agree).length / recentAccuracy.length
    
    if (accuracyRate >= 0.95) {
      tolerance *= 0.8  // 高準確度：收緊容忍度
    } else if (accuracyRate < 0.7) {
      tolerance *= 1.3  // 低準確度：放寬容忍度
    }
  }
  
  // 根據船齡調整（較老的船可能精度較低）
  const shipAge = ship.age || 0
  if (shipAge > 15) {
    tolerance *= 1.2
  }
  
  return Math.round(tolerance * 10) / 10  // 四捨五入到小數點後一位
}

// 置信區間計算
export function confidenceInterval(data, confidence = 0.95) {
  if (data.length < 2) return null
  
  const mean = data.reduce((sum, val) => sum + val, 0) / data.length
  const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (data.length - 1)
  const standardError = Math.sqrt(variance / data.length)
  
  // t 分佈臨界值（簡化版本，適用於 n > 30）
  const tValue = data.length > 30 ? 1.96 : 2.262  // 簡化的 t 值
  const marginOfError = tValue * standardError
  
  return {
    mean,
    lowerBound: mean - marginOfError,
    upperBound: mean + marginOfError,
    marginOfError,
    confidence
  }
}

// 相關係數計算
export function pearsonCorrelation(x, y) {
  if (x.length !== y.length || x.length < 2) return null
  
  const n = x.length
  const sumX = x.reduce((a, b) => a + b, 0)
  const sumY = y.reduce((a, b) => a + b, 0)
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0)
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0)
  const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0)
  
  const numerator = n * sumXY - sumX * sumY
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY))
  
  return denominator === 0 ? 0 : numerator / denominator
}

// 線性回歸
export function linearRegression(x, y) {
  if (x.length !== y.length || x.length < 2) return null
  
  const n = x.length
  const sumX = x.reduce((a, b) => a + b, 0)
  const sumY = y.reduce((a, b) => a + b, 0)
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0)
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0)
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
  const intercept = (sumY - slope * sumX) / n
  
  // R² 計算
  const yMean = sumY / n
  const totalSS = y.reduce((sum, yi) => sum + Math.pow(yi - yMean, 2), 0)
  const residualSS = y.reduce((sum, yi, i) => sum + Math.pow(yi - (slope * x[i] + intercept), 2), 0)
  const rSquared = 1 - (residualSS / totalSS)
  
  return { slope, intercept, rSquared }
}

// 異常值檢測（使用 IQR 方法）
export function detectOutliers(data, field = null) {
  const values = field ? data.map(d => d[field]) : data
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  
  if (n < 4) return []
  
  const q1 = sorted[Math.floor(n * 0.25)]
  const q3 = sorted[Math.floor(n * 0.75)]
  const iqr = q3 - q1
  const lowerBound = q1 - 1.5 * iqr
  const upperBound = q3 + 1.5 * iqr
  
  return data.filter((item, index) => {
    const value = field ? item[field] : item
    return value < lowerBound || value > upperBound
  }).map((item, originalIndex) => ({ 
    ...item, 
    outlierReason: field && item[field] < lowerBound ? 'low' : 'high' 
  }))
}

// 批次統計摘要
export function batchStatistics(verificationRecords) {
  if (verificationRecords.length === 0) return null
  
  const systemValues = verificationRecords.map(r => r.foc)
  const manualValues = verificationRecords.map(r => r.m)
  const gaps = verificationRecords.map(r => r.gapPct)
  
  const agreementRate = verificationRecords.filter(r => r.agree).length / verificationRecords.length
  const meanGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length
  const stdGap = Math.sqrt(gaps.reduce((sum, gap) => sum + Math.pow(gap - meanGap, 2), 0) / (gaps.length - 1))
  
  const correlation = pearsonCorrelation(systemValues, manualValues)
  const regression = linearRegression(systemValues, manualValues)
  const blandAltman = blandAltmanAnalysis(systemValues, manualValues)
  const outliers = detectOutliers(verificationRecords, 'gapPct')
  
  return {
    totalRecords: verificationRecords.length,
    agreementRate,
    meanGap,
    stdGap,
    correlation,
    regression,
    blandAltman,
    outliers,
    systemValueStats: {
      mean: systemValues.reduce((a, b) => a + b, 0) / systemValues.length,
      min: Math.min(...systemValues),
      max: Math.max(...systemValues)
    },
    manualValueStats: {
      mean: manualValues.reduce((a, b) => a + b, 0) / manualValues.length,
      min: Math.min(...manualValues),
      max: Math.max(...manualValues)
    }
  }
}