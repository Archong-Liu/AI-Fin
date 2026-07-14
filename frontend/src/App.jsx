import React, { useState, useMemo, useEffect, useRef } from 'react'
import { makeShips, statusOf, STATUS_TXT, bufferDays, aiAnswer, SUGGESTIONS } from './data.js'
import { spark, slChart, focChart, attrDonut, waterfall, scatterChart, mapeBars, simChart } from './charts.js'

const Svg = ({ html, className = 'chart-wrap' }) => (
  <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
)

const VIEW_NAME = { fleet: '船隊總覽', ship: '單船分析', verify: '人工比對', data: '資料與報告' }

/* ---------- 船隊總覽 ---------- */
function FleetView({ ships, thr, setThr, onPick }) {
  const [sent, setSent] = useState(false)
  const over = ships.filter(s => s.sl >= thr)
  const avgSl = ships.reduce((s, x) => s + x.sl, 0) / ships.length
  const totPenalty = over.reduce((s, x) => s + x.penalty, 0)
  return (
    <>
      {over.length ? (
        <div className="banner crit" role="alert">
          ⚠ {over.length} 艘船超過警戒線 {thr}%：{over.map(s => s.name).join('、')}
          <button disabled={sent} onClick={() => setSent(true)}>{sent ? '已寄送 ✓（demo）' : '立即寄送通報 Email'}</button>
        </div>
      ) : (
        <div className="banner ok">✓ 全船隊皆在警戒線 {thr}% 以內</div>
      )}
      <div className="thr-row">
        <label htmlFor="thrInput">油耗超標警戒線</label>
        <input id="thrInput" type="number" min="2" max="20" step="0.5" value={thr}
          onChange={e => { setThr(parseFloat(e.target.value) || 8); setSent(false) }} />
        <span>%</span>
        <span className="faint">超標自動通報：fleet-ops@yangming.com.tw（demo）</span>
      </div>
      <h2 className="section">船隊健康指標</h2>
      <div className="kpis">
        <div className="kpi"><div className="label">船隊平均 Speed Loss</div>
          <div className="value">{avgSl.toFixed(1)}<small> %</small></div>
          <div className="delta up">▲ 0.3 pt vs 上月</div></div>
        <div className="kpi"><div className="label">超標船數</div>
          <div className="value">{over.length}<small> / 15 艘</small></div>
          <div className="delta flat">警戒線 ≥ {thr}%</div></div>
        <div className="kpi"><div className="label">超標船估計多燒</div>
          <div className="value">{totPenalty.toFixed(1)}<small> t/day</small></div>
          <div className="delta up">燃油當量（VLSFO）</div></div>
        <div className="kpi"><div className="label">模型 FOC 預測誤差</div>
          <div className="value">4.2<small> % MAPE</small></div>
          <div className="delta down">▼ 0.6 pt（重訓後）</div></div>
      </div>
      <h2 className="section">全船隊 Speed Loss（依嚴重度排序 · 點擊查看單船）</h2>
      <div className="fleet">
        {ships.map(s => {
          const st = statusOf(s.sl, thr)
          return (
            <button key={s.id} className={`ship ${st}`} onClick={() => onPick(s.id)} aria-label={`查看 ${s.name}`}>
              <div className="ship-head">
                <span className="name">{s.name} <span className="type">{s.type}</span></span>
                <span className={`pill ${st}`}>{STATUS_TXT[st]}</span>
              </div>
              <div className="row">
                <span className="sl">{s.sl.toFixed(1)}<small> % SL</small></span>
                <span className="pen">+{s.penalty.toFixed(1)} t/d</span>
              </div>
              <div className="meta">距上次清潔 {s.daysClean} 天{s.sl < thr ? ` · 緩衝約 ${bufferDays(s, thr)} 天` : ''}</div>
              <Svg className="" html={spark(s.trend)} />
            </button>
          )
        })}
      </div>
    </>
  )
}

