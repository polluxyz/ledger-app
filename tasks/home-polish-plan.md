# 2n 首頁去除冗餘與窄寬修整：計畫

依據 [spec 2n](../docs/specs/phase-2n-home-polish.md)（開發者 2026-11-22 核可；本計畫與 todo 同日核可）。工作區 `web-unslop`，分支 `feature/web-unslop`，一個 PR。

## 分工

- 協調者（Claude，web-unslop）：寫 spec、plan、todo 與 2l W275 修訂註記；派工；驗收；開 PR。
- Codex `default` worker：在本工作區實作 `apps/web` 與測試，不另開工作區、不開 PR、不合併。
- 開發者：PR CI 全綠後確認畫面，確認後才合併（spec §8，優先於 `CLAUDE.md` §10 自動合併）。

## 順序與相依

1. T0 協調者：2l W275 加修訂註記，與 spec、plan、todo 同一個 docs commit。
2. T1 W312 改名：只動文字與標籤，先做可讓後續 e2e 斷言一次改齊。
3. T2 W309 趨勢詳情與 `$`：獨立元件，不受版面影響。
4. T3 W310、W311 待確認卡：獨立元件。
5. T4 W308 交易列：動 `TransactionList` 的首頁窄卡樣式，需跑 SC-Y30 確認不退步。
6. T5 W307 摘要卡橫排：牽動 narrow 版面與 2m 裝飾，風險最高，放最後，前面改動穩定後再量高度。
7. T6 全套驗證與 8 張前後截圖。
8. T7 協調者驗收：讀完整 diff、自己重跑 typecheck、test、首頁與版面編輯 e2e，再開 PR。

T1～T4 互不相依，順序只為降低 e2e 斷言衝突；T5 依賴 T1（卡片標籤）完成後的 e2e 基準。

## 風險與對策

| 風險                                                                  | 對策                                                                                                |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| W307 用 CSS 換位置後，卡片連結的讀屏名稱順序改變                      | DOM 順序維持「標題、金額、我 $X、副標」，只用 grid area 擺位置；`stats.spec.ts` 連結名稱斷言不改    |
| W307 與 W279「卡片填滿格子」或 W7 同列等高衝突                        | 橫排只在 `data-home-layout="narrow"`，該版面是單欄固定順序，不受同列等高約束；W7 仍在 1280px 驗     |
| W307 長金額或負數擠壓副標                                             | 放不下時金額自己換行（spec W307），用 9 位數與負數結餘在 320px 驗                                   |
| W308 拿掉空副標後 SC-Y30「名稱寬度 >0」的量測找不到元素               | SC-Y30 量的是有名稱的列；沒有名稱的列不量名稱。若斷言需要調整，只調整選取範圍，不放寬寬度或重疊條件 |
| W308 影響交易頁                                                       | 只在 `.homeActivityRows` 範圍內生效，交易頁 52px 列高斷言保留                                       |
| W309 拿掉最新月份的詳情後，`aria-live` 不再播報選回最新月份           | 主數字已有讀屏名稱；SC-V4 的鍵盤斷言改為讀主數字或詳情，二者擇一出現                                |
| W312 改名打破 e2e 字串（`home-layout-edit.spec.ts:39`、分隔線名稱等） | 全庫搜尋「本月支出」逐一判斷是 `expense` 或 `categories`，只改後者                                  |
| 與其他工作區同時跑 Web e2e，共用測試資源                              | 依 `docs/operations/test-environment.md` 使用本工作區的資料庫與埠；衝突時回報協調者，不搶資源       |

## 替代方案與取捨

- 摘要卡用 container query 依卡寬切換：桌機 309px 卡也會變形，違反「桌機不變」。改用 narrow 版面（決策 408）。
- 全站拿掉空副標：交易頁列高會跳動，違反 3d T13。只在首頁窄卡生效（決策 409）。
- 趨勢詳情永遠顯示但改樣式：仍是同一金額出現兩次，沒有解決重複（決策 410）。
- 借還名字不截斷（b）：開發者認為長名字太占版面，不做（spec 依據）。

## 未處理（實作中發現、不在本次範圍）

- 分類色依分類 ID（資料識別碼）選色。前後截圖各建測試資料，分類 ID 不同。截圖中的分類色可能不同，選色程式未改。
- 本機未追蹤的 `.agents/skills/unslop/` 有 8 個既有格式差異。套用暫時忽略檔複驗，未改技能目錄或專案格式設定。

## 執行紀錄

