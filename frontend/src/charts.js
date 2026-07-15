// SVG 圖表產生器：回傳字串，元件用 dangerouslySetInnerHTML 掛載。
// ponytail: 接真實資料時只需換掉各函式的資料來源，繪製邏輯不動。
import { setSeed, rnd } from './data.js'

export function spark(points, w = 190, h = 34) {
  const max = Math.max(...points) * 1.15
  const px = i => (i / (points.length - 1)) * w
  const py = v => h - 3 - (v / max) * (h - 8)
  const path = points.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join('')
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${path} L${w},${h} L0,${h} Z" fill="var(--chart-area)"/>
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="1.6"/>
    <circle cx="${px(points.length - 1)}" cy="${py(points[points.length - 1])}" r="2.6" fill="var(--accent)"/>
  </svg>`
}

function dailySeries(ship) {
  setSeed(1000 + ship.id)
  const events = [{ d: 560, label: 'UWC 清洗' }, { d: 1120, label: 'PP 拋光' }, { d: 1550, label: 'UWC+PP' }]
  const bounds = [0, ...events.map(e => e.d), 1825]
  const segs = []; let prevEnd = 0
  for (let i = 0; i < bounds.length - 1; i++) {
    const v0 = i === 0 ? 1 + rnd() : Math.max(0.5, prevEnd * 0.28)
    const v1 = i === bounds.length - 2 ? ship.sl : 5.5 + rnd() * 3.5
    segs.push({ d0: bounds[i], d1: bounds[i + 1], v0, v1 })
    prevEnd = v1
  }
  const pts = []
  segs.forEach(s => {
    for (let d = s.d0; d < s.d1; d += 7) {
      const v = s.v0 + (s.v1 - s.v0) * (d - s.d0) / (s.d1 - s.d0)
      pts.push({ d, v: Math.max(0.1, v + (rnd() - 0.5) * 1.1) })
    }
  })
  return { segs, events, pts }
}

export function slChart(ship, thr) {
  const { segs, events, pts } = dailySeries(ship)
  const W = 680, H = 250, L = 38, B = 24, T = 12, R = 8, DMAX = 1825
  const max = Math.max(thr * 1.25, ...segs.map(s => s.v1)) * 1.08
  const px = d => L + (d / DMAX) * (W - L - R)
  const py = v => T + (1 - v / max) * (H - T - B)
  let svg = ''
  for (let g = 0; g <= 4; g++) {
    const val = (max / 4) * g, y = py(val)
    svg += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="var(--chart-grid)"/>
      <text x="${L - 6}" y="${y + 3}" text-anchor="end">${val.toFixed(0)}%</text>`
  }
  for (let d = 0; d <= DMAX; d += 365) svg += `<text x="${px(d)}" y="${H - 6}" text-anchor="middle">D${d}</text>`
  svg += `<rect x="${L}" y="${T}" width="${W - L - R}" height="${Math.max(0, py(thr) - T)}" fill="var(--crit)" opacity=".05"/>
    <line x1="${L}" x2="${W - R}" y1="${py(thr)}" y2="${py(thr)}" stroke="var(--crit)" stroke-dasharray="5 4"/>
    <text x="${W - R}" y="${py(thr) - 5}" text-anchor="end" style="fill:var(--crit)">警戒線 ${thr}%</text>`
  events.forEach(e => {
    svg += `<line x1="${px(e.d)}" x2="${px(e.d)}" y1="${T}" y2="${H - B}" stroke="var(--faint)" stroke-dasharray="3 4"/>
    <text x="${px(e.d) + 4}" y="${T + 10}">${e.label}</text>`
  })
  svg += pts.map(p => `<circle cx="${px(p.d).toFixed(1)}" cy="${py(p.v).toFixed(1)}" r="1.7" fill="var(--accent)" opacity=".35"/>`).join('')
  segs.forEach(s => { svg += `<line x1="${px(s.d0)}" y1="${py(s.v0)}" x2="${px(s.d1)}" y2="${py(s.v1)}" stroke="var(--accent)" stroke-width="2.2"/>` })
  const last = segs[segs.length - 1]
  svg += `<circle cx="${px(last.d1)}" cy="${py(last.v1)}" r="4" fill="var(--accent)"/>
    <text x="${px(last.d1) - 6}" y="${py(last.v1) + 16}" text-anchor="end" style="fill:var(--text);font-weight:600">目前 ${last.v1.toFixed(1)}%</text>`
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="speed loss 時間序列">${svg}</svg>`
}

export function focChart(ship) {
  setSeed(2000 + ship.id)
  const days = 30, W = 680, H = 190, L = 38, B = 22, T = 10, R = 8
  const base = [], act = []
  for (let d = 0; d < days; d++) { const b = 52 + rnd() * 6; base.push(b); act.push(b * (1 + ship.sl / 100) + (rnd() - 0.5) * 2) }
  const max = Math.max(...act) * 1.08, min = Math.min(...base) * 0.92
  const px = i => L + (i / (days - 1)) * (W - L - R)
  const py = v => T + (1 - (v - min) / (max - min)) * (H - T - B)
  const bw = ((W - L - R) / days) * 0.62
  let bars = ''
  for (let d = 0; d < days; d++) {
    const over = act[d] > base[d] * 1.04
    bars += `<rect x="${px(d) - bw / 2}" y="${py(act[d])}" width="${bw}" height="${H - B - py(act[d])}" rx="1.5"
      fill="${over ? 'var(--crit)' : 'var(--accent)'}" opacity="${over ? '.75' : '.55'}"/>`
  }
  const line = base.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join('')
  let labels = ''
  for (let g = 0; g <= 3; g++) { const val = min + ((max - min) / 3) * g, y = py(val); labels += `<text x="${L - 6}" y="${y + 3}" text-anchor="end">${val.toFixed(0)}</text>` }
  labels += `<text x="${L}" y="${H - 5}">近 30 個航行日 · t/day</text>`
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="每日油耗對比">${bars}<path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2"/>${labels}</svg>`
}

