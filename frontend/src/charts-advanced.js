/**
 * 進階圖表組件庫
 * 專為統計分析設計的高級圖表
 */

// 散點圖（系統值 vs 人工值）
export function scatterPlotChart(systemValues, manualValues, options = {}) {
  const {
    width = 500,
    height = 350,
    margin = { top: 30, right: 30, bottom: 60, left: 70 },
    showRegression = true,
    showIdentityLine = true,
    title = "系統值 vs 人工值比較"
  } = options

  if (systemValues.length === 0 || systemValues.length !== manualValues.length) {
    return `<div class="chart-placeholder">數據不足，無法繪製散點圖</div>`
  }

  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom

  // 計算數據範圍
  const allValues = [...systemValues, ...manualValues]
  const minVal = Math.min(...allValues) * 0.95
  const maxVal = Math.max(...allValues) * 1.05
  const range = maxVal - minVal

  // 座標轉換函數
  const xScale = (val) => margin.left + ((val - minVal) / range) * plotWidth
  const yScale = (val) => margin.top + plotHeight - ((val - minVal) / range) * plotHeight

  // 生成散點
  const points = systemValues.map((sys, i) => {
    const manual = manualValues[i]
    const gap = Math.abs((sys - manual) / sys * 100)
    const isOutlier = gap > 5  // 超過 5% 視為異常點
    return `<circle cx="${xScale(sys)}" cy="${yScale(manual)}" r="${isOutlier ? 5 : 4}" 
             fill="${isOutlier ? '#dc3545' : '#0066cc'}" 
             fill-opacity="${isOutlier ? 0.8 : 0.7}" 
             stroke="${isOutlier ? '#dc3545' : '#0066cc'}" 
             stroke-width="1">
             <title>系統: ${sys.toFixed(2)}, 人工: ${manual.toFixed(2)}, 差異: ${gap.toFixed(1)}%</title>
           </circle>`
  }).join('')

  // 理想線 (y = x)
  const identityLine = showIdentityLine ? 
    `<line x1="${xScale(minVal)}" y1="${yScale(minVal)}" 
           x2="${xScale(maxVal)}" y2="${yScale(maxVal)}" 
           stroke="#999999" stroke-dasharray="5,5" stroke-width="2"/>` : ''

  // 回歸線
  let regressionLine = ''
  let rSquared = 0
  if (showRegression && systemValues.length >= 3) {
    const n = systemValues.length
    const sumX = systemValues.reduce((a, b) => a + b, 0)
    const sumY = manualValues.reduce((a, b) => a + b, 0)
    const sumXY = systemValues.reduce((sum, x, i) => sum + x * manualValues[i], 0)
    const sumX2 = systemValues.reduce((sum, x) => sum + x * x, 0)
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
    const intercept = (sumY - slope * sumX) / n
    
    const y1 = slope * minVal + intercept
    const y2 = slope * maxVal + intercept
    
    // 計算 R²
    const yMean = sumY / n
    const totalSS = manualValues.reduce((sum, y) => sum + Math.pow(y - yMean, 2), 0)
    const residualSS = manualValues.reduce((sum, y, i) => sum + Math.pow(y - (slope * systemValues[i] + intercept), 2), 0)
    rSquared = totalSS > 0 ? 1 - (residualSS / totalSS) : 0
    
    regressionLine = `
      <line x1="${xScale(minVal)}" y1="${yScale(y1)}" 
            x2="${xScale(maxVal)}" y2="${yScale(y2)}" 
            stroke="#ff6b35" stroke-width="3"/>`
  }

  // 軸刻度
  const tickCount = 5
  const tickStep = range / tickCount
  let ticks = ''
  for (let i = 0; i <= tickCount; i++) {
    const val = minVal + i * tickStep
    const x = xScale(val)
    const y = yScale(val)
    
    // X 軸刻度
    ticks += `
      <line x1="${x}" y1="${margin.top + plotHeight}" 
            x2="${x}" y2="${margin.top + plotHeight + 8}" 
            stroke="#666666" stroke-width="1"/>
      <text x="${x}" y="${margin.top + plotHeight + 25}" 
            text-anchor="middle" fill="#333333" font-size="14" font-family="Arial, sans-serif">${val.toFixed(0)}</text>`
    
    // Y 軸刻度
    ticks += `
      <line x1="${margin.left - 8}" y1="${y}" 
            x2="${margin.left}" y2="${y}" 
            stroke="#666666" stroke-width="1"/>
      <text x="${margin.left - 15}" y="${y + 5}" 
            text-anchor="end" fill="#333333" font-size="14" font-family="Arial, sans-serif">${val.toFixed(0)}</text>`
    
    // 網格線（淺色）
    if (i > 0 && i < tickCount) {
      ticks += `
        <line x1="${margin.left}" y1="${y}" 
              x2="${margin.left + plotWidth}" y2="${y}" 
              stroke="#f0f0f0" stroke-width="1"/>
        <line x1="${x}" y1="${margin.top}" 
              x2="${x}" y2="${margin.top + plotHeight}" 
              stroke="#f0f0f0" stroke-width="1"/>`
    }
  }

  return `
    <div class="advanced-chart">
      <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: auto; background: white;">
        <!-- 網格和刻度 -->
        ${ticks}
        
        <!-- 軸線 -->
        <line x1="${margin.left}" y1="${margin.top}" 
              x2="${margin.left}" y2="${margin.top + plotHeight}" 
              stroke="#333333" stroke-width="2"/>
        <line x1="${margin.left}" y1="${margin.top + plotHeight}" 
              x2="${margin.left + plotWidth}" y2="${margin.top + plotHeight}" 
              stroke="#333333" stroke-width="2"/>
        
        <!-- 軸標籤 -->
        <text x="${margin.left + plotWidth/2}" y="${height - 15}" 
              text-anchor="middle" fill="#333333" font-weight="600" font-size="16" font-family="Arial, sans-serif">系統計算值 (t/day)</text>
        <text x="20" y="${margin.top + plotHeight/2}" 
              text-anchor="middle" fill="#333333" font-weight="600" font-size="16" font-family="Arial, sans-serif"
              transform="rotate(-90 20 ${margin.top + plotHeight/2})">人工計算值 (t/day)</text>
        
        <!-- 圖表標題 -->
        <text x="${width/2}" y="20" 
              text-anchor="middle" fill="#333333" font-weight="700" font-size="18" font-family="Arial, sans-serif">${title}</text>
        
        ${identityLine}
        ${regressionLine}
        ${points}
        
        <!-- 圖例 -->
        <g transform="translate(${width - 150}, 40)">
          ${showRegression ? `
            <line x1="0" y1="0" x2="20" y2="0" stroke="#ff6b35" stroke-width="3"/>
            <text x="25" y="5" fill="#333333" font-size="12" font-family="Arial, sans-serif">回歸線 (R²=${rSquared.toFixed(3)})</text>
          ` : ''}
          ${showIdentityLine ? `
            <line x1="0" y1="15" x2="20" y2="15" stroke="#999999" stroke-dasharray="3,3" stroke-width="2"/>
            <text x="25" y="20" fill="#333333" font-size="12" font-family="Arial, sans-serif">理想線 (y=x)</text>
          ` : ''}
        </g>
      </svg>
    </div>`
}

