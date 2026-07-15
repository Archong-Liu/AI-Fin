// 互動式 Speed Loss 主圖：拖曳平移、滾輪/按鈕縮放、底部時間軸捲動條、
// 點資料點看單日資訊；趨勢函數可選（線性/多項式/指數/傅立葉），點曲線看公式與 R²。
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

/* ===== 擬合核心：廣義最小二乘（basis 線性組合 + 高斯消去） ===== */
function lstsq(pts, basis) {
  const m = basis.length
  const A = Array.from({ length: m }, () => new Array(m + 1).fill(0))
  for (const p of pts) {
    const phi = basis.map(f => f(p.t))
    for (let i = 0; i < m; i++) {
      A[i][m] += phi[i] * p.v
      for (let k = 0; k < m; k++) A[i][k] += phi[i] * phi[k]
    }
  }
  for (let c = 0; c < m; c++) { // 部分選主元
    let piv = c
    for (let r2 = c + 1; r2 < m; r2++) if (Math.abs(A[r2][c]) > Math.abs(A[piv][c])) piv = r2
    if (Math.abs(A[piv][c]) < 1e-12) return null
    ;[A[c], A[piv]] = [A[piv], A[c]]
    for (let r2 = 0; r2 < m; r2++) {
      if (r2 === c) continue
      const f = A[r2][c] / A[c][c]
      for (let k = c; k <= m; k++) A[r2][k] -= f * A[c][k]
    }
  }
  return A.map((row, i) => row[m] / row[i])
}

const r2Of = (pts, ev) => {
  const mean = pts.reduce((a, p) => a + p.v, 0) / pts.length
  let sr = 0, st = 0
  pts.forEach(p => { sr += (p.v - ev(p.t)) ** 2; st += (p.v - mean) ** 2 })
  return st > 1e-9 ? Math.max(0, 1 - sr / st) : 1
}
const fmt = x => Math.abs(x) >= 1e4 || (x !== 0 && Math.abs(x) < 1e-3) ? x.toExponential(2) : +x.toPrecision(3)

export const FIT_TYPES = [
  ['linear', '線性 Linear'],
  ['poly2', '二次多項式 Poly-2'],
  ['poly3', '三次多項式 Poly-3'],
  ['exp', '指數 Exponential'],
  ['fourier', '傅立葉 DFT'],
]

