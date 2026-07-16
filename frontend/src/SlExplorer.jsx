// 互動式 Speed Loss 主圖：拖曳平移、滾輪/按鈕縮放、底部時間軸捲動條、點資料點看單日資訊；
// 趨勢線一律逐點直線連接實測值（依養護事件分段，不跨事件邊界），不做回歸/週期性擬合——
// 汙損累積是單向趨勢，強行擬合一條公式（線性/多項式/指數/傅立葉皆試過）反而會生出資料裡
// 沒有的形狀，不如直接連線誠實、好懂。
// 資料一律走 useShipSeries（api.js 銜接層產出），mock 船才用 charts.js 產生器。
import React, { useState, useEffect, useRef, useMemo } from 'react'
import { dailySeries, dateOf } from './charts.js'
import { statusOf, STATUS_TXT, CONFIG } from './data.js'

export const DMAX = 1825
const MIN_WIN = 60
const W = 980, H = 430, L = 80, B = 58, T = 16, R = 30
const PLOT_W = W - L - R

function useShipSeries(ship) {
  const [series, setSeries] = useState(() => ship.series ?? dailySeries(ship))
  useEffect(() => { setSeries(ship.series ?? dailySeries(ship)) }, [ship])
  return series
}

// pts:[{t,v}]（t=距區間起點天數，已依 t 排序）→ eval(t) 逐段線性內插；區間外 clamp 到端點值
function connectPoints(pts) {
  if (pts.length < 2) return null
  const ev = t => {
    if (t <= pts[0].t) return pts[0].v
    if (t >= pts[pts.length - 1].t) return pts[pts.length - 1].v
    let i = 0
    while (i < pts.length - 2 && pts[i + 1].t < t) i++
    const a = pts[i], b = pts[i + 1]
    return b.t > a.t ? a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t) : a.v
  }
  return { eval: ev }
}