/* ---------- 單船分析 ---------- */
function RecoCard({ ship, thr }) {
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

function ShipView({ ships, ship, thr, onPick }) {
  const [simDay, setSimDay] = useState(14)
  const st = statusOf(ship.sl, thr)
  const sim = simChart(ship, simDay)
  return (
    <>
      <div className="ship-toolbar">
        <select value={ship.id} onChange={e => onPick(+e.target.value)}>
          {ships.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span className={`pill ${st}`}>{STATUS_TXT[st]}</span>
        <span className="faint">距上次清潔 {ship.daysClean} 天 · 資料點 1,216 筆（篩選後）</span>
      </div>
      <div className="grid-2">
        <div className="card">
          <h3>Speed Loss 時間序列</h3>
          <div className="hint">每點＝一個良好天氣航行日（風 ≤4 級、全速 ≥22h）的實測 Speed Loss；實線＝養護區間趨勢，斜率即汙損惡化速率</div>
          <Svg html={slChart(ship, thr)} />
          <div className="legend">
            <span><span className="sw dot" />每日實測點</span>
            <span><span className="sw" style={{ background: 'var(--accent)' }} />區間趨勢</span>
            <span><span className="sw" style={{ background: 'var(--faint)' }} />養護事件</span>
            <span><span className="sw" style={{ background: 'var(--crit)' }} />警戒線</span>
          </div>
        </div>
        <div className="col">
          <RecoCard ship={ship} thr={thr} />
          <div className="card">
            <h3>損失歸因（模型估計）</h3>
            <div className="hint">船體汙損 vs 螺槳 vs 其他因素</div>
            <Svg className="donut-row" html={attrDonut(ship)} />
          </div>
        </div>
      </div>
      <div className="card mt">
        <h3>清潔排程模擬器</h3>
        <div className="hint">拖動滑桿假設清潔日，比較「清潔 vs 不清潔」的累積額外燃油（未來 120 天）</div>
        <div className="sim-row">
          <label htmlFor="simSlider">假設於第 <b>{simDay}</b> 天清潔</label>
          <input id="simSlider" type="range" min="5" max="60" value={simDay} onChange={e => setSimDay(+e.target.value)} />
          <span className="sim-stats">{sim.stats}</span>
        </div>
        <Svg html={sim.svg} />
      </div>
      <details className="adv">
        <summary>進階 · 油耗細節、模型歸因與驗證（工程師展開用）</summary>
        <div className="card mt-s">
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
        <div className="grid-2 mt">
          <div className="card">
            <h3>單日油耗歸因 — 瀑布圖（{ship.name} · D1800）</h3>
            <div className="hint">乾淨船體基準 + 各因素增量 = 當日實測 FOC；紅色＝船體汙損（本案焦點）</div>
            <Svg html={waterfall(ship)} />
          </div>
          <div className="card">
            <h3>模型驗證</h3>
            <div className="hint">holdout 期間預測 vs 實測 Daily FOC</div>
            <Svg className="" html={scatterChart()} />
            <Svg className="" html={mapeBars(ships)} />
          </div>
        </div>
      </details>
    </>
  )
}

/* ---------- 資料與報告 ---------- */
function ManualVerify({ thr }) {
  const [c, setC] = useState(58); const [h, setH] = useState(22); const [s, setS] = useState(15.2)
  const [out, setOut] = useState(null)
  const run = () => {
    if (!c || !h) { setOut({ text: '請填入油耗與全速時數' }); return }
    const foc = (c / h) * 24, base = 50 + (s - 14) * 3.2, diff = ((foc - base) / base) * 100 // ponytail: 基準用線性 mock，正式版換模型 API
    const lv = diff >= thr ? 'crit' : diff >= thr / 2 ? 'watch' : 'good'
    setOut({ foc, base, diff, lv })
  }
  return (
    <div className="card">
      <div className="hint">丟一筆測試數據進來，系統算出 Daily FOC 並與模型基準比對——供管理員跟人工手算結果核對、建立信任。</div>
      <div className="mvrow">
        <label>當日主機全速油耗 (MT)<input type="number" value={c} step="0.1" onChange={e => setC(+e.target.value)} /></label>
        <label>全速時數 (hr)<input type="number" value={h} step="0.5" onChange={e => setH(+e.target.value)} /></label>
        <label>對水航速 STW (kn)<input type="number" value={s} step="0.1" onChange={e => setS(+e.target.value)} /></label>
        <button onClick={run}>計算比對</button>
      </div>
      {out && (
        <div className="mv-out">{out.text || (
          <>Daily FOC = {out.foc.toFixed(1)} t/day ・ 模型基準 {out.base.toFixed(1)} t/day ・ 偏差{' '}
            <b style={{ color: `var(--${out.lv})` }}>{out.diff >= 0 ? '+' : ''}{out.diff.toFixed(1)}%</b>
            {out.lv === 'crit' ? '（超過警戒線——請與人工手算比對後回報）' : out.lv === 'watch' ? '（偏高，建議追蹤）' : '（正常範圍）'} ※ demo 公式</>
        )}</div>
      )}
    </div>
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

function DataView({ ships, thr }) {
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
          <p>本月全船隊平均 Speed Loss 為 <b>{(ships.reduce((s, x) => s + x.sl, 0) / ships.length).toFixed(1)}%</b>。<b>{ships.filter(s => s.sl >= thr).length} 艘</b>船舶超過警戒線，估計每日合計多燒 <b>{ships.filter(s => s.sl >= thr).reduce((s, x) => s + x.penalty, 0).toFixed(1)} t</b> 燃油（VLSFO 當量）。模型 Daily FOC 預測誤差（MAPE）為 <b>4.2%</b>。</p>
          <h4>② 優先處理建議</h4>
          <table>
            <thead><tr><th>船名</th><th>Speed Loss</th><th>額外油耗</th><th>建議</th><th>調度緩衝期</th></tr></thead>
            <tbody>
              {ships.slice(0, 5).map(s => {
                const st = statusOf(s.sl, thr)
                const act = st === 'crit' ? (s.cleanCount >= 3 ? '評估進塢' : '安排清潔') : st === 'watch' ? '觀察' : '—'
                return (
                  <tr key={s.id}><td>{s.name}</td><td className="num">{s.sl.toFixed(1)}%</td>
                    <td className="num">{s.penalty.toFixed(1)} t/d</td>
                    <td>{act}</td><td className="num">{s.sl >= thr ? '已超標' : `${bufferDays(s, thr)} 天`}</td></tr>
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

/* ---------- App ---------- */
export default function App() {
  const ships = useMemo(makeShips, [])
  const [view, setView] = useState('fleet')
  const [thr, setThr] = useState(8)
  const [shipId, setShipId] = useState(ships[0].id)
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
    setTimeout(() => setMsgs(m => [...m, { role: 'ai', text: aiAnswer(q, ships, ship, thr) }]), 350)
  }
  const pick = id => { setShipId(id); setView('ship') }

  const [explorerOpen, setExplorerOpen] = useState(false)

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
              <button key={k} className={`nav ${view === k ? 'active' : ''}`} onClick={() => setView(k)}>{label}</button>
            ))}
          </nav>
          <button className="btn-consult" onClick={() => setDrawerOpen(o => !o)}><span className="dot" />AI 諮詢</button>
        </header>
        <main className="content">
          {view === 'fleet' && <FleetView ships={ships} thr={thr} setThr={setThr} onPick={pick} />}
          {view === 'ship' && <ShipView ships={ships} ship={ship} thr={thr} onPick={setShipId} />}
          {view === 'verify' && (<>
            <h2 className="section">人工比對（導入期雙軌驗證）</h2>
            <ManualVerify thr={thr} />
          </>)}
          {view === 'data' && <DataView ships={ships} thr={thr} />}
        </main>
      </div>
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} ctx={ctx} msgs={msgs} onAsk={ask} />
    </div>
  )
}