// pts:[{t,v}]（t=距區間起點天數）→ { eval, formula, r2 }；擬合失敗回 null
function fitInterval(pts, type, Tspan) {
  const u = t => t / Tspan // 多項式用正規化時間避免數值病態
  if (type === 'linear' || type === 'poly2' || type === 'poly3') {
    const deg = type === 'linear' ? 1 : type === 'poly2' ? 2 : 3
    if (pts.length < deg + 2) return null
    const basis = Array.from({ length: deg + 1 }, (_, k) => t => u(t) ** k)
    const c = lstsq(pts, basis)
    if (!c) return null
    const ev = t => c.reduce((a, ck, k) => a + ck * u(t) ** k, 0)
    const a = c.map((ck, k) => ck / Tspan ** k) // 換回 t 係數供顯示
    const expr = a.map((ak, k) => k === 0 ? { t: 'num', v: ak } : { t: 'pow', coef: ak, pow: k })
    return { eval: ev, expr, r2: r2Of(pts, ev) }
  }
  if (type === 'exp') {
    const pos = pts.filter(p => p.v > 0.05)
    if (pos.length < 4) return null
    const c = lstsq(pos.map(p => ({ t: p.t, v: Math.log(p.v) })), [() => 1, t => t])
    if (!c) return null
    const ev = t => Math.exp(c[0] + c[1] * t)
    return { eval: ev, expr: [{ t: 'exp', a: Math.exp(c[0]), b: c[1] }], r2: r2Of(pts, ev) }
  }
  if (type === 'fourier') {
    // 離散傅立葉變換：實測日不等距 → 線性內插到均勻網格 → 樸素 DFT（N=64 夠快）
    // → 取振幅前 K 大的諧波做截斷重建（低通近似）
    if (pts.length < 8) return null
    const N = 64, K = 4
    const xs = new Array(N)
    let j = 0
    for (let i = 0; i < N; i++) {
      const t = Tspan * i / N
      while (j < pts.length - 2 && pts[j + 1].t < t) j++
      const a = pts[j], b = pts[Math.min(j + 1, pts.length - 1)]
      xs[i] = b.t > a.t ? a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t) : a.v
    }
    const a0 = xs.reduce((s, x) => s + x, 0) / N
    const comps = []
    for (let k = 1; k <= N / 2 - 1; k++) { // X_k = Σ x_n·e^(−i2πkn/N)
      let re = 0, im = 0
      for (let n = 0; n < N; n++) {
        const ang = 2 * Math.PI * k * n / N
        re += xs[n] * Math.cos(ang); im -= xs[n] * Math.sin(ang)
      }
      comps.push({ k, A: 2 * Math.hypot(re, im) / N, ph: Math.atan2(im, re) })
    }
    const top = comps.sort((a, b) => b.A - a.A).slice(0, K).sort((a, b) => a.k - b.k)
    const ev = t => top.reduce((s, c) => s + c.A * Math.cos(2 * Math.PI * c.k * t / Tspan + c.ph), a0)
    const expr = [{ t: 'num', v: a0 },
      ...top.map(c => ({ t: 'cos', A: c.A, period: Math.round(Tspan / c.k), phase: c.ph }))]
    return { eval: ev, expr, r2: r2Of(pts, ev) }
  }
  return null
}

/* ===== 公式排版：結構化項次 → 數學式（分數疊排/上標/係數上色，不用外部庫） ===== */
function Formula({ expr }) {
  const lead = (i, v) => i === 0
    ? (v < 0 ? <span className="op">−</span> : null)
    : <span className="op">{v < 0 ? '−' : '+'}</span>
  return (
    <span className="formula">
      <i>SL(t)</i><span className="op">=</span>
      {expr.map((e, i) => {
        if (e.t === 'num') return <span className="term" key={i}>{lead(i, e.v)}<b>{fmt(Math.abs(e.v))}</b></span>
        if (e.t === 'pow') return (
          <span className="term" key={i}>{lead(i, e.coef)}<b>{fmt(Math.abs(e.coef))}</b>·<i>t</i>{e.pow > 1 && <sup>{e.pow}</sup>}</span>
        )
        if (e.t === 'exp') return (
          <span className="term" key={i}>{lead(i, e.a)}<b>{fmt(Math.abs(e.a))}</b>·<span className="fn">e</span><sup>{fmt(e.b)}·t</sup></span>
        )
        if (e.t === 'cos') return (
          <span className="term" key={i}>
            {lead(i, e.A)}<b>{fmt(Math.abs(e.A))}</b>·<span className="fn">cos</span>(
            <span className="frac"><span>2π<i>t</i></span><span>{e.period}</span></span>
            <span className="op">{e.phase < 0 ? '−' : '+'}</span>{Math.abs(e.phase).toFixed(2)})
          </span>
        )
        return null
      })}
    </span>
  )
}

