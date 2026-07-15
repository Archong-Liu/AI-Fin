import React, { useState, useEffect, useRef } from 'react'
import { makeShips, makeShip, DEFAULT_THR, statusOf, STATUS_TXT, bufferDays, aiAnswer, SUGGESTIONS } from './data.js'
import { spark, focChart, attrDonut, waterfall, scatterChart, mapeBars, simChart } from './charts.js'
import SlExplorer, { DMAX } from './SlExplorer.jsx'
import { fetchFleetData, adaptFleet } from './api.js'

const Svg = ({ html, className = 'chart-wrap' }) => (
  <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
)

const VIEW_NAME = { fleet: '船隊總覽', ship: '單船分析', verify: '人工比對', data: '資料與報告' }

const NAV_ICONS = {
  fleet: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>,
  ship: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 17l3 4h12l3-4M3 17l9-2 9 2M12 15V6M7 9l5-4 5 4" /></svg>,
  verify: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5h6a1 1 0 0 1 1 1v0a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v0a1 1 0 0 1 1-1z" /><path d="M16 6h2a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h2" /><path d="M9 13l2 2 4-4" /></svg>,
  data: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 16V4m0 0L7 9m5-5l5 5M4 20h16" /></svg>,
}

/* ---------- 船隊總覽 ---------- */
function FleetView({ ships, onPick, onAdd, meta }) {
  const [sent, setSent] = useState(false)
  const [filter, setFilter] = useState('crit') // 永遠鎖定一個分類，沒有「全部」視圖
  const [adding, setAdding] = useState(false)
  const over = ships.filter(s => s.sl >= s.thr)
  const avgSl = ships.reduce((s, x) => s + x.sl, 0) / ships.length
  const totPenalty = over.reduce((s, x) => s + x.penalty, 0)
  const shown = ships.filter(s => statusOf(s.sl, s.thr) === filter)
  return (
    <>
      {over.length ? (
        <div className="banner crit" role="alert">
          ⚠ {over.length} 艘船超過各自警戒線：{over.map(s => `${s.name}（≥${s.thr}%）`).join('、')}
          <button disabled={sent} onClick={() => setSent(true)}>{sent ? '已寄送 ✓（demo）' : '立即寄送通報 Email'}</button>
        </div>
      ) : (
        <div className="banner ok">✓ 全船隊皆在各自警戒線以內</div>
      )}
      <div className="thr-row">
        <span className="faint">
          {meta ? `資料來源 fleet_data.json（${meta.generatedAt?.slice(0, 10)} 產出 · ${meta.nRows.toLocaleString()} 列）` : '離線示意資料'}
          · 各船警戒線可於「單船分析」頁個別調整 · 超標自動通報：fleet-ops@yangming.com.tw（demo）
        </span>
        <button className="add-ship" onClick={() => setAdding(true)}>＋ 新增船隻</button>
      </div>
      {adding && <AddShipModal ships={ships} onAdd={onAdd} onClose={() => setAdding(false)} />}
      <h2 className="section">船隊健康指標</h2>
      <div className="kpis">
        <div className="kpi"><div className="label">船隊平均 Speed Loss</div>
          <div className="value">{avgSl.toFixed(1)}<small> %</small></div>
          <div className="delta up">▲ 0.3 pt vs 上月</div></div>
        <div className="kpi"><div className="label">超標船數</div>
          <div className="value">{over.length}<small> / {ships.length} 艘</small></div>
          <div className="delta flat">依各船警戒線</div></div>
        <div className="kpi"><div className="label">超標船估計多燒</div>
          <div className="value">{totPenalty.toFixed(1)}<small> t/day</small></div>
          <div className="delta up">燃油當量（VLSFO）</div></div>
        <div className="kpi"><div className="label">模型 FOC 預測誤差</div>
          <div className="value">{meta?.mape?.toFixed(1) ?? '4.2'}<small> % MAPE</small></div>
          <div className="delta down">{meta?.mape ? 'event-holdout 驗證' : '▼ 0.6 pt（重訓後）'}</div></div>
      </div>
      <h2 className="section">全船隊 Speed Loss（依嚴重度排序 · 點擊查看單船）</h2>
      <div className="fleet-body">
        <StatusSide ships={ships} filter={filter} setFilter={setFilter} />
        <div className="fleet">
        {shown.length === 0 && <div className="faint">此類別目前沒有船</div>}
        {shown.map(s => {
          const st = statusOf(s.sl, s.thr)
          return (
            <button key={s.id} className={`ship ${st}`} onClick={() => onPick(s.id)} aria-label={`查看 ${s.name}`}>
              <div className="ship-head">
                <span className="name">{s.name}</span>
                <span className={`pill ${st}`}>{STATUS_TXT[st]}</span>
              </div>
              <div className="row">
                <span className="sl">{s.sl.toFixed(1)}<small> % SL</small></span>
                <span className="pen">+{s.penalty.toFixed(1)} t/d</span>
              </div>
              <div className="meta">距上次清潔 {s.daysClean} 天{s.sl < s.thr ? ` · 緩衝約 ${bufferDays(s, s.thr)} 天` : ''}</div>
              <Svg className="" html={spark(s.trend)} />
            </button>
          )
        })}
        </div>
      </div>
    </>
  )
}

