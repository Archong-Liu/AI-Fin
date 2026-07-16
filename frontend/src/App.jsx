import React, { useState, useEffect, useRef, useMemo } from 'react'
import { makeShips, makeShip, DEFAULT_THR, statusOf, STATUS_TXT, bufferDays, aiAnswer, SUGGESTIONS } from './data.js'
import { spark, focChart, attrDonut, stackedFoc, scatterChart, mapeBars } from './charts.js'
import SlExplorer, { DMAX } from './SlExplorer.jsx'
import { fetchFleetData, fetchSpeedLoss, adaptFleet, adaptSpeedLoss, consultAI, buildShipContext, buildFleetContext, sendNotify, sendReportEmail } from './api.js'
import { blandAltmanAnalysis, calculateDynamicTolerance, batchStatistics } from './statistics.js'
import { professionalScatterChart, professionalBlandAltmanChart } from './charts-simple.js'
import { generateMockVerificationData, BATCH_CSV_EXAMPLE } from './demo-data.js'

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
  const [notifyState, setNotifyState] = useState('idle') // idle | sending | sent | partial | error
  const [filter, setFilter] = useState('crit') // 永遠鎖定一個分類，沒有「全部」視圖
  const [adding, setAdding] = useState(false)
  const over = ships.filter(s => s.sl >= s.thr)
  const avgSl = ships.reduce((s, x) => s + x.sl, 0) / ships.length
  const totPenalty = over.reduce((s, x) => s + x.penalty, 0)
  const shown = ships.filter(s => statusOf(s.sl, s.thr) === filter)
  // 逐船寄送（notify Lambda 一次只處理一艘船，見 lambdas/notify/handler.py）；不帶 recipients
  // 走 Lambda 預設的 SES_RECIPIENT（sandbox 已驗證地址），banner 文案的示意收件人不會真的收到。
  const sendAlerts = async () => {
    setNotifyState('sending')
    const results = await Promise.all(over.map(s => sendNotify({
      shipId: s.name, currentPct: +s.sl.toFixed(1), daysSinceHull: s.daysClean,
      note: s.dockRationale ?? undefined,
    })))
    const okCount = results.filter(r => r?.sent).length
    setNotifyState(okCount === results.length ? 'sent' : okCount > 0 ? 'partial' : 'error')
  }
  const NOTIFY_LABEL = {
    idle: '立即寄送通報 Email', sending: '寄送中…',
    sent: '已寄送 ✓', partial: '部分寄送成功 ⚠', error: '寄送失敗，點擊重試',
  }
  return (
    <>
      {over.length ? (
        <div className="banner crit" role="alert">
          ⚠ {over.length} 艘船超過各自警戒線：{over.map(s => `${s.name}（≥${s.thr}%）`).join('、')}
          <button disabled={notifyState === 'sending' || notifyState === 'sent'} onClick={sendAlerts}>
            {NOTIFY_LABEL[notifyState]}
          </button>
        </div>
      ) : (
        <div className="banner ok">✓ 全船隊皆在各自警戒線以內</div>
      )}
      <div className="thr-row">
        <span className="faint">
          {meta
            ? `資料來源 ${meta.mode === 'iso' ? 'speed_loss.json' : 'fleet_data.json'}（${meta.generatedAt?.slice(0, 10)} 產出）· ${
              { iso: 'ISO 19030 speed loss（正式）', 'daily-pct': '後台逐日 speed_loss 欄位', derived: '前端過渡推導（speed_loss.json 抓取失敗）', mixed: '混合來源' }[meta.mode]}`
            : '離線示意資料'}
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
  const dock = ship.recommendDrydock ?? (ship.cleanCount >= 3)
  const lifeMonths = Math.max(2, 7 - ship.cleanCount * 1.5)
  const buf = bufferDays(ship, thr)
  const head = st === 'crit' ? (dock ? '清潔效果已遞減，建議評估進塢（DD）' : '建議儘速安排水下清潔（UWC+PP）')
    : st === 'watch' ? `觀察中 · 調度緩衝約 ${buf} 天` : '狀態良好，無需行動'
  return (
    <div className="card reco">
      <div className="headline" style={{ color: `var(--${st})` }}>{head}</div>
      {ship.dockRationale && <div className="hint">ISO 19030 模型依據：{ship.dockRationale}</div>}
      <table><tbody>
        <tr><td>目前 Speed Loss</td><td>{ship.sl.toFixed(1)} %</td></tr>
        <tr><td>額外油耗</td><td>{ship.penalty.toFixed(1)} t/day</td></tr>
        <tr><td>突破警戒線（{thr}%）</td><td>{ship.sl >= thr ? '已超標' : `約 ${buf} 天後`}</td></tr>
        <tr><td>累計水下清潔</td><td>{ship.cleanCount} 次</td></tr>
        {ship.foulingRatePer100d != null && (
          <tr><td>汙損累積速率</td><td>{ship.foulingRatePer100d.toFixed(1)} %/100天</td></tr>
        )}
        <tr><td><b>本次清潔預期維持</b></td><td><b>約 {lifeMonths.toFixed(0)} 個月</b></td></tr>
      </tbody></table>
      {st !== 'good' && <button className="cta">{dock ? '排入進塢評估 →' : '排入清潔計畫 →'}</button>}
    </div>
  )
}

