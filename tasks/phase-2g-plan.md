# 實作計畫：階段二 (2g) — 收尾

> 狀態：**實作完成，待開發者驗收**（2026-09-23。plan 核可於 2026-09-23）
> 依據：`docs/specs/phase-2g-wrap-up.md`（spec 已核可 2026-09-23）。
> 對應成功條件：**SC-20**（CSP）、**SC-21**（錯誤訊息在地化）、**SC-22**（分類排序）、
> **SC-23**（文件與測試）、**SC-12**（既有）。
> 前置：Slice 4 已合併（PR #46）。
> **本步會動 Prisma schema 與 `playwright.config.ts`，兩者皆已取得同意（spec §7）。不新增任何 npm 套件。**

---

## 1. 為什麼是這一塊

階段二的畫面全部做完了，剩下四件在 spec 的技術債表裡累積的事。它們沒有一件是新功能，
但每一件都會在「別人拿去用」的時候變成問題：

- CSP 沒有 → token 存 `localStorage` 的那個取捨沒有任何補償措施。
- 錯誤訊息是英文 → 中文介面裡冒出英文句子。
- 分類順序不確定 → 使用者覺得常用的「餐飲」莫名其妙排在第六個。
- README 過時 → 下一個人（或未來的自己）照它做會卡住。

做完這一塊，階段二正式結束，接下來是階段三（好友 + 借還帳）。

---

## 2. 範圍

### 範圍內

- Web 建置產物注入 CSP（build 時，不影響 dev）。
- 前端 `errorCode → 中文` 對照表，`FormError` 統一出口。
- `Category` 加 `sortOrder`，種子依 `DEFAULT_CATEGORIES` 填值，排序改用它。
- README、`docs/README.md`、`security-baseline.md` 更新。
- 五個無狀態元件補測試。
- `playwright.config.ts` 加一個 `vite preview` 的 webServer，新增 `e2e/csp.spec.ts`。

### 範圍外（spec §8）

部署、SEC-2 token 撤銷、SEC-1 漏洞掃描、SEC-3 的 API 安全標頭、
`details` 欄位層級訊息的在地化、i18n 套件、使用者自訂分類排序。

---

## 3. 元件與相依

```
apps/api/
├── prisma/schema.prisma                改：Category 加 sortOrder Int @default(0)
├── prisma/migrations/<新>/             新：純加法 migration
├── src/ledgers/ledgers.service.ts      改（:77）種子依索引填 sortOrder
├── src/categories/categories.service.ts 改（:30）orderBy 改成 [sortOrder, name]
└── src/categories/categories.service.spec.ts 改：+排序測試

packages/shared/
└── src/types/category.ts               改：Category 加 sortOrder（API 回應形狀變了）

apps/web/
├── vite.config.ts                      改：加 apply:'build' 的 CSP 插件
├── src/lib/error-messages.ts           新：對照表 + toUserMessage
├── src/lib/error-messages.test.ts      新
├── src/components/FormError.tsx        改：改用 toUserMessage；更新註解
├── src/components/Button.test.tsx      新
├── src/components/TextField.test.tsx   新
├── src/components/Select.test.tsx      新
├── src/components/FormError.test.tsx   新
├── src/components/Pagination.test.tsx  新
├── src/features/**/use-*.ts            改：只改那句過時的註解
├── e2e/env.ts                          改：加 PREVIEW_PORT / PREVIEW_ORIGIN
├── e2e/csp.spec.ts                     新
└── playwright.config.ts                改：加 vite preview 的 webServer

README.md                               改：功能敘述
docs/README.md                          改：階段二狀態改「完成」
docs/specs/security-baseline.md         改：SEC-4 註明 meta 的限制
docs/specs/phase-2-web-mvp.md           改：勾掉「9. 收尾」、清掉技術債表對應列
```

**`ConfirmDialog` 不必改。** 它內部就是用 `FormError` 呈現錯誤（`ConfirmDialog.tsx:69`），
改 `FormError` 一處，兩個地方一起生效。spec §4.2 寫「`FormError` 與 `ConfirmDialog` 改用
`toUserMessage`」是寫多了，這裡更正。

⚠️ **`packages/shared` 的 `Category` 型別會多一個欄位，等於 API 回應形狀變了。**
它是純加法（既有欄位不動、不刪），前端不改也不會壞。但仍屬 API 介面變更，
實作時要在 PR 描述裡明說。

---

## 4. 設計決策

