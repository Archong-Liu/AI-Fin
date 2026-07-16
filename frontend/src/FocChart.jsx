// 每日油耗 Daily FOC — ECharts 版，格式對齊 SlChart.jsx（Grafana / CloudWatch 風）：
// 三條線（乾淨基準 / 實測 FOC / 額外油耗＝實測−基準）、crosshair tooltip 單日明細、
// 底部 dataZoom 時間軸。圖下方 radio 單選一條曲線會隱藏其他兩條，「全部」還原。
// 資料一律來自 charts.js focSeries()；接真實資料時只換那邊，這裡不動。
import React, { useEffect, useRef, useState } from 'react'
import * as echarts from 'echarts/core'
import { LineChart, BarChart } from 'echarts/charts'
import {
  GridComponent, TooltipComponent, DataZoomComponent, LegendComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { focSeries, stackedSeries } from './charts.js'
import { DMAX } from './SlChart.jsx'

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, DataZoomComponent, LegendComponent, CanvasRenderer])

// day index → 時間戳，同 SlChart 的換算（DMAX = 今天）
const tsOf = d => Date.now() - (DMAX - d) * 86400000
const fmtDate = ts => {
  const d = new Date(ts)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}
const OVER = 1.04 // 單日偏高門檻：實測 > 基準 4%（沿用舊柱狀圖紅柱規則）
const COLOR = {
  grid: '#DCE4EB', muted: '#5A7186', accent: '#1F7BC4', text: '#14273A',
  crit: '#C74A3E', good: '#1E9E72', watch: '#B97E1E',
}
const CURVES = [
  { key: 'base', name: '乾淨基準（乾淨船體）', color: COLOR.accent },
  { key: 'act', name: '實測 FOC', color: COLOR.text },
  { key: 'extra', name: '額外油耗（實測−基準）', color: COLOR.crit },
]

export default function FocChart({ ship }) {
  const elRef = useRef(null)
  const chartRef = useRef(null)
  const [only, setOnly] = useState(null) // null＝全部；否則只顯示該 key 的曲線

  useEffect(() => {
    if (!elRef.current) return
    const chart = echarts.init(elRef.current)
    chartRef.current = chart
    const rows = focSeries(ship)
    const val = (r, key) => (key === 'extra' ? Math.max(0, r.act - r.base) : r[key])

    chart.setOption({
      backgroundColor: 'transparent',
      grid: { left: 56, right: 24, top: 20, bottom: 64 },
      // legend 不顯示，只借它的 series 選取狀態給下方 radio 用（dispatchAction 切換）
      legend: { show: false, data: CURVES.map(c => c.name) },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', label: { backgroundColor: COLOR.muted } },
        // 單日明細一律算齊三個值＋狀態，跟顯示中的曲線無關（沿用 SlChart 的 tooltip 資料原理）
        formatter: ps => {
          const r = rows[ps[0].dataIndex]
          const extra = r.act - r.base
          const pct = (r.act / r.base - 1) * 100
          const over = r.act > r.base * OVER
          return `<b>${fmtDate(tsOf(r.d))}（D${r.d}）</b><br/>` +
            `實測 FOC：<b>${r.act.toFixed(1)} t/day</b><br/>` +
            `乾淨基準（模型）：${r.base.toFixed(1)} t/day<br/>` +
            `額外油耗：${extra >= 0 ? '+' : ''}${extra.toFixed(1)} t/day（${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%）<br/>` +
            `狀態：<span style="color:${over ? COLOR.crit : COLOR.good}">${over ? `偏高（超過基準 ${((OVER - 1) * 100).toFixed(0)}%）` : '正常範圍'}</span>`
        },
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: COLOR.grid } },
        axisLabel: { color: COLOR.muted },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value', name: 'Daily FOC（t/day）', nameTextStyle: { color: COLOR.muted },
        scale: true, // 不釘死 min：只看單一曲線時軸距自動貼合該曲線
        axisLabel: { color: COLOR.muted },
        splitLine: { lineStyle: { color: COLOR.grid } },
      },
      dataZoom: [
        { type: 'inside', xAxisIndex: 0 },
        { type: 'slider', xAxisIndex: 0, height: 20, bottom: 10, borderColor: COLOR.grid,
          fillerColor: 'rgba(31,123,196,.12)', handleStyle: { color: COLOR.accent } },
      ],
      series: CURVES.map(c => ({
        name: c.name, type: 'line', showSymbol: false,
        data: rows.map(r => [tsOf(r.d), val(r, c.key)]),
        lineStyle: { width: 2, color: c.color },
        itemStyle: { color: c.color },
      })),
    })

    return () => chart.dispose()
  }, [ship])

  // radio → 曲線顯示/隱藏：走 legend 選取狀態，不重建圖表。
  // 依賴含 ship：換船重建圖後 legend 會重置為全顯示，這裡把選取狀態補回去。
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    CURVES.forEach(c => chart.dispatchAction({
      type: only == null || only === c.key ? 'legendSelect' : 'legendUnSelect',
      name: c.name,
    }))
  }, [only, ship])

  // 同 SlChart：用 ResizeObserver 而非 window resize，drawer 開關擠壓版面時才會跟著重算
  useEffect(() => {
    const ro = new ResizeObserver(() => chartRef.current?.resize())
    ro.observe(elRef.current)
    return () => ro.disconnect()
  }, [])

  return (
    <div>
      <div ref={elRef} style={{ width: '100%', height: 380 }} role="img" aria-label="每日油耗三線圖：乾淨基準、實測 FOC、額外油耗" />
      <div className="range-opts" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 18, marginTop: 6 }}>
        <label>
          <input type="radio" name="foccurve" checked={only == null} onChange={() => setOnly(null)} />全部
        </label>
        {CURVES.map(c => (
          <label key={c.key}>
            <input type="radio" name="foccurve" checked={only === c.key} onChange={() => setOnly(c.key)} />
            <span className="sw" style={{ background: c.color }} />{c.name}
          </label>
        ))}
      </div>
    </div>
  )
}