- T1：分類卡、編輯把手、移動選單與播報、拖動預覽及分隔線共用「支出分類」。本月支出摘要沿用原名。兩種帳本都顯示帳本名稱與年月。
- T2：趨勢未選月份、選最新月份時，詳情區保持空白。選較早月份顯示該月和金額。主數字與摘要共用 0.48 倍的貨幣符號樣式，負號一起縮小。
- T3：待確認小按鈕在 390px 實測為 44px，在 1280px 實測為 30px。日期放在「記了一筆」之後、箭頭之前。
- T4：1280px 與 390px 的首頁無副標列都由 96.59px 降至 69px，縮短 27.59px。有副標列都是 97px。交易頁同筆交易實測 52px，SC-Y30 通過。
- T5：依 `data-home-layout="narrow"` 切換摘要卡格線。390px 共享帳本的摘要區由 602px 降至 248px，待確認卡上緣由 y=845px 移至 y=491px。個人帳本摘要區由 536px 降至 248px，待確認卡上緣由 y=779px 移至 y=491px。1280px 個人與共享摘要區維持 180px 與 202px。
- 320px 的摘要區實測為個人 248px、共享 266px。在 320px 與 390px，以 $12,345,678 支出和 -$12,300,678 結餘驗證兩種帳本。標題、金額、「我 $X」與副標的文字範圍都在卡內，彼此沒有重疊。
- T6：使用 `ledger_web_unslop_test` 和虛構資料擷取深淺色、個人與共享、1280px 與 390px 的 16 張截圖。第一輪全站測試發現 CSP 測試仍用分類卡舊名，已依畫面中的分隔線名稱修正選取器。
- 對照 16 張截圖。1280px 的摘要區 4 組像素相同。390px 可見摘要卡橫排、待確認卡提早出現、交易列縮短。結餘底色與圓弧仍可辨識。
- 全站 Web e2e 重跑 145/145 通過，耗時 8 分 40 秒，結束碼 0。涵蓋 2l SC-Y1、SC-Y2、SC-Y30、W7、版面拖動與儲存、2m SC-V1～V4，以及原有摘要連結名稱斷言。2m SC-V5～V9 由既有首頁與單元測試，加上本次截圖對照確認。

截圖路徑（各列是同一個畫面條件）

| 寬度與帳本、主題 | 改動前                                                                                                | 改動後                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1280px 個人淺色  | [before-1280-light-personal.png](../docs/artifacts/home-unslop-before/before-1280-light-personal.png) | [after-1280-light-personal.png](../docs/artifacts/home-unslop-after/after-1280-light-personal.png) |
| 1280px 個人深色  | [before-1280-dark-personal.png](../docs/artifacts/home-unslop-before/before-1280-dark-personal.png)   | [after-1280-dark-personal.png](../docs/artifacts/home-unslop-after/after-1280-dark-personal.png)   |
| 1280px 共享淺色  | [before-1280-light-shared.png](../docs/artifacts/home-unslop-before/before-1280-light-shared.png)     | [after-1280-light-shared.png](../docs/artifacts/home-unslop-after/after-1280-light-shared.png)     |
| 1280px 共享深色  | [before-1280-dark-shared.png](../docs/artifacts/home-unslop-before/before-1280-dark-shared.png)       | [after-1280-dark-shared.png](../docs/artifacts/home-unslop-after/after-1280-dark-shared.png)       |
| 390px 個人淺色   | [before-390-light-personal.png](../docs/artifacts/home-unslop-before/before-390-light-personal.png)   | [after-390-light-personal.png](../docs/artifacts/home-unslop-after/after-390-light-personal.png)   |
| 390px 個人深色   | [before-390-dark-personal.png](../docs/artifacts/home-unslop-before/before-390-dark-personal.png)     | [after-390-dark-personal.png](../docs/artifacts/home-unslop-after/after-390-dark-personal.png)     |
| 390px 共享淺色   | [before-390-light-shared.png](../docs/artifacts/home-unslop-before/before-390-light-shared.png)       | [after-390-light-shared.png](../docs/artifacts/home-unslop-after/after-390-light-shared.png)       |
| 390px 共享深色   | [before-390-dark-shared.png](../docs/artifacts/home-unslop-before/before-390-dark-shared.png)         | [after-390-dark-shared.png](../docs/artifacts/home-unslop-after/after-390-dark-shared.png)         |

## 驗證結果

協調者 2026-11-22 驗收 `399917c`：

- 讀完整 `git diff 9e3d164 399917c`：18 個檔案，只含 `apps/web` 與 `tasks`。摘要卡橫排只用 CSS grid 擺位置，DOM 順序不變；金額仍由 `formatMoney` 產生；沒有 API、schema、相依或 CI 改動。
- 重跑 `pnpm typecheck`：結束碼 0。
- 重跑 `pnpm test`：shared 161/161、API 1233/1233、Web 1323/1323，結束碼 0。
- 重跑 Web e2e `home.spec.ts`、`home-layout-edit.spec.ts`、`csp.spec.ts`、`stats.spec.ts`：54/54 通過（4.2 分鐘），結束碼 0。
- 對照截圖（1280px 淺色共享、390px 淺色共享前後，以及 390px 深色個人）：W307～W312 都和 spec 一致；1280px 摘要卡與基線相同；分類色差異來自重建測試資料，已記在「未處理」。
- PR 的 CI 全部通過後交開發者確認畫面，不自行合併（spec §8）。