export function attrDonut(ship) {
  const hull = Math.min(82, 45 + ship.sl * 4)
  const prop = Math.min(30, 10 + ship.sl * 1.5, 96 - hull)
  const other = 100 - hull - prop
  const C = 2 * Math.PI * 44
  const seg = (pct, off, color) => `<circle cx="60" cy="60" r="44" fill="none" stroke="${color}" stroke-width="14"
    stroke-dasharray="${((pct / 100) * C).toFixed(1)} ${C}" stroke-dashoffset="${((-off / 100) * C).toFixed(1)}" transform="rotate(-90 60 60)"/>`
  return `<svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label="損失歸因">
      ${seg(hull, 0, 'var(--crit)')}${seg(prop, hull, 'var(--watch)')}${seg(other, hull + prop, 'var(--chart-grid)')}
      <text x="60" y="57" text-anchor="middle" style="font-size:19px;font-weight:600;fill:var(--text)">${hull.toFixed(0)}%</text>
      <text x="60" y="72" text-anchor="middle">船體汙損</text></svg>
    <div style="font-size:12.5px;color:var(--muted);line-height:2">
      <span style="color:var(--crit)">●</span> 船體汙損 ${hull.toFixed(0)}%<br>
      <span style="color:var(--watch)">●</span> 螺槳 ${prop.toFixed(0)}%<br>
      <span style="color:var(--faint)">●</span> 其他 ${other.toFixed(0)}%</div>`
}

