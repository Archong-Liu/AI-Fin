// Speed Loss 時間序列圖 — Grafana / CloudWatch 風格：dataZoom 滾輪縮放 + 底部時間軸刷選、
// crosshair tooltip、依警戒線分段上色（threshold coloring）、養護事件標記線。
// 用 ECharts 取代原本手刻 SVG 的座標/縮放/擬合邏輯；資料一律走 ship.series（api.js 銜接層產出）。
import React, { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import {
  GridComponent, TooltipComponent, DataZoomComponent, MarkLineComponent, VisualMapComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { dailySeries } from './charts.js'
import { statusOf, STATUS_TXT, CONFIG } from './data.js'

echarts.use([
  LineChart, GridComponent, TooltipComponent, DataZoomComponent, MarkLineComponent,
  VisualMapComponent, CanvasRenderer,
])

export const DMAX = 1825
// day index（0..DMAX）→ 真實時間戳：DMAX = 今天，往回推。與 charts.js 的 dateOf() 同一套換算，
// 這裡要數值型時間戳給 ECharts 的 time 軸用。
const tsOf = d => Date.now() - (DMAX - d) * 86400000

function useShipSeries(ship) {
  const [series, setSeries] = React.useState(() => ship.series ?? dailySeries(ship))
  useEffect(() => { setSeries(ship.series ?? dailySeries(ship)) }, [ship])
  return series
}

const COLOR = {
  good: '#1E9E72', watch: '#B97E1E', crit: '#C74A3E', accent: '#1F7BC4',
  grid: '#DCE4EB', muted: '#5A7186', faint: '#8CA0B2', panel: '#FFFFFF', text: '#14273A',
}

export default function SlChart({ ship, thr, win, setWin }) {
  const elRef = useRef(null)
  const chartRef = useRef(null)
  const { events, pts } = useShipSeries(ship)

  // 初次建圖 + 船隻切換時整組重建（軸線範圍、markLine、visualMap 分段都跟著這艘船的資料變）
  useEffect(() => {
    if (!elRef.current) return
    const chart = echarts.init(elRef.current)
    chartRef.current = chart

    const data = pts.map(p => [tsOf(p.d), Math.max(0, p.v)])
    const half = thr / 2

    chart.setOption({
      backgroundColor: 'transparent',
      grid: { left: 56, right: 24, top: 20, bottom: 64 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', label: { backgroundColor: COLOR.muted } },
        formatter: p0 => {
          const p = p0[0]
          const v = p.value[1]
          const st = statusOf(v, thr)
          const d = new Date(p.value[0])
          const date = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
          return `<b>${date}</b><br/>Speed Loss：<b>${v.toFixed(2)}%</b><br/>` +
            `對警戒線 ${thr}%：${(v - thr >= 0 ? '+' : '')}${(v - thr).toFixed(2)} pt<br/>` +
            `估計額外油耗：${(v * CONFIG.penaltyPerSl).toFixed(1)} t/day<br/>` +
            `狀態：<span style="color:${COLOR[st]}">${STATUS_TXT[st]}</span>`
        },
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: COLOR.grid } },
        axisLabel: { color: COLOR.muted },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value', name: 'Speed Loss（%）', nameTextStyle: { color: COLOR.muted },
        min: 0, scale: true,
        axisLabel: { color: COLOR.muted, formatter: '{value}%' },
        splitLine: { lineStyle: { color: COLOR.grid } },
      },
      // 底部時間軸刷選（Grafana/CloudWatch 的 time range bar）+ 滾輪/拖曳縮放；
      // 初始位置直接讀 win（外部「顯示區間」按鈕的初始值），後續變更改走 dispatchAction（見下方
      // effect）——setOption 的 startValue/endValue 對「已建好」的 dataZoom 不可靠，只在初始化生效。
      dataZoom: [
        { type: 'inside', xAxisIndex: 0, startValue: tsOf(win.d0), endValue: tsOf(win.d1) },
        { type: 'slider', xAxisIndex: 0, height: 20, bottom: 10, borderColor: COLOR.grid,
          startValue: tsOf(win.d0), endValue: tsOf(win.d1),
          fillerColor: 'rgba(31,123,196,.12)', handleStyle: { color: COLOR.accent } },
      ],
      // 依警戒線分段上色（threshold coloring）——低於半警戒線綠、半警戒線~警戒線黃、超過警戒線紅
      visualMap: {
        show: false, dimension: 1, seriesIndex: 0,
        pieces: [
          { max: half, color: COLOR.good },
          { min: half, max: thr, color: COLOR.watch },
          { min: thr, color: COLOR.crit },
        ],
      },
      series: [{
        type: 'line', data, showSymbol: false, sampling: 'lttb',
        lineStyle: { width: 2 },
        markLine: {
          symbol: 'none', silent: true,
          label: { formatter: p => p.data.label, color: COLOR.muted, fontSize: 11 },
          lineStyle: { type: 'dashed', color: COLOR.faint },
          data: [
            ...events.map(e => ({ xAxis: tsOf(e.d), label: e.label })),
            { yAxis: thr, lineStyle: { color: COLOR.crit, type: 'dashed' },
              label: { formatter: `警戒線 ${thr}%`, color: COLOR.crit, position: 'insideEndTop' } },
          ],
        },
      }],
    })

    return () => chart.dispose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ship, pts, events, thr])

  // 外部 win（顯示區間按鈕）→ 圖表 dataZoom：改變已建好圖表的縮放位置要用 dispatchAction，
  // setOption 的 startValue/endValue 對「已經在跑」的 dataZoom 不可靠（只在初始化那次生效，
  // 這也是「顯示區間按鈕沒作用」的原因）。
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.dispatchAction({ type: 'dataZoom', startValue: tsOf(win.d0), endValue: tsOf(win.d1) })
  }, [win])

  // 圖表拖曳/縮放 → 回寫 win，兩邊互相同步；直接吃事件參數，不用 getOption() 反推
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const onZoom = params => {
      const b = params.batch?.[0] ?? params
      if (b.startValue == null || b.endValue == null) return
      const d0 = Math.round((b.startValue - tsOf(0)) / 86400000)
      const d1 = Math.round((b.endValue - tsOf(0)) / 86400000)
      setWin(w => (w.d0 === d0 && w.d1 === d1 ? w : { d0, d1 }))
    }
    chart.on('datazoom', onZoom)
    return () => chart.off('datazoom', onZoom)
  }, [setWin])

  // 容器寬度變化（開關 AI 諮詢 drawer、視窗縮放）都要重算 canvas 尺寸，
  // 只聽 window resize 會漏掉 drawer 擠壓 .main-col 的情況 → 圖表卡在舊寬度
  useEffect(() => {
    const ro = new ResizeObserver(() => chartRef.current?.resize())
    ro.observe(elRef.current)
    return () => ro.disconnect()
  }, [])

  return <div ref={elRef} style={{ width: '100%', height: 430 }} role="img" aria-label="speed loss 時間序列" />
}