D1～D4 已於 spec §4 核可（CSP 走 build 時注入、對照表放 `lib/error-messages.ts`、
分類排序選方案 A、補五個元件測試）。以下是實作階段新增、**需要一併核可**的四項。

### D5 — `sortOrder` 放 `packages/shared` 的 `Category` 型別裡

後端要排序，前端就會拿到這個欄位。與其讓型別與實際回應不一致，不如照實寫進
`packages/shared/src/types/category.ts`。

**前端這次不使用它**——排序已經由後端做完，前端照著回傳順序渲染就好（SC-13：前端零業務邏輯）。
把欄位寫進型別只是讓契約誠實，不是要前端拿去排序。

### D6 — CSP 的 `connect-src` 從 `VITE_API_BASE_URL` 推導

API 與 Web 不同埠就是不同來源。插件在建置時讀 `VITE_API_BASE_URL`，取它的 origin
填進 `connect-src`；沒設時用預設的 `http://localhost:3000`。

**不要寫死。** e2e 的 preview 會用 3100，開發用 3000，未來正式環境是別的網域——
寫死等於只有一種環境能用。

### D7 — CSP 的 e2e 用獨立的 preview 埠 5274

既有 e2e 已占用 3100（API）與 5273（web dev）。preview 再開一個 5274，
三者互不相干。埠號統一寫在 `e2e/env.ts`，不散在設定檔裡（沿用既有做法）。

`csp.spec.ts` **不需要資料庫**，但它跟其他 e2e 在同一個 Playwright run 裡，
仍然受 `workers: 1` 的序列限制。

### D8 — 對照表只寫「使用者能據以行動」的句子

對照表的中文不是把英文翻一遍，而是回答「發生什麼事、接下來該怎麼辦」。例如：

| errorCode                        | 中文                                                               |
| -------------------------------- | ------------------------------------------------------------------ |
| `CATEGORY_NAME_TAKEN`            | 這個名稱已經有同型別的分類在用了，換一個名稱。                     |
| `CATEGORY_IN_USE`                | 這個分類已經有交易在用，不能刪除。可以改名，或先改那些交易的分類。 |
| `ACCOUNT_IN_USE`                 | 這個帳戶已經有交易在用，不能刪除。                                 |
| `USER_NOT_FOUND`                 | 找不到使用這個 email 的帳號。請對方先註冊，再加入。                |
| `LAST_OWNER_CANNOT_LEAVE`        | 你是這本帳本唯一的擁有者，先把其他成員升成擁有者才能退出。         |
| `LEDGER_HAS_OTHERS_TRANSACTIONS` | 這本帳本有其他成員記的交易，不能刪除。請改用封存。                 |

⚠️ **不可以寫得比後端更具體。** 例如不要寫「這個分類被 3 筆交易引用」——
後端沒給這個數字，前端寫了就是在猜，而猜錯比英文更糟。界線見 spec §7 Never。

---

## 5. 實作順序

| 順序 | 內容                                                | 為什麼排這裡                                 |
| ---- | --------------------------------------------------- | -------------------------------------------- |
| 1    | 後端：schema + migration + 種子 + orderBy + 測試    | 動資料模型，我自己做（CLAUDE.md §11 的例外） |
| 2    | `packages/shared` 的 `Category` 加 `sortOrder`      | 與 1 同一件事，一起改一起驗                  |
| 3    | 前端對照表 + `FormError` + 過時註解                 | 與 1、2 無相依，可平行                       |
| 4    | 五個元件測試                                        | 依賴 3 的 `FormError` 改動                   |
| 5    | CSP 插件 + `vite preview` webServer + `csp.spec.ts` | 與 3、4 無相依，可平行                       |
| 6    | 既有 e2e 的英文斷言改中文                           | 要等 3 完成                                  |
| 7    | 文件（README ×2、security-baseline、phase-2 spec）  | 最後做，內容依賴前面的實際結果               |

第 3 項與第 5 項無相依，**可以平行派給兩個 worker**。第 1、2 項我自己做。

---

## 6. 風險與對策

