# 3e 畫面實作計畫：共享帳本分帳與結清的 Web 畫面

spec：`docs/specs/phase-3e-web.md`（W93～W129、SC-W87～SC-W101）。一個 PR，含 spec §5 的後端小改動。

> 核可：2026-10-05 開發者核可。

## 1. 元件與相依

**協調者自己做（契約與後端小改動，commit 在 `feature/ledger-split-web`）**

- **資料 hook**（全部 worker 共用，先寫好才派工）：
  - `features/ledger-people/use-ledger-people.ts`：`useLedgerPeople(ledgerId)`、`useCreateLedgerPerson`、`useRenameLedgerPerson`、`useDeleteLedgerPerson`。只在 `SHARED` 帳本啟用查詢。
  - `features/settlements/use-settlements.ts`：`useSettlementSummary`、`useCreateSettlement`、`useUpdateSettlement`、`useDeleteSettlement`、`useSetTransactionAccount`、`useSetSettlementAccount`。成功後讓交易列表、summary、帳戶餘額的查詢失效。
  - 照 `use-members.ts` 的寫法，含 hook 測試。
- **介面契約**（型別與空殼，讓三個 worker 對得上）：
  - `PanelTarget` 加兩種：`{ kind: 'settlement'; settlement?: Transaction; prefill?: SettlementPrefill }`、`{ kind: 'fillAccount'; transaction: Transaction }`。
  - `TransactionList` 加選填 prop `onFillAccount?: (transaction: Transaction) => void`。
- **後端（spec §5）**：`transactions.service.ts` 兩處 `allowLeft` 改成 `true`；改寫 `ledger-splits.e2e-spec.ts` 裡 SC-E14 的斷言（新交易選已離開的人 → 成功）。自己跑 API e2e 與隔離測試。

**`default` worker 實作**（無 `backend` 工作：不動 schema、授權、金額規則）

1. **`lsw-form` 記帳表單**（W98～W109）：
   - 新檔 `features/transactions/ledger-split-form.ts`（名單暫存狀態，key 是 `LedgerPerson.id`）與 `LedgerSplitSection.tsx`（勾選框名單＋預覽箭頭）。
   - `SplitOptionsView` 改成以通用字串 key 表示人，3c 照舊傳對象。3c 的元件測試照跑全綠。
   - `PaymentRow` 在共享帳本改用帳本裡的人當付款人清單（可打新名字）。
   - `TransactionForm` 只加分支與接線，共享帳本的邏輯放進新檔，不讓這個 1,092 行的檔案再長大太多。
2. **`lsw-settle` 結清與右側欄**（W110～W121、W125 的補帳戶表單）：
   - 新檔 `features/settlements/SettlementView.tsx`（淨額＋建議）、`SettlementForm.tsx`、`FillAccountForm.tsx`。
   - `TransactionsPage`：第三格「結清」、`?view=settle`、工具列按鈕文字。
   - `TransactionWorkbench`：兩種新 `PanelTarget` 的渲染；點結清列打開 `settlement` 目標。
   - `HomePage`：接上 `onFillAccount`。
3. **`lsw-list` 列表、帳本頁、錯誤訊息**（W122～W129、W125 的「待補」標籤）：
   - `TransactionList`：帳本分帳列、付款人是別人的列、結清列、「待補」標籤按鈕（呼叫 `onFillAccount`）；結清列點了呼叫既有的 `onEdit`。
   - `features/ledger-people/GuestList.tsx`＋改名／新增彈窗，掛到 `LedgerDetailPage` 成員區下方。
   - `lib/error-messages.ts` 的 7 個錯誤碼。
4. **`lsw-e2e`**（第 2 波）：`apps/web/e2e/ledger-split.spec.ts`，SC-W100 主線。

## 2. 實作順序

1. spec PR（#106）合併 → 協調者開整合 worktree `ledger-split-web`（分支 `feature/ledger-split-web`），寫 hook、契約、後端小改動，跑測試。
2. 第 1 波：`lsw-form`、`lsw-settle`、`lsw-list` 平行，各自從整合分支開 worktree。
3. 逐個驗收、merge 回整合分支，解 `TransactionWorkbench` 與 `TransactionList` 的接線衝突。
4. 第 2 波：`lsw-e2e`。
5. 協調者全套驗證、開 PR、盯 CI、合併、替開發者部署。

## 3. 風險與對策

