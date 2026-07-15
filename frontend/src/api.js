// 後台銜接層（issue #5 / ISO 19030 productionization）：前端元件只認一種內部形狀
//   ship = { id, name, type, sl, trend, daysClean, cleanCount, penalty, thr,
//            series: { pts:[{d,v}], segs:[{d0,d1,v0,v1}], events:[{d,label}] },
//            attribution?, foulingRatePer100d?, propellerCondition?, backendTrend?,
//            recommendDrydock?, dockRationale? }
// 來源自動降級（偵測欄位存在性，不需版本協調）：
//   0. iso        — 獨立的 results-json/speed_loss.json（正式路徑，single source of truth，
//                    見 ml/speed_loss.py compute()；ships 為 {ship_id: {...}} 字典，非陣列）
//   1. daily-pct  — fleet_data.json daily[] 逐日已有 speed_loss_pct 欄位
//   2. derived    — 前端以 fleet_data.json 原始欄位過渡推導
// 全部抓不到 → App 沿用 data.js 的離線 mock。
// 註：fleet_data.json 不再帶 ships[].speed_loss 區塊（已改由 speed_loss.json 取代），
// 舊的 mode 1「processed」因此永久不會觸發，已移除。
import { CONFIG, DEFAULT_THR } from './data.js'

const BASES = [
  '',                                              // 同源（部署於 CloudFront，issue #5 建議）
  'https://d2tp5kf8xp01w0.cloudfront.net',         // 本機開發直打（已開 CORS）
]

async function fetchFirst(path) {
  for (const base of BASES) {
    try {
      const r = await fetch(base + path)
      if (r.ok) return await r.json()
    } catch { /* 換下一個來源 */ }
  }
  return null
}

export async function fetchFleetData() {
  const j = await fetchFirst('/results-json/fleet_data.json')
  return j?.ships?.length ? j : null
}

// ISO 19030 speed loss（single source of truth）— 獨立於 fleet_data.json 之外的檔案
export async function fetchSpeedLoss() {
  const j = await fetchFirst('/results-json/speed_loss.json')
  return j?.ships && Object.keys(j.ships).length ? j : null
}

/* ---------- 共同工具 ---------- */
const DMAX = 1825
const HULL_EVENTS = new Set(['DD', 'UWC', 'PP', 'UWC+PP', 'UWI+PP']) // UWI 純檢查不切區間
const num = v => typeof v === 'number' && isFinite(v)
const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }

function fitSeg(seg) { // 區間內最小二乘直線擬合 → 趨勢段端點
  const n = seg.length
  const sx = seg.reduce((a, p) => a + p.d, 0), sy = seg.reduce((a, p) => a + p.v, 0)
  const sxx = seg.reduce((a, p) => a + p.d * p.d, 0), sxy = seg.reduce((a, p) => a + p.d * p.v, 0)
  const den = n * sxx - sx * sx
  const b = den ? (n * sxy - sx * sy) / den : 0
  const a = sy / n - b * (sx / n)
  const d0 = seg[0].d, d1 = seg[n - 1].d
  return { d0, d1, v0: Math.max(0, a + b * d0), v1: Math.max(0, a + b * d1) }
}

const eventsOf = s => (s.maintenance || [])
  .filter(m => HULL_EVENTS.has(m.event_type) && num(m.event_day))
  .map(m => ({ d: m.event_day, label: m.event_type }))
  .sort((a, b) => a.d - b.d)

function fitByEvents(pts, events) { // 以養護事件切段，各段擬合趨勢
  const bounds = [0, ...events.map(e => e.d), DMAX + 1]
  const segs = []
  for (let bi = 0; bi < bounds.length - 1; bi++) {
    const seg = pts.filter(p => p.d >= bounds[bi] && p.d < bounds[bi + 1])
    if (seg.length >= 3) segs.push(fitSeg(seg))
  }
  return segs
}

/* ---------- 模式 0：iso — 獨立的 results-json/speed_loss.json（正式，最高優先） ---------- */
// speed_loss.json 的 speed_loss_pct 可能是負值（統計雜訊：實測優於自身乾淨基準的擬合中位數），
// 與其餘模式一致，一律以 0 為底線顯示（此看板的敘事是「距乾淨基準的劣化程度」，不會是負的）。
const eventsFromIso = sl => (sl.events || [])
  .filter(e => HULL_EVENTS.has(e.type) && num(e.event_day))
  .map(e => ({ d: e.event_day, label: e.type }))
  .sort((a, b) => a.d - b.d)

function fromIso(sl) {
  const rows = (sl.history || []).filter(h => num(h.day) && num(h.speed_loss_pct))
  if (rows.length < 20) return null
  const pts = rows.map(h => ({ d: h.day, v: Math.max(0, h.speed_loss_pct) })).sort((a, b) => a.d - b.d)
  const events = eventsFromIso(sl)
  return {
    pts, events,
    segs: fitByEvents(pts, events),
    current: num(sl.latest?.speed_loss_pct) ? Math.max(0, sl.latest.speed_loss_pct) : null,
    srcMode: 'iso',
  }
}

/* ---------- 模式 1：daily-pct — 逐日 speed_loss_pct 欄位 ---------- */
function fromDailyPct(s) {
  const rows = (s.daily || []).filter(r => num(r.speed_loss_pct) && num(r.day))
  if (rows.length < 20) return null
  const pts = rows.map(r => ({ d: r.day, v: Math.max(0, r.speed_loss_pct) })).sort((a, b) => a.d - b.d)
  const events = eventsOf(s)
  return { pts, events, segs: fitByEvents(pts, events), current: null, srcMode: 'daily-pct' }
}

