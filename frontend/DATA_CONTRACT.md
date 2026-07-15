# 前端資料契約（Speed Loss Dashboard ↔ 後台）

對應 issue #5。前端銜接層在 `frontend/src/api.js`，元件只消費內部形狀，
後台輸出符合本契約的任一層級，前端**自動切換、零改動**。

## 降級偵測順序（依欄位存在性，不需版本協調）

| 優先 | 模式 | 觸發條件 | 說明 |
|---|---|---|---|
| 1 | `processed` | `ships[].speed_loss.points` 存在 | **正式路徑**：後台清洗/計算完的 speed loss |
| 2 | `daily-pct` | `daily[]` 列有數值 `speed_loss_pct` | 逐日欄位，前端自行切段擬合趨勢 |
| 3 | `derived` | 都沒有 | 前端以 raw 欄位過渡推導（可比條件 + Admiralty 正規化），**後台欄位上線即自動棄用** |
| 4 | mock | fetch 失敗 | 離線示意資料 |

目前使用中的模式會顯示在船隊總覽的資料來源列。

## 模式 1（正式）：`ships[].speed_loss` 區塊

```jsonc
{
  "ship_id": "S1",
  "ship_type": "W1",
  "maintenance": [ /* 既有結構不變 */ ],
  "daily":       [ /* 既有結構不變 */ ],
  "speed_loss": {
    "method": "ISO19030",              // 或 model 版本字串，僅供顯示/追溯
    "current_pct": 6.3,                // 目前 speed loss %（卡片/KPI 直接用）
    "thr": 8,                          // （選填）該船警戒線 %，缺省用船種預設
    "points": [                        // 已清洗、可比條件篩選後的逐日點
      { "day": 123, "pct": 4.1 }
    ],
    "segments": [                      // （選填）養護區間趨勢段；缺省前端自行擬合
      { "d0": 0, "d1": 560, "p0": 1.0, "p1": 8.2 }
    ]
  }
}
```

必填：`points[]（day, pct）`。其餘選填，缺什麼前端就自己算什麼。
非數值/NaN 的點會被前端丟棄，不會壞畫面。

## 模式 2：`daily[]` 加一欄

在既有 daily 列直接加 `"speed_loss_pct": 4.1`（無值日給 `null`）。
前端取有值的列當 points，其餘同模式 1 的自動補齊。

## 前端內部形狀（元件消費用，後台不用管）

```js
ship = { id, name, type, sl, trend[24], daysClean, cleanCount, penalty, thr,
         srcMode: 'processed' | 'daily-pct' | 'derived',
         series: { pts: [{d, v}], segs: [{d0, d1, v0, v1}], events: [{d, label}] } }
```

`events` 來自 `maintenance[]`（DD / UWC / PP / UWC+PP / UWI+PP；UWI 純檢查不切區間）。

## 其他約定

- 端點：同源 `/results-json/fleet_data.json`（CloudFront cache behavior，TTL ~60s）。
- 檔案更新即生效，前端重新載入頁面就吃到新資料；要自動輪詢前建議先做 per-ship 拆檔（32MB 整包不適合高頻輪詢）。
- `validation.event_holdout_mape_pct` 會顯示在船隊 KPI——目前線上檔案缺這個區塊，請補。
- follow-up（issue #5 checklist #4）：正式 ISO 19030 `speed_loss_pct` 由 ML team 產出後，走模式 1 或 2 皆可。
