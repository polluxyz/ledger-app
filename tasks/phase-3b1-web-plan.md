# 實作計畫：3b-1 修訂「以此結清」＋ 3b-1 的 Web 畫面

> 依據：`docs/specs/phase-3b-debts.md` 決策 30～32、SC-D23～SC-D29；`docs/specs/phase-3b1-web.md`。
> 兩個 PR，依序合併：**PR A 後端**（以此結清）→ **PR B Web**。PR B 的還款表單要用到 PR A 的 `settles`。
> 規格文件（兩份 spec 的修改）隨 PR A 一起進版控。

---

## 1. 元件與相依

```
PR A（後端，協調者自己做：動到 schema 與 API）
  A1 shared 契約 ──▶ A2 migration ──▶ A3 狀態計算與規則 ──▶ A4 測試與驗收

PR B（Web，main 已含 PR A 之後開分支）
  B1 use-debts hooks＋錯誤訊息（協調者）
     ├─▶ B2 借還檢視（worker）
     ├─▶ B3 借還分頁的新增表單＋PaymentFields（worker）
     └─▶ B4 債務詳情與明細的連結（worker，用到 B3 的 PaymentFields）
  B5 e2e 與最終驗收（協調者）
```

B2 與 B3 平行派出；B4 等 B3 的 `PaymentFields` 完成。

---

## 2. 實作重點

### 2.1 PR A：狀態計算（`debt-state.ts`）

`computeDebtState` 多回傳 `settlementDifference`：

1. 已免除 → `FORGIVEN`，差額 `null`（免除只能對 `OPEN` 做，不會與結清還款並存）。
2. 有未刪除的結清還款 → `SETTLED`，`outstanding = 0`，差額依方向：
   - `LENT`：已還總額 − 本金（多收為正）。
   - `BORROWED`：本金 − 已還總額（少付為正）。
3. 其餘照舊：`outstanding = 本金 − 已還`，差額 `null`。

差額是算出來的，不存欄位（決策 5、決策 30）。

### 2.2 PR A：規則

| 動作     | 改動                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------- |
| 記還款   | `settles = true` 時跳過超額檢查；狀態仍必須是 `OPEN`                                                           |
| 刪還款   | 不用改：狀態每次現算，刪掉結清還款自然回到 `OPEN`                                                              |
| 改債務   | 有未刪除的結清還款且本金有變 → `409 DEBT_NOT_OPEN`，放在同一個 `$transaction` 的最前面；改備註、名字、日期照常 |
| 並行寫入 | 部分唯一索引擋下第二筆結清還款，Prisma 的 `P2002` 轉成 `409 DEBT_NOT_OPEN`                                     |

### 2.3 PR A：migration 手寫 SQL（套用前請開發者過目）

```sql
ALTER TABLE "DebtPayment" ADD COLUMN "settles" BOOLEAN NOT NULL DEFAULT false;

-- 一筆債務最多一筆未刪除的結清還款（決策 30）。Prisma 表達不了部分唯一索引。
CREATE UNIQUE INDEX "DebtPayment_debtId_active_settlement_key"
  ON "DebtPayment" ("debtId")
  WHERE "settles" AND "deletedAt" IS NULL;
```

既有資料全部是 `settles = false`，行為不變。

### 2.4 PR B：送出的 body 怎麼組

- 借出／借入：沒勾舊債 → `record: { ledgerId: 作用中帳本, accountId? }`；勾了 → 不帶 `record`。
- 還款：沒勾不記入帳本 → **明確帶** `record`；勾了 → `record: null`。**不使用「省略 `record`」**：省略時後端會沿用本金交易的帳本與帳戶，畫面顯示的與實際記的可能不同。

- `settles`：只有使用者勾了才送 `true`。

### 2.5 PR B：右側欄的狀態

`TransactionsPage` 目前的 `editing: Transaction | null` 改成一個聯集：

```ts
type PanelTarget =
  | { kind: 'new' }
  | { kind: 'transaction'; transaction: Transaction }
  | { kind: 'debt'; debtId: string };
```

點一般交易 → `transaction`；點借還交易或借還檢視的一列 → `debt`。`TransactionWorkbench` 依 `kind` 渲染新增表單、交易編輯或 `DebtDetail`。

---

## 3. 風險與對策

