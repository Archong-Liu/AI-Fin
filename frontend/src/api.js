// 真實資料層（issue #5）：從 CloudFront /results-json/ 抓 fleet_data.json，
// 轉成前端 ship 形狀。抓不到（離線開發）回 null，App fallback 到 data.js mock。
import { CONFIG, DEFAULT_THR } from './data.js'

const SOURCES = [
  '/results-json/fleet_data.json', // 部署於 CloudFront 時走同源（issue #5 建議）
  'https://d2tp5kf8xp01w0.cloudfront.net/results-json/fleet_data.json', // 本機開發直打（已開 CORS）
]

export async function fetchFleetData() {
  for (const url of SOURCES) {
    try {
      const r = await fetch(url)
      if (!r.ok) continue
      const j = await r.json()
      if (j?.ships?.length) return j
    } catch { /* 換下一個來源 */ }
  }
  return null
}

const HULL_EVENTS = new Set(['DD', 'UWC', 'PP', 'UWC+PP', 'UWI+PP']) // UWI 純檢查不切區間
const DMAX = 1825
const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }

// 區間內最小二乘直線擬合 → 趨勢段端點
function fitSeg(seg) {
  const n = seg.length
  const sx = seg.reduce((a, p) => a + p.d, 0), sy = seg.reduce((a, p) => a + p.v, 0)
  const sxx = seg.reduce((a, p) => a + p.d * p.d, 0), sxy = seg.reduce((a, p) => a + p.d * p.v, 0)
  const den = n * sxx - sx * sx
  const b = den ? (n * sxy - sx * sy) / den : 0
  const a = sy / n - b * (sx / n)
  const d0 = seg[0].d, d1 = seg[n - 1].d
  return { d0, d1, v0: Math.max(0, a + b * d0), v1: Math.max(0, a + b * d1) }
}

export function adaptFleet(j) {
  const ships = j.ships.map((s, i) => {
    // steady = 良好天氣可比較日；foc_eq24 = VLSFO 當量油耗/24h（issue #5 §4 的建議欄位）
    const all = s.daily
      .filter(r => r.steady && r.foc_eq24 != null && r.SPEED_THROUGH_WATER > 8 && r.DISPLACEMENT)
      .sort((a, b) => a.day - b.day)
    if (all.length < 20) return null
    // SL proxy（正式 ISO 19030 speed_loss_pct 為 ML team follow-up）：
    // 1) 可比條件：最常見航速帶 ±1.5kn，且排水量在中位數 ±25% 內（排除壓載/滿載不可比日）
    // 2) Admiralty 正規化 idx = foc / (Δ^⅔ · V³)
    // 3) 每個養護區間用「區間初期最低四分位」當乾淨基準
    // 4) 7 點滾動中位數壓單日尖刺
    const freq = {}
    all.forEach(r => { const b = Math.round(r.SPEED_THROUGH_WATER); freq[b] = (freq[b] || 0) + 1 })
    const mode = +Object.keys(freq).reduce((a, b) => freq[a] >= freq[b] ? a : b)
    let rows = all.filter(r => Math.abs(r.SPEED_THROUGH_WATER - mode) <= 1.5)
    const dispMed = median(rows.map(r => r.DISPLACEMENT))
    rows = rows.filter(r => Math.abs(r.DISPLACEMENT - dispMed) / dispMed <= 0.25)
    if (rows.length < 20) rows = all
    const idx = r => r.foc_eq24 / ((r.DISPLACEMENT ** (2 / 3)) * r.SPEED_THROUGH_WATER ** 3) * 1e9
    const events = (s.maintenance || [])
      .filter(m => HULL_EVENTS.has(m.event_type) && m.event_day != null)
      .map(m => ({ d: m.event_day, label: m.event_type }))
      .sort((a, b) => a.d - b.d)
    const bounds = [0, ...events.map(e => e.d), DMAX + 1]
    const pts = [], segs = []
    for (let bi = 0; bi < bounds.length - 1; bi++) {
      const seg = rows.filter(r => r.day >= bounds[bi] && r.day < bounds[bi + 1])
      if (seg.length < 5) continue
      const early = seg.slice(0, Math.max(5, Math.floor(seg.length / 5))).map(idx).sort((a, b) => a - b)
      const k = Math.max(2, Math.floor(early.length / 4))
      const base = early.slice(0, k).reduce((a, b) => a + b, 0) / k
      const raw = seg.map(r => Math.max(0, (idx(r) / base - 1) * 100))
      const segPts = seg.map((r, n) => ({ d: r.day, v: median(raw.slice(Math.max(0, n - 3), n + 4)) }))
      pts.push(...segPts)
      if (segPts.length >= 3) segs.push(fitSeg(segPts))
    }
    if (pts.length < 20) return null
    const sl = median(pts.slice(-15).map(p => p.v))
    const trend = Array.from({ length: 24 }, (_, m) =>
      pts[Math.min(pts.length - 1, Math.floor(m / 23 * (pts.length - 1)))].v)
    const lastRow = all[all.length - 1]
    const lastHull = events.length ? events[events.length - 1].d : 0
    return {
      id: i, name: s.ship_id, type: s.ship_type, sl, trend,
      daysClean: lastRow.days_since_hull ?? Math.max(0, lastRow.day - lastHull),
      cleanCount: events.filter(e => e.label !== 'DD').length,
      penalty: sl * CONFIG.penaltyPerSl,
      thr: DEFAULT_THR[s.ship_type] ?? 8,
      series: { segs, events, pts },
    }
  }).filter(Boolean).sort((a, b) => b.sl - a.sl)
  return {
    ships,
    meta: {
      generatedAt: j.generated_at, model: j.model, nRows: j.n_rows,
      nPredictions: j.n_predictions, mape: j.validation?.event_holdout_mape_pct ?? null,
    },
  }
}