/* ---------- 狀態篩選側欄（船卡區最左，貼網格背景） ---------- */
function StatusSide({ ships, filter, setFilter }) {
  // 狀態由「各船自己的警戒線」動態推導——任一船的警戒線一改，分類與數量即時重算
  const counts = { crit: 0, watch: 0, good: 0 }
  ships.forEach(s => { counts[statusOf(s.sl, s.thr)]++ })
  const CATS = [
    { key: 'crit', label: STATUS_TXT.crit, dot: 'crit' },
    { key: 'watch', label: STATUS_TXT.watch, dot: 'warn' },
    { key: 'good', label: STATUS_TXT.good, dot: 'ok' },
  ]
  return (
    <aside className="status-side" aria-label="狀態篩選">
      {CATS.map(c => (
        <button key={c.key} className={`status-item ${c.key} ${filter === c.key ? 'active' : ''}`}
          onClick={() => setFilter(c.key)}>
          <span className={`fdot ${c.dot}`} />
          <span>{c.label}</span>
          <span className="cnt">{counts[c.key]}</span>
        </button>
      ))}
    </aside>
  )
}

/* ---------- 新增船隻 ---------- */
function AddShipModal({ ships, onAdd, onClose }) {
  const [f, setF] = useState({ name: '', type: 'W1', daysClean: 30, cleanCount: 0, thr: DEFAULT_THR.W1 })
  const [err, setErr] = useState('')
  // 換船種時警戒線自動帶入該船種預設，仍可手動覆寫
  const set = (k, v) => { setErr(''); setF(o => ({ ...o, [k]: v, ...(k === 'type' ? { thr: DEFAULT_THR[v] } : {}) })) }
  const submit = e => {
    e.preventDefault()
    const name = f.name.trim().toUpperCase()
    if (!name) return setErr('請輸入船名')
    if (ships.some(s => s.name === name)) return setErr(`船名 ${name} 已存在`)
    onAdd({ name, type: f.type, daysClean: Math.max(0, +f.daysClean || 0), cleanCount: Math.max(0, +f.cleanCount || 0), thr: +f.thr || DEFAULT_THR[f.type] })
    onClose()
  }
  return (
    <div className="modal-ov" onClick={onClose}>
      <form className="modal" onClick={e => e.stopPropagation()} onSubmit={submit} aria-label="新增船隻">
        <h3>新增船隻</h3>
        <label>船名<input autoFocus value={f.name} placeholder="例：S24" onChange={e => set('name', e.target.value)} /></label>
        <div className="row2">
          <label>船種
            <select value={f.type} onChange={e => set('type', e.target.value)}>
              <option value="W1">W1</option><option value="W2">W2</option>
            </select>
          </label>
          <label>警戒線（%）<input type="number" min="2" max="20" step="0.5" value={f.thr} onChange={e => set('thr', e.target.value)} /></label>
        </div>
        <div className="row2">
          <label>距上次清潔（天）<input type="number" min="0" value={f.daysClean} onChange={e => set('daysClean', e.target.value)} /></label>
          <label>累計水下清潔（次）<input type="number" min="0" value={f.cleanCount} onChange={e => set('cleanCount', e.target.value)} /></label>
        </div>
        <div className="faint">建立後 Speed Loss 會先以清潔天數粗估（demo），待後台串接 noon report 即改用實際計算值。</div>
        {err && <div className="err" role="alert">{err}</div>}
        <div className="actions">
          <button type="button" className="ghost2" onClick={onClose}>取消</button>
          <button type="submit" className="primary">建立船隻</button>
        </div>
      </form>
    </div>
  )
}