/* ---------- 額外油耗歸因 — 只堆疊「超出乾淨基準」的成分 ---------- */
const PARTS = [
  { key: 'wind', name: '風阻', color: '#8CA0B2' },
  { key: 'draft', name: '吃水', color: '#B9C7D2' },
  { key: 'hull', name: '船體汙損', color: COLOR.crit },
  { key: 'prop', name: '螺槳', color: COLOR.watch },
]

export function FocAttribution({ ship }) {
  const elRef = useRef(null)
  const chartRef = useRef(null)

  useEffect(() => {
    if (!elRef.current) return
    const chart = echarts.init(elRef.current)
    chartRef.current = chart
    const rows = stackedSeries(ship)

    chart.setOption({
      backgroundColor: 'transparent',
      grid: { left: 56, right: 24, top: 44, bottom: 28 },
      // 圖例靠右上，避免和左上的 y 軸名稱「額外油耗（t/day）」重疊
      legend: { top: 0, right: 24, itemWidth: 14, textStyle: { color: COLOR.text } },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        // 歸因明細：各成分 t/day＋占額外油耗的百分比，乾淨基準只當對照
        formatter: ps => {
          const r = rows[ps[0].dataIndex]
          const tot = PARTS.reduce((s, p) => s + r[p.key], 0)
          const items = PARTS.map(p =>
            `<span style="color:${p.color}">●</span> ${p.name}：${r[p.key].toFixed(1)} t/day（${(r[p.key] / tot * 100).toFixed(0)}%）`
          ).join('<br/>')
          return `<b>${fmtDate(tsOf(r.d))}（D${r.d}）</b><br/>` +
            `額外油耗合計：<b>${tot.toFixed(1)} t/day</b>（乾淨基準 ${r.base.toFixed(1)} 的 +${(tot / r.base * 100).toFixed(1)}%）<br/>${items}`
        },
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: COLOR.grid } },
        axisLabel: { color: COLOR.muted },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value', name: '額外油耗（t/day）', nameTextStyle: { color: COLOR.muted },
        axisLabel: { color: COLOR.muted },
        splitLine: { lineStyle: { color: COLOR.grid } },
      },
      series: PARTS.map(p => ({
        name: p.name, type: 'bar', stack: 'extra', barWidth: '55%',
        data: rows.map(r => [tsOf(r.d), r[p.key]]),
        itemStyle: { color: p.color },
      })),
    })

    return () => chart.dispose()
  }, [ship])

  useEffect(() => {
    const ro = new ResizeObserver(() => chartRef.current?.resize())
    ro.observe(elRef.current)
    return () => ro.disconnect()
  }, [])

  return <div ref={elRef} style={{ width: '100%', height: 300 }} role="img" aria-label="額外油耗歸因堆疊圖：風阻、吃水、船體汙損、螺槳" />
}