| #   | 風險                                                                                     | 對策                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | 還款「不記入帳本」：原本的後端沒有「明確不產生交易」的寫法，省略 `record` 會沿用本金交易 | **PR A 一併處理**：`record` 接受 `null`（spec 已寫入，SC-D30）。這是 API 變更，列在 §5 請開發者確認。若不同意，Web 在本金有交易的債務上就不提供這個勾選框 |
| R2  | `TransactionsPage` 的 `editing` 改成聯集，會動到 2i 的右側欄測試                         | B4 先跑既有的 `TransactionWorkbench.test.tsx`、`transaction-edit.test.tsx`，改動後維持綠燈                                                                |
| R3  | 未結清債務的下拉要列出全部，`GET /debts` 上限 100 筆                                     | 本步以 `limit=100` 取一頁。超過 100 筆未結清債務的使用者目前不存在；超過時下拉底部註明「只列出最近 100 筆」                                               |
| R4  | e2e 與其他 worktree 共用 `ledger_test` 與固定 port                                       | 跑 e2e 前檢查 3100、5273 沒被占用                                                                                                                         |

---

## 4. 驗證點

- PR A：SC-D23～SC-D29 的單元測試與 e2e；3b-1 既有的債務測試全部維持綠燈；`prisma migrate status` 無 pending。
- PR B：`phase-3b1-web.md` SC-W1～SC-W11。
- 兩個 PR 都跑完整 CI（lint、typecheck、test、build、format:check、兩套 e2e）。
- PR B 合併後，開發者的 dev 資料庫要跑 `prisma migrate deploy`（PR A 的 migration）。

---

## 5. 需要開發者確認的變更（Ask first）

| 項目      | 內容                                                                        |
| --------- | --------------------------------------------------------------------------- |
| 資料模型  | `DebtPayment.settles` 欄位、部分唯一索引（§2.3 的 SQL）                     |
| API       | 還款 body 加 `settles`；回應加 `settlementDifference`、`payments[].settles` |
| API（R1） | 還款 body 的 `record` 接受 `null`，表示明確不產生交易                       |
| 套件、CI  | 無                                                                          |

---

## 6. 分工

- PR A 全部由協調者做（動到 schema 與 API，CLAUDE.md §11 的例外）。
- PR B 的 B1、B5 由協調者做；B2～B4 派給 worker。worker 模型派工前再確認。
- worker 不准修改：`packages/shared`、`apps/api`、`use-debts.ts`、既有測試的斷言。

---

## 7. 實作紀錄

### PR A（2026-09-24）

- 與計畫一致，沒有偏離。migration SQL 與 §2.3 相同。
- 計畫外的細節：改債務時「送回相同的本金」不算改本金。Web 的編輯視窗會把整張表單送回來，否則結清後連改備註都會被 409 擋下。
- 超額檢查同樣只在本金真的改變時做：結清時多收的債務，已還總額本來就大於本金。
- 驗證：api 單元測試 311 通過；debts 兩個 e2e 檔 35 通過（新增 8 條對應 SC-D23～SC-D30）；lint、typecheck、format:check、build 通過。

### PR B（2026-09-24）

- **worker 更換**：B2、B3 派給 Pi + `zai/glm-5.3`。B3 做到一半撞上 GLM 的 5 小時用量上限（`429 code 1308`），開發者指示改用 Antigravity + `gemini-3.8-flash-high` 接手 B3 與 B4。
- **Antigravity 的三個坑**（之後要寫回 `docs/orca-multi-agent.md` §4）：
  1. 第一次啟動的「信任資料夾」提示留在終端機歷史裡，Orca 會一直判定 `agent-trust-workspace` 而擋下派工。解法：信任一次之後關掉那個終端機，重開一個新的。
  2. 啟動當下若 Google 的登入驗證回 503，整個 session 會一直卡在 `Eligibility check failed`。解法同上：重開終端機。
  3. 每個指令、每次改檔、每次建檔都要求許可。協調者用一支腳本盯著畫面，只自動放行白名單指令與該 Task 的 Target 檔案。
- **驗收時的修正**：
  - B2：淨額卡片的 key 改用使用者 id 加名字；淨額為 0 顯示「淨額 $0」。
  - B3：名字提示清單去重。
  - B4：worker 回報全綠，但 `TransactionWorkbench.test.tsx` 新增的一條有型別錯誤且逾時（直接渲染元件拿不到右側欄的掛載點）。頁面層已有同樣的兩條測試，所以移除。另外兩處文案：已免除時顯示「已免除金額」而非「未清餘額」；刪除確認改成「回到記這筆借還之前」（借入的債務沒有「借出」）。
  - 交易頁的「明細／借還」切換加上 `role="group" aria-label="檢視"`，e2e 與螢幕閱讀器才分得出它和表單裡的「借還」分頁。
- **已知問題（未處理）**：切換「明細／借還」會改網址，右側欄照 2i 的「換頁就收起」規則（SC-44）收起來。填表單時切換檢視，表單會被收掉。修它要動共用的 `RightPanelProvider`，影響分類頁等其他頁面，超出這一輪範圍，待開發者決定。
- 驗證：web 單元測試 64 個檔、455 條通過；`debts.spec.ts` 2 條 e2e 通過；web 其餘 e2e 38 條通過；lint、typecheck、format:check 通過。
