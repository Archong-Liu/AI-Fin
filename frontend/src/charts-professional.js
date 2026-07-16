/**
 * 專業級交互式圖表組件
 * 支持懸停提示和專業樣式
 */

// 專業散點圖（系統值 vs 人工值）
export function professionalScatterChart(systemValues, manualValues, metadata = [], options = {}) {
  const {
    width = 550,
    height = 400,
    margin = { top: 40, right: 40, bottom: 70, left: 80 },
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

  // 生成散點（專業樣式）
  const points = systemValues.map((sys, i) => {
    const manual = manualValues[i]
    const gap = Math.abs((sys - manual) / sys * 100)
    const isOutlier = gap > 5
    const shipName = metadata[i]?.name || `數據點 ${i + 1}`
    const timestamp = metadata[i]?.timestamp || ''
    
    const color = isOutlier ? '#e74c3c' : '#3498db'
    const radius = isOutlier ? 7 : 5
    
    return `<circle 
             cx="${xScale(sys)}" 
             cy="${yScale(manual)}" 
             r="${radius}" 
             fill="${color}" 
             fill-opacity="0.8" 
             stroke="#ffffff" 
             stroke-width="2"
             class="data-point"
             data-ship="${shipName}"
             data-system="${sys.toFixed(2)}"
             data-manual="${manual.toFixed(2)}"
             data-gap="${gap.toFixed(1)}"
             data-timestamp="${timestamp}"
             style="cursor: pointer; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));"
           />`
  }).join('')

  // 理想線 (y = x) - 專業樣式
  const identityLine = showIdentityLine ? 
    `<line x1="${xScale(minVal)}" y1="${yScale(minVal)}" 
           x2="${xScale(maxVal)}" y2="${yScale(maxVal)}" 
           stroke="#95a5a6" stroke-dasharray="8,4" stroke-width="2" opacity="0.7"/>` : ''

  // 回歸線 - 專業樣式
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
            stroke="#e67e22" stroke-width="3" opacity="0.9"
            style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.1));"/>`
  }

  // 專業網格線
  const tickCount = 6
  const tickStep = range / (tickCount - 1)
  let gridLines = ''
  let ticks = ''
  
  for (let i = 0; i < tickCount; i++) {
    const val = minVal + i * tickStep
    const x = xScale(val)
    const y = yScale(val)
    
    // 網格線（更細緻）
    if (i > 0 && i < tickCount - 1) {
      gridLines += `
        <line x1="${margin.left}" y1="${y}" 
              x2="${margin.left + plotWidth}" y2="${y}" 
              stroke="#ecf0f1" stroke-width="1"/>
        <line x1="${x}" y1="${margin.top}" 
              x2="${x}" y2="${margin.top + plotHeight}" 
              stroke="#ecf0f1" stroke-width="1"/>`
    }
    
    // 軸刻度
    ticks += `
      <!-- X 軸刻度 -->
      <line x1="${x}" y1="${margin.top + plotHeight}" 
            x2="${x}" y2="${margin.top + plotHeight + 8}" 
            stroke="#34495e" stroke-width="2"/>
      <text x="${x}" y="${margin.top + plotHeight + 28}" 
            text-anchor="middle" fill="#2c3e50" font-size="13" font-family="'Segoe UI', Arial, sans-serif" font-weight="500">${val.toFixed(0)}</text>
      
      <!-- Y 軸刻度 -->
      <line x1="${margin.left - 8}" y1="${y}" 
            x2="${margin.left}" y2="${y}" 
            stroke="#34495e" stroke-width="2"/>
      <text x="${margin.left - 15}" y="${y + 5}" 
            text-anchor="end" fill="#2c3e50" font-size="13" font-family="'Segoe UI', Arial, sans-serif" font-weight="500">${val.toFixed(0)}</text>`
  }

  const chartId = `scatter-${Date.now()}` // 唯一ID
  
  return `
    <div class="professional-chart">
      <svg id="${chartId}" viewBox="0 0 ${width} ${height}" style="width: 100%; height: auto; background: #ffffff; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
        <!-- 定義漸層和陰影 -->
        <defs>
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="rgba(0,0,0,0.1)"/>
          </filter>
          <linearGradient id="backgroundGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:#fafbfc;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#ffffff;stop-opacity:1" />
          </linearGradient>
        </defs>
        
        <!-- 背景 -->
        <rect x="${margin.left}" y="${margin.top}" 
              width="${plotWidth}" height="${plotHeight}" 
              fill="url(#backgroundGradient)" stroke="#e1e8ed" stroke-width="1"/>
        
        <!-- 網格線 -->
        ${gridLines}
        
        <!-- 軸刻度 -->
        ${ticks}
        
        <!-- 主軸線 -->
        <line x1="${margin.left}" y1="${margin.top}" 
              x2="${margin.left}" y2="${margin.top + plotHeight}" 
              stroke="#2c3e50" stroke-width="3"/>
        <line x1="${margin.left}" y1="${margin.top + plotHeight}" 
              x2="${margin.left + plotWidth}" y2="${margin.top + plotHeight}" 
              stroke="#2c3e50" stroke-width="3"/>
        
        <!-- 軸標籤 -->
        <text x="${margin.left + plotWidth/2}" y="${height - 20}" 
              text-anchor="middle" fill="#2c3e50" font-weight="600" font-size="16" font-family="'Segoe UI', Arial, sans-serif">系統計算值 (t/day)</text>
        <text x="25" y="${margin.top + plotHeight/2}" 
              text-anchor="middle" fill="#2c3e50" font-weight="600" font-size="16" font-family="'Segoe UI', Arial, sans-serif"
              transform="rotate(-90 25 ${margin.top + plotHeight/2})">人工計算值 (t/day)</text>
        
        <!-- 圖表標題 -->
        <text x="${width/2}" y="25" 
              text-anchor="middle" fill="#2c3e50" font-weight="700" font-size="18" font-family="'Segoe UI', Arial, sans-serif">${title}</text>
        
        <!-- 理想線和回歸線 -->
        ${identityLine}
        ${regressionLine}
        
        <!-- 數據點 -->
        ${points}
        
        <!-- 圖例區域 -->
        <g transform="translate(${width - 200}, 50)">
          <rect x="-10" y="-10" width="190" height="80" fill="#ffffff" stroke="#e1e8ed" stroke-width="1" rx="4" opacity="0.95"/>
          ${showRegression ? `
            <line x1="0" y1="5" x2="25" y2="5" stroke="#e67e22" stroke-width="3"/>
            <text x="30" y="9" fill="#2c3e50" font-size="12" font-family="'Segoe UI', Arial, sans-serif" font-weight="500">回歸線 (R²=${rSquared.toFixed(3)})</text>
          ` : ''}
          ${showIdentityLine ? `
            <line x1="0" y1="25" x2="25" y2="25" stroke="#95a5a6" stroke-dasharray="4,2" stroke-width="2"/>
            <text x="30" y="29" fill="#2c3e50" font-size="12" font-family="'Segoe UI', Arial, sans-serif" font-weight="500">理想線 (y=x)</text>
          ` : ''}
          <circle cx="12" cy="45" r="5" fill="#3498db" stroke="#ffffff" stroke-width="2"/>
          <text x="30" y="49" fill="#2c3e50" font-size="12" font-family="'Segoe UI', Arial, sans-serif" font-weight="500">正常數據</text>
          <circle cx="12" cy="60" r="6" fill="#e74c3c" stroke="#ffffff" stroke-width="2"/>
          <text x="30" y="64" fill="#2c3e50" font-size="12" font-family="'Segoe UI', Arial, sans-serif" font-weight="500">異常值 (>5%)</text>
        </g>
      </svg>
      
      <!-- 懸停提示框 -->
      <div id="tooltip-${chartId}" class="chart-tooltip" style="
        position: absolute;
        background: rgba(44, 62, 80, 0.95);
        color: white;
        padding: 12px 16px;
        border-radius: 6px;
        font-size: 13px;
        font-family: 'Segoe UI', Arial, sans-serif;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s ease;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 1000;
        white-space: nowrap;
      "></div>
      
      <script>
        (function() {
          const chart = document.getElementById('${chartId}');
          const tooltip = document.getElementById('tooltip-${chartId}');
          const points = chart.querySelectorAll('.data-point');
          
          points.forEach(point => {
            point.addEventListener('mouseenter', function(e) {
              const ship = this.getAttribute('data-ship');
              const system = this.getAttribute('data-system');
              const manual = this.getAttribute('data-manual');
              const gap = this.getAttribute('data-gap');
              const timestamp = this.getAttribute('data-timestamp');
              
              let content = '<div style="font-weight: 600; margin-bottom: 4px;">' + ship + '</div>';
              content += '<div>系統值: ' + system + ' t/day</div>';
              content += '<div>人工值: ' + manual + ' t/day</div>';
              content += '<div>差異: ' + gap + '%</div>';
              if (timestamp) {
                const date = new Date(timestamp).toLocaleDateString('zh-TW');
                content += '<div style="font-size: 11px; opacity: 0.8; margin-top: 4px;">' + date + '</div>';
              }
              
              tooltip.innerHTML = content;
              tooltip.style.opacity = '1';
              
              // 增大點的大小
              this.setAttribute('r', parseFloat(this.getAttribute('r')) * 1.3);
              this.style.filter = 'drop-shadow(0 4px 8px rgba(0,0,0,0.2))';
            });
            
            point.addEventListener('mouseleave', function(e) {
              tooltip.style.opacity = '0';
              
              // 恢復點的大小
              const isOutlier = parseFloat(this.getAttribute('data-gap')) > 5;
              this.setAttribute('r', isOutlier ? 7 : 5);
              this.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))';
            });
            
            point.addEventListener('mousemove', function(e) {
              const rect = chart.getBoundingClientRect();
              tooltip.style.left = (e.clientX - rect.left + 15) + 'px';
              tooltip.style.top = (e.clientY - rect.top - 10) + 'px';
            });
          });
        })();
      </script>
    </div>`
}