| 風險                                                             | 對策                                                                                                 |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **CSP 把 `pnpm dev` 弄壞**（Vite 的 HMR 靠 inline script）       | 插件標 `apply: 'build'`，`index.html` 保持乾淨。Step 5 完成後**手動開一次 dev server** 確認 HMR 正常 |
| `style-src` 不放 `'unsafe-inline'` 會不會爆                      | 建置產物目前沒有 inline style（已確認）。但要**開著 console 把每一頁點過一遍**才算數，不能只看首頁   |
| `connect-src` 漏掉 API 的來源 → 每個請求都被擋                   | 從 `VITE_API_BASE_URL` 推導（D6）。`csp.spec.ts` 的第一條就是「登入成功」，漏了這條會當場紅          |
| **既有 17 條 e2e 因為訊息改中文而變紅**                          | SC-21.4 允許改訊息字串，但**只能改字串，不能改選取器或斷言意圖**。先跑一次找出哪幾條，逐條改         |
| migration 對既有資料的影響                                       | 純加法、有預設值 `0`。既有分類的相對順序改由 `name` 決定，這是 spec §4.3 明文接受的結果              |
| `packages/shared` 改了但 dev server 沒重開，前端拿到舊的預先打包 | `apps/web/CLAUDE.md` 的已知陷阱。Step 2 完成後重新 `pnpm --filter @ledger/shared build` 並重開 dev   |
| worker 動到授權或資料模型                                        | Task spec 明寫：Step 1、2 由協調者做，worker 不得碰 `apps/api/` 與 `packages/shared/`                |

---

## 7. 驗證點