/* ---------- 模式 2：derived — 前端過渡推導（後台欄位上線即棄用） ---------- */
function fromRawDerived(s) {
  const all = (s.daily || [])
    .filter(r => r.steady && r.foc_eq24 != null && r.SPEED_THROUGH_WATER > 8 && r.DISPLACEMENT)
    .sort((a, b) => a.day - b.day)
  if (all.length < 20) return null
  // 可比條件：最常見航速帶 ±1.5kn + 排水量中位數 ±25%；Admiralty Δ^⅔·V³ 正規化；
  // 養護區間初期最低四分位當乾淨基準；7 點滾動中位數去尖刺
  const freq = {}
  all.forEach(r => { const b = Math.round(r.SPEED_THROUGH_WATER); freq[b] = (freq[b] || 0) + 1 })
  const mode = +Object.keys(freq).reduce((a, b) => freq[a] >= freq[b] ? a : b)
  let rows = all.filter(r => Math.abs(r.SPEED_THROUGH_WATER - mode) <= 1.5)
  const dispMed = median(rows.map(r => r.DISPLACEMENT))
  rows = rows.filter(r => Math.abs(r.DISPLACEMENT - dispMed) / dispMed <= 0.25)
  if (rows.length < 20) rows = all
  const idx = r => r.foc_eq24 / ((r.DISPLACEMENT ** (2 / 3)) * r.SPEED_THROUGH_WATER ** 3) * 1e9
  const events = eventsOf(s)
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
  return { pts, events, segs, current: null, srcMode: 'derived' }
}

/* ---------- 組裝內部形狀 ---------- */
// opts: { thr?, daysClean?, extra? } — iso 來源用來覆寫警戒線/清潔天數，並附掛後台真實歸因等欄位
function buildShip(i, s, r, opts = {}) {
  const sl = r.current ?? median(r.pts.slice(-15).map(p => p.v))
  const trend = Array.from({ length: 24 }, (_, m) =>
    r.pts[Math.min(r.pts.length - 1, Math.floor(m / 23 * (r.pts.length - 1)))].v)
  const lastDay = r.pts[r.pts.length - 1].d
  const lastHull = r.events.length ? r.events[r.events.length - 1].d : 0
  const lastRow = (s.daily || [])[s.daily?.length - 1]
  return {
    id: i, name: s.ship_id, type: s.ship_type, sl, trend,
    daysClean: opts.daysClean ?? lastRow?.days_since_hull ?? Math.max(0, lastDay - lastHull),
    cleanCount: r.events.filter(e => e.label !== 'DD').length,
    penalty: sl * CONFIG.penaltyPerSl,
    thr: opts.thr ?? DEFAULT_THR[s.ship_type] ?? 8,
    srcMode: r.srcMode,
    series: { segs: r.segs, events: r.events, pts: r.pts },
    ...opts.extra,
  }
}

// fleet_data.json 單獨可用時的降級組裝（daily-pct ?? derived；iso 永遠優先，見 adaptSpeedLoss）
export function adaptFleet(j) {
  const ships = j.ships.map((s, i) => {
    const r = fromDailyPct(s) ?? fromRawDerived(s)
    return r ? buildShip(i, s, r) : null
  }).filter(Boolean).sort((a, b) => b.sl - a.sl)
  const modes = [...new Set(ships.map(s => s.srcMode))]
  return {
    ships,
    meta: {
      generatedAt: j.generated_at, model: j.model, nRows: j.n_rows,
      nPredictions: j.n_predictions, mape: j.validation?.event_holdout_mape_pct ?? null,
      mode: modes.length === 1 ? modes[0] : 'mixed',
    },
  }
}

// 正式路徑：speed_loss.json 為主（每船 iso 計算 + 事件 + 歸因 + 進塢建議），
// fleetJson 選填，僅用來補 KPI 用的 model/n_rows/MAPE（fleet_data.json 抓不到時這些欄位為 null）。
export function adaptSpeedLoss(sl, fleetJson) {
  if (!sl?.ships) return null
  const thr = num(sl.thresholds_speed_loss_pct?.critical) ? sl.thresholds_speed_loss_pct.critical : 6
  const typeById = {}
  ;(sl.fleet_summary || []).forEach(f => { typeById[f.ship_id] = f.ship_type })
  const ships = Object.entries(sl.ships).map(([shipId, shipSl], i) => {
    const r = fromIso(shipSl)
    if (!r) return null
    const stub = { ship_id: shipId, ship_type: typeById[shipId] ?? null }
    const latest = shipSl.latest || {}
    return buildShip(i, stub, r, {
      thr,
      daysClean: num(latest.days_since_cleaning) ? latest.days_since_cleaning : undefined,
      extra: {
        attribution: latest.attribution ?? null,
        foulingRatePer100d: num(latest.fouling_rate_pct_per_100d) ? latest.fouling_rate_pct_per_100d : null,
        propellerCondition: latest.propeller_condition ?? null,
        backendTrend: latest.trend ?? null,
        recommendDrydock: shipSl.drydock_recommendation?.recommend_drydock ?? null,
        dockRationale: shipSl.drydock_recommendation?.rationale ?? null,
      },
    })
  }).filter(Boolean).sort((a, b) => b.sl - a.sl)
  if (!ships.length) return null
  return {
    ships,
    meta: {
      generatedAt: sl.generated_at,
      model: fleetJson?.model ?? sl.standard,
      nRows: fleetJson?.n_rows ?? null,
      nPredictions: fleetJson?.n_predictions ?? null,
      mape: fleetJson?.validation?.event_holdout_mape_pct ?? null,
      mode: 'iso',
      thresholds: sl.thresholds_speed_loss_pct,
    },
  }
}
