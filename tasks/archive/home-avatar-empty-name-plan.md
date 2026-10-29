# 首頁借還卡空白姓名頭像修正提案

## 問題與原因

首頁借還卡由 `apps/web/src/features/home/card-registry.tsx:33` 登記為「借還」卡；實際列出對象與未指向對象的帳本成員時，`apps/web/src/features/debts/DebtsCard.tsx:47-55,75-83` 都將姓名傳給 `HomeBalanceSummaryArrow`。該元件在 `apps/web/src/features/home/HomeBalanceSummaryArrow.tsx:21-29` 直接用 `Array.from(label)[0]` 當頭像字元，並原樣顯示姓名；空字串會讓兩處都沒有內容，只有空白則會留下看不見的空白。摘要的無障礙名稱也在 `apps/web/src/features/home/HomeBalanceSummaryArrow.tsx:15-19,35-38` 直接組合原始姓名。

目前頭像樣式在 `apps/web/src/features/home/HomeBalanceSummaryArrow.module.css:18-28` 已有圓形、置中與文字樣式，可直接承載備用符號，不需要改版面或配色。

## 資料面調查

- 往來對象的 shared 型別在 `packages/shared/src/types/debt.ts:72-83` 將 `name` 定義為 `string | null`、`displayName` 定義為 `string`，沒有非空字串的型別限制。API 在 `apps/api/src/debts/debt-entry-rules.ts:161-175` 以 `row.name ?? link?.userName ?? ''` 組出 `displayName`，因此缺少名稱與連結資料時會明確回傳空字串。
- 一般往來對象新增與改名 DTO 會先 trim，並要求名稱長度至少 1：`apps/api/src/debts/dto/create-counterparty.dto.ts:6-12`、`apps/api/src/debts/dto/update-counterparty.dto.ts:6-13`。虛擬帳本成員新增與改名也會 trim 並拒絕空白：`apps/api/src/ledger-people/dto/create-guest.dto.ts:5-14`、`apps/api/src/ledger-people/dto/rename-guest.dto.ts:5-14`。
- 但帳號名稱可成為好友連動往來對象的顯示名稱，也可作為帳本成員名稱。註冊 DTO `apps/api/src/auth/dto/register.dto.ts:20-24` 僅以 `@MinLength(1)` 檢查，沒有 trim，因此純空白名稱可通過；shared 的 `Counterparty.displayName`、`Friend.name`、`LedgerPerson.name` 也沒有空白限制（`packages/shared/src/types/debt.ts:80-83`、`packages/shared/src/types/friend.ts:21-27`、`packages/shared/src/types/ledger-split.ts:19-26`）。所以空字串在 API 的防禦性回退分支確實可能出現，純空白則可由有效註冊名稱一路成為顯示名稱；前端需要處理兩者。

## 做法比較

| 做法                                                | 優點                                                                 | 缺點                                                                           |
| --------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 只在頭像增加 CSS `:empty` 或備用圖示                | 改動小                                                               | 姓名欄和摘要無障礙名稱仍空白；純空白也不是空節點。                             |
| 在 `HomeBalanceSummaryArrow` 統一處理空字串與純空白 | 一處涵蓋兩種來源，也同時能給姓名欄和摘要合理值；保留現有圓形頭像樣式 | 需要新增幾個邊界測試。                                                         |
| 從 API、資料模型或 shared 契約禁止空白名稱          | 可在資料來源建立更強約束                                             | 觸及 API／shared，超出本任務 ownership；也無法替既有或不完整資料提供畫面回退。 |

**推薦第二種。** 元件先以 `trim()` 判斷是否只有空白；非空名稱沿用目前的姓名與首碼呈現。空白名稱在圓形頭像顯示 `?`，姓名位置顯示 `—`，摘要的無障礙名稱用「未命名對象」描述；一般姓名不改字、不改樣式。既有 `Array.from` 依 Unicode code point 取首碼，測試會明確鎖定 emoji 與中文字首碼行為。

## 影響範圍與預計檔案

`HomeBalanceSummaryArrow` 搜尋結果只有 `DebtsCard.tsx` 引用，且該卡把對象及未指向的帳本成員都送入同一元件。因此影響僅在首頁借還卡的兩種列；其他頁面沒有共用此頭像元件，頁面與 API 行為不受影響。

- `apps/web/src/features/home/HomeBalanceSummaryArrow.tsx`：處理空白姓名的顯示、頭像與摘要文字。
- `apps/web/src/features/home/HomeBalanceSummaryArrow.test.tsx`：新增邊界測試並鎖住一般姓名的既有輸出。
- `apps/web/src/features/home/HomeBalanceSummaryArrow.module.css`：預計不修改，回退符號沿用既有樣式。
- 本提案檔：與實作一同提交。

不需改 `card-registry.tsx`、`DebtsCard.tsx` 或其 CSS；註冊表只負責卡片登記，資料流已共用目前的摘要元件。

## 實作步驟

1. 在摘要元件計算是否為空白名稱，將視覺名稱、頭像首碼與摘要無障礙名稱分開處理；保持非空一般姓名現有的首碼、全名、title 與金額方向。
2. 在摘要元件的單元測試覆蓋空字串、純空白、正常姓名、emoji 開頭與多位元組中文開頭。
3. 只對改動檔執行 Prettier，再跑指定的全 repo lint、typecheck、test、format:check。

## 驗收條件

- [x] `name=""` 時，頭像顯示 `?`、姓名欄顯示 `—`，摘要無障礙名稱包含「未命名對象」。
- [x] `name="   "`（含純空白）時呈現相同回退內容，不把空白當成首碼或姓名。
- [x] 一般姓名（例如「小明」）的頭像首字、姓名、title、摘要與目前一致；現有樣式不變。
- [x] emoji 開頭姓名（例如 `😀小明`）的頭像顯示完整 emoji code point，不顯示空白或拆開的代理字元。
- [x] 多位元組中文開頭姓名（例如「小明」）仍顯示第一個中文字。
- [x] `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm format:check` 在 Node 24.22.1 下全部 exit 0；不跑 e2e。

## 測試策略

以 `HomeBalanceSummaryArrow.test.tsx` 的 Vitest 單元測試直接渲染元件，驗證頭像文字、姓名欄、title 與 `aria-label`；既有金額方向測試繼續確認正常顯示不受影響。完成後在 repo 根目錄執行 `fnm exec --using=24.22.1 pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm format:check`（每項均以 `fnm exec --using=24.22.1` 執行）。不執行 Playwright 或 API e2e。

## 需要開發者核可

本方案不新增相依套件、不改 Prisma schema、不改 API 介面、不改 CI；協調者已核可本提案，並要求 API 名稱驗證另行記錄、不納入本任務。實作只改列出的 `apps/web` 元件與對應單元測試範圍。

## 實作紀錄

按核可方案完成，沒有偏離。只改 `HomeBalanceSummaryArrow.tsx` 與其單元測試，回退符號沿用既有 CSS。

- `lint`：exit 0。
- `typecheck`：exit 0。
- `test`：exit 0；shared 160/160、API 956/956（60 suites）、Web 1137/1137（137 files），共 2253 tests。
- `format:check`：exit 0。
- 未執行 e2e。