export default function SlExplorer({ ship, thr, win, setWin }) {
  const svgRef = useRef(null)
  const drag = useRef(null)
  const movedRef = useRef(false)
  const trackRef = useRef(null)
  const tdrag = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [sel, setSel] = useState(null)        // 被點選的資料點
  const { events, pts } = useShipSeries(ship)
  useEffect(() => { setSel(null) }, [ship])

  // 每個養護區間各自逐點連線，不跨事件邊界（清潔前後不會互相污染顯示）
  const curves = useMemo(() => {
    const bounds = [0, ...events.map(e => e.d), DMAX + 1]
    const out = []
    for (let bi = 0; bi < bounds.length - 1; bi++) {
      const seg = pts.filter(p => p.d >= bounds[bi] && p.d < bounds[bi + 1])
      if (seg.length < 2) continue
      const d0 = seg[0].d, d1 = seg[seg.length - 1].d
      const f = connectPoints(seg.map(p => ({ t: p.d - d0, v: p.v })))
      if (f) out.push({ ...f, d0, d1, n: seg.length })
    }
    return out
  }, [pts, events])

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

  const vpts = pts.filter(p => p.d >= win.d0 && p.d <= win.d1)
  const vevents = events.filter(e => e.d >= win.d0 && e.d <= win.d1)
  // Y 上限：可見點 97 百分位（離群日貼頂顯示，不壓扁整張圖）
  const vsSorted = vpts.map(p => p.v).sort((a, b) => a - b)
  const p97 = vsSorted.length ? vsSorted[Math.floor((vsSorted.length - 1) * 0.97)] : 0
  const max = Math.max(thr * 1.25, p97) * 1.08
  const px = d => L + ((d - win.d0) / span) * PLOT_W
  const py = v => T + (1 - v / max) * (H - T - B)
  const xStep = [7, 14, 30, 61, 91, 182, 365].find(s => span / s <= 8) || 365
  const xTicks = []
  for (let d = Math.ceil(win.d0 / xStep) * xStep; d <= win.d1; d += xStep) xTicks.push(d)
  const yTicks = [0, 1, 2, 3, 4].map(g => (max / 4) * g)
  const bands = [[thr, max, 'var(--crit)'], [thr / 2, thr, 'var(--watch)'], [0, thr / 2, 'var(--good)']]
  const lastCurve = curves[curves.length - 1]

  // 曲線取樣成 path（只畫視窗內的部分，值 clamp ≥ 0）
  const curvePath = c => {
    const a = Math.max(c.d0, win.d0), b = Math.min(c.d1, win.d1)
    if (a >= b) return null
    const n = 64, seg = []
    for (let k2 = 0; k2 <= n; k2++) {
      const d = a + (b - a) * k2 / n
      seg.push(`${k2 ? 'L' : 'M'}${px(d).toFixed(1)},${py(Math.max(0, c.eval(d - c.d0))).toFixed(1)}`)
    }
    return seg.join('')
  }

  return (
    <div className="sl-explorer">
      <div className="explorer-bar">
        <span className="btns">
          <button onClick={() => zoomAt(1 / 1.4)} aria-label="放大">＋</button>
          <button onClick={() => zoomAt(1.4)} aria-label="縮小">−</button>
          <button className="txt" onClick={() => setWin({ d0: 0, d1: DMAX })}>重置</button>
        </span>
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
        aria-label="speed loss 時間序列（可拖曳平移、縮放；點資料點看詳情）"
        className={dragging ? 'dragging' : ''}
        onClick={() => { if (!movedRef.current) setSel(null) }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <text transform={`rotate(-90 20 ${(T + H - B) / 2})`} x="20" y={(T + H - B) / 2}
          textAnchor="middle" style={{ fill: 'var(--muted)', fontWeight: 600 }}>Speed Loss（%）</text>
        <text x={L + PLOT_W / 2} y={H - 6} textAnchor="middle" style={{ fill: 'var(--muted)', fontWeight: 600 }}>
          日期（D = 資料起算第幾天）
        </text>
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={L} y1={py(v)} x2={W - R} y2={py(v)} stroke="var(--chart-grid)" />
            <text x={L - 8} y={py(v) + 4} textAnchor="end">{v.toFixed(1)}%</text>
          </g>
        ))}
        {xTicks.map(d => {
          const anchor = px(d) > W - R - 40 ? 'end' : 'middle' // 貼近右緣的刻度靠右對齊，避免日期被裁切
          return (
            <g key={d}>
              <line x1={px(d)} y1={H - B} x2={px(d)} y2={H - B + 5} stroke="var(--chart-grid)" />
              <text x={px(d)} y={H - B + 19} textAnchor={anchor}>{dateOf(d)}</text>
              <text x={px(d)} y={H - B + 34} textAnchor={anchor} style={{ fill: 'var(--faint)' }}>D{d}</text>
            </g>
          )
        })}
        <rect x={L} y={T} width={PLOT_W} height={Math.max(0, py(thr) - T)} fill="var(--crit)" opacity=".05" />
        <line x1={L} x2={W - R} y1={py(thr)} y2={py(thr)} stroke="var(--crit)" strokeDasharray="5 4" />
        <text x={W - R - 4} y={py(thr) - 6} textAnchor="end" style={{ fill: 'var(--crit)' }}>警戒線 {thr}%</text>
        {bands.map(([v0, v1, c], i) => {
          const yTop = py(Math.min(v1, max))
          return <rect key={i} x={W - 20} y={yTop} width="10" height={Math.max(0, py(v0) - yTop)} fill={c} opacity=".35" />
        })}
        {(() => {
          // 相鄰事件（畫面距離近）標籤上下交替錯開，避免疊字
          let prevX = -Infinity, prevLift = 0
          return vevents.map(e => {
            const lift = px(e.d) - prevX < 96 ? (prevLift === 0 ? 16 : 0) : 0
            prevX = px(e.d); prevLift = lift
            return (
              <g key={e.d}>
                <line x1={px(e.d)} x2={px(e.d)} y1={T} y2={H - B} stroke="var(--faint)" strokeDasharray="3 4" />
                <text x={px(e.d) + 4} y={T + 12 + lift}>{e.label}</text>
              </g>
            )
          })
        })()}
        {vpts.map(p => <circle key={p.d} cx={px(p.d)} cy={Math.max(T, py(p.v))} r="2" fill="var(--text)" opacity=".8" />)}
        {curves.map((c, i) => {
          const d = curvePath(c)
          return d && <path key={i} d={d} fill="none" stroke="var(--accent)" strokeWidth="2.4" />
        })}
        {lastCurve && lastCurve.d1 >= win.d0 && lastCurve.d1 <= win.d1 && (() => {
          const vEnd = Math.max(0, lastCurve.eval(lastCurve.d1 - lastCurve.d0))
          return (
            <g>
              <circle cx={px(lastCurve.d1)} cy={py(vEnd)} r="4" fill="var(--accent)" />
              <text x={px(lastCurve.d1) - 8} y={py(vEnd) + 18} textAnchor="end"
                style={{ fill: 'var(--text)', fontWeight: 600 }}>目前 {vEnd.toFixed(1)}%</text>
            </g>
          )
        })()}
        {vpts.map(p => (
          <circle key={`h${p.d}`} cx={px(p.d)} cy={Math.max(T, py(p.v))} r="8" fill="transparent" style={{ cursor: 'pointer' }}
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); setSel(p) }} />
        ))}
        {sel && sel.d >= win.d0 && sel.d <= win.d1 && (() => {
          const x = px(sel.d), y = Math.max(T, py(sel.v))
          const BW = 232, BH = 114
          const bx = x + 14 + BW > W - R ? x - 14 - BW : x + 14
          const by = Math.min(Math.max(T, y - BH / 2), H - B - BH)
          const stp = statusOf(sel.v, thr)
          const gap = sel.v - thr
          return (
            <g onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
              <circle cx={x} cy={y} r="6" fill="none" stroke="var(--accent)" strokeWidth="2" />
              <rect x={bx} y={by} width={BW} height={BH} fill="var(--panel)" stroke="var(--line)" />
              <text x={bx + 12} y={by + 22} style={{ fill: 'var(--text)', fontWeight: 600 }}>{dateOf(sel.d)}（D{sel.d}）</text>
              <text x={bx + 12} y={by + 44}>實測 Speed Loss：{sel.v.toFixed(2)}%</text>
              <text x={bx + 12} y={by + 62}>對警戒線 {thr}%：{gap >= 0 ? '+' : ''}{gap.toFixed(2)} pt</text>
              <text x={bx + 12} y={by + 80}>估計額外油耗：{(sel.v * CONFIG.penaltyPerSl).toFixed(1)} t/day</text>
              <text x={bx + 12} y={by + 98} style={{ fill: `var(--${stp})`, fontWeight: 600 }}>狀態：{STATUS_TXT[stp]}</text>
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
