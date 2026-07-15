// 示意資料層：接真實資料時，這一檔換成 API 呼叫即可，元件不用動。

export const CONFIG = {
  penaltyPerSl: 0.55, // 每 1% speed loss ≈ 額外 t/day 油耗 — 模型應輸出此值
}

let _seed = 42
export function setSeed(s) { _seed = s }
export function rnd() { _seed = (_seed * 1103515245 + 12345) % 2147483648; return _seed / 2147483648 }

const SHIPS_META = [
  ['S1', 'W1'], ['S2', 'W1'], ['S3', 'W1'], ['S4', 'W1'], ['S5', 'W1'], ['S6', 'W1'], ['S7', 'W1'], ['S8', 'W1'],
  ['S9', 'W2'], ['S10', 'W2'], ['S11', 'W2'], ['S12', 'W2'], ['S21', 'W1'], ['S22', 'W2'], ['S23', 'W2'],
]

export function makeShips() {
  setSeed(42)
  return SHIPS_META.map(([name, type], i) => {
    const base = 0.8 + rnd() * 9.4
    const trend = []
    let v = Math.max(0.4, base - rnd() * 3)
    for (let m = 0; m < 24; m++) { v += (rnd() - 0.32) * 0.5; v = Math.max(0.3, v); trend.push(v) }
    trend[23] = base
    return {
      id: i, name, type, sl: base, trend,
      daysClean: Math.round(60 + rnd() * 640),
      cleanCount: 1 + Math.floor(rnd() * 4),
      penalty: base * CONFIG.penaltyPerSl,
    }
  }).sort((a, b) => b.sl - a.sl)
}

export const STATUS_TXT = { good: '良好', watch: '觀察', crit: '建議清潔' }
export const statusOf = (sl, thr) => (sl >= thr ? 'crit' : sl >= thr / 2 ? 'watch' : 'good')

export function bufferDays(ship, thr) {
  if (ship.sl >= thr) return 0
  const slope = Math.max(0.008, (ship.trend[23] - ship.trend[17]) / 180) // %/day
  return Math.min(365, Math.round((thr - ship.sl) / slope))
}

export function aiAnswer(q, ships, ship, thr) {
  if (q.includes('優先') || q.includes('哪些船')) {
    const top = ships.slice(0, 3).map(s => `${s.name}（${s.sl.toFixed(1)}%）`).join('、')
    const t = ships.slice(0, 3).reduce((a, s) => a + s.penalty, 0).toFixed(1)
    return `依目前模型輸出，最優先的是 ${top}。三艘合計每日多燒約 ${t} 噸 VLSFO 當量。建議先排 ${ships[0].name}——額外油耗最高、調度緩衝期最短。※ DEMO 示意回答`
  }
  if (q.includes('省多少') || q.includes('清潔一次')) {
    return '以歷史 77 筆養護事件統計（示意），清潔後 speed loss 平均從 5.8% 回落至 1.6%，約省 2.3 t/day。注意效果會遞減：第一次清潔約維持 6 個月，之後縮短到約 3 個月，最終仍需進塢重新塗裝。※ DEMO 示意回答'
  }
  if (q.includes('上升') || q.includes('為什麼')) {
    return `我看了你目前檢視的 ${ship.name}：近三個月 speed loss 斜率明顯變陡，同期報表顯示其航線海水溫度偏高、且距上次清潔已 ${ship.daysClean} 天——與生物附著加速的型態一致。※ DEMO 示意回答`
  }
  if (q.includes('歸因') || q.includes('演算法') || q.includes('模型')) {
    return '模型分兩層：先用每次養護事件後 30 天的良好天氣航段，擬合該船「乾淨船體」的速度–油耗基準曲線；之後每天把實測 FOC 與基準的偏移量，依衰退曲線型態對齊養護事件時間軸，分解為船體汙損、螺槳與其他因素。展開單船分析頁底部的「進階」區塊可看當日歸因瀑布圖。※ DEMO 示意回答'
  }
  return '這是原型的示意回覆。正式版會把「你目前檢視的視圖 + 該船模型輸出 + 養護紀錄摘要」一起送進 Claude API，回答會引用實際數據並附出處欄位。'
}

export const SUGGESTIONS = ['哪些船最該優先清潔？', '清潔一次平均能省多少？', '為什麼這艘船速度損失突然上升？', '模型是怎麼歸因的？']
