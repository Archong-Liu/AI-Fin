// 互動式 Speed Loss 主圖：左右拖曳平移、滾輪/按鈕縮放（股票圖式操作）。
// 資料一律走 useShipSeries，後台 API 就緒後只改該 hook，繪圖不動。
import React, { useState, useEffect, useRef } from 'react'
import { dailySeries } from './charts.js'
import { statusOf, STATUS_TXT, CONFIG } from './data.js'

export const DMAX = 1825
const MIN_WIN = 60
const W = 980, H = 340, L = 46, B = 26, T = 14, R = 30
const PLOT_W = W - L - R

function useShipSeries(ship) {
  // 真實資料：api.js 的 adaptFleet 已把 fleet_data.json 轉成 ship.series；mock 船才用產生器
  const [series, setSeries] = useState(() => ship.series ?? dailySeries(ship))
  useEffect(() => { setSeries(ship.series ?? dailySeries(ship)) }, [ship])
  // 資料每 60s 會在 CloudFront 更新（issue #5）；要即時刷新時在 App 層重抓 fleet_data.json 即可
  return series
}

// D1825 = 今日，往回推算實際日期（demo 對齊 noon_reports 2021–2025）
const dateOf = d => {
  const t = new Date(Date.now() - (DMAX - d) * 86400000)
  return `${t.getFullYear()}/${String(t.getMonth() + 1).padStart(2, '0')}/${String(t.getDate()).padStart(2, '0')}`
}

