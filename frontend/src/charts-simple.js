/**
 * 簡化的專業圖表組件
 * 修復實色點和鼠標交互問題
 */

// 簡化散點圖（修復版本）
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

  // 生成散點（實色，簡化交互）
  const points = systemValues.map((sys, i) => {
    const manual = manualValues[i]
    const gap = Math.abs((sys - manual) / sys * 100)
    const isOutlier = gap > 5
    const shipName = metadata[i]?.name || `數據點 ${i + 1}`
    const timestamp = metadata[i]?.timestamp || ''
    
    const color = isOutlier ? '#dc3545' : '#007bff'
    const radius = isOutlier ? 4 : 3
    
    return `<circle 
             cx="${xScale(sys)}" 
             cy="${yScale(manual)}" 
             r="${radius}" 
             fill="${color}" 
             stroke="none"
             class="chart-point"
             data-index="${i}"
             data-ship="${shipName}"
             data-system="${sys.toFixed(2)}"
             data-manual="${manual.toFixed(2)}"
             data-gap="${gap.toFixed(1)}"
             data-timestamp="${timestamp}"
             style="cursor: pointer;"
           />`
  }).join('')

  // 理想線 (y = x)
  const identityLine = showIdentityLine ? 
    `<line x1="${xScale(minVal)}" y1="${yScale(minVal)}" 
           x2="${xScale(maxVal)}" y2="${yScale(maxVal)}" 
           stroke="#6c757d" stroke-dasharray="8,4" stroke-width="2" opacity="0.6"/>` : ''

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
            stroke="#fd7e14" stroke-width="3"/>`
  }

  // 網格線和刻度
  const tickCount = 6
  const tickStep = range / (tickCount - 1)
  let gridLines = ''
  let ticks = ''
  
  for (let i = 0; i < tickCount; i++) {
    const val = minVal + i * tickStep
    const x = xScale(val)
    const y = yScale(val)
    
    // 網格線
    if (i > 0 && i < tickCount - 1) {
      gridLines += `
        <line x1="${margin.left}" y1="${y}" 
              x2="${margin.left + plotWidth}" y2="${y}" 
              stroke="#f8f9fa" stroke-width="1"/>
        <line x1="${x}" y1="${margin.top}" 
              x2="${x}" y2="${margin.top + plotHeight}" 
              stroke="#f8f9fa" stroke-width="1"/>`
    }
    
    // 軸刻度
    ticks += `
      <line x1="${x}" y1="${margin.top + plotHeight}" 
            x2="${x}" y2="${margin.top + plotHeight + 8}" 
            stroke="#495057" stroke-width="2"/>
      <text x="${x}" y="${margin.top + plotHeight + 25}" 
            text-anchor="middle" fill="#212529" font-size="12" font-family="Arial, sans-serif">${val.toFixed(0)}</text>
      
      <line x1="${margin.left - 8}" y1="${y}" 
            x2="${margin.left}" y2="${y}" 
            stroke="#495057" stroke-width="2"/>
      <text x="${margin.left - 12}" y="${y + 4}" 
            text-anchor="end" fill="#212529" font-size="12" font-family="Arial, sans-serif">${val.toFixed(0)}</text>`
  }

  const chartId = `chart-${Math.random().toString(36).substr(2, 9)}`
  
  return `
    <div class="professional-chart" style="position: relative;">
      <svg id="${chartId}" viewBox="0 0 ${width} ${height}" style="width: 100%; height: auto; background: #ffffff; border: 1px solid #dee2e6; border-radius: 8px;">
        <!-- 背景 -->
        <rect x="${margin.left}" y="${margin.top}" 
              width="${plotWidth}" height="${plotHeight}" 
              fill="#fefefe" stroke="#e9ecef" stroke-width="1"/>
        
        <!-- 網格線 -->
        ${gridLines}
        
        <!-- 軸線 -->
        <line x1="${margin.left}" y1="${margin.top}" 
              x2="${margin.left}" y2="${margin.top + plotHeight}" 
              stroke="#212529" stroke-width="2"/>
        <line x1="${margin.left}" y1="${margin.top + plotHeight}" 
              x2="${margin.left + plotWidth}" y2="${margin.top + plotHeight}" 
              stroke="#212529" stroke-width="2"/>
        
        <!-- 刻度 -->
        ${ticks}
        
        <!-- 軸標籤 -->
        <text x="${margin.left + plotWidth/2}" y="${height - 25}" 
              text-anchor="middle" fill="#212529" font-weight="600" font-size="14" font-family="Arial, sans-serif">系統計算值 (t/day)</text>
        <text x="20" y="${margin.top + plotHeight/2}" 
              text-anchor="middle" fill="#212529" font-weight="600" font-size="14" font-family="Arial, sans-serif"
              transform="rotate(-90 20 ${margin.top + plotHeight/2})">人工計算值 (t/day)</text>
        
        <!-- 標題 -->
        <text x="${width/2}" y="25" 
              text-anchor="middle" fill="#212529" font-weight="700" font-size="16" font-family="Arial, sans-serif">${title}</text>
        
        <!-- 線條 -->
        ${identityLine}
        ${regressionLine}
        
        <!-- 數據點 -->
        ${points}
        
        <!-- 圖例 -->
        <g transform="translate(${width - 180}, 50)">
          <rect x="-8" y="-8" width="170" height="75" fill="rgba(255,255,255,0.95)" stroke="#dee2e6" stroke-width="1" rx="4"/>
          ${showRegression ? `
            <line x1="0" y1="5" x2="20" y2="5" stroke="#fd7e14" stroke-width="3"/>
            <text x="25" y="9" fill="#212529" font-size="11" font-family="Arial, sans-serif">回歸線 (R²=${rSquared.toFixed(3)})</text>
          ` : ''}
          ${showIdentityLine ? `
            <line x1="0" y1="20" x2="20" y2="20" stroke="#6c757d" stroke-dasharray="4,2" stroke-width="2"/>
            <text x="25" y="24" fill="#212529" font-size="11" font-family="Arial, sans-serif">理想線 (y=x)</text>
          ` : ''}
          <circle cx="10" cy="37" r="4" fill="#007bff" stroke="none"/>
          <text x="25" y="41" fill="#212529" font-size="11" font-family="Arial, sans-serif">正常數據</text>
          <circle cx="10" cy="52" r="5" fill="#dc3545" stroke="none"/>
          <text x="25" y="56" fill="#212529" font-size="11" font-family="Arial, sans-serif">異常值 (>5%)</text>
        </g>
      </svg>
      
      <!-- 提示框 -->
      <div id="tooltip-${chartId}" style="
        position: absolute;
        background: rgba(33, 37, 41, 0.95);
        color: white;
        padding: 8px 12px;
        border-radius: 4px;
        font-size: 12px;
        font-family: Arial, sans-serif;
        pointer-events: none;
        opacity: 0;
        z-index: 1000;
        transition: opacity 0.2s ease;
        white-space: nowrap;
      "></div>
      
      <style>
        .chart-point {
          transition: r 0.1s ease;
        }
        .chart-point:hover {
          filter: brightness(1.1);
        }
      </style>
      
      <script>
        (function() {
          const svg = document.getElementById('${chartId}');
          const tooltip = document.getElementById('tooltip-${chartId}');
          if (!svg || !tooltip) return;
          
          const points = svg.querySelectorAll('.chart-point');
          
          points.forEach(function(point) {
            point.addEventListener('mouseenter', function() {
              const ship = this.getAttribute('data-ship') || '未知船隻';
              const system = this.getAttribute('data-system') || '0';
              const manual = this.getAttribute('data-manual') || '0';
              const gap = this.getAttribute('data-gap') || '0';
              const timestamp = this.getAttribute('data-timestamp') || '';
              
              let content = '<div style="font-weight: bold; margin-bottom: 3px; color: #ffffff;">' + ship + '</div>';
              content += '<div style="color: #ffffff;">系統值: ' + system + ' t/day</div>';
              content += '<div style="color: #ffffff;">人工值: ' + manual + ' t/day</div>';
              content += '<div style="color: #ffffff;">差異: ' + gap + '%</div>';
              if (timestamp) {
                try {
                  const date = new Date(timestamp).toLocaleDateString('zh-TW');
                  content += '<div style="font-size: 10px; opacity: 0.8; margin-top: 3px; color: #ffffff;">' + date + '</div>';
                } catch (e) {}
              }
              
              tooltip.innerHTML = content;
              tooltip.style.opacity = '1';
              
              // 放大點
              const currentR = parseFloat(this.getAttribute('r'));
              this.setAttribute('r', currentR + 1.5);
            });
            
            point.addEventListener('mouseleave', function() {
              tooltip.style.opacity = '0';
              
              // 恢復點大小
              const gap = parseFloat(this.getAttribute('data-gap')) || 0;
              const isOutlier = gap > 5;
              this.setAttribute('r', isOutlier ? 4 : 3);
            });
            
            point.addEventListener('mousemove', function(event) {
              const rect = svg.getBoundingClientRect();
              const x = event.clientX - rect.left + 10;
              const y = event.clientY - rect.top - 30;
              
              tooltip.style.left = x + 'px';
              tooltip.style.top = y + 'px';
            });
          });
        })();
      </script>
    </div>`
}

// 簡化 Bland-Altman 圖
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

  // 數據點
  const points = differences.map((diff, i) => {
    const avg = averages[i]
    const isOutside = diff > upperLimit || diff < lowerLimit
    const shipName = metadata[i]?.name || `數據點 ${i + 1}`
    const timestamp = metadata[i]?.timestamp || ''
    
    const color = isOutside ? '#dc3545' : '#007bff'
    const radius = isOutside ? 4 : 3
    
    return `<circle 
             cx="${xScale(avg)}" 
             cy="${yScale(diff)}" 
             r="${radius}" 
             fill="${color}" 
             stroke="none"
             class="chart-point-ba"
             data-ship="${shipName}"
             data-average="${avg.toFixed(2)}"
             data-difference="${diff.toFixed(2)}"
             data-timestamp="${timestamp}"
             style="cursor: pointer;"
           />`
  }).join('')

  // 界限線
  const limitLines = `
    <!-- 均值線 -->
    <line x1="${xScale(xMin)}" y1="${yScale(meanDiff)}" 
          x2="${xScale(xMax)}" y2="${yScale(meanDiff)}" 
          stroke="#fd7e14" stroke-width="3"/>
    
    <!-- 上界限線 -->
    <line x1="${xScale(xMin)}" y1="${yScale(upperLimit)}" 
          x2="${xScale(xMax)}" y2="${yScale(upperLimit)}" 
          stroke="#dc3545" stroke-dasharray="8,4" stroke-width="2"/>
    
    <!-- 下界限線 -->
    <line x1="${xScale(xMin)}" y1="${yScale(lowerLimit)}" 
          x2="${xScale(xMax)}" y2="${yScale(lowerLimit)}" 
          stroke="#dc3545" stroke-dasharray="8,4" stroke-width="2"/>
    
    <!-- 零線 -->
    <line x1="${xScale(xMin)}" y1="${yScale(0)}" 
          x2="${xScale(xMax)}" y2="${yScale(0)}" 
          stroke="#6c757d" stroke-dasharray="4,2" stroke-width="1" opacity="0.6"/>`

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
              stroke="#f8f9fa" stroke-width="1"/>`
    }
    
    ticks += `
      <line x1="${x}" y1="${margin.top + plotHeight}" 
            x2="${x}" y2="${margin.top + plotHeight + 8}" 
            stroke="#495057" stroke-width="2"/>
      <text x="${x}" y="${margin.top + plotHeight + 25}" 
            text-anchor="middle" fill="#212529" font-size="12" font-family="Arial, sans-serif">${xVal.toFixed(0)}</text>`
  }
  
  // Y軸
  for (let i = 0; i < yTickCount; i++) {
    const yVal = yMin + (yMax - yMin) * i / (yTickCount - 1)
    const y = yScale(yVal)
    
    if (i > 0 && i < yTickCount - 1) {
      gridLines += `
        <line x1="${margin.left}" y1="${y}" 
              x2="${margin.left + plotWidth}" y2="${y}" 
              stroke="#f8f9fa" stroke-width="1"/>`
    }
    
    ticks += `
      <line x1="${margin.left - 8}" y1="${y}" 
            x2="${margin.left}" y2="${y}" 
            stroke="#495057" stroke-width="2"/>
      <text x="${margin.left - 12}" y="${y + 4}" 
            text-anchor="end" fill="#212529" font-size="12" font-family="Arial, sans-serif">${yVal.toFixed(1)}</text>`
  }

  const chartId = `ba-${Math.random().toString(36).substr(2, 9)}`

  return `
    <div class="professional-chart" style="position: relative;">
      <svg id="${chartId}" viewBox="0 0 ${width} ${height}" style="width: 100%; height: auto; background: #ffffff; border: 1px solid #dee2e6; border-radius: 8px;">
        <!-- 背景 -->
        <rect x="${margin.left}" y="${margin.top}" 
              width="${plotWidth}" height="${plotHeight}" 
              fill="#fefefe" stroke="#e9ecef" stroke-width="1"/>
        
        <!-- 網格線 -->
        ${gridLines}
        
        <!-- 軸線 -->
        <line x1="${margin.left}" y1="${margin.top}" 
              x2="${margin.left}" y2="${margin.top + plotHeight}" 
              stroke="#212529" stroke-width="2"/>
        <line x1="${margin.left}" y1="${margin.top + plotHeight}" 
              x2="${margin.left + plotWidth}" y2="${margin.top + plotHeight}" 
              stroke="#212529" stroke-width="2"/>
        
        <!-- 刻度 -->
        ${ticks}
        
        <!-- 軸標籤 -->
        <text x="${margin.left + plotWidth/2}" y="${height - 25}" 
              text-anchor="middle" fill="#212529" font-weight="600" font-size="14" font-family="Arial, sans-serif">兩方法平均值 (t/day)</text>
        <text x="20" y="${margin.top + plotHeight/2}" 
              text-anchor="middle" fill="#212529" font-weight="600" font-size="14" font-family="Arial, sans-serif"
              transform="rotate(-90 20 ${margin.top + plotHeight/2})">差值 (系統-人工)</text>
        
        <!-- 標題 -->
        <text x="${width/2}" y="25" 
              text-anchor="middle" fill="#212529" font-weight="700" font-size="16" font-family="Arial, sans-serif">${title}</text>
        
        <!-- 界限線 -->
        ${limitLines}
        
        <!-- 數據點 -->
        ${points}
        
        <!-- 圖例 -->
        <g transform="translate(${width - 200}, 50)">
          <rect x="-8" y="-8" width="190" height="90" fill="rgba(255,255,255,0.95)" stroke="#dee2e6" stroke-width="1" rx="4"/>
          
          <line x1="0" y1="5" x2="20" y2="5" stroke="#fd7e14" stroke-width="3"/>
          <text x="25" y="9" fill="#212529" font-size="11" font-family="Arial, sans-serif">均值: ${meanDiff.toFixed(3)}</text>
          
          <line x1="0" y1="20" x2="20" y2="20" stroke="#dc3545" stroke-dasharray="4,2" stroke-width="2"/>
          <text x="25" y="24" fill="#212529" font-size="11" font-family="Arial, sans-serif">±1.96σ 界限</text>
          
          <circle cx="10" cy="37" r="4" fill="#007bff" stroke="none"/>
          <text x="25" y="41" fill="#212529" font-size="11" font-family="Arial, sans-serif">界限內數據</text>
          
          <circle cx="10" cy="52" r="5" fill="#dc3545" stroke="none"/>
          <text x="25" y="56" fill="#212529" font-size="11" font-family="Arial, sans-serif">界限外數據</text>
          
          <text x="0" y="72" fill="#212529" font-size="11" font-family="Arial, sans-serif">
            一致性: ${(blandAltmanData.agreementRate * 100).toFixed(1)}%
          </text>
        </g>
      </svg>
      
      <!-- 提示框 -->
      <div id="tooltip-${chartId}" style="
        position: absolute;
        background: rgba(33, 37, 41, 0.95);
        color: white;
        padding: 8px 12px;
        border-radius: 4px;
        font-size: 12px;
        font-family: Arial, sans-serif;
        pointer-events: none;
        opacity: 0;
        z-index: 1000;
        transition: opacity 0.2s ease;
        white-space: nowrap;
      "></div>
      
      <style>
        .chart-point-ba {
          transition: r 0.1s ease;
        }
        .chart-point-ba:hover {
          filter: brightness(1.1);
        }
      </style>
      
      <script>
        (function() {
          const svg = document.getElementById('${chartId}');
          const tooltip = document.getElementById('tooltip-${chartId}');
          if (!svg || !tooltip) return;
          
          const points = svg.querySelectorAll('.chart-point-ba');
          
          points.forEach(function(point) {
            point.addEventListener('mouseenter', function() {
              const ship = this.getAttribute('data-ship') || '未知船隻';
              const average = this.getAttribute('data-average') || '0';
              const difference = this.getAttribute('data-difference') || '0';
              const timestamp = this.getAttribute('data-timestamp') || '';
              
              let content = '<div style="font-weight: bold; margin-bottom: 3px; color: #ffffff;">' + ship + '</div>';
              content += '<div style="color: #ffffff;">平均值: ' + average + ' t/day</div>';
              content += '<div style="color: #ffffff;">差異: ' + difference + ' t/day</div>';
              if (timestamp) {
                try {
                  const date = new Date(timestamp).toLocaleDateString('zh-TW');
                  content += '<div style="font-size: 10px; opacity: 0.8; margin-top: 3px; color: #ffffff;">' + date + '</div>';
                } catch (e) {}
              }
              
              tooltip.innerHTML = content;
              tooltip.style.opacity = '1';
              
              // 放大點
              const currentR = parseFloat(this.getAttribute('r'));
              this.setAttribute('r', currentR + 1.5);
            });
            
            point.addEventListener('mouseleave', function() {
              tooltip.style.opacity = '0';
              
              // 恢復點大小
              const difference = parseFloat(this.getAttribute('data-difference')) || 0;
              const upperLimit = ${upperLimit};
              const lowerLimit = ${lowerLimit};
              const isOutside = difference > upperLimit || difference < lowerLimit;
              this.setAttribute('r', isOutside ? 4 : 3);
            });
            
            point.addEventListener('mousemove', function(event) {
              const rect = svg.getBoundingClientRect();
              const x = event.clientX - rect.left + 10;
              const y = event.clientY - rect.top - 30;
              
              tooltip.style.left = x + 'px';
              tooltip.style.top = y + 'px';
            });
          });
        })();
      </script>
    </div>`
}