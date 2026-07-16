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

export function dailySeries(ship) {
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

// slChart 已改由 SlExplorer.jsx（可拖拉/縮放的互動元件）取代

// D1825 = 今日，往回推算實際日期（demo 對齊 noon_reports 2021–2025）
export const dateOf = d => {
  const t = new Date(Date.now() - (1825 - d) * 86400000)
  return `${t.getFullYear()}/${String(t.getMonth() + 1).padStart(2, '0')}/${String(t.getDate()).padStart(2, '0')}`
}

// 每日油耗資料（近 30 個良好天氣航行日，尾端對齊 D1825＝今日）。
// 繪製在 FocChart.jsx；接真實資料時只換這個函式的內容。
export function focSeries(ship) {
  setSeed(2000 + ship.id)
  const days = 30, rows = []
  for (let i = 0; i < days; i++) {
    const base = 52 + rnd() * 6
    rows.push({ d: 1825 - (days - 1) + i, base, act: base * (1 + ship.sl / 100) + (rnd() - 0.5) * 2 })
  }
  return rows
}

// primary_cause（ml/speed_loss.py attribution()）→ 中文標籤
const CAUSE_TXT = {
  HULL_FOULING: '船體汙損為主', PROPELLER_ROUGHNESS: '螺槳粗糙為主',
  COMBINED: '船體＋螺槳混合', INDETERMINATE: '推力資料不足，無法歸因', CLEAN: '目前無明顯損失',
}

export function attrDonut(ship) {
  // 後台已有推力法歸因（ISO 19030 §4.3）時優先採用真實值；INDETERMINATE/CLEAN（無推力計）或
  // derived/demo 資料時退回前端估算公式，並在下方註明來源避免誤認為模型輸出
  const attr = ship.attribution
  const real = attr && typeof attr.hull_contribution_pct === 'number'
  const hull = real ? attr.hull_contribution_pct : Math.min(82, 45 + ship.sl * 4)
  const prop = real ? attr.propeller_contribution_pct : Math.min(30, 10 + ship.sl * 1.5, 96 - hull)
  const other = Math.max(0, 100 - hull - prop)
  const C = 2 * Math.PI * 44
  const seg = (pct, off, color) => `<circle cx="60" cy="60" r="44" fill="none" stroke="${color}" stroke-width="14"
    stroke-dasharray="${((pct / 100) * C).toFixed(1)} ${C}" stroke-dashoffset="${((-off / 100) * C).toFixed(1)}" transform="rotate(-90 60 60)"/>`
  const caption = real
    ? `依 ISO 19030 推力法歸因（近 ${attr.window_days} 個航行日）· ${CAUSE_TXT[attr.primary_cause] ?? attr.primary_cause}`
    : (attr ? `${CAUSE_TXT[attr.primary_cause] ?? '推力資料不足'}，以下為前端估算值` : '前端估算值（無後台歸因資料）')
  return `<svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label="損失歸因">
      ${seg(hull, 0, 'var(--crit)')}${seg(prop, hull, 'var(--watch)')}${seg(other, hull + prop, 'var(--chart-grid)')}
      <text x="60" y="57" text-anchor="middle" style="font-size:22.8px;font-weight:600;fill:var(--text)">${hull.toFixed(0)}%</text>
      <text x="60" y="72" text-anchor="middle">船體汙損</text></svg>
    <div style="font-size:15px;color:var(--muted);line-height:2">
      <span style="color:var(--crit)">●</span> 船體汙損 ${hull.toFixed(0)}%<br>
      <span style="color:var(--watch)">●</span> 螺槳 ${prop.toFixed(0)}%<br>
      <span style="color:var(--faint)">●</span> 其他 ${other.toFixed(0)}%
      <div style="font-size:12px;margin-top:4px">${caption}</div></div>`
}

// 每日油耗歸因 — 成分堆疊柱狀圖（乾淨基準+風阻+吃水+船體汙損+螺槳＝當日實測 FOC）
export function stackedFoc(ship) {
  setSeed(3000 + ship.id)
  const days = 14, W = 980, H = 330, L = 68, B = 58, T = 42, R = 16
  const COMP = [
    ['乾淨基準', 'var(--accent)', '.5'],
    ['風阻', '#8CA0B2', '.9'],
    ['吃水', '#B9C7D2', '.9'],
    ['船體汙損', 'var(--crit)', '.9'],
    ['螺槳', 'var(--watch)', '.9'],
  ]
  const extra = ship.penalty
  const rows = []
  for (let d = 0; d < days; d++) {
    rows.push([
      52 + rnd() * 4 - 2,
      extra * (0.08 + rnd() * 0.05),
      extra * (0.06 + rnd() * 0.04),
      extra * (0.60 + rnd() * 0.12),
      extra * (0.14 + rnd() * 0.06),
    ])
  }
  const max = Math.max(...rows.map(p => p.reduce((a, b) => a + b, 0))) * 1.1
  const px = i => L + ((i + 0.5) / days) * (W - L - R)
  const bw = (W - L - R) / days * 0.58
  const py = v => T + (1 - v / max) * (H - T - B)
  let svg = `<text transform="rotate(-90 12 ${(T + H - B) / 2})" x="12" y="${(T + H - B) / 2}" text-anchor="middle"
    style="fill:var(--muted);font-weight:600">FOC（t/day）</text>`
  for (let g = 0; g <= 4; g++) {
    const val = (max / 4) * g, y = py(val)
    svg += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="var(--chart-grid)"/>
      <text x="28" y="${y + 4}" style="fill:var(--text);font-weight:600">${val.toFixed(0)}</text>`
  }
  rows.forEach((parts, i) => {
    let cum = 0
    parts.forEach((v, k) => {
      const y0 = py(cum + v)
      svg += `<rect x="${(px(i) - bw / 2).toFixed(1)}" y="${y0.toFixed(1)}" width="${bw.toFixed(1)}"
        height="${(py(cum) - y0).toFixed(1)}" fill="${COMP[k][1]}" opacity="${COMP[k][2]}"/>`
      cum += v
    })
  })
  ;[0, 3, 6, 9, 13].forEach(i => {
    const day = 1825 - (days - 1) + i
    const anchor = i === 13 ? 'end' : 'middle'
    svg += `<line x1="${px(i)}" y1="${H - B}" x2="${px(i)}" y2="${H - B + 5}" stroke="var(--chart-grid)"/>
      <text x="${px(i)}" y="${H - B + 19}" text-anchor="${anchor}">${dateOf(day)}</text>
      <text x="${px(i)}" y="${H - B + 34}" text-anchor="${anchor}" style="fill:var(--faint)">D${day}</text>`
  })
  let lx = L
  COMP.forEach(([name, color, op]) => { // 圖例列（左上）
    svg += `<rect x="${lx}" y="10" width="13" height="13" fill="${color}" opacity="${op}"/>
      <text x="${lx + 18}" y="21" style="fill:var(--text)">${name}</text>`
    lx += 18 + name.length * 13 + 26
  })
  svg += `<text x="${L + (W - L - R) / 2}" y="${H - 6}" text-anchor="middle"
    style="fill:var(--muted);font-weight:600">日期（D = 資料起算第幾天）· 近 ${days} 個良好天氣航行日</text>`
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="每日油耗成分堆疊圖">${svg}</svg>`
}

export function scatterChart() {
  setSeed(77)
  const W = 560, H = 430, L = 66, B = 66, T = 40, R = 18, min = 42, max = 68
  const px = v => L + ((v - min) / (max - min)) * (W - L - R)
  const py = v => T + (1 - (v - min) / (max - min)) * (H - T - B)
  let svg = ''
  ;[45, 50, 55, 60, 65].forEach(v => { // 格線 + 兩軸刻度
    svg += `<line x1="${px(v)}" y1="${T}" x2="${px(v)}" y2="${H - B}" stroke="var(--chart-grid)"/>
      <line x1="${L}" y1="${py(v)}" x2="${W - R}" y2="${py(v)}" stroke="var(--chart-grid)"/>
      <text x="${px(v)}" y="${H - B + 24}" text-anchor="middle" style="font-size:14px;fill:var(--muted)">${v}</text>
      <text x="${L - 10}" y="${py(v) + 5}" text-anchor="end" style="font-size:14px;fill:var(--muted)">${v}</text>`
  })
  svg += `<line x1="${px(min)}" y1="${py(min)}" x2="${px(max)}" y2="${py(max)}" stroke="var(--faint)" stroke-width="1.5" stroke-dasharray="6 4"/>`
  for (let i = 0; i < 70; i++) {
    const a = 44 + rnd() * 22, p = Math.min(max, Math.max(min, a * (1 + (rnd() - 0.5) * 0.085)))
    svg += `<circle cx="${px(a).toFixed(1)}" cy="${py(p).toFixed(1)}" r="4" fill="var(--accent)" opacity=".55"/>`
  }
  svg += `<line x1="${L}" y1="19" x2="${L + 34}" y2="19" stroke="var(--faint)" stroke-width="1.5" stroke-dasharray="6 4"/>
    <text x="${L + 42}" y="24" style="font-family:var(--font-body);font-size:14.5px;fill:var(--muted)">虛線＝完美預測（預測值 ＝ 實測值）</text>
    <text x="${L + (W - L - R) / 2}" y="${H - 14}" text-anchor="middle" style="font-family:var(--font-body);font-size:15.5px;font-weight:600;fill:var(--text)">實測 FOC（t/day）</text>
    <text x="22" y="${T + (H - T - B) / 2}" text-anchor="middle" transform="rotate(-90 22 ${T + (H - T - B) / 2})" style="font-family:var(--font-body);font-size:15.5px;font-weight:600;fill:var(--text)">預測 FOC（t/day）</text>`
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="預測與實測散點圖">${svg}</svg>`
}

export function mapeBars(ships) {
  setSeed(88)
  const rows = ships.slice(0, 6).map(s => ({ n: s.name, m: 3 + rnd() * 2.6 }))
  return rows.map(r => `<div style="display:flex;align-items:center;gap:14px;margin:15px 0">
      <span style="font-family:var(--font-data);font-size:15.5px;color:var(--text);width:64px;flex:none">${r.n}</span>
      <div style="flex:1;height:12px;background:var(--panel-2);border-radius:6px;overflow:hidden">
        <div style="width:${((r.m / 6) * 100).toFixed(0)}%;height:100%;background:${r.m > 5 ? 'var(--watch)' : 'var(--accent)'}"></div></div>
      <span style="font-family:var(--font-data);font-size:16px;font-weight:600;color:var(--text);width:56px;text-align:right">${r.m.toFixed(1)}%</span></div>`).join('')
}