export default function SlExplorer({ ship, thr, win, setWin }) {
  const svgRef = useRef(null)
  const drag = useRef(null)
  const movedRef = useRef(false)
  const trackRef = useRef(null)
  const tdrag = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [sel, setSel] = useState(null) // 被點選的資料點
  const { segs, events, pts } = useShipSeries(ship)
  useEffect(() => { setSel(null) }, [ship])

  const span = win.d1 - win.d0
  const clampWin = (d0, d1) => {
    const s = d1 - d0
    if (d0 < 0) { d0 = 0; d1 = s }
    if (d1 > DMAX) { d1 = DMAX; d0 = DMAX - s }
    return { d0, d1 }
  }
  const zoomAt = (factor, fx = 0.5) => setWin(w => {
    const s0 = w.d1 - w.d0
    const s1 = Math.min(DMAX, Math.max(MIN_WIN, s0 * factor))
    const anchor = w.d0 + fx * s0
    return clampWin(anchor - fx * s1, anchor - fx * s1 + s1)
  })

  const onPointerDown = e => {
    drag.current = { x: e.clientX, w: { ...win } }
    movedRef.current = false
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = e => {
    if (!drag.current) return
    if (Math.abs(e.clientX - drag.current.x) > 3) movedRef.current = true
    const rect = svgRef.current.getBoundingClientRect()
    const plotPx = rect.width * PLOT_W / W
    const dxDays = (drag.current.x - e.clientX) / plotPx * (drag.current.w.d1 - drag.current.w.d0)
    setWin(clampWin(drag.current.w.d0 + dxDays, drag.current.w.d1 + dxDays))
  }
  const onPointerUp = () => { drag.current = null; setDragging(false) }

  // 底部時間軸捲動條：拖 thumb 平移視窗、點軌道跳到該處
  const thumbDown = e => {
    e.stopPropagation()
    tdrag.current = { x: e.clientX, w: { ...win } }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const thumbMove = e => {
    if (!tdrag.current) return
    const tw = trackRef.current.getBoundingClientRect().width
    const dd = (e.clientX - tdrag.current.x) / tw * DMAX
    setWin(clampWin(tdrag.current.w.d0 + dd, tdrag.current.w.d1 + dd))
  }
  const thumbUp = () => { tdrag.current = null }
  const trackJump = e => {
    const r = trackRef.current.getBoundingClientRect()
    const mid = (e.clientX - r.left) / r.width * DMAX
    const s = win.d1 - win.d0
    setWin(clampWin(mid - s / 2, mid + s / 2))
  }

  useEffect(() => {
    const el = svgRef.current
    const onWheel = e => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const fx = Math.min(1, Math.max(0, ((e.clientX - rect.left) / rect.width * W - L) / PLOT_W))
      zoomAt(e.deltaY > 0 ? 1.2 : 1 / 1.2, fx)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // 視窗裁切：跨界趨勢段線性內插
  const vsegs = segs.filter(s => s.d1 > win.d0 && s.d0 < win.d1).map(s => {
    const vAt = d => s.v0 + (s.v1 - s.v0) * (d - s.d0) / (s.d1 - s.d0)
    const d0 = Math.max(s.d0, win.d0), d1 = Math.min(s.d1, win.d1)
    return { d0, d1, v0: vAt(d0), v1: vAt(d1) }
  })
  const vpts = pts.filter(p => p.d >= win.d0 && p.d <= win.d1)
  const vevents = events.filter(e => e.d >= win.d0 && e.d <= win.d1)
  // Y 軸上限用可見點的 97 百分位，避免單日離群值把整張圖壓扁（超出的點貼頂顯示）
  const vsSorted = vpts.map(p => p.v).sort((a, b) => a - b)
  const p97 = vsSorted.length ? vsSorted[Math.floor((vsSorted.length - 1) * 0.97)] : 0
  const max = Math.max(thr * 1.25, p97, ...vsegs.flatMap(s => [s.v0, s.v1])) * 1.08
  const px = d => L + ((d - win.d0) / span) * PLOT_W
  const py = v => T + (1 - v / max) * (H - T - B)
  const xStep = [7, 14, 30, 61, 91, 182, 365].find(s => span / s <= 8) || 365
  const xTicks = []
  for (let d = Math.ceil(win.d0 / xStep) * xStep; d <= win.d1; d += xStep) xTicks.push(d)
  const yTicks = [0, 1, 2, 3, 4].map(g => (max / 4) * g)
  const last = segs[segs.length - 1]
  const bands = [[thr, max, 'var(--crit)'], [thr / 2, thr, 'var(--watch)'], [0, thr / 2, 'var(--good)']]

  return (
    <div className="sl-explorer">
      <div className="explorer-bar">
        <span>視窗 D{Math.round(win.d0)}–D{Math.round(win.d1)}（{Math.round(span)} 天）</span>
        <span>橫軸每格 {xStep} 天 · 縱軸每格 {(max / 4).toFixed(1)}%</span>
        <span className="faint">拖曳平移 · 滾輪縮放</span>
        <span className="btns">
          <button onClick={() => zoomAt(1 / 1.4)} aria-label="放大">＋</button>
          <button onClick={() => zoomAt(1.4)} aria-label="縮小">−</button>
          <button className="txt" onClick={() => setWin({ d0: 0, d1: DMAX })}>重置</button>
        </span>
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="speed loss 時間序列（可拖曳平移、縮放，點資料點看詳情）"
        className={dragging ? 'dragging' : ''}
        onClick={() => { if (!movedRef.current) setSel(null) }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={L} y1={py(v)} x2={W - R} y2={py(v)} stroke="var(--chart-grid)" />
            <text x={L - 6} y={py(v) + 3} textAnchor="end">{v.toFixed(1)}%</text>
          </g>
        ))}
        {xTicks.map(d => (
          <g key={d}>
            <line x1={px(d)} y1={H - B} x2={px(d)} y2={H - B + 4} stroke="var(--chart-grid)" />
            <text x={px(d)} y={H - 6} textAnchor="middle">D{d}</text>
          </g>
        ))}
        <rect x={L} y={T} width={PLOT_W} height={Math.max(0, py(thr) - T)} fill="var(--crit)" opacity=".05" />
        <line x1={L} x2={W - R} y1={py(thr)} y2={py(thr)} stroke="var(--crit)" strokeDasharray="5 4" />
        <text x={W - R - 4} y={py(thr) - 5} textAnchor="end" style={{ fill: 'var(--crit)' }}>警戒線 {thr}%</text>
        {bands.map(([v0, v1, c], i) => {
          const yTop = py(Math.min(v1, max))
          return <rect key={i} x={W - 20} y={yTop} width="10" height={Math.max(0, py(v0) - yTop)} fill={c} opacity=".35" />
        })}
        {vevents.map(e => (
          <g key={e.d}>
            <line x1={px(e.d)} x2={px(e.d)} y1={T} y2={H - B} stroke="var(--faint)" strokeDasharray="3 4" />
            <text x={px(e.d) + 4} y={T + 10}>{e.label}</text>
          </g>
        ))}
        {vpts.map(p => <circle key={p.d} cx={px(p.d)} cy={Math.max(T, py(p.v))} r="1.7" fill="var(--accent)" opacity=".35" />)}
        {vsegs.map((s, i) => <line key={i} x1={px(s.d0)} y1={py(s.v0)} x2={px(s.d1)} y2={py(s.v1)} stroke="var(--accent)" strokeWidth="2.2" />)}
        {last && last.d1 >= win.d0 && last.d1 <= win.d1 && (
          <g>
            <circle cx={px(last.d1)} cy={py(last.v1)} r="4" fill="var(--accent)" />
            <text x={px(last.d1) - 6} y={py(last.v1) + 16} textAnchor="end"
              style={{ fill: 'var(--text)', fontWeight: 600 }}>目前 {last.v1.toFixed(1)}%</text>
          </g>
        )}
        {vpts.map(p => (
          <circle key={`h${p.d}`} cx={px(p.d)} cy={py(p.v)} r="8" fill="transparent" style={{ cursor: 'pointer' }}
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); setSel(p) }} />
        ))}
        {sel && sel.d >= win.d0 && sel.d <= win.d1 && (() => {
          const x = px(sel.d), y = py(sel.v)
          const BW = 232, BH = 132
          const bx = x + 14 + BW > W - R ? x - 14 - BW : x + 14
          const by = Math.min(Math.max(T, y - BH / 2), H - B - BH)
          const seg = segs.find(s => sel.d >= s.d0 && sel.d <= s.d1)
          const tv = seg ? seg.v0 + (seg.v1 - seg.v0) * (sel.d - seg.d0) / Math.max(1, seg.d1 - seg.d0) : null
          const stp = statusOf(sel.v, thr)
          const gap = sel.v - thr
          return (
            <g onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
              <circle cx={x} cy={y} r="6" fill="none" stroke="var(--accent)" strokeWidth="2" />
              <rect x={bx} y={by} width={BW} height={BH} fill="var(--panel)" stroke="var(--line)" />
              <text x={bx + 12} y={by + 22} style={{ fill: 'var(--text)', fontWeight: 600 }}>{dateOf(sel.d)}（D{sel.d}）</text>
              <text x={bx + 12} y={by + 44}>實測 Speed Loss：{sel.v.toFixed(2)}%</text>
              <text x={bx + 12} y={by + 62}>區間趨勢值：{tv != null ? `${tv.toFixed(2)}%` : '—'}</text>
              <text x={bx + 12} y={by + 80}>對警戒線 {thr}%：{gap >= 0 ? '+' : ''}{gap.toFixed(2)} pt</text>
              <text x={bx + 12} y={by + 98}>估計額外油耗：{(sel.v * CONFIG.penaltyPerSl).toFixed(1)} t/day</text>
              <text x={bx + 12} y={by + 118} style={{ fill: `var(--${stp})`, fontWeight: 600 }}>狀態：{STATUS_TXT[stp]}</text>
            </g>
          )
        })()}
      </svg>
      <div className="sl-scroll" ref={trackRef} onPointerDown={trackJump} role="scrollbar"
        aria-label="時間軸捲動" aria-valuemin={0} aria-valuemax={DMAX} aria-valuenow={Math.round(win.d0)}>
        <div className="sl-thumb" style={{ left: `${win.d0 / DMAX * 100}%`, width: `${span / DMAX * 100}%` }}
          onPointerDown={thumbDown} onPointerMove={thumbMove} onPointerUp={thumbUp} onPointerCancel={thumbUp} />
      </div>
    </div>
  )
}
