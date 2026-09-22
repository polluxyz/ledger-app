# 實作計畫：階段二 (2d) — 帳本類型（私人 / 共享）

> 狀態：**已核可並實作**（2026-08-23）
> 依據：`docs/specs/phase-2d-ledger-kind.md`。
> 對應成功條件：SC-D1～SC-D9。
> 分支：`feature/ledger-kind`（自 `main` 開，已建立）。**本步不動前端。**

---

## 1. 為什麼是這一塊

2b Slice 2 的 Step 3（建立帳本）與 Step 6（成員管理）都要知道帳本是私人還是共享。
先做前端等於建一個馬上要改的表單——`CLAUDE.md` §4 記著 2c 當初被排到 Slice 2 之前，
理由一模一樣。

另一個理由是時機：`kind` 是資料模型變更，現在資料庫幾乎沒有資料，回填很單純。
等實際開始記帳之後再加，就要處理真實資料。

---

## 2. 元件與相依

```
packages/shared/src/
├── types/ledger.ts          修改：LedgerKind、Ledger.kind、CreateLedgerRequest.kind
└── constants/error-codes.ts 修改：兩個新錯誤碼

apps/api/prisma/
├── schema.prisma            修改：enum LedgerKind、Ledger.kind
└── migrations/<新>/         新增：DDL + 手寫的回填 SQL

apps/api/src/ledgers/
├── dto/create-ledger.dto.ts 修改：選填的 kind
├── dto/update-ledger.dto.ts 修改：明確接住 kind 並回 400
├── ledgers.service.ts       修改：create 具名參數、addMember 擋私人帳本
├── ledgers.controller.ts    修改：跟著 create 的簽章走
└── ledgers.service.spec.ts  修改：補上新規則的測試

apps/api/src/auth/auth.service.ts  修改：跟著 createLedgerForUser 的簽章走
apps/api/test/                     修改：e2e 補上 SC-D1～SC-D6
```

不新增任何套件。不新增環境變數。

---

## 3. 待確認的設計決策

規則面的決策已於 spec §2 逐條定案，這裡只補實作層面的三點。

### P1 — migration 用 `--create-only`，不當場套用

`prisma migrate dev` 會直接套用到本機資料庫，而且偵測到 drift 時可能提議重置——
那會清空開發者的本機資料。

**做法**：用 `prisma migrate dev --create-only` 只產生 migration 檔，手寫回填 SQL 之後
再由開發者親手套用。`prisma generate` 不需要套用就能更新型別，所以程式碼照樣寫得下去、
typecheck 照樣過。

這也對應 spec §9 的「回填 SQL 要在套用前給開發者看過」。

### P2 — `create` 改為具名參數

加上 `kind` 之後會有四個位置參數，其中兩個是布林與列舉：

```ts
// 之前
create(userId, name, tracksBalance);
// 之後
create(userId, { name, tracksBalance, kind });
```

呼叫端只有 controller 與 `auth.service.ts` 兩處。純重構，既有測試就是回歸網。

### P3 — 私人帳本的檢查放在 service 的哪裡

放進 `addMember` 的開頭，在查詢目標使用者**之前**。

順序有意義：先查使用者再檢查帳本類型的話，對私人帳本送一個不存在的 email 會拿到
`USER_NOT_FOUND`，那洩漏了「這個 email 沒註冊」，而呼叫者其實根本無權對這本帳本做
任何成員操作。先擋帳本類型就不會有這個縫。

---

## 4. 實作順序

| Step | 內容                                               | 驗證                                    |
| ---- | -------------------------------------------------- | --------------------------------------- |
| 1    | `@ledger/shared` 契約：型別與錯誤碼                | `pnpm --filter @ledger/shared build` 綠 |
| 2    | schema + migration（`--create-only` + 回填 SQL）   | `prisma generate` 綠；migration 檔可讀  |
| 3    | DTO 與 service：建立、PATCH 擋下、addMember 擋私人 | 單元測試綠                              |
| 4    | e2e 補完與最終驗收                                 | 全套指令綠；SC-D1～SC-D9 逐條核對       |

Step 4 的 e2e **需要先套用 migration**，屬開發者親手操作的部分。

---

## 5. 風險與對策

| 風險                           | 對策                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 回填漏掉，既有共享帳本變成私人 | 回填 SQL 與 DDL 放在同一份 migration，一起套用。手動驗證：套用前造一本兩人帳本，套用後確認變 `SHARED` |
| `migrate dev` 提議重置資料庫   | 用 `--create-only`，不當場套用（P1）                                                                  |
| 既有測試因新欄位變紅           | `kind` 有預設值，既有呼叫都仍合法。**若真的變紅就停下來看**，那代表相容性不如預期                     |
| 洩漏 email 是否已註冊          | 帳本類型的檢查排在查使用者之前（P3）                                                                  |
| 前端已合併的程式碼拿到新欄位   | `LedgerSummary` 繼承 `Ledger`，多一個欄位不會讓前端壞掉；前端在 Slice 2 Step 3 才用到                 |

---

## 6. 驗證點

- 每步：`pnpm --filter @ledger/api typecheck` / `test` 綠。
- 全部完成：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm format:check` 全綠。
- 套用 migration 後跑 e2e，並手動確認 SC-D7（回填結果）。

---

## 7. 對外介面影響

- **資料模型變更**：`Ledger` 新增 `kind`，純加法 migration。
- **API 變更**：`POST /ledgers` 多一個選填欄位；`PATCH /ledgers/{id}` 多擋一個欄位；
  `POST /ledgers/{id}/members` 對私人帳本回 409。回應多一個 `kind` 欄位。
- **前端**：本步不動，但 Slice 2 的 Step 3 與 Step 6 會用到（spec §7）。
- 不新增套件、不新增環境變數。

---

## 8. 建議的 PR 切法

單一 PR `feature/ledger-kind`，自 `main` 開。commit 依上述 4 步分次提交。

migration 的套用與 e2e 由開發者親手執行後再合併。