const SHIP_TABS = [['overview', '總覽'], ['foc', '油耗細節'], ['validate', '模型驗證']]
const SL_RANGES = [['1y', '近 1 年', DMAX - 365], ['3y', '近 3 年', DMAX - 1095], ['all', '全部 5 年', 0]]

function ShipView({ ships, ship, onPick, updateShip }) {
  const [tab, setTab] = useState('overview')
  const [win, setWin] = useState({ d0: 0, d1: DMAX })
  const thr = ship.thr
  const st = statusOf(ship.sl, thr)
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
        </div>
      </>}
      {tab === 'foc' && <>
        <div className="card">
          <h3>每日油耗 Daily FOC — 實測 vs 模型基準（乾淨船體）</h3>
          <div className="hint">柱狀＝實測 FOC（t/day）；藍線＝模型預測之乾淨船體基準；兩者差距即汙損造成的額外油耗</div>
          <Svg html={focChart(ship)} />
        </div>
        <div className="card mt">
          <h3>每日油耗歸因 — 成分堆疊（{ship.name} · 近 14 個航行日）</h3>
          <div className="hint">每根柱＝當日實測 FOC 的組成：乾淨基準 + 風阻 + 吃水 + 船體汙損 + 螺槳；紅色＝船體汙損（本案焦點）</div>
          <Svg html={stackedFoc(ship)} />
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
  const [activeTab, setActiveTab] = useState('single') // single | batch | analysis
  const [batchData, setBatchData] = useState('')
  const [useDynamicTol, setUseDynamicTol] = useState(false)
  const ship = ships.find(x => x.id === shipId) || ships[0]

  // 系統軌：即時計算，不用按按鈕
  const foc = c > 0 && h > 0 ? (c / h) * 24 : null
  const base = 50 + (sw - 14) * 3.2 // ponytail: 基準用線性 mock，正式版換模型 API
  const diff = foc != null ? ((foc - base) / base) * 100 : null
  const st = diff != null ? statusOf(diff, ship.thr) : null

  // 動態容忍度計算
  const dynamicTol = useMemo(() => {
    if (!useDynamicTol) return tol
    return calculateDynamicTolerance(ship, log)
  }, [useDynamicTol, tol, ship, log])

  const effectiveTol = useDynamicTol ? dynamicTol : tol

  // 人工軌：與系統值比對，差異在容忍範圍內＝一致
  const m = parseFloat(manual)
  const gapPct = foc != null && m > 0 ? ((m - foc) / foc) * 100 : null
  const agree = gapPct != null ? Math.abs(gapPct) <= effectiveTol : null
  const record = () => setLog(l => [{ 
    id: l.length + 1, 
    name: ship.name, 
    shipId: ship.id,
    foc, 
    m, 
    gapPct, 
    agree, 
    tolerance: effectiveTol,
    timestamp: new Date().toISOString()
  }, ...l])
  
  // 基於當前容忍度重新計算一致性
  const okN = log.filter(r => Math.abs(r.gapPct) <= effectiveTol).length

  // 統計分析 - 基於當前容忍度重新計算
  const statistics = useMemo(() => {
    if (log.length < 3) return null
    
    // 重新計算每條記錄的一致性（基於當前容忍度）
    const adjustedLog = log.map(record => ({
      ...record,
      agree: Math.abs(record.gapPct) <= effectiveTol,
      tolerance: effectiveTol // 更新為當前容忍度
    }))
    
    return batchStatistics(adjustedLog)
  }, [log, effectiveTol])

  // 演示數據生成
  const generateDemoData = () => {
    try {
      const demoData = generateMockVerificationData(25)
      setLog(demoData)
      setActiveTab('analysis')
    } catch (error) {
      console.error('生成演示數據失敗:', error)
      alert('生成演示數據失敗，請檢查控制台')
    }
  }

  const loadBatchExample = () => {
    setBatchData(BATCH_CSV_EXAMPLE)
  }

  // 批量處理函數
  const processBatchData = () => {
    try {
      const lines = batchData.trim().split('\n')
      const batchResults = []
      
      lines.forEach((line, index) => {
        const parts = line.split(',').map(p => p.trim())
        if (parts.length >= 4) {
          const [shipName, consumption, hours, speed, manualValue] = parts
          const batchFoc = (parseFloat(consumption) / parseFloat(hours)) * 24
          const batchBase = 50 + (parseFloat(speed) - 14) * 3.2
          const batchDiff = ((batchFoc - batchBase) / batchBase) * 100
          const batchGap = ((parseFloat(manualValue) - batchFoc) / batchFoc) * 100
          const batchAgree = Math.abs(batchGap) <= effectiveTol
          
          batchResults.push({
            id: log.length + batchResults.length + 1,
            name: shipName,
            shipId: shipId, // 使用當前選中的船
            foc: batchFoc,
            m: parseFloat(manualValue),
            gapPct: batchGap,
            agree: batchAgree,
            tolerance: effectiveTol,
            timestamp: new Date().toISOString(),
            batch: true
          })
        }
      })
      
      setLog(prev => [...batchResults, ...prev])
      setBatchData('')
      alert(`成功處理 ${batchResults.length} 筆批量數據`)
    } catch (error) {
      alert('批量數據格式錯誤，請檢查 CSV 格式')
    }
  }

  return (
    <>
      {/* 標籤頁導航 */}
      <div className="verify-tabs">
        <button 
          className={`tab-btn ${activeTab === 'single' ? 'active' : ''}`}
          onClick={() => setActiveTab('single')}
        >
          單筆驗證
        </button>
        <button 
          className={`tab-btn ${activeTab === 'batch' ? 'active' : ''}`}
          onClick={() => setActiveTab('batch')}
        >
          批量驗證
        </button>
        <button 
          className={`tab-btn ${activeTab === 'analysis' ? 'active' : ''}`}
          onClick={() => setActiveTab('analysis')}
        >
          統計分析 {log.length > 0 && `(${log.length})`}
        </button>
        <button 
          className="tab-btn demo"
          onClick={generateDemoData}
        >
          生成演示數據
        </button>
      </div>



      {/* 單筆驗證頁面 */}
      {activeTab === 'single' && (
        <>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input 
                      type="checkbox" 
                      checked={useDynamicTol} 
                      onChange={e => setUseDynamicTol(e.target.checked)}
                    />
                    動態容忍度
                  </label>
                  {!useDynamicTol && (
                    <label>容忍差異 ± (%)<input type="number" value={tol} min="0.5" step="0.5" onChange={e => setTol(+e.target.value || 2)} /></label>
                  )}
                  {useDynamicTol && (
                    <div className="hint" style={{ fontSize: '12px', color: 'var(--muted)' }}>
                      當前動態容忍度: ±{effectiveTol.toFixed(1)}% (基於船型: {ship.type || 'general'})
                    </div>
                  )}
                </div>
              </div>
              {agree != null && (
                <div className={`verdict ${agree ? 'ok' : 'bad'}`} role="status">
                  {agree
                    ? `✓ 一致 — 差異 ${gapPct >= 0 ? '+' : ''}${gapPct.toFixed(1)}%，在 ±${effectiveTol.toFixed(1)}% 容忍範圍內`
                    : `✗ 不一致 — 差異 ${gapPct >= 0 ? '+' : ''}${gapPct.toFixed(1)}%，超出 ±${effectiveTol.toFixed(1)}%，建議回報模型團隊複查`}
                </div>
              )}
              <button className="cta2" disabled={agree == null} onClick={record}>記錄本次比對 →</button>
            </div>
          </div>
        </>
      )}

      {/* 批量驗證頁面 */}
      {activeTab === 'batch' && (
        <div className="card mt">
          <h3>批量數據驗證</h3>
          <div className="hint">
            上傳 CSV 格式數據進行批量驗證。格式：船名,油耗(MT),時數(hr),航速(kn),人工FOC值<br/>
            範例：EVER_GIVEN,58,22,15.2,63.2
          </div>
          
          {/* 容忍度設定區域 */}
          <div className="batch-tolerance-control" style={{ 
            background: '#f8f9fa', 
            padding: '16px', 
            borderRadius: '6px', 
            margin: '16px 0',
            border: '1px solid #e9ecef'
          }}>
            <h4 style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#495057' }}>驗證設定</h4>
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: '500', minWidth: '80px' }}>容忍度閾值</span>
                <input 
                  type="number" 
                  value={tol} 
                  onChange={e => setTol(parseFloat(e.target.value) || 0)}
                  step="0.1" 
                  min="0" 
                  max="10"
                  style={{ 
                    width: '80px', 
                    padding: '4px 8px', 
                    border: '1px solid #ced4da',
                    borderRadius: '4px',
                    fontSize: '14px'
                  }}
                  disabled={useDynamicTol}
                />
                <span style={{ fontSize: '14px', color: '#6c757d' }}>%</span>
              </label>
              
              <label style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px',
                padding: '8px 12px',
                background: useDynamicTol ? '#e3f2fd' : 'transparent',
                borderRadius: '4px',
                border: useDynamicTol ? '1px solid #2196f3' : '1px solid transparent'
              }}>
                <input 
                  type="checkbox" 
                  checked={useDynamicTol}
                  onChange={e => setUseDynamicTol(e.target.checked)}
                  style={{ margin: '0' }}
                />
                <span style={{ fontSize: '14px', fontWeight: '500' }}>使用動態容忍度</span>
              </label>
              
              <div style={{ 
                padding: '8px 12px',
                background: '#e8f5e8',
                borderRadius: '4px',
                border: '1px solid #28a745'
              }}>
                <span style={{ fontSize: '13px', fontWeight: '600', color: '#155724' }}>
                  當前閾值: ±{effectiveTol.toFixed(1)}%
                </span>
              </div>
            </div>
            
            <div className="hint" style={{ marginTop: '8px', fontSize: '12px', color: '#6c757d' }}>
              {useDynamicTol ? 
                '動態容忍度會根據歷史數據自動調整，提高驗證準確性' : 
                '固定容忍度適用於標準化驗證流程'
              }
            </div>
          </div>

          <textarea
            value={batchData}
            onChange={e => setBatchData(e.target.value)}
            placeholder="船名1,58,22,15.2,63.2&#10;船名2,62,20,14.8,68.1&#10;..."
            rows={8}
            style={{ 
              width: '100%', 
              padding: '10px', 
              border: '1px solid var(--line)', 
              borderRadius: '4px',
              fontFamily: 'monospace'
            }}
          />
          <div className="mvrow" style={{ marginTop: '16px', justifyContent: 'space-between' }}>
            <button 
              className="ghost" 
              onClick={loadBatchExample}
              style={{ padding: '8px 16px', fontSize: '14px' }}
            >
              載入範例數據
            </button>
            <button 
              className="cta2" 
              onClick={processBatchData}
              disabled={!batchData.trim()}
            >
              處理批量數據
            </button>
          </div>
        </div>
      )}

      {/* 統計分析頁面 */}
      {activeTab === 'analysis' && (
        <div className="mt">
          {log.length < 3 ? (
            <div className="card">
              <h3>統計分析</h3>
              <div className="hint">需要至少 3 筆驗證記錄才能進行統計分析</div>
            </div>
          ) : (
            <>
              {/* 統計摘要卡片 */}
              <div className="card">
                <h3>統計摘要</h3>
                <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginTop: '16px' }}>
                  <div className="stat-item">
                    <div className="stat-label">總驗證次數</div>
                    <div className="stat-value">{statistics?.totalRecords || 0}</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-label">一致率</div>
                    <div className="stat-value" style={{ color: (statistics?.agreementRate || 0) >= 0.95 ? 'var(--good)' : (statistics?.agreementRate || 0) >= 0.8 ? 'var(--watch)' : 'var(--crit)' }}>
                      {((statistics?.agreementRate || 0) * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-label">平均差異</div>
                    <div className="stat-value">{(statistics?.meanGap || 0) >= 0 ? '+' : ''}{(statistics?.meanGap || 0).toFixed(2)}%</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-label">差異標準差</div>
                    <div className="stat-value">±{(statistics?.stdGap || 0).toFixed(2)}%</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-label">相關係數</div>
                    <div className="stat-value">{statistics?.correlation?.toFixed(3) || 'N/A'}</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-label">R²</div>
                    <div className="stat-value">{statistics?.regression?.rSquared?.toFixed(3) || 'N/A'}</div>
                  </div>
                </div>
              </div>

              {/* 圖表區域 */}
              <div className="analysis-charts" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '20px' }}>
                <div className="card">
                  <div dangerouslySetInnerHTML={{ 
                    __html: professionalScatterChart(
                      log.map(r => r.foc), 
                      log.map(r => r.m),
                      log.map(r => ({ name: r.name, timestamp: r.timestamp })),
                      { title: "系統值 vs 人工值散點圖" }
                    )
                  }} />
                </div>
                <div className="card">
                  <div dangerouslySetInnerHTML={{ 
                    __html: professionalBlandAltmanChart(
                      statistics?.blandAltman, 
                      log.map(r => ({ name: r.name, timestamp: r.timestamp })),
                      { title: "Bland-Altman 一致性分析" }
                    )
                  }} />
                </div>
              </div>

              {/* 異常值檢測 */}
              {statistics?.outliers && statistics.outliers.length > 0 && (
                <div className="card mt">
                  <h3>異常值檢測</h3>
                  <div className="hint">以下記錄被識別為統計異常值（基於 IQR 方法）：</div>
                  <table className="vlog" style={{ marginTop: '16px' }}>
                    <thead><tr><th>記錄#</th><th>船名</th><th>系統FOC</th><th>人工FOC</th><th>差異</th><th>異常類型</th></tr></thead>
                    <tbody>
                      {statistics.outliers.map(r => (
                        <tr key={r.id} style={{ backgroundColor: 'var(--danger-bg)' }}>
                          <td>{r.id}</td><td>{r.name}</td>
                          <td>{r.foc.toFixed(1)}</td><td>{r.m.toFixed(1)}</td>
                          <td>{r.gapPct >= 0 ? '+' : ''}{r.gapPct.toFixed(1)}%</td>
                          <td>{r.outlierReason === 'high' ? '高異常' : '低異常'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* 驗證記錄（所有標籤頁共用） */}
      <div className="card mt">
        <h3>④ 驗證紀錄（雙軌期間累積）</h3>
        {log.length === 0 ? (
          <div className="hint">尚無紀錄——每次比對後按「記錄」即累積於此，作為結束雙軌的依據。</div>
        ) : (
          <>
            <div className="vstat">
              一致 {okN} / {log.length} 筆（{(okN / log.length * 100).toFixed(0)}%）· 
              建議：連續 30 筆一致率 ≥95% 即可評估結束雙軌（demo 門檻）
              {useDynamicTol && <span style={{ marginLeft: '10px', color: 'var(--accent)' }}>[AUTO] 動態容忍度已啟用</span>}
            </div>
            <table className="vlog">
              <thead><tr><th>#</th><th>船</th><th>系統 FOC</th><th>人工 FOC</th><th>差異</th><th>容忍度</th><th>結果</th><th>類型</th></tr></thead>
              <tbody>
                {log.map(r => {
                  const currentAgree = Math.abs(r.gapPct) <= effectiveTol
                  return (
                    <tr key={r.id}><td>{r.id}</td><td>{r.name}</td>
                      <td>{r.foc.toFixed(1)}</td><td>{r.m.toFixed(1)}</td>
                      <td>{r.gapPct >= 0 ? '+' : ''}{r.gapPct.toFixed(1)}%</td>
                      <td>±{effectiveTol.toFixed(1)}%</td>
                      <td className={currentAgree ? 'ok' : 'bad'}>{currentAgree ? '✓ 一致' : '✗ 不一致'}</td>
                      <td>{r.batch ? '批量' : '單筆'}</td>
                    </tr>
                  )
                })}
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

function DataView({ ships, meta }) {
  const avgSl = ships.reduce((s, x) => s + x.sl, 0) / ships.length
  const overShips = ships.filter(s => s.sl >= s.thr)
  const totPenalty = overShips.reduce((s, x) => s + x.penalty, 0)
  const mape = meta?.mape ?? 4.2
  const staticSummary = `本月全船隊平均 Speed Loss 為 ${avgSl.toFixed(1)}%。${overShips.length} 艘船舶超過各自警戒線，估計每日合計多燒 ${totPenalty.toFixed(1)} t 燃油（VLSFO 當量）。模型 Daily FOC 預測誤差（MAPE）為 ${mape.toFixed(1)}%。`

  const [aiSummary, setAiSummary] = useState(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [notificationState, setNotificationState] = useState('idle')

  // ①摘要用真實 Bedrock 呼叫產生（docs/feature-spec.md F4 v0.2），失敗/未設 VITE_API_BASE
  // 就停在 staticSummary（同一組真實數字，只是沒有 AI 潤飾）——與其餘 AI 功能同一套降級邏輯。
  useEffect(() => {
    let on = true
    setAiBusy(true)
    consultAI({
      view: 'data',
      question: '請根據以上船隊資料撰寫一段月報摘要（繁體中文，3-4 句話，不要條列），需引用平均 Speed Loss、超標船數、估計每日多燒油量、模型 MAPE 這幾個數字，語氣正式，給岸端管理層看。',
      fleetContext: buildFleetContext(ships, meta),
    }).then(res => { if (on) { setAiSummary(res?.answer ?? null); setAiBusy(false) } })
    return () => { on = false }
  }, [ships, meta])

  // 單一資料來源：畫面表格、Markdown 匯出、寄信內容都從這裡取值，不各自重算一份
  const reportRows = ships.slice(0, 5).map(s => {
    const st = statusOf(s.sl, s.thr)
    return {
      ship_id: s.name, sl_pct: s.sl.toFixed(1), penalty_t_day: s.penalty.toFixed(1),
      action: st === 'crit' ? (s.cleanCount >= 3 ? '評估進塢' : '安排清潔') : st === 'watch' ? '觀察' : '—',
      buffer: s.sl >= s.thr ? '已超標' : `${bufferDays(s, s.thr)} 天`,
    }
  })
  const reportBasis = '基準油耗模型以良好天氣航段（風力 ≤ 4 級、全速 ≥ 22 小時）訓練，比對養護事件前後之速度–油耗曲線位移，分離船體汙損與螺槳因素。'

  // 一封信，排版對齊畫面上的報告卡片（①摘要/②表格/③模型依據）——不是每艘船各寄一封
  const sendToEngineering = async () => {
    setNotificationState('sending')
    const res = await sendReportEmail({
      title: '船隊船體能效月報', summary: aiSummary ?? staticSummary,
      rows: reportRows, basis: reportBasis,
    })
    setNotificationState(res?.sent ? 'sent' : 'error')
  }

  const exportMarkdown = () => {
    const rows = reportRows.map(r =>
      `| ${r.ship_id} | ${r.sl_pct}% | ${r.penalty_t_day} t/d | ${r.action} | ${r.buffer} |`).join('\n')
    const md = `# 船隊船體能效月報\n\n## 摘要\n\n${aiSummary ?? staticSummary}\n\n` +
      `## 優先處理建議\n\n| 船名 | Speed Loss | 額外油耗 | 建議 | 調度緩衝期 |\n|---|---|---|---|---|\n${rows}\n\n` +
      `## 模型依據\n\n${reportBasis}\n`
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }))
    const a = document.createElement('a')
    a.href = url; a.download = 'fleet-report.md'; a.click()
    URL.revokeObjectURL(url)
  }

  const NOTIFY_LABEL = { idle: '寄送給輪機部門', sending: '寄送中…', sent: '已寄送 ✓', error: '寄送失敗，點擊重試' }

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
          <div className="meta">模型版本 hull-fx v0.3 · {aiSummary ? 'AI 摘要（Bedrock Claude）' : 'AI 摘要未啟用，顯示系統計算摘要'}</div>
          <h4>① 摘要</h4>
          <p>{aiBusy && !aiSummary ? 'AI 摘要生成中…' : (aiSummary ?? staticSummary)}</p>
          <h4>② 優先處理建議</h4>
          <table>
            <thead><tr><th>船名</th><th>Speed Loss</th><th>額外油耗</th><th>建議</th><th>調度緩衝期</th></tr></thead>
            <tbody>
              {reportRows.map(r => (
                <tr key={r.ship_id}><td>{r.ship_id}</td><td className="num">{r.sl_pct}%</td>
                  <td className="num">{r.penalty_t_day} t/d</td>
                  <td>{r.action}</td><td className="num">{r.buffer}</td></tr>
              ))}
            </tbody>
          </table>
          <h4>③ 模型依據</h4>
          <p>{reportBasis}</p>
          <div className="export-row">
            <button className="primary" onClick={() => window.print()}>匯出 PDF</button>
            <button onClick={exportMarkdown}>匯出 Markdown</button>
            <button onClick={sendToEngineering} disabled={notificationState === 'sending' || notificationState === 'sent'}>
              {NOTIFY_LABEL[notificationState]}
            </button>
          </div>
        </div>
    </div>
  )
}

/* ---------- AI 諮詢抽屜 ---------- */
function Drawer({ open, onClose, ctx, msgs, onAsk, busy }) {
  const [input, setInput] = useState('')
  const boxRef = useRef(null)
  useEffect(() => { boxRef.current?.scrollTo(0, boxRef.current.scrollHeight) }, [msgs, busy])
  const send = () => { if (input.trim() && !busy) { onAsk(input.trim()); setInput('') } }
  return (
    <aside className={`drawer ${open ? '' : 'closed'}`} aria-label="AI 諮詢">
      <header>
        <div className="t"><span className="dot" />AI 諮詢 · Consult
          <button className="x" onClick={onClose} aria-label="收合">×</button></div>
        <div className="ctx">👁 正在追蹤：{ctx}</div>
      </header>
      <div className="msgs" ref={boxRef}>
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.text}
            {m.action && <div className="msg-action">💡 {m.action.summary}</div>}
          </div>
        ))}
        {busy && <div className="msg ai pending">思考中…</div>}
      </div>
      <div className="sugs">
        {SUGGESTIONS.map(q => <button key={q} disabled={busy} onClick={() => onAsk(q)}>{q}</button>)}
      </div>
      <div className="inputbar">
        <input value={input} placeholder="詢問 AI 顧問…" aria-label="輸入問題" disabled={busy}
          onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} />
        <button onClick={send} disabled={busy}>送出</button>
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

  // 開機抓正式資料（同源 → CloudFront fallback）：優先 speed_loss.json（ISO 19030，single source
  // of truth），抓不到才退回 fleet_data.json 的過渡推導；都失敗則沿用 mock。
  useEffect(() => {
    let on = true
    Promise.all([fetchSpeedLoss(), fetchFleetData()]).then(([sl, fleet]) => {
      if (!on) return
      const iso = sl ? adaptSpeedLoss(sl, fleet) : null
      if (iso?.ships.length) { setShips(iso.ships); setMeta(iso.meta); setShipId(iso.ships[0].id); return }
      if (fleet) {
        const { ships: real, meta: m } = adaptFleet(fleet)
        if (real.length) { setShips(real); setMeta(m); setShipId(real[0].id) }
      }
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

  // 呼叫 /api/consult（見 docs/feature-spec.md F4 v0.2）；VITE_API_BASE 未設定或呼叫失敗時
  // 退回本地示意回覆 aiAnswer()，行為與 api.js 的 fetchFleetData 多來源降級一致。
  const [busy, setBusy] = useState(false)
  const ask = async q => {
    setMsgs(m => [...m, { role: 'user', text: q }])
    const history = msgs.filter(m => m.role === 'user' || m.role === 'ai').slice(-6)
      .map(m => ({ role: m.role, text: m.text }))
    setBusy(true)
    const res = await consultAI({
      view, question: q, history,
      shipContext: view === 'ship' ? buildShipContext(ship) : null,
      fleetContext: view === 'fleet' ? buildFleetContext(ships, meta) : null,
    })
    setBusy(false)
    if (res?.answer) setMsgs(m => [...m, { role: 'ai', text: res.answer, action: res.suggested_action }])
    else setTimeout(() => setMsgs(m => [...m, { role: 'ai', text: aiAnswer(q, ships, ship) }]), 300)
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
          {view === 'data' && <DataView ships={ships} meta={meta} />}
        </main>
      </div>
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} ctx={ctx} msgs={msgs} onAsk={ask} busy={busy} />
    </div>
  )
}