/* ---------- 單船分析 ---------- */
function RecoCard({ ship }) {
  const thr = ship.thr
  const st = statusOf(ship.sl, thr)
  const dock = ship.cleanCount >= 3
  const lifeMonths = Math.max(2, 7 - ship.cleanCount * 1.5)
  const buf = bufferDays(ship, thr)
  const head = st === 'crit' ? (dock ? '清潔效果已遞減，建議評估進塢（DD）' : '建議儘速安排水下清潔（UWC+PP）')
    : st === 'watch' ? `觀察中 · 調度緩衝約 ${buf} 天` : '狀態良好，無需行動'
  return (
    <div className="card reco">
      <div className="headline" style={{ color: `var(--${st})` }}>{head}</div>
      <table><tbody>
        <tr><td>目前 Speed Loss</td><td>{ship.sl.toFixed(1)} %</td></tr>
        <tr><td>額外油耗</td><td>{ship.penalty.toFixed(1)} t/day</td></tr>
        <tr><td>突破警戒線（{thr}%）</td><td>{ship.sl >= thr ? '已超標' : `約 ${buf} 天後`}</td></tr>
        <tr><td>累計水下清潔</td><td>{ship.cleanCount} 次</td></tr>
        <tr><td><b>本次清潔預期維持</b></td><td><b>約 {lifeMonths.toFixed(0)} 個月</b></td></tr>
      </tbody></table>
      {st !== 'good' && <button className="cta">{dock ? '排入進塢評估 →' : '排入清潔計畫 →'}</button>}
    </div>
  )
}

const SHIP_TABS = [['overview', '總覽'], ['foc', '油耗細節'], ['validate', '模型驗證']]
const SL_RANGES = [['1y', '近 1 年', DMAX - 365], ['3y', '近 3 年', DMAX - 1095], ['all', '全部 5 年', 0]]