通用：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm format:check`、`pnpm build` 全綠。

**基準線（2026-09-23 實測）**：
web 單元測試 27 檔 / 156 條；e2e 17 條；**api 單元測試 8 套 / 111 條**。做完只能增加。

| SC      | 驗證點                                                     | 怎麼驗                              |
| ------- | ---------------------------------------------------------- | ----------------------------------- |
| SC-20.1 | `dist/index.html` 含 CSP 的 `meta`                         | `csp.spec.ts`                       |
| SC-20.2 | preview 下 console 無 CSP 違規，登入 / 記帳 / 切帳本都能用 | `csp.spec.ts` + 手動點過每一頁      |
| SC-20.3 | 注入 inline script 被擋                                    | `csp.spec.ts`                       |
| SC-20.4 | `pnpm dev` 不受影響，HMR 正常                              | **手動**，改完 vite.config 當場試   |
| SC-21.1 | 六種情境顯示中文                                           | `error-messages.test.ts` + 元件測試 |
| SC-21.2 | 查不到的代碼退回後端原文                                   | `error-messages.test.ts`            |
| SC-21.3 | 網路層失敗仍顯示「無法連線到伺服器…」                      | `FormError.test.tsx`                |
| SC-22.1 | 新建帳本的分類順序固定                                     | `categories.service.spec.ts`        |
| SC-22.2 | 順序等於 `DEFAULT_CATEGORIES`                              | 同上                                |
| SC-22.3 | 分類頁與記帳表單下拉同一種順序                             | 兩者都打同一個端點，靠 SC-22.1 保證 |
| SC-23   | README 涵蓋新頁面；五個元件有測試；階段二狀態改「完成」    | 人眼讀 + 測試檔存在                 |
| SC-12   | 五個指令 + 完整 e2e                                        | 輸出貼進驗收報告                    |

⚠️ 跑 e2e 前確認沒有別的 worktree 在跑（共用 `ledger_test`）。

---

## 8. 派工計畫

Step 1、2（Prisma schema、API 回應形狀）**依 CLAUDE.md §11 由協調者自己做**，不派工。

| 批次 | 任務                                            | 模型               |
| ---- | ----------------------------------------------- | ------------------ |
| 一   | E：對照表 + `FormError` + 過時註解 + 元件測試   | Pi + `zai/glm-5.3` |
| 一   | F：CSP 插件 + preview webServer + `csp.spec.ts` | Pi + `zai/glm-5.3` |
| 二   | 既有 e2e 的訊息字串、文件、驗收                 | 協調者自己做       |

E 與 F 無相依，一次全部派出去。Task spec 要求 worker 遇到 provider 錯誤時原文回報、
不要自己重試；額度用盡往下換層（Antigravity → Claude Code）。

---

## 9. Git

- 分支：`chore/phase-2g-wrap-up`（自 `main` 開）。
- 一個 PR。標題：`chore(web): add CSP, localize error messages, and stabilize category order`。
- PR 描述必須明說：**動了 Prisma schema（純加法 migration）與 `Category` 的 API 回應形狀**。
- CI 全綠後 squash merge。

---

## 10. 實作紀錄

### 計畫外的問題：CORS 擋住 preview（需要開發者裁決）

Worker F 實測發現一個 plan 完全沒預料到的衝突：

`csp.spec.ts` 要在 preview（5274）登入並讀資料，證明 `connect-src` 有放行 API 的來源。
但 API 啟動時 `CORS_ORIGIN` 只設了 dev server（5273），從 5274 發出的請求會在
**CORS 那一層**就被擋掉——CSP 放行了，瀏覽器仍然拒絕。測試必定紅。

查證後確認 F 的分析正確：`CORS_ORIGIN` 是單一字串（`env.validation.ts:17`），
直接丟給 `enableCors({ origin })`（`main.ts:25`），逗號清單會被當成一個字面值。

**開發者於 2026-09-23 裁決：讓 `CORS_ORIGIN` 支援逗號分隔的多來源。** 理由是多來源
本來就是真實需求（staging + 正式、Web + 未來的 App），不是為了測試才硬湊的。

另外三個被否決的選項各自的問題：

- 再起一個 API 實例（3101）：CI 多跑一個 Nest，設定變成四個伺服器共存。
- preview 用 proxy 轉發成同源：測試會綠，但**跨來源正是 `connect-src` 要防的那件事**，
  繞過去等於什麼都沒驗。
- 放棄這條測試：`connect-src` 漏掉 API 來源時沒有任何測試會抓到。

**CORS 是安全邊界，後端那一半依 §11 由協調者自己做**，worker 只改 playwright 那一側。
實作：`env.validation.ts` 用 zod 的 `transform` 拆成字串陣列（trim、濾掉空項、
一項都不剩就驗證失敗），`main.ts` 只改註解。每一筆仍是完全比對，逗號只是把清單
裝進一個環境變數，**沒有放寬任何一筆的比對規則**。新增 `env.validation.spec.ts` 5 條測試
釘住這件事。`.env.example` 同步說明。

### 其他偏離

1. **`sortOrder` 預設 0 會讓新增的分類插到最前面**（計畫外）。plan 只想到既有資料，
   沒想到「之後新增的」也會拿到 0，於是和「餐飲」並列第一、靠名稱插進預設分類中間。
   在已核可範圍內解掉：`create()` 先查同帳本同型別的最大 `sortOrder` 再 +1。
   不加鎖——兩人同時新增只會並列，次要鍵 `name` 決定先後，順序仍然確定。
2. **`CategoryRow` 與 `toCategory` 要一起改**（plan §3 沒列到）。後端的內部型別與
   mapper 都得帶 `sortOrder`，否則欄位到不了前端。
3. **`csp.spec.ts` 第三條一開始寫錯**：`addScriptTag` 被 CSP 擋下時會**拋錯**，
   不是安靜失敗，所以原本「斷言 `__cspProbe` 是 undefined」那行根本走不到。
   改成斷言它被 reject 且理由含 `Content Security Policy`，再補驗探針沒有留下痕跡。
4. **Worker F 的終端機中途被關閉**，最後一行 CORS 設定沒改到。那是一行改動，
   派工成本高於自己做，由協調者補完。F 其餘產出（CSP 插件、preview webServer、
   `csp.spec.ts`）都已完成且通過驗收。
5. **`TransactionForm.tsx` 也有一句過時的錯誤訊息註解**，worker E 回報但不在它的
   ownership 內，由協調者補改。

### 驗證結果（實測數字）

| 項目           | 基準線         | 完成後         |
| -------------- | -------------- | -------------- |
| api 單元測試   | 8 套 / 111 條  | 9 套 / 119 條  |
| web 單元測試   | 27 檔 / 156 條 | 33 檔 / 179 條 |
| Playwright e2e | 17 條          | 20 條          |

`pnpm lint`、`pnpm typecheck`、`pnpm format:check`、`pnpm build` 全綠。

**SC-20.4（dev 不受影響）實測**：`pnpm dev` 開得起來，頁面裡 CSP 的 meta 數量是 0，
console 零錯誤、零違規。

**todo 4.4（六頁掃過）實測**：preview 模式下走過首頁、帳本、帳本明細、帳戶、分類、
個人資料，**六頁零 CSP 違規**。`style-src 'self'` 不放寬的賭注成立，不需要 `'unsafe-inline'`。
唯一的 console 錯誤是刻意觸發的 409（刪除使用中的分類）。

**`connect-src` 的推導實測有效**：用 `VITE_API_BASE_URL=http://localhost:3201/api` 建置，
產物裡的 `connect-src` 就變成 `'self' http://localhost:3201`。

順帶確認了 SC-22：畫面上的分類順序現在是「餐飲、交通、購物、居住、娛樂、醫療、教育、其他」，
與 `DEFAULT_CATEGORIES` 的定義完全一致。
