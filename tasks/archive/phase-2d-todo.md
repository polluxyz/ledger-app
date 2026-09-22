# 任務清單：階段二 (2d) — 帳本類型（私人 / 共享）

> 狀態：**實作完成，待開發者驗收**（2026-08-23）
> 依據：`docs/specs/phase-2d-ledger-kind.md`、`tasks/phase-2d-plan.md`。
> 用法：依序執行；每個任務有驗收條件。勾選＝「開發者已驗收」。
> 標 👤 = 開發者親手操作（Claude 陪跑）。
> 通用驗收（每任務皆適用，不再重複）：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全綠。
> 分支：`feature/ledger-kind`（自 `main` 開）。**本步不動前端。**

### 設計決策（已於 spec §2 與 plan §3 定案）

| #   | 結論                                                                  |
| --- | --------------------------------------------------------------------- |
| 2-1 | `kind` 建立後不可變更；`PATCH` 帶著它回 400 `LEDGER_KIND_IMMUTABLE`   |
| 2-3 | 私人帳本加成員回 409 `PERSONAL_LEDGER_CANNOT_SHARE`，owner 本人也一樣 |
| 2-4 | 共享帳本可以只剩一個成員，不會自動變回私人                            |
| 2-7 | `kind` 省略時預設 `PERSONAL`                                          |
| P1  | migration 用 `--create-only`，不當場套用；回填 SQL 手寫               |
| P2  | `LedgersService.create` 改為具名參數物件                              |
| P3  | 私人帳本的檢查排在「查詢目標使用者」之前，避免洩漏 email 是否已註冊   |

---

## Step 1：shared 契約

- [x] **1.1 `types/ledger.ts` 加型別**
  - 內容：`LEDGER_KINDS` const tuple 與 `LedgerKind` 型別（比照 `LEDGER_ROLES` 的寫法，好讓值也能用於 `@IsIn`）；`Ledger` 加 `kind`；`CreateLedgerRequest` 加選填的 `kind`。`UpdateLedgerRequest` **不加**——它建立後不可變更。
  - 驗收：`pnpm --filter @ledger/shared build` 綠；註解說明「建立後不可變更」與「共享帳本可能只有一個成員」。
- [x] **1.2 `constants/error-codes.ts` 加兩個碼**
  - 內容：`LEDGER_KIND_IMMUTABLE`、`PERSONAL_LEDGER_CANNOT_SHARE`，各附一行說明。
  - 驗收：型別綠。

## Step 2：schema 與 migration

- [x] **2.1 `schema.prisma`**
  - 內容：`enum LedgerKind { PERSONAL SHARED }`；`Ledger` 加 `kind LedgerKind @default(PERSONAL)`，附三斜線註解說明不可變更的理由。
  - 驗收：`prisma format` 無變動；`prisma validate` 通過。
- [x] **2.2 產生 migration（不套用）**
  - 內容：`prisma migrate dev --create-only --name add_ledger_kind`。
  - 驗收：`apps/api/prisma/migrations/<timestamp>_add_ledger_kind/migration.sql` 產生，且**本機資料庫沒有被改動**。
- [x] **2.3 手寫回填 SQL**
  - 內容：在同一份 `migration.sql` 末尾加上把「成員超過 1 人」的帳本設為 `SHARED` 的 `UPDATE`（SQL 見 spec §4）。
  - 驗收：SQL 可讀、有註解說明為什麼要回填。**回填與 DDL 必須在同一份 migration**，分開會出現一段「共享帳本被當成私人」的空窗。
- [x] **2.4 更新 Prisma Client**
  - 內容：`prisma generate`。不需要套用 migration 就能更新型別。
  - 驗收：`apps/api` typecheck 認得 `LedgerKind`。
- [x] **2.5 👤 套用 migration 並手動驗證回填**
  - 內容：開發者親手執行 `prisma migrate deploy`（或 `migrate dev`）。**套用前先造一本兩人帳本**，套用後確認它是 `SHARED`、單人帳本是 `PERSONAL`。
  - 驗收：SC-D7。這一條沒有自動測試，migration 不進 Jest。

## Step 3：DTO 與 service

- [x] **3.1 `CreateLedgerDto` 加 `kind`**
  - 內容：選填、`@IsIn(LEDGER_KINDS)`、`@ApiPropertyOptional` 標明預設 `PERSONAL` 與「建立後不可變更」。
  - 驗收：省略時建出 `PERSONAL`；帶 `SHARED` 時建出 `SHARED`。
- [x] **3.2 `UpdateLedgerDto` 明確接住 `kind`**
  - 內容：比照既有的 `tracksBalance` 寫法——宣告欄位只為了回一句說得出原因的 400，並讓規則出現在 OpenAPI 文件上。
  - 驗收：`PATCH` 帶 `kind` 回 400 `LEDGER_KIND_IMMUTABLE`，且值真的沒被改到（SC-D2）。
- [x] **3.3 `create` / `createLedgerForUser` 改具名參數**
  - 偏離（2026-08-23）：驗收條件寫「既有測試一字未改」，但 `auth.service.spec.ts`
    有一條斷言比對的正是舊的位置參數（`expect.stringContaining('Alice')`），簽章一改
    它必然變紅。改成比對新的物件形狀，行為未變。這是重構的預期結果，不是相容性問題。
  - 內容：P2 的重構。呼叫端只有 `ledgers.controller.ts` 與 `auth.service.ts`。註冊建立的帳本明確傳 `PERSONAL`。
  - 驗收：既有測試一字未改仍全綠（純重構）；SC-D6。
- [x] **3.4 `rename` 擋下 `kind`**
  - 內容：`LedgersService.rename` 比照 `tracksBalance` 的處理，收到 `kind` 就丟 `AppException`。
  - 驗收：service 單元測試一條。
- [x] **3.5 `addMember` 擋私人帳本**
  - 內容：在方法開頭、**查詢目標使用者之前**檢查 `ledger.kind`（P3）。私人帳本丟 409 `PERSONAL_LEDGER_CANNOT_SHARE`。
  - 驗收：service 單元測試兩條——私人帳本被擋且成員沒被建立；共享帳本行為不變（SC-D3、SC-D4）。
  - 注意：**順序不可調換**。先查使用者的話，對私人帳本送一個沒註冊的 email 會拿到 `USER_NOT_FOUND`，那洩漏了該 email 未註冊，而呼叫者本就無權對這本帳本做任何成員操作。

## Step 4：測試補完與驗收

- [x] **4.1 service 單元測試補完**
  - 內容：建立時的預設值、`rename` 擋 `kind`、`addMember` 擋私人帳本、共享帳本退到剩一人仍是 `SHARED`。
  - 驗收：`pnpm --filter @ledger/api test` 綠。
- [x] **4.2 e2e 補完**
  - 內容：SC-D1～SC-D6 逐條走過。SC-D5 要特別寫——它是「不可用成員數推導」的具體證據。
  - 驗收：e2e 全綠（38 條，新增 6 條）。
  - 修正（2026-08-23）：原本寫「需要先完成 2.5」是錯的。e2e 連的是 `ledger_test`，
    `global-setup.ts` 會自己對它跑 `prisma migrate deploy`，與開發者的 `ledger_dev`
    無關。所以 e2e 現在就跑得起來，2.5 仍然要做，但不是 4.2 的前提。
  - **計畫外的變更（2026-08-23）**：6 條既有 e2e 因這一步變紅，全部是同一個原因——
    它們拿 `firstLedgerId()`（註冊自動建立的帳本，現在是 `PERSONAL`）去加成員。
    這不是相容性問題，是規則生效了。修法是在 `e2e-utils.ts` 加一個
    `createSharedLedger()` 輔助函式，把那 6 處改成先建一本共享帳本。
    `ledgers.e2e-spec.ts` 改 3 處、`transactions.e2e-spec.ts` 改 3 處。
- [x] **4.3 文件回寫**
  - 內容：`CLAUDE.md` §6 補上帳本類型（原文寫「差別在於成員數與角色」，現在不只如此）；spec 狀態改為已完成；本 todo 的偏離之處回寫。
  - 驗收：文件與程式碼一致。
- [ ] **4.4 PR**
  - 內容：草擬 `feature/ledger-kind` 的 PR 標題與描述（Markdown 區塊，依 `.github/pull_request_template.md`）。
  - 驗收：CI 全綠後由開發者 squash merge。
