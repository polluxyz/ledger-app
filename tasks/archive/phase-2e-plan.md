# 實作計畫：階段二 (2e) — Web 端對端測試（Playwright）

> 對應 spec：`docs/specs/phase-2e-web-e2e.md`（已核可，2026-08-24）
> 分支：`feature/web-e2e-playwright`
> 狀態：**待審核**

---

## 1. 為什麼是這一塊

Slice 2 做完之後，前端有五個頁面、四種對話框，全部靠 mock `fetch` 的元件測試把關。這些測試抓不到「兩個行程之間」的問題，而那類問題已經咬過三次，最後一次是整頁全白、四個指令全綠。

在 Slice 3 再堆一批畫面之前，先把這個洞補起來。越晚做，要補寫的情境越多。

---

## 2. 範圍

### 範圍內

- Playwright 的安裝、設定、目錄慣例。
- 自動啟動 API 與 web，測完自動關閉。
- 每個測試前清空 `ledger_test`。
- spec §7 的六個情境。
- 順帶把 `apps/api/test/e2e-utils.ts` 的 `resetDb` 改成動態查詢。
- CI 步驟與瀏覽器快取。

### 範圍外

見 spec §1「範圍外」。這裡只補一條實作層面的：**不重構既有的 Vitest 測試**。就算發現有些元件測試被 e2e 蓋掉了，這次也不刪，避免範圍失控。

---

## 3. 元件與相依

```
playwright.config.ts
├── globalSetup ──→ prisma migrate deploy（ledger_test）
├── webServer[0] ─→ API :3100   （等 /docs 回 200）
├── webServer[1] ─→ web :5273   （等 / 回 200）
└── projects: [chromium]

e2e/
├── db.ts        pg 連線 + 動態 TRUNCATE          （無相依）
├── api.ts       打 :3100 的輔助函式               （無相依）
├── fixtures.ts  組合 db + api，產出「已登入的頁面」（相依 db、api）
└── ledgers.spec.ts                                （相依 fixtures）
```

相依方向單純，沒有循環。`db.ts` 與 `api.ts` 互不相識——一個講 SQL，一個講 HTTP。

**外部相依**：本機要有跑得起來的 PostgreSQL 與 `apps/api/.env.test`。這與現有的 api e2e 條件相同，沒有新增門檻。

---

## 4. 待確認的設計決策

spec 的 D1～D8 已定案，這裡只列實作時才浮現的題目。

### P1 — 伺服器就緒怎麼判定：**用 `/docs`**

Playwright 的 `webServer` 要一個 URL，等它有回應才開始測。

API 沒有 health 端點。根路徑 `/` 會 404，因為所有路由掛在 `/api` 之下。可用的選項：

| 選項               | 問題                                                                                |
| ------------------ | ----------------------------------------------------------------------------------- |
| `GET /api/ledgers` | 沒 token 會回 401。Playwright 新版接受 401 當作「活著」，但這是靠版本行為吃飯，會脆 |
| 新增 health 端點   | 要改產品程式碼，超出本步範圍                                                        |
| **`GET /docs`**    | Swagger UI，回 200，本來就存在                                                      |

**選 `/docs`**。零改動，語意也對——文件出得來代表應用程式起來了。

代價：哪天把 Swagger 關掉（例如正式環境不曝露文件），這裡要跟著改。寫進註解。

### P2 — 元素怎麼選：**先用可及性選取器，撐不住才加 `data-testid`**（需要你點頭）

Playwright 建議用 `getByRole`、`getByLabel`、`getByText`——這些也是使用者實際辨認元素的方式，順便驗到可及性。

問題是有些地方可能選不到，例如帳本切換器的選項、確認對話框裡的特定按鈕。

**做法**：先一律用可及性選取器。真的選不到，才在那個元素加 `data-testid`，而且**加之前先問**（spec §9 已列為 Ask first）。

**不接受的做法**：用 CSS class 選取。CSS Modules 的 class 名稱是編譯後產生的，改個樣式就爛。

### P3 — 兩個帳號的瀏覽器怎麼開：**同一個測試內開兩個 context**

情境 3、4 要同時看 A 與 B 的畫面。

Playwright 的 `browser.newContext()` 各自有獨立的 `localStorage` 與 cookie，等同兩台電腦。在同一個測試裡開兩個，比拆成兩個測試再想辦法傳狀態單純得多。

### P4 — 情境 6 的前置資料怎麼建：**用 API，不走畫面**

情境 6 要「帳本裡有別人的交易」才會回 409。讓 B 在畫面上一步步記一筆交易，要跑完登入、切帳本、填表單——那些是情境 1、2 已經驗過的事，重跑只是拖慢。