// 專業 Bland-Altman 圖
export function professionalBlandAltmanChart(blandAltmanData, metadata = [], options = {}) {
  const {
    width = 550,
    height = 400,
    margin = { top: 40, right: 40, bottom: 70, left: 80 },
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

  // 數據點（專業樣式）
  const points = differences.map((diff, i) => {
    const avg = averages[i]
    const isOutside = diff > upperLimit || diff < lowerLimit
    const shipName = metadata[i]?.name || `數據點 ${i + 1}`
    const timestamp = metadata[i]?.timestamp || ''
    
    const color = isOutside ? '#e74c3c' : '#3498db'
    const radius = isOutside ? 7 : 5
    
    return `<circle 
             cx="${xScale(avg)}" 
             cy="${yScale(diff)}" 
             r="${radius}" 
             fill="${color}" 
             fill-opacity="0.8" 
             stroke="#ffffff" 
             stroke-width="2"
             class="data-point-ba"
             data-ship="${shipName}"
             data-average="${avg.toFixed(2)}"
             data-difference="${diff.toFixed(2)}"
             data-timestamp="${timestamp}"
             style="cursor: pointer; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));"
           />`
  }).join('')

  // 一致性界限線（專業樣式）
  const limitLines = `
    <!-- 均值線 -->
    <line x1="${xScale(xMin)}" y1="${yScale(meanDiff)}" 
          x2="${xScale(xMax)}" y2="${yScale(meanDiff)}" 
          stroke="#e67e22" stroke-width="3" opacity="0.9"/>
    
    <!-- 上界限線 -->
    <line x1="${xScale(xMin)}" y1="${yScale(upperLimit)}" 
          x2="${xScale(xMax)}" y2="${yScale(upperLimit)}" 
          stroke="#e74c3c" stroke-dasharray="8,4" stroke-width="2" opacity="0.8"/>
    
    <!-- 下界限線 -->
    <line x1="${xScale(xMin)}" y1="${yScale(lowerLimit)}" 
          x2="${xScale(xMax)}" y2="${yScale(lowerLimit)}" 
          stroke="#e74c3c" stroke-dasharray="8,4" stroke-width="2" opacity="0.8"/>
    
    <!-- 零線 -->
    <line x1="${xScale(xMin)}" y1="${yScale(0)}" 
          x2="${xScale(xMax)}" y2="${yScale(0)}" 
          stroke="#95a5a6" stroke-dasharray="4,2" stroke-width="1" opacity="0.6"/>`

  // 軸刻度
  const xTickCount = 6
  const yTickCount = 7
  let gridLines = ''
  let ticks = ''
  
  // X軸
  for (let i = 0; i < xTickCount; i++) {
    const xVal = xMin + (xMax - xMin) * i / (xTickCount - 1)
    const x = xScale(xVal)
    
    if (i > 0 && i < xTickCount - 1) {
      gridLines += `
        <line x1="${x}" y1="${margin.top}" 
              x2="${x}" y2="${margin.top + plotHeight}" 
              stroke="#ecf0f1" stroke-width="1"/>`
    }
    
    ticks += `
      <line x1="${x}" y1="${margin.top + plotHeight}" 
            x2="${x}" y2="${margin.top + plotHeight + 8}" 
            stroke="#34495e" stroke-width="2"/>
      <text x="${x}" y="${margin.top + plotHeight + 28}" 
            text-anchor="middle" fill="#2c3e50" font-size="13" font-family="'Segoe UI', Arial, sans-serif" font-weight="500">${xVal.toFixed(0)}</text>`
  }
  
  // Y軸
  for (let i = 0; i < yTickCount; i++) {
    const yVal = yMin + (yMax - yMin) * i / (yTickCount - 1)
    const y = yScale(yVal)
    
    if (i > 0 && i < yTickCount - 1) {
      gridLines += `
        <line x1="${margin.left}" y1="${y}" 
              x2="${margin.left + plotWidth}" y2="${y}" 
              stroke="#ecf0f1" stroke-width="1"/>`
    }
    
    ticks += `
      <line x1="${margin.left - 8}" y1="${y}" 
            x2="${margin.left}" y2="${y}" 
            stroke="#34495e" stroke-width="2"/>
      <text x="${margin.left - 15}" y="${y + 5}" 
            text-anchor="end" fill="#2c3e50" font-size="13" font-family="'Segoe UI', Arial, sans-serif" font-weight="500">${yVal.toFixed(1)}</text>`
  }

  const chartId = `ba-${Date.now()}`

  return `
    <div class="professional-chart">
      <svg id="${chartId}" viewBox="0 0 ${width} ${height}" style="width: 100%; height: auto; background: #ffffff; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
        <!-- 背景 -->
        <rect x="${margin.left}" y="${margin.top}" 
              width="${plotWidth}" height="${plotHeight}" 
              fill="#fafbfc" stroke="#e1e8ed" stroke-width="1"/>
        
        <!-- 網格線 -->
        ${gridLines}
        
        <!-- 軸刻度 -->
        ${ticks}
        
        <!-- 主軸線 -->
        <line x1="${margin.left}" y1="${margin.top}" 
              x2="${margin.left}" y2="${margin.top + plotHeight}" 
              stroke="#2c3e50" stroke-width="3"/>
        <line x1="${margin.left}" y1="${margin.top + plotHeight}" 
              x2="${margin.left + plotWidth}" y2="${margin.top + plotHeight}" 
              stroke="#2c3e50" stroke-width="3"/>
        
        <!-- 軸標籤 -->
        <text x="${margin.left + plotWidth/2}" y="${height - 20}" 
              text-anchor="middle" fill="#2c3e50" font-weight="600" font-size="16" font-family="'Segoe UI', Arial, sans-serif">兩方法平均值 (t/day)</text>
        <text x="25" y="${margin.top + plotHeight/2}" 
              text-anchor="middle" fill="#2c3e50" font-weight="600" font-size="16" font-family="'Segoe UI', Arial, sans-serif"
              transform="rotate(-90 25 ${margin.top + plotHeight/2})">差值 (系統-人工)</text>
        
        <!-- 圖表標題 -->
        <text x="${width/2}" y="25" 
              text-anchor="middle" fill="#2c3e50" font-weight="700" font-size="18" font-family="'Segoe UI', Arial, sans-serif">${title}</text>
        
        <!-- 界限線 -->
        ${limitLines}
        
        <!-- 數據點 -->
        ${points}
        
        <!-- 圖例 -->
        <g transform="translate(${width - 220}, 50)">
          <rect x="-10" y="-10" width="210" height="100" fill="#ffffff" stroke="#e1e8ed" stroke-width="1" rx="4" opacity="0.95"/>
          
          <line x1="0" y1="5" x2="25" y2="5" stroke="#e67e22" stroke-width="3"/>
          <text x="30" y="9" fill="#2c3e50" font-size="12" font-family="'Segoe UI', Arial, sans-serif" font-weight="500">均值: ${meanDiff.toFixed(3)}</text>
          
          <line x1="0" y1="25" x2="25" y2="25" stroke="#e74c3c" stroke-dasharray="4,2" stroke-width="2"/>
          <text x="30" y="29" fill="#2c3e50" font-size="12" font-family="'Segoe UI', Arial, sans-serif" font-weight="500">±1.96σ 界限</text>
          
          <circle cx="12" cy="45" r="5" fill="#3498db" stroke="#ffffff" stroke-width="2"/>
          <text x="30" y="49" fill="#2c3e50" font-size="12" font-family="'Segoe UI', Arial, sans-serif" font-weight="500">界限內數據</text>
          
          <circle cx="12" cy="65" r="6" fill="#e74c3c" stroke="#ffffff" stroke-width="2"/>
          <text x="30" y="69" fill="#2c3e50" font-size="12" font-family="'Segoe UI', Arial, sans-serif" font-weight="500">界限外數據</text>
          
          <text x="0" y="85" fill="#2c3e50" font-size="11" font-family="'Segoe UI', Arial, sans-serif" font-weight="500">
            一致性: ${(blandAltmanData.agreementRate * 100).toFixed(1)}%
          </text>
        </g>
      </svg>
      
      <!-- 懸停提示框 -->
      <div id="tooltip-${chartId}" class="chart-tooltip" style="
        position: absolute;
        background: rgba(44, 62, 80, 0.95);
        color: white;
        padding: 12px 16px;
        border-radius: 6px;
        font-size: 13px;
        font-family: 'Segoe UI', Arial, sans-serif;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s ease;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 1000;
        white-space: nowrap;
      "></div>
      
      <script>
        (function() {
          const chart = document.getElementById('${chartId}');
          const tooltip = document.getElementById('tooltip-${chartId}');
          const points = chart.querySelectorAll('.data-point-ba');
          
          points.forEach(point => {
            point.addEventListener('mouseenter', function(e) {
              const ship = this.getAttribute('data-ship');
              const average = this.getAttribute('data-average');
              const difference = this.getAttribute('data-difference');
              const timestamp = this.getAttribute('data-timestamp');
              
              let content = '<div style="font-weight: 600; margin-bottom: 4px;">' + ship + '</div>';
              content += '<div>平均值: ' + average + ' t/day</div>';
              content += '<div>差異: ' + difference + ' t/day</div>';
              if (timestamp) {
                const date = new Date(timestamp).toLocaleDateString('zh-TW');
                content += '<div style="font-size: 11px; opacity: 0.8; margin-top: 4px;">' + date + '</div>';
              }
              
              tooltip.innerHTML = content;
              tooltip.style.opacity = '1';
              
              this.setAttribute('r', parseFloat(this.getAttribute('r')) * 1.3);
              this.style.filter = 'drop-shadow(0 4px 8px rgba(0,0,0,0.2))';
            });
            
            point.addEventListener('mouseleave', function(e) {
              tooltip.style.opacity = '0';
              
              const difference = parseFloat(this.getAttribute('data-difference'));
              const upperLimit = ${upperLimit};
              const lowerLimit = ${lowerLimit};
              const isOutside = difference > upperLimit || difference < lowerLimit;
              this.setAttribute('r', isOutside ? 7 : 5);
              this.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))';
            });
            
            point.addEventListener('mousemove', function(e) {
              const rect = chart.getBoundingClientRect();
              tooltip.style.left = (e.clientX - rect.left + 15) + 'px';
              tooltip.style.top = (e.clientY - rect.top - 10) + 'px';
            });
          });
        })();
      </script>
    </div>`
}