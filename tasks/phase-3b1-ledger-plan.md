# 實作計畫：3b-1 往來帳版（後端＋畫面）

> 依據：`docs/specs/phase-3b-debts.md`（往來帳版，決策 33～45、SC-L1～L16）、`docs/specs/phase-3b1-web.md`（往來帳版，W10～W16、SC-W20～W30）。
> 開發者 2026-09-24 同意假設清單：「先這樣，看到成果後再調整」。
> **一個分支、一個 PR**（`feature/debt-ledger`）：後端移除 `/debts` 與舊型別後，現有畫面會編譯失敗，所以後端與畫面一起合併。

---

## 1. 元件與相依

```
A 後端（協調者自己做：schema、API、授權）
  A1 shared 契約 → A2 schema + migration → A3 隔離測試先行 → A4 對象與往來紀錄 → A5 交易端點與帳本刪除 → A6 e2e
B 畫面（派給 Codex，A 提交後開始）
  B1 hooks＋錯誤訊息（協調者，定介面）
  B2 借還分頁表單（worker）      B3 借還檢視＋對象往來帳（worker）      可平行
  B4 明細的對象名字＋右側欄保留旗標（worker，等 B2、B3）
  B5 e2e 與驗收（協調者）
```

## 2. 實作重點

### 2.1 `delta` 與種類

`delta = sign(kind) × amount`：`LEND`、`REPAY` 為正；`BORROW`、`COLLECT`、`PAID_FOR_ME` 為負。`SETTLEMENT`、`FORGIVE` 由系統計算。CHECK 約束在資料庫再擋一次。

### 2.2 往來餘額與 `balanceAfter`

- 往來餘額：`SUM(delta) WHERE counterpartyId = ? AND deletedAt IS NULL`。對象清單用一次 `groupBy` 算全部對象，不逐一查詢。
- `balanceAfter`：依 `(date, createdAt)` 由舊到新累加；分頁時先算出這一頁之前（更新的那一側以外）的累計。實作：取出該對象全部未刪除紀錄（數量小）在 service 裡累加，再切頁。量大時再改 window function。

### 2.3 寫入的交易邊界

`POST /debt-entries` 整個包在一個 `$transaction`：找或建對象 → 帳本權限 → 建交易 → 建往來紀錄 → （結清）算餘額、補 `SETTLEMENT`。任何一步失敗，全部回滾，連新建的對象也不留（SC-L11）。對象名字撞上並行建立（`P2002`）時，改讀既有那一個。

### 2.4 代付支出

`TransactionsService` 新增 `createPaidForMeExpense`：檢查分類屬於該帳本且是 `EXPENSE`，寫一筆 `accountId = null` 的 `EXPENSE`。一般交易端點的帳戶規則不變，這是唯一的例外入口。

### 2.5 交易的唯讀判斷與回應

- `findActive` 之後查 `DebtEntry where transactionId = id`；有就回 `409 DEBT_TRANSACTION_READ_ONLY`。取代「看型別」。
- 交易列表的 include 改成 `debtEntry: { select: { id, counterparty: { select: { id, name, ownerId } } } }`，只對 `ownerId === viewer` 回 `debt`。
- 帳本真刪的檢查改成 `DebtEntry` join `Transaction` 計數（含已軟刪除）。

### 2.6 migration 手寫 SQL（套用前在 PR 描述列出）

```sql
-- 決策 45：逐筆債務版產生的交易一併刪除（只有 dev 測試資料）
DELETE FROM "DebtPayment";
DELETE FROM "Debt";
DELETE FROM "Transaction" WHERE "type" IN ('LEND','BORROW','COLLECT','REPAY');
-- （Prisma 產生的 DROP TABLE Debt / DebtPayment、DROP TYPE DebtDirection、CREATE TABLE Counterparty / DebtEntry）
ALTER TABLE "Counterparty" ADD CONSTRAINT "Counterparty_name_trimmed"
  CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 1 AND 100);
ALTER TABLE "DebtEntry" ADD CONSTRAINT "DebtEntry_delta_sign" CHECK (
  "delta" <> 0
  AND ("kind" NOT IN ('LEND','REPAY') OR "delta" > 0)
  AND ("kind" NOT IN ('BORROW','COLLECT','PAID_FOR_ME','FORGIVE') OR "delta" < 0)
);
ALTER TABLE "DebtEntry" ADD CONSTRAINT "DebtEntry_transaction_by_kind" CHECK (
  ("kind" NOT IN ('SETTLEMENT','FORGIVE') OR "transactionId" IS NULL)
  AND ("kind" <> 'PAID_FOR_ME' OR "transactionId" IS NOT NULL)
);
```

### 2.7 右側欄保留旗標（W15）

`TransactionsPage` 切換檢視時 `setSearchParams(..., { state: { keepRightPanel: true } })`。`RightPanelProvider` 在 `location.state?.keepRightPanel` 為真、且右側欄在上一個 location 是開著的時候，把「打開時的 key」移到新 key。用 effect 做，不在 render 期間 setState（檔頭記錄過 transition 的坑）。

## 3. 風險與對策

| #   | 風險                                         | 對策                                                                       |
| --- | -------------------------------------------- | -------------------------------------------------------------------------- |
| R1  | 移除舊端點後畫面編譯失敗，分支中途 CI 紅     | 單一 PR；只在全部完成後合併                                                |
| R2  | 右側欄保留旗標影響 2i 的「換頁就收起」       | 只有帶旗標的導覽才保留；SC-44 的兩條 e2e 必須維持綠燈                      |
| R3  | Codex worker 讀 `AGENTS.md` 不讀 `CLAUDE.md` | Task spec 開頭要求先讀 `CLAUDE.md` 與 `apps/web/CLAUDE.md`                 |
| R4  | 開發者的 dev DB 有舊資料與舊 migration       | 合併後提醒跑 `prisma migrate deploy`；migration 會刪掉舊借還資料（已同意） |

## 4. 驗證點

- 後端：SC-L1～L16 的單元與 e2e；既有交易、帳戶 e2e 維持綠燈。
- 畫面：SC-W20～W30。
- PR 合併前完整 CI。

## 5. 實作紀錄

（實作時填寫偏離與計畫外的問題。）