**做法**：B 的那筆交易直接打 `POST /api/ledgers/:id/transactions` 建立。這符合 spec D3（打真實 API），也不繞過業務規則。

### P5 — 409 的畫面呈現要先確認

spec 情境 6 寫「回 409 並引導去封存」。實作前要先確認前端**真的有**顯示那段引導文字，以及它的實際措辭。

如果發現沒有，那是 Slice 2 的缺漏，**停下來說明**，不要在 e2e 裡順手改產品程式碼。

---

## 5. 實作順序

| Step | 內容                                                          | 為什麼排這裡                                                  |
| ---- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| 1    | 裝套件、`playwright.config.ts`、工具鏈涵蓋、冒煙測試          | 先讓「跑得起來」這件事本身綠掉，後面才有地方站                |
| 2    | 兩個伺服器 + `globalSetup` + `db.ts`；順帶改 api 的 `resetDb` | 冒煙測試此時才真的打得到後端                                  |
| 3    | `api.ts` 與 `fixtures.ts`                                     | 有了乾淨的資料庫，才談得上「準備某個狀態」                    |
| 4    | 六個情境                                                      | 前三步是地基，這步才是產出                                    |
| 5    | SC-E6 的驗證實驗                                              | 要有情境才驗得了「拿掉設定會不會紅」                          |
| 6    | CI                                                            | 本機全綠再上 CI。反過來會變成用 CI 當偵錯工具，每輪等好幾分鐘 |

Step 1 到 3 是純基礎建設，看不到任何業務價值。這是刻意的——**先讓工具鏈綠，再寫測試**，否則會同時在對付「設定沒弄好」與「測試寫錯」兩件事，分不清是哪個爛。

---

## 6. 風險與對策

| 風險                                                                                        | 對策                                                                                                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **dev server 首次啟動慢**：Vite 要預打包相依，可能超過 Playwright 預設的 60 秒              | `webServer.timeout` 調到 120 秒。CI 上第一次尤其慢                                                                  |
| **Windows 關不掉子行程**：`pnpm --filter` 會生出行程樹，Playwright 可能只殺掉外層，埠被佔住 | 用專用埠（D6）讓衝突好認；本機重跑靠 `reuseExistingServer`。真的殺不掉就改成直接呼叫底層指令，不透過 pnpm           |
| **兩套 e2e 互相清資料**：api e2e 與 web e2e 共用 `ledger_test`                              | CI 是序列步驟不會撞。本機要在 README 與 spec 註明不可同時跑                                                         |
| **選取器脆弱**：畫面一改測試就紅                                                            | P2 的選取器策略。紅了要先問「是產品壞了還是測試寫太死」                                                             |
| **CI 時間膨脹**：瀏覽器下載約 150 MB                                                        | `actions/cache`。沒命中時第一次會慢，之後穩定                                                                       |
| **測試變不穩**：非同步載入的畫面容易搶快                                                    | 一律用 Playwright 的自動等待（`expect(...).toBeVisible()`），**禁止 `waitForTimeout` 硬等**。不重試（D8），紅了就修 |
| **範圍失控**：寫著寫著開始補 Slice 0、1 的情境                                              | 這次只做六條。其他情境列進 spec §8，各 slice 收尾時再補                                                             |

---

## 7. 驗證點

- 每步：`pnpm --filter @ledger/web lint` / `typecheck` 綠。
- Step 1 之後：`pnpm --filter @ledger/web test:e2e` 能跑完冒煙測試。
- Step 2 之後：`pnpm --filter @ledger/api test:e2e` 仍然全綠（證明改 `resetDb` 沒弄壞既有測試）。
- Step 4 之後：`test:e2e` 連跑三次結果一致（SC-E3）。
- Step 5：拿掉 `optimizeDeps.include`，`test:e2e` 必須紅（SC-E6）。
- 全部完成：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm format:check` 全綠，且 `pnpm test` **沒有**跑到 Playwright（SC-E8）。

---

## 8. 對外介面影響

- **API**：無變更。
- **資料模型**：無變更，沒有 migration。
- **產品程式碼**：預期無變更。唯一可能的例外是 P2 的 `data-testid`，發生時先問。
- **開發者環境**：無新增的必填環境變數。要多一次 `playwright install chromium`（第一次跑時 Playwright 會提示）。
- **CI**：新增三個步驟、既有一個步驟改名。**動工前另行確認。**

---

## 9. 建議的 PR 切法

**一個 PR。** 六個 Step 都是同一件事的組成部分，拆開來的話前面幾個 PR 合進 `main` 時是「裝了 Playwright 但沒有任何測試」，沒有意義。

PR 標題：`test(web): add playwright end-to-end tests for the ledger flows`