// Bland-Altman 圖
export function blandAltmanChart(blandAltmanData, options = {}) {
  const {
    width = 480,
    height = 320,
    margin = { top: 20, right: 20, bottom: 40, left: 50 },
    title = "Bland-Altman 一致性分析"
  } = options

  if (!blandAltmanData || blandAltmanData.n < 3) {
    return `<div class="chart-placeholder">數據不足，無法繪製 Bland-Altman 圖</div>`
  }

  const { differences, averages, meanDiff, upperLimit, lowerLimit } = blandAltmanData
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom

  // 計算範圍
  const xMin = Math.min(...averages) * 0.95
  const xMax = Math.max(...averages) * 1.05
  const yMin = Math.min(lowerLimit * 1.2, Math.min(...differences) * 1.2)
  const yMax = Math.max(upperLimit * 1.2, Math.max(...differences) * 1.2)

  const xScale = (val) => margin.left + ((val - xMin) / (xMax - xMin)) * plotWidth
  const yScale = (val) => margin.top + plotHeight - ((val - yMin) / (yMax - yMin)) * plotHeight

  // 數據點
  const points = differences.map((diff, i) => {
    const avg = averages[i]
    const isOutside = diff > upperLimit || diff < lowerLimit
    return `<circle cx="${xScale(avg)}" cy="${yScale(diff)}" r="3" 
             fill="${isOutside ? 'var(--danger)' : 'var(--primary)'}" 
             fill-opacity="0.6" stroke="${isOutside ? 'var(--danger)' : 'var(--primary)'}" 
             stroke-width="1">
             <title>平均值: ${avg.toFixed(2)}, 差值: ${diff.toFixed(2)}</title>
           </circle>`
  }).join('')

  // 一致性界限線
  const limitLines = `
    <!-- 均值線 -->
    <line x1="${xScale(xMin)}" y1="${yScale(meanDiff)}" 
          x2="${xScale(xMax)}" y2="${yScale(meanDiff)}" 
          stroke="var(--accent)" stroke-width="2"/>
    <text x="${xScale(xMax) - 80}" y="${yScale(meanDiff) - 5}" 
          fill="var(--accent)" font-size="12">均值差: ${meanDiff.toFixed(3)}</text>
    
    <!-- 上界限線 -->
    <line x1="${xScale(xMin)}" y1="${yScale(upperLimit)}" 
          x2="${xScale(xMax)}" y2="${yScale(upperLimit)}" 
          stroke="var(--danger)" stroke-dasharray="3,3" stroke-width="1"/>
    <text x="${xScale(xMax) - 100}" y="${yScale(upperLimit) - 5}" 
          fill="var(--danger)" font-size="12">+1.96σ: ${upperLimit.toFixed(3)}</text>
    
    <!-- 下界限線 -->
    <line x1="${xScale(xMin)}" y1="${yScale(lowerLimit)}" 
          x2="${xScale(xMax)}" y2="${yScale(lowerLimit)}" 
          stroke="var(--danger)" stroke-dasharray="3,3" stroke-width="1"/>
    <text x="${xScale(xMax) - 100}" y="${yScale(lowerLimit) + 15}" 
          fill="var(--danger)" font-size="12">-1.96σ: ${lowerLimit.toFixed(3)}</text>
    
    <!-- 零線 -->
    <line x1="${xScale(xMin)}" y1="${yScale(0)}" 
          x2="${xScale(xMax)}" y2="${yScale(0)}" 
          stroke="var(--muted)" stroke-dasharray="5,5" stroke-width="1"/>`

  // 軸刻度（簡化版）
  const ticks = Array.from({length: 6}, (_, i) => {
    const xVal = xMin + (xMax - xMin) * i / 5
    const yVal = yMin + (yMax - yMin) * i / 5
    return `
      <!-- X 軸刻度 -->
      <line x1="${xScale(xVal)}" y1="${margin.top + plotHeight}" 
            x2="${xScale(xVal)}" y2="${margin.top + plotHeight + 5}" 
            stroke="var(--muted)"/>
      <text x="${xScale(xVal)}" y="${margin.top + plotHeight + 20}" 
            text-anchor="middle" fill="var(--text)" font-size="12">${xVal.toFixed(1)}</text>
      
      <!-- Y 軸刻度 -->
      <line x1="${margin.left - 5}" y1="${yScale(yVal)}" 
            x2="${margin.left}" y2="${yScale(yVal)}" 
            stroke="var(--muted)"/>
      <text x="${margin.left - 10}" y="${yScale(yVal) + 4}" 
            text-anchor="end" fill="var(--text)" font-size="12">${yVal.toFixed(2)}</text>`
  }).join('')

  return `
    <div class="advanced-chart">
      <h4>${title}</h4>
      <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: auto;">
        ${ticks}
        
        <!-- 軸線 -->
        <line x1="${margin.left}" y1="${margin.top}" 
              x2="${margin.left}" y2="${margin.top + plotHeight}" 
              stroke="var(--text)" stroke-width="1"/>
        <line x1="${margin.left}" y1="${margin.top + plotHeight}" 
              x2="${margin.left + plotWidth}" y2="${margin.top + plotHeight}" 
              stroke="var(--text)" stroke-width="1"/>
        
        <!-- 軸標籤 -->
        <text x="${margin.left + plotWidth/2}" y="${height - 5}" 
              text-anchor="middle" fill="var(--text)" font-weight="600">兩方法平均值 (t/day)</text>
        <text x="15" y="${margin.top + plotHeight/2}" 
              text-anchor="middle" fill="var(--text)" font-weight="600" 
              transform="rotate(-90 15 ${margin.top + plotHeight/2})">差值 (系統-人工)</text>
        
        ${limitLines}
        ${points}
      </svg>
      <div class="chart-stats">
        <span>一致性: ${(blandAltmanData.agreementRate * 100).toFixed(1)}% 點在界限內</span>
        <span>標準差: ${blandAltmanData.stdDiff.toFixed(3)}</span>
      </div>
    </div>`
}