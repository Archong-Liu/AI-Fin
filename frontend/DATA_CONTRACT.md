# 前端資料契約（Speed Loss Dashboard ↔ 後台）

對應 issue #5，v2 隨 ISO 19030 productionization（`ml/speed_loss.py` / 見
`docs/plan-speed-loss-productionization.md`）更新。前端銜接層在 `frontend/src/api.js`，
元件只消費內部形狀，後台輸出符合本契約的任一層級，前端**自動切換、零改動**。

## 降級偵測順序（依欄位存在性，不需版本協調）

| 優先 | 模式 | 觸發條件 | 說明 |
|---|---|---|---|
| 0 | `iso` | `results-json/speed_loss.json` 抓得到且非空 | **正式路徑**：ISO 19030，single source of truth |
| 1 | `daily-pct` | `fleet_data.json` 的 `daily[]` 列有數值 `speed_loss_pct` | 逐日欄位，前端自行切段擬合趨勢 |
| 2 | `derived` | 都沒有 | 前端以 `fleet_data.json` 原始欄位過渡推導（可比條件 + Admiralty 正規化） |
| 3 | mock | 兩個檔案都抓不到 | 離線示意資料 |

目前使用中的模式會顯示在船隊總覽的資料來源列。舊的「模式 1 processed」
（`fleet_data.json` 的 `ships[].speed_loss.points`）已隨這次改版移除——
`fleet_data.json` 不再帶 speed loss，一律由獨立的 `speed_loss.json` 取代。

## 模式 0（正式）：`results-json/speed_loss.json`

整份檔案是一個獨立於 `fleet_data.json` 的物件，`ships` 是**以 ship_id 為 key 的字典**
（不是陣列）：

```jsonc
{
  "generated_at": "2026-07-15T17:05:32Z",
  "standard": "ISO 19030 (in-service, data-driven per-ship reference)",
  "thresholds_speed_loss_pct": { "warning": 3.0, "critical": 6.0 },
  "fleet_summary": [
    { "ship_id": "S1", "ship_type": "W1", "latest_speed_loss_pct": -1.88,
      "status": "normal", "days_since_cleaning": 844, "primary_cause": "INDETERMINATE",
      "hull_contribution_pct": null, "propeller_contribution_pct": null,
      "trend": "degrading", "recommend_drydock": false }
  ],
  "ships": {
    "S1": {
      "reference": { "n_ref_days": 22, "has_thrust_model": false },
      "latest": {
        "day": 1825, "speed_loss_pct": -1.88, "performance_loss_pct": -5.63,
        "status": "normal", "days_since_cleaning": 844, "propeller_condition": "Good",
        "attribution": { "hull_contribution_pct": null, "propeller_contribution_pct": null,
                          "primary_cause": "INDETERMINATE", "window_days": 0 },
        "fouling_rate_pct_per_100d": -0.4, "trend": "degrading"
      },
      "history": [
        { "day": 0, "speed_loss_pct": 0.0, "performance_loss_pct": 0.0,
          "roll_speed_loss_pct": null, "days_since_hull": null }
      ],
      "events": [
        { "event_day": 981, "type": "DD", "resets": ["hull", "propeller"],
          "is_inspection_only": false, "days_since_hull_at_event": 0,
          "recovery_pct": null, "sl_before_pct": -3.987, "sl_after_pct": 0.027,
          "hull_fouling_type": null, "propeller_condition": null }
      ],
      "recovery_curve": [ /* hull 事件的養護效果曲線，選填顯示用 */ ],
      "drydock_recommendation": {
        "recommend_drydock": false, "current_speed_loss_pct": -1.88,
        "fouling_rate_pct_per_100d": -0.4,
        "rationale": "below critical and slow fouling; keep the underwater-cleaning schedule"
      }
    }
  }
}
```

必填：每船 `history[]`（`day`, `speed_loss_pct`）＋ `latest.speed_loss_pct`。
其餘選填，缺什麼前端就自己算什麼；非數值/NaN 的點會被前端丟棄，不會壞畫面。

`thresholds_speed_loss_pct` 是**全船隊統一**的警戒線（非逐船），且
`critical = 2 × warning`——前端 `thr`/`thr/2` 的既有分級邏輯剛好對上：
`thr = critical(6%)`、`thr/2 = warning(3%)`。

`speed_loss_pct` 可能是負值（實測優於自身乾淨基準擬合中位數的統計雜訊）；
前端一律以 0 為底線顯示，與模式 1/2 的既有慣例一致。

`attribution.hull_contribution_pct`/`propeller_contribution_pct` 在
`primary_cause` 為 `INDETERMINATE`（無推力計資料）時是 `null`——前端退回估算公式
並在 UI 註明「前端估算值」。

## 模式 1：`fleet_data.json` 的 `daily[]` 加一欄

在既有 daily 列直接加 `"speed_loss_pct": 4.1`（無值日給 `null`）。
前端取有值的列當 points，其餘同模式 0 的自動補齊（事件改讀 `maintenance[]`）。

## 前端內部形狀（元件消費用，後台不用管）

```js
ship = { id, name, type, sl, trend[24], daysClean, cleanCount, penalty, thr,
         srcMode: 'iso' | 'daily-pct' | 'derived',
         series: { pts: [{d, v}], segs: [{d0, d1, v0, v1}], events: [{d, label}] },
         // 以下僅 srcMode === 'iso' 時存在（見 ml/speed_loss.py latest/drydock_recommendation）：
         attribution, foulingRatePer100d, propellerCondition, backendTrend,
         recommendDrydock, dockRationale }
```

`events`：iso 模式讀 `speed_loss.json` 的 `ships[id].events[]`（`event_day`/`type`）；
其餘模式讀 `fleet_data.json` 的 `maintenance[]`（`event_day`/`event_type`）。
兩者都只保留 DD / UWC / PP / UWC+PP / UWI+PP；純 UWI 檢查不切區間、不進 events。

## 其他約定

- 端點：同源 `/results-json/speed_loss.json` + `/results-json/fleet_data.json`
  （CloudFront cache behavior，TTL ~60s），失敗一律 fallback 到 CloudFront 直連。
- 檔案更新即生效，前端重新載入頁面就吃到新資料。
- `validation.event_holdout_mape_pct`（船隊 KPI 用）仍在 `fleet_data.json`，`speed_loss.json`
  不重複帶——兩個檔案並行抓取，iso 模式下 KPI 的 model/MAPE 欄位取自 `fleet_data.json`
  （抓不到時該 KPI 顯示為 null，UI 已有預設文案）。