export default function SlExplorer({ ship, thr, win, setWin }) {
  const svgRef = useRef(null)
  const drag = useRef(null)
  const movedRef = useRef(false)
  const trackRef = useRef(null)
  const tdrag = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [sel, setSel] = useState(null)        // 被點選的資料點
  const [fitType, setFitType] = useState('linear')
  const [selCurve, setSelCurve] = useState(null) // 被點選的趨勢曲線
  const { events, pts } = useShipSeries(ship)
  useEffect(() => { setSel(null); setSelCurve(null) }, [ship, fitType])

  // 每個養護區間各自擬合使用者選的函數
  const curves = useMemo(() => {
    const bounds = [0, ...events.map(e => e.d), DMAX + 1]
    const out = []
    for (let bi = 0; bi < bounds.length - 1; bi++) {
      const seg = pts.filter(p => p.d >= bounds[bi] && p.d < bounds[bi + 1])
      if (seg.length < 4) continue
      const d0 = seg[0].d, d1 = seg[seg.length - 1].d
      const f = fitInterval(seg.map(p => ({ t: p.d - d0, v: p.v })), fitType, Math.max(1, d1 - d0))
        ?? fitInterval(seg.map(p => ({ t: p.d - d0, v: p.v })), 'linear', Math.max(1, d1 - d0))
      if (f) out.push({ ...f, d0, d1, n: seg.length })
    }
    return out
  }, [pts, events, fitType])

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
        <label className="fit-pick">趨勢函數
          <select value={fitType} onChange={e => setFitType(e.target.value)}>
            {FIT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <span className="btns">
          <button onClick={() => zoomAt(1 / 1.4)} aria-label="放大">＋</button>
          <button onClick={() => zoomAt(1.4)} aria-label="縮小">−</button>
          <button className="txt" onClick={() => setWin({ d0: 0, d1: DMAX })}>重置</button>
        </span>
      </div>
      {selCurve && (
        <div className="fit-info" role="status">
          <div className="fi-head">
            <b>{FIT_TYPES.find(([k]) => k === fitType)?.[1]}</b>
            <span>區間 D{selCurve.d0}–D{selCurve.d1}（{selCurve.n} 點）· t = 天數 − {selCurve.d0}</span>
            <span className="fi-r2">R² = {selCurve.r2.toFixed(3)}</span>
            <button onClick={() => setSelCurve(null)} aria-label="關閉">×</button>
          </div>
          <div className="formula-row"><Formula expr={selCurve.expr} /></div>
        </div>
      )}
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
        aria-label="speed loss 時間序列（可拖曳平移、縮放；點資料點或趨勢線看詳情）"
        className={dragging ? 'dragging' : ''}
        onClick={() => { if (!movedRef.current) { setSel(null); setSelCurve(null) } }}
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
          if (!d) return null
          const active = selCurve && selCurve.d0 === c.d0
          return (
            <g key={i}>
              <path d={d} fill="none" stroke="var(--accent)" strokeWidth={active ? 3.6 : 2.4} />
              <path d={d} fill="none" stroke="transparent" strokeWidth="14" pointerEvents="stroke"
                style={{ cursor: 'pointer' }}
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); setSelCurve(c); setSel(null) }} />
            </g>
          )
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
            onClick={e => { e.stopPropagation(); setSel(p); setSelCurve(null) }} />
        ))}
        {sel && sel.d >= win.d0 && sel.d <= win.d1 && (() => {
          const x = px(sel.d), y = Math.max(T, py(sel.v))
          const BW = 232, BH = 132
          const bx = x + 14 + BW > W - R ? x - 14 - BW : x + 14
          const by = Math.min(Math.max(T, y - BH / 2), H - B - BH)
          const c = curves.find(cv => sel.d >= cv.d0 && sel.d <= cv.d1)
          const tv = c ? Math.max(0, c.eval(sel.d - c.d0)) : null
          const stp = statusOf(sel.v, thr)
          const gap = sel.v - thr
          return (
            <g onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
              <circle cx={x} cy={y} r="6" fill="none" stroke="var(--accent)" strokeWidth="2" />
              <rect x={bx} y={by} width={BW} height={BH} fill="var(--panel)" stroke="var(--line)" />
              <text x={bx + 12} y={by + 22} style={{ fill: 'var(--text)', fontWeight: 600 }}>{dateOf(sel.d)}（D{sel.d}）</text>
              <text x={bx + 12} y={by + 44}>實測 Speed Loss：{sel.v.toFixed(2)}%</text>
              <text x={bx + 12} y={by + 62}>趨勢值：{tv != null ? `${tv.toFixed(2)}%` : '—'}</text>
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