function ShipView({ ships, ship, onPick, updateShip }) {
  const [simDay, setSimDay] = useState(14)
  const [tab, setTab] = useState('overview')
  const [win, setWin] = useState({ d0: 0, d1: DMAX })
  const thr = ship.thr
  const st = statusOf(ship.sl, thr)
  const sim = simChart(ship, simDay)
  return (
    <>
      <div className="ship-tabs" role="tablist">
        {SHIP_TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''}
            onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'overview' && <>
        <div className="ship-layout">
          <aside className="ship-ctrl">
            <div className="ctrl-box">
              <select value={ship.id} onChange={e => onPick(+e.target.value)} aria-label="選擇船隻">
                {ships.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <div><span className={`pill ${st}`}>{STATUS_TXT[st]}</span></div>
              <div className="ctrl-meta">距上次清潔 {ship.daysClean} 天<br />資料點 {(ship.series ? ship.series.pts.length : 1216).toLocaleString()} 筆（可比條件篩選後）</div>
              <label className="thr-edit">此船警戒線（%）
                <span>
                  <input type="number" min="2" max="20" step="0.5" value={ship.thr}
                    onChange={e => updateShip(ship.id, { thr: parseFloat(e.target.value) || ship.thr })} /> %
                </span>
              </label>
            </div>
            <div className="ctrl-box">
              <div className="ctrl-title">顯示區間</div>
              <div className="range-opts">
                {SL_RANGES.map(([k, l, d0]) => (
                  <label key={k}>
                    <input type="radio" name="slrange" checked={win.d0 === d0 && win.d1 === DMAX}
                      onChange={() => setWin({ d0, d1: DMAX })} />{l}
                  </label>
                ))}
              </div>
            </div>
            <div className="ctrl-box plain">
              <div className="ctrl-title">圖例說明</div>
              <div className="legend v">
                <span><span className="sw dot" />每日實測點</span>
                <span><span className="sw" style={{ background: 'var(--accent)' }} />區間趨勢</span>
                <span><span className="sw" style={{ background: 'var(--faint)' }} />養護事件</span>
                <span><span className="sw" style={{ background: 'var(--crit)' }} />警戒線</span>
              </div>
              <div className="ctrl-meta">每點＝一個良好天氣航行日（風 ≤4 級、全速 ≥22h）；右緣色帶＝狀態區間（紅／黃／綠）</div>
            </div>
          </aside>
          <div className="card hero">
            <div className="hero-num">
              <b>{ship.sl.toFixed(1)}<small> % SL</small></b>
              <span className={`hero-st ${st}`}>
                {ship.sl >= thr ? `已超過警戒線 ${thr}%` : `警戒線 ${thr}% · 緩衝約 ${bufferDays(ship, thr)} 天`}
              </span>
            </div>
            <SlExplorer ship={ship} thr={thr} win={win} setWin={setWin} />
          </div>
        </div>
        <div className="ship-bottom">
          <RecoCard ship={ship} />
          <div className="card">
            <h3>損失歸因（模型估計）</h3>
            <div className="hint">船體汙損 vs 螺槳 vs 其他因素</div>
            <Svg className="donut-row" html={attrDonut(ship)} />
          </div>
          <div className="card">
            <h3>清潔排程模擬器</h3>
            <div className="hint">拖動滑桿假設清潔日，比較未來 120 天累積額外燃油</div>
            <div className="sim-row">
              <label htmlFor="simSlider">第 <b>{simDay}</b> 天清潔</label>
              <input id="simSlider" type="range" min="5" max="60" value={simDay} onChange={e => setSimDay(+e.target.value)} />
            </div>
            <Svg html={sim.svg} />
            <div className="sim-stats">{sim.stats}</div>
          </div>
        </div>
      </>}
      {tab === 'foc' && <>
        <div className="card">
          <h3>每日油耗 Daily FOC — 實測 vs 模型基準（乾淨船體）</h3>
          <div className="hint">柱狀＝實測 FOC（t/day）；藍線＝模型預測之乾淨船體基準；兩者差距即汙損造成的額外油耗</div>
          <Svg html={focChart(ship)} />
        </div>
        <div className="pipeline mt">
          <div className="step"><div className="no">STAGE 1</div><div className="nm">良好天氣航段篩選</div><div className="ds">風力 ≤4 Bft · 全速 ≥22h</div></div>
          <div className="step"><div className="no">STAGE 2</div><div className="nm">乾淨基準擬合</div><div className="ds">養護後 30 天窗口<br />速度–油耗曲線回歸</div></div>
          <div className="step"><div className="no">STAGE 3</div><div className="nm">偏移量計算</div><div className="ds">實測 FOC − 基準 FOC</div></div>
          <div className="step"><div className="no">STAGE 4</div><div className="nm">衰退曲線分解</div><div className="ds">船體 / 螺槳 / 其他<br />對齊養護事件時間軸</div></div>
          <div className="step"><div className="no">STAGE 5</div><div className="nm">輸出</div><div className="ds">Speed Loss % · 歸因 · 建議</div></div>
        </div>
        <div className="card mt" style={{ maxWidth: 860 }}>
          <h3>單日油耗歸因 — 瀑布圖（{ship.name} · D1800）</h3>
          <div className="hint">乾淨船體基準 + 各因素增量 = 當日實測 FOC；紅色＝船體汙損（本案焦點）</div>
          <Svg html={waterfall(ship)} />
        </div>
      </>}
      {tab === 'validate' && (
        <div className="card" style={{ maxWidth: 560 }}>
          <h3>模型驗證</h3>
          <div className="hint">holdout 期間預測 vs 實測 Daily FOC</div>
          <Svg className="" html={scatterChart()} />
          <Svg className="" html={mapeBars(ships)} />
        </div>
      )}
    </>
  )
}