export function waterfall(ship) {
  const extra = ship.penalty, base = 52.0, total = base + extra
  const items = [
    { n: '風阻', v: extra * 0.10, c: 'var(--faint)' },
    { n: '吃水', v: extra * 0.08, c: 'var(--faint)' },
    { n: '船體汙損', v: extra * 0.65, c: 'var(--crit)' },
    { n: '螺槳', v: extra * 0.17, c: 'var(--watch)' },
  ]
  const W = 640, H = 230, L = 42, B = 40, T = 16, R = 10
  const yMin = Math.floor(base - 2), yMax = total + Math.max(0.8, extra * 0.15)
  const py = v => T + (1 - (v - yMin) / (yMax - yMin)) * (H - T - B)
  const n = items.length + 2, gap = (W - L - R) / n, bw = gap * 0.55
  const bx = i => L + gap * i + gap * 0.5 - bw / 2
  let svg = '', cum = base
  for (let g = 0; g <= 3; g++) {
    const val = yMin + ((yMax - yMin) / 3) * g, y = py(val)
    svg += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="var(--chart-grid)"/>
    <text x="${L - 6}" y="${y + 3}" text-anchor="end">${val.toFixed(0)}</text>`
  }
  svg += `<rect x="${bx(0)}" y="${py(base)}" width="${bw}" height="${H - B - py(base)}" fill="var(--accent)" opacity=".55" rx="2"/>
    <text x="${bx(0) + bw / 2}" y="${H - B + 14}" text-anchor="middle">乾淨基準</text>
    <text x="${bx(0) + bw / 2}" y="${py(base) - 5}" text-anchor="middle" style="fill:var(--text)">${base.toFixed(1)}</text>`
  items.forEach((it, i) => {
    const y0 = py(cum + it.v), h = Math.max(2, py(cum) - y0)
    svg += `<line x1="${bx(i) + bw}" y1="${py(cum)}" x2="${bx(i + 1)}" y2="${py(cum)}" stroke="var(--faint)" stroke-dasharray="2 3"/>
      <rect x="${bx(i + 1)}" y="${y0}" width="${bw}" height="${h}" fill="${it.c}" opacity=".85" rx="2"/>
      <text x="${bx(i + 1) + bw / 2}" y="${H - B + 14}" text-anchor="middle">${it.n}</text>
      <text x="${bx(i + 1) + bw / 2}" y="${y0 - 5}" text-anchor="middle" style="fill:var(--text)">+${it.v.toFixed(1)}</text>`
    cum += it.v
  })
  svg += `<line x1="${bx(items.length) + bw}" y1="${py(cum)}" x2="${bx(n - 1)}" y2="${py(cum)}" stroke="var(--faint)" stroke-dasharray="2 3"/>
    <rect x="${bx(n - 1)}" y="${py(total)}" width="${bw}" height="${H - B - py(total)}" fill="var(--accent)" rx="2"/>
    <text x="${bx(n - 1) + bw / 2}" y="${H - B + 14}" text-anchor="middle">實測 FOC</text>
    <text x="${bx(n - 1) + bw / 2}" y="${py(total) - 5}" text-anchor="middle" style="fill:var(--text)">${total.toFixed(1)}</text>
    <text x="${L}" y="${H - 4}">單位 t/day · y 軸自 ${yMin} 起（截斷）</text>`
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="FOC 歸因瀑布圖">${svg}</svg>`
}

export function scatterChart() {
  setSeed(77)
  const W = 300, H = 220, L = 36, B = 28, T = 8, R = 8, min = 42, max = 68
  const px = v => L + ((v - min) / (max - min)) * (W - L - R)
  const py = v => T + (1 - (v - min) / (max - min)) * (H - T - B)
  let svg = `<line x1="${px(min)}" y1="${py(min)}" x2="${px(max)}" y2="${py(max)}" stroke="var(--faint)" stroke-dasharray="4 3"/>`
  for (let i = 0; i < 70; i++) {
    const a = 44 + rnd() * 22, p = Math.min(max, Math.max(min, a * (1 + (rnd() - 0.5) * 0.085)))
    svg += `<circle cx="${px(a).toFixed(1)}" cy="${py(p).toFixed(1)}" r="2.4" fill="var(--accent)" opacity=".6"/>`
  }
  ;[45, 55, 65].forEach(v => { svg += `<text x="${px(v)}" y="${H - B + 13}" text-anchor="middle">${v}</text><text x="${L - 5}" y="${py(v) + 3}" text-anchor="end">${v}</text>` })
  svg += `<text x="${(L + W - R) / 2}" y="${H - 3}" text-anchor="middle">實測 FOC (t/day) · 虛線＝完美預測</text>`
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="預測與實測散點圖">${svg}</svg>`
}

export function mapeBars(ships) {
  setSeed(88)
  const rows = ships.slice(0, 6).map(s => ({ n: s.name, m: 3 + rnd() * 2.6 }))
  return `<div style="font-size:11.5px;color:var(--muted);margin-bottom:6px">各船 Daily FOC 預測 MAPE（全船隊 4.2%）</div>` +
    rows.map(r => `<div style="display:flex;align-items:center;gap:8px;margin:3px 0">
      <span style="font-family:var(--font-data);font-size:10.5px;width:60px;flex:none">${r.n}</span>
      <div style="flex:1;height:7px;background:var(--panel-2);border-radius:4px;overflow:hidden">
        <div style="width:${((r.m / 6) * 100).toFixed(0)}%;height:100%;background:${r.m > 5 ? 'var(--watch)' : 'var(--accent)'}"></div></div>
      <span style="font-family:var(--font-data);font-size:11px;width:38px;text-align:right">${r.m.toFixed(1)}%</span></div>`).join('')
}

export function simChart(ship, cleanDay) {
  const days = 120, p0 = ship.penalty
  const a = [0], b = [0]; let ca = 0, cb = 0
  for (let t = 1; t <= days; t++) {
    ca += p0 * (1 + 0.004 * t)
    cb += t < cleanDay ? p0 * (1 + 0.004 * t) : p0 * 0.15 * (1 + 0.006 * (t - cleanDay))
    a.push(ca); b.push(cb)
  }
  const net = ca - cb
  const W = 680, H = 200, L = 52, B = 24, T = 12, R = 10
  const max = Math.max(a[days], b[days]) * 1.06 || 1
  const px = t => L + (t / days) * (W - L - R)
  const py = v => T + (1 - v / max) * (H - T - B)
  const line = arr => arr.map((v, t) => `${t ? 'L' : 'M'}${px(t).toFixed(1)},${py(v).toFixed(1)}`).join('')
  let svg = ''
  for (let g = 0; g <= 3; g++) {
    const val = (max / 3) * g, y = py(val)
    svg += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="var(--chart-grid)"/>
      <text x="${L - 6}" y="${y + 3}" text-anchor="end">${Math.round(val)} t</text>`
  }
  ;[30, 60, 90, 120].forEach(d => { svg += `<text x="${px(d)}" y="${H - 6}" text-anchor="middle">${d}天</text>` })
  svg += `<line x1="${px(cleanDay)}" y1="${T}" x2="${px(cleanDay)}" y2="${H - B}" stroke="var(--faint)" stroke-dasharray="3 4"/>
    <text x="${px(cleanDay) + 4}" y="${T + 10}">清潔日</text>
    <path d="${line(a)}" fill="none" stroke="var(--crit)" stroke-width="2"/>
    <path d="${line(b)}" fill="none" stroke="var(--good)" stroke-width="2"/>
    <text x="${W - R}" y="${T + 10}" text-anchor="end"><tspan style="fill:var(--crit)">— 不清潔</tspan><tspan style="fill:var(--good)" dx="10">— 於第${cleanDay}天清潔</tspan></text>`
  return {
    svg: `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="清潔排程模擬">${svg}</svg>`,
    stats: `於第 ${cleanDay} 天清潔：120 天可少燒 ${Math.round(net)} t（越早清、省越多）`,
  }
}