| 風險                                                 | 對策                                                                                                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 改 `SplitOptionsView` 的人選表示法，弄壞 3c 個人分帳 | 3c 的元件測試與 `phase-3c-split.spec.ts` 照跑；Task spec 寫明「3c 的測試不准改斷言」                                                         |
| `TransactionForm` 再長大，個人與共享兩條路徑互相干擾 | 共享帳本的狀態與畫面放新檔；個人帳本的測試（SC-W92）全綠才算過                                                                               |
| 三個 worker 同時碰右側欄與列表，merge 衝突           | 協調者先定 `PanelTarget` 與 `onFillAccount` 契約；檔案歸屬見 §5，`TransactionWorkbench` 只歸 `lsw-settle`、`TransactionList` 只歸 `lsw-list` |
| 前端偷算淨額或建議（違反 3e spec §10）               | 結清檢視只讀 summary；名單金額只用 shared 的 `computeSharesByKey` 當預覽。驗收時逐行看                                                       |
| 補帳戶表單顯示別人的帳戶                             | 帳戶下拉只來自 `useAccounts()`（自己的帳戶）；回應裡別人的 `account` 本來就是 `null`                                                         |
| worker 把 migration 或 e2e 打到 `ledger_dev`         | 派工前把每個 worker worktree 的 `apps/api/.env` 與 `.env.test` 改指向 `ledger_test_<名稱>`（先 `create database`）                           |
| Web 的 Playwright 撞 port                            | 只有 `lsw-e2e` 與協調者跑 Web e2e，而且不同時。開發者的 dev 伺服器用 3000／5173，e2e 用 3100／5273，不衝突                                   |

## 4. 驗證點

- worker：`pnpm --filter @ledger/web lint / typecheck / test`、`pnpm format:check`；`lsw-e2e` 另跑 `pnpm --filter @ledger/web test:e2e`。
- 協調者：逐行看 diff（特別是送出的 body、帳戶欄位只出現在自己那一邊、VIEWER 隱藏按鈕）；`pnpm lint / typecheck / test / build / format:check`；API e2e（含隔離測試）與 Web e2e 各跑一次。
- 合併後：`web-redesign` 跟到 `origin/main`、rebuild API（有後端改動，沒有 migration），請開發者重開 API 與 Vite。

## 5. 派工

全部 `default` 角色。每個 worker 一個 worktree，從 `feature/ledger-split-web` 開出；驗收後 merge 回整合分支，最後整條一個 PR。

| 波次 | worker       | 檔案歸屬                                                                                                                                                                  |
| ---- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `lsw-form`   | `TransactionForm.tsx`、`PaymentRow.tsx`、`SplitSection.tsx`、`SplitOptionsView.tsx`、`split-form.ts`、新檔 `ledger-split-form.ts`、`LedgerSplitSection.tsx`，與各自的測試 |
| 1    | `lsw-settle` | `features/settlements/` 新元件、`TransactionsPage.tsx`、`TransactionWorkbench.tsx`、`HomePage.tsx`，與各自的測試                                                          |
| 1    | `lsw-list`   | `TransactionList.tsx`、`transaction-label.ts`、`features/ledger-people/` 新元件、`LedgerDetailPage.tsx`、`lib/error-messages.ts`，與各自的測試                            |
| 2    | `lsw-e2e`    | `apps/web/e2e/ledger-split.spec.ts`，必要時 `e2e/api.ts`、`e2e/ui.ts` 加 helper                                                                                           |

- worker 不改 `packages/shared`、`apps/api`、協調者寫的 hook；要改先問。
- Web 的 Playwright 只有 `lsw-e2e` 跑。

## 6. 實作紀錄

2026-10-05，Orca Run `run_74bbb80ec969`，整合分支 `feature/ledger-split-web`（worktree `ledger-split-web`，資料庫 `ledger_test_lsw_int`）。

| 任務 | worker       | 結果                                                    |
| ---- | ------------ | ------------------------------------------------------- |
| F0   | 協調者       | 完成：hook、契約、後端兩處 `allowLeft`；API e2e 211/211 |
| F1   | `lsw-form`   | 進行中                                                  |
| F2   | `lsw-settle` | 一次通過，已併入；Web 測試 646/646                      |
| F3   | `lsw-list`   | 一次通過，已併入                                        |
| F4   | `lsw-e2e`    | 未派；Task spec 照 todo F4 與 spec SC-W100 寫           |

偏離與發現：

1. **W107 改寫**：`lsw-form` 發現後端在 `PATCH` 省略 `payerPersonId` 時保留舊付款人，所以編輯時一律帶付款人 id（含我自己）。不改 API，spec W107 已補正。
2. `lib/api-client.ts` 的 `method` 加上 `PUT`（補帳戶端點要用）。
3. 交易寫入後也讓 `settlement-summary` 快取失效（`use-transactions.ts`）。