/* ---------- 資料與報告 ---------- */
function DualVerify({ ships }) {
  const [shipId, setShipId] = useState(ships[0].id)
  const [c, setC] = useState(58); const [h, setH] = useState(22); const [sw, setSw] = useState(15.2)
  const [manual, setManual] = useState('')
  const [tol, setTol] = useState(2)
  const [log, setLog] = useState([])
  const ship = ships.find(x => x.id === shipId) || ships[0]

  // 系統軌：即時計算，不用按按鈕
  const foc = c > 0 && h > 0 ? (c / h) * 24 : null
  const base = 50 + (sw - 14) * 3.2 // ponytail: 基準用線性 mock，正式版換模型 API
  const diff = foc != null ? ((foc - base) / base) * 100 : null
  const st = diff != null ? statusOf(diff, ship.thr) : null

  // 人工軌：與系統值比對，差異在容忍範圍內＝一致
  const m = parseFloat(manual)
  const gapPct = foc != null && m > 0 ? ((m - foc) / foc) * 100 : null
  const agree = gapPct != null ? Math.abs(gapPct) <= tol : null
  const record = () => setLog(l => [{ id: l.length + 1, name: ship.name, foc, m, gapPct, agree }, ...l])
  const okN = log.filter(r => r.agree).length

  return (
    <>
      <div className="pipeline">
        <div className="step"><div className="no">STEP 1</div><div className="nm">丟一筆測試數據</div><div className="ds">船 + 當日油耗／時數／航速</div></div>
        <div className="step"><div className="no">STEP 2</div><div className="nm">系統自動計算</div><div className="ds">Daily FOC vs 模型基準</div></div>
        <div className="step"><div className="no">STEP 3</div><div className="nm">填入人工手算值</div><div className="ds">差異在容忍內＝一致</div></div>
        <div className="step"><div className="no">STEP 4</div><div className="nm">累積一致率</div><div className="ds">達標後評估退出雙軌</div></div>
      </div>
      <div className="verify-grid mt">
        <div className="card">
          <h3>① 測試數據</h3>
          <div className="hint">輸入輪機部門回報的一筆當日原始數據（人工手算須使用同一筆）</div>
          <div className="mvrow">
            <label>船隻
              <select value={shipId} onChange={e => setShipId(+e.target.value)}>
                {ships.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label>當日主機全速油耗 (MT)<input type="number" value={c} step="0.1" onChange={e => setC(+e.target.value)} /></label>
            <label>全速時數 (hr)<input type="number" value={h} step="0.5" onChange={e => setH(+e.target.value)} /></label>
            <label>對水航速 STW (kn)<input type="number" value={sw} step="0.1" onChange={e => setSw(+e.target.value)} /></label>
          </div>
          <div className="ctrl-meta">狀態判定採用此船警戒線 {ship.thr}%</div>
        </div>
        <div className="card">
          <h3>② 系統計算 × ③ 人工比對</h3>
          <table className="kv"><tbody>
            <tr><td>系統 Daily FOC</td><td>{foc != null ? `${foc.toFixed(1)} t/day` : '—'}</td></tr>
            <tr><td>模型乾淨基準</td><td>{base.toFixed(1)} t/day</td></tr>
            <tr><td>偏差（≒ speed loss）</td>
              <td style={{ color: st ? `var(--${st})` : undefined }}>
                {diff != null ? `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%（${STATUS_TXT[st]}）` : '—'}
              </td></tr>
          </tbody></table>
          <div className="mvrow" style={{ marginTop: 14 }}>
            <label>人工手算 Daily FOC (t/day)<input type="number" value={manual} step="0.1" placeholder="輪機部門算的值" onChange={e => setManual(e.target.value)} /></label>
            <label>容忍差異 ± (%)<input type="number" value={tol} min="0.5" step="0.5" onChange={e => setTol(+e.target.value || 2)} /></label>
          </div>
          {agree != null && (
            <div className={`verdict ${agree ? 'ok' : 'bad'}`} role="status">
              {agree
                ? `✓ 一致 — 差異 ${gapPct >= 0 ? '+' : ''}${gapPct.toFixed(1)}%，在 ±${tol}% 容忍範圍內`
                : `✗ 不一致 — 差異 ${gapPct >= 0 ? '+' : ''}${gapPct.toFixed(1)}%，超出 ±${tol}%，建議回報模型團隊複查`}
            </div>
          )}
          <button className="cta2" disabled={agree == null} onClick={record}>記錄本次比對 →</button>
        </div>
      </div>
      <div className="card mt">
        <h3>④ 驗證紀錄（雙軌期間累積）</h3>
        {log.length === 0 ? (
          <div className="hint">尚無紀錄——每次比對後按「記錄」即累積於此，作為結束雙軌的依據。</div>
        ) : (
          <>
            <div className="vstat">一致 {okN} / {log.length} 筆（{(okN / log.length * 100).toFixed(0)}%）· 建議：連續 30 筆一致率 ≥95% 即可評估結束雙軌（demo 門檻）</div>
            <table className="vlog">
              <thead><tr><th>#</th><th>船</th><th>系統 FOC</th><th>人工 FOC</th><th>差異</th><th>結果</th></tr></thead>
              <tbody>
                {log.map(r => (
                  <tr key={r.id}><td>{r.id}</td><td>{r.name}</td>
                    <td>{r.foc.toFixed(1)}</td><td>{r.m.toFixed(1)}</td>
                    <td>{r.gapPct >= 0 ? '+' : ''}{r.gapPct.toFixed(1)}%</td>
                    <td className={r.agree ? 'ok' : 'bad'}>{r.agree ? '✓ 一致' : '✗ 不一致'}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </>
  )
}

function Folder({ name, count, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="tree-node">
      <button className="tree-folder" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className={`chev ${open ? 'open' : ''}`}>▸</span>
        <span className="ficon">{open ? '📂' : '📁'}</span>
        <span className="fname">{name}</span>
        <span className="fnote">{count}</span>
      </button>
      {open && <div className="tree-children">{children}</div>}
    </div>
  )
}

function TreeFile({ name, note, ok = true, active = false, onClick }) {
  return (
    <button className={`tree-file ${active ? 'active' : ''}`} onClick={onClick}>
      <span className={`fdot ${ok ? 'ok' : 'warn'}`} />
      <span className="fname">{name}</span>
      <span className="fnote">{note}</span>
    </button>
  )
}

function ExplorerPanel() {
  const [sel, setSel] = useState('vt_fd_D1825.csv')
  const noonFiles = [
    { name: 'vt_fd_D1825.csv', note: '15 列 · 今日', ok: true },
    { name: 'vt_fd_D1824.csv', note: '15 列', ok: true },
    { name: 'vt_fd_D1823.csv', note: '15 列', ok: true },
    { name: 'vt_fd_D1822.csv', note: '14 列 · S7 未回報', ok: false },
    { name: 'vt_fd_D1821.csv', note: '15 列', ok: true },
    { name: 'vt_fd_D1820.csv', note: '15 列', ok: true },
    { name: 'vt_fd_D1819.csv', note: '15 列', ok: true },
  ]
  return (
    <aside className="explorer-panel">
      <div className="explorer-head">檔案總管 · 已接收資料</div>
      <Folder name="noon_reports" count="1,825 檔" defaultOpen>
        {noonFiles.map(f => (
          <TreeFile key={f.name} {...f} active={sel === f.name} onClick={() => setSel(f.name)} />
        ))}
        <div className="tree-more">…更早 1,818 檔</div>
      </Folder>
      <Folder name="maintenance" count="1 檔">
        <TreeFile name="maintenance.csv" note="77 筆事件" active={sel === 'maintenance.csv'} onClick={() => setSel('maintenance.csv')} />
      </Folder>
    </aside>
  )
}

function DataView({ ships }) {
  return (
    <div>
        <h2 className="section">每日正午報表 · 自動接收</h2>
        <div className="card">
          <div className="ingest-status"><span className="dot-live" />已啟用 — 每日 08:00 自動從船報系統拉取當日 CSV（或單船單行 data）</div>
          <div className="hint">最近同步：D1825 · 15/15 艘回報 · 累計 21,283 筆，篩選後 18,240 筆</div>
          <button className="ghost">手動補上傳 CSV（備援）</button>
        </div>
        <h2 className="section">處理管線</h2>
        <div className="pipeline">
          <div className="step"><div className="no">STEP 1</div><div className="nm">解析與欄位對映</div><div className="ds">csv → schema</div></div>
          <div className="step"><div className="no">STEP 2</div><div className="nm">良好天氣篩選</div><div className="ds">WIND_SCALE ≤ 4 Bft<br />HOURS_FULL_SPEED ≥ 22 h</div></div>
          <div className="step"><div className="no">STEP 3</div><div className="nm">燃料熱值換算</div><div className="ds">LCV → VLSFO 當量<br />MGO 42.7 / ULSFO 41.2<br />HFO 40.2 / VLSFO 40.2</div></div>
          <div className="step"><div className="no">STEP 4</div><div className="nm">Daily FOC 計算</div><div className="ds">CONSUMP ÷ HOURS × 24</div></div>
          <div className="step"><div className="no">STEP 5</div><div className="nm">模型推論</div><div className="ds">speed loss % + 汙損歸因</div></div>
        </div>
        <h2 className="section">AI 報告</h2>
        <div className="card report-doc">
          <h1>船隊船體能效月報 — D1825</h1>
          <div className="meta">模型版本 hull-fx v0.3（示意）· 全數字均為 DEMO 佔位值</div>
          <h4>① 摘要</h4>
          <p>本月全船隊平均 Speed Loss 為 <b>{(ships.reduce((s, x) => s + x.sl, 0) / ships.length).toFixed(1)}%</b>。<b>{ships.filter(s => s.sl >= s.thr).length} 艘</b>船舶超過各自警戒線，估計每日合計多燒 <b>{ships.filter(s => s.sl >= s.thr).reduce((s, x) => s + x.penalty, 0).toFixed(1)} t</b> 燃油（VLSFO 當量）。模型 Daily FOC 預測誤差（MAPE）為 <b>4.2%</b>。</p>
          <h4>② 優先處理建議</h4>
          <table>
            <thead><tr><th>船名</th><th>Speed Loss</th><th>額外油耗</th><th>建議</th><th>調度緩衝期</th></tr></thead>
            <tbody>
              {ships.slice(0, 5).map(s => {
                const st = statusOf(s.sl, s.thr)
                const act = st === 'crit' ? (s.cleanCount >= 3 ? '評估進塢' : '安排清潔') : st === 'watch' ? '觀察' : '—'
                return (
                  <tr key={s.id}><td>{s.name}</td><td className="num">{s.sl.toFixed(1)}%</td>
                    <td className="num">{s.penalty.toFixed(1)} t/d</td>
                    <td>{act}</td><td className="num">{s.sl >= s.thr ? '已超標' : `${bufferDays(s, s.thr)} 天`}</td></tr>
                )
              })}
            </tbody>
          </table>
          <h4>③ 模型依據</h4>
          <p>基準油耗模型以良好天氣航段（風力 ≤ 4 級、全速 ≥ 22 小時）訓練，比對養護事件前後之速度–油耗曲線位移，分離船體汙損與螺槳因素。</p>
          <div className="export-row">
            <button className="primary">匯出 PDF</button>
            <button>匯出 Markdown</button>
            <button>寄送給輪機部門</button>
          </div>
        </div>
    </div>
  )
}

/* ---------- AI 諮詢抽屜 ---------- */
function Drawer({ open, onClose, ctx, msgs, onAsk }) {
  const [input, setInput] = useState('')
  const boxRef = useRef(null)
  useEffect(() => { boxRef.current?.scrollTo(0, boxRef.current.scrollHeight) }, [msgs])
  const send = () => { if (input.trim()) { onAsk(input.trim()); setInput('') } }
  return (
    <aside className={`drawer ${open ? '' : 'closed'}`} aria-label="AI 諮詢">
      <header>
        <div className="t"><span className="dot" />AI 諮詢 · Consult
          <button className="x" onClick={onClose} aria-label="收合">×</button></div>
        <div className="ctx">👁 正在追蹤：{ctx}</div>
      </header>
      <div className="msgs" ref={boxRef}>
        {msgs.map((m, i) => <div key={i} className={`msg ${m.role}`}>{m.text}</div>)}
      </div>
      <div className="sugs">
        {SUGGESTIONS.map(q => <button key={q} onClick={() => onAsk(q)}>{q}</button>)}
      </div>
      <div className="inputbar">
        <input value={input} placeholder="詢問 AI 顧問…" aria-label="輸入問題"
          onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} />
        <button onClick={send}>送出</button>
      </div>
    </aside>
  )
}

/* ---------- 登入 ---------- */
// ponytail: demo 帳密寫死前端；正式版換 AWS Cognito / 後端 auth API，元件介面不變
const DEMO_USERS = { admin: 'hullfx2026', yangming: 'demo1234', hahahaha: '12345678' }

function Login({ onLogin }) {
  const [acc, setAcc] = useState('')
  const [pwd, setPwd] = useState('')
  const [err, setErr] = useState('')
  const submit = e => {
    e.preventDefault()
    if (DEMO_USERS[acc.trim()] === pwd) onLogin(acc.trim())
    else setErr('帳號或密碼錯誤，請再試一次')
  }
  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 14l2 5h14l2-5M3 14l9-2 9 2M12 12V4M8 7l4-3 4 3" /></svg>
        </div>
        <h1>船體能效監控台</h1>
        <div className="login-sub">Hull Efficiency Console</div>
        <label>帳號
          <input value={acc} autoComplete="username" autoFocus
            onChange={e => { setAcc(e.target.value); setErr('') }} placeholder="輸入帳號" />
        </label>
        <label>密碼
          <input type="password" value={pwd} autoComplete="current-password"
            onChange={e => { setPwd(e.target.value); setErr('') }} placeholder="輸入密碼" />
        </label>
        {err && <div className="login-err" role="alert">{err}</div>}
        <button type="submit" className="login-btn" disabled={!acc || !pwd}>登入</button>
        <div className="login-hint">DEMO 帳密：admin / hullfx2026</div>
      </form>
    </div>
  )
}

/* ---------- App ---------- */
export default function App() {
  const [ships, setShips] = useState(makeShips)
  const [meta, setMeta] = useState(null) // 真實資料 metadata；null = mock/載入中
  const [view, setView] = useState('fleet')
  const [shipId, setShipId] = useState(ships[0].id)
  const updateShip = (id, patch) => setShips(list => list.map(s => s.id === id ? { ...s, ...patch } : s))
  const addShip = f => setShips(list =>
    [...list, makeShip(f, Math.max(...list.map(s => s.id)) + 1)].sort((a, b) => b.sl - a.sl))

  // issue #5：開機抓 fleet_data.json（同源 → CloudFront fallback），失敗則沿用 mock
  useEffect(() => {
    let on = true
    fetchFleetData().then(j => {
      if (!on || !j) return
      const { ships: real, meta: m } = adaptFleet(j)
      if (real.length) { setShips(real); setMeta(m); setShipId(real[0].id) }
    })
    return () => { on = false }
  }, [])
  const [drawerOpen, setDrawerOpen] = useState(window.innerWidth > 1100)
  const [msgs, setMsgs] = useState([
    { role: 'sys', text: '— AI 已連線，會同步你目前查看的視圖 —' },
    { role: 'ai', text: '你好，我是船體能效顧問。我能看到你目前的儀表板狀態，可以直接問我任何關於速度損失、清潔排程或油耗的問題。' },
  ])
  const ship = ships.find(s => s.id === shipId)
  const ctx = view === 'ship' ? `單船分析：${ship.name}` : VIEW_NAME[view]

  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    setMsgs(m => [...m, { role: 'sys', text: `— 視圖已切換：${ctx}，AI 已同步脈絡 —` }])
  }, [ctx])

  const ask = q => {
    setMsgs(m => [...m, { role: 'user', text: q }])
    setTimeout(() => setMsgs(m => [...m, { role: 'ai', text: aiAnswer(q, ships, ship) }]), 350)
  }
  const pick = id => { setShipId(id); setView('ship') }

  const [explorerOpen, setExplorerOpen] = useState(false)
  const [user, setUser] = useState(() => localStorage.getItem('hullfx_user'))
  const login = u => { localStorage.setItem('hullfx_user', u); setUser(u) }
  const logout = () => { localStorage.removeItem('hullfx_user'); setUser(null) }

  if (!user) return <Login onLogin={login} />

  return (
    <div className="app">
      <nav className="rail" aria-label="側邊工具列">
        <div className="logo" title="Hull-FX">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 14l2 5h14l2-5M3 14l9-2 9 2M12 12V4M8 7l4-3 4 3" /></svg>
        </div>
        <button className={`rail-btn ${explorerOpen ? 'active' : ''}`} title="已接收資料"
          onClick={() => setExplorerOpen(o => !o)} aria-label="檔案總管">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
        </button>
      </nav>
      {explorerOpen && <ExplorerPanel />}
      <div className="main-col">
        <header className="topbar">
          <div className="title">船體能效監控台 <span className="sub">Hull Efficiency Console</span></div>
          <nav aria-label="主導航">
            {Object.entries(VIEW_NAME).map(([k, label]) => (
              <button key={k} className={`nav ${view === k ? 'active' : ''}`} onClick={() => setView(k)}>
                {NAV_ICONS[k]}
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <button className="btn-consult" onClick={() => setDrawerOpen(o => !o)}><span className="dot" />AI 諮詢</button>
          <div className="user-chip">
            <span className="avatar">{user[0].toUpperCase()}</span>
            <span className="uinfo">
              <span className="uname">{user}</span>
              <span className="urole">岸端管理員</span>
            </span>
            <button onClick={logout}>登出</button>
          </div>
        </header>
        <main className="content">
          {view === 'fleet' && <FleetView ships={ships} onPick={pick} onAdd={addShip} meta={meta} />}
          {view === 'ship' && <ShipView ships={ships} ship={ship} onPick={setShipId} updateShip={updateShip} />}
          {view === 'verify' && (<>
            <h2 className="section">人工比對（導入期雙軌驗證）</h2>
            <DualVerify ships={ships} />
          </>)}
          {view === 'data' && <DataView ships={ships} />}
        </main>
      </div>
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} ctx={ctx} msgs={msgs} onAsk={ask} />
    </div>
  )
}
