# 首頁版面 revision 改由後端保護（不回繞）

狀態：開發者 2026-10-29 核可。advisor 兩輪後雙方一致。

依據：`docs/specs/phase-2l-home-layout.md` 決策 260～262、修訂後的決策 329、333、§3.1、§4、§8、SC-Y11。前一版是 `tasks/archive/home-layout-stale-revision-plan.md` 的方案 (b)；這次做的是當時的方案 (c)，但 API 仍用 JSON number。

## 目標

- `UserHomeLayout.revision` 寫入永遠只加 1，不回繞。舊分頁帶的舊 revision 永遠對不上，後端就能擋住所有 client，不只網頁。
- PUT 回傳這次寫入的快照，不是寫完後另外 GET 的結果。
- API 形狀不變：revision 仍是 JSON number，`packages/shared` 型別不變，網頁不改。

## 範圍

| 檔案                                                              | 改動                                                                   |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `apps/api/prisma/schema.prisma`                                   | `revision Int` → `BigInt`，註解補決策 260                              |
| `apps/api/prisma/migrations/<時間>_home_layout_revision_bigint`   | `ALTER COLUMN "revision" SET DATA TYPE BIGINT`，不動資料               |
| `apps/api/src/users/dto/put-home-layout.dto.ts`                   | 上限改 `Number.MAX_SAFE_INTEGER - 1`；OpenAPI maximum 9007199254740990 |
| `apps/api/src/users/dto/home-layout-response.dto.ts`              | OpenAPI maximum 9007199254740991                                       |
| `apps/api/src/users/home-layout.service.ts`                       | 拿掉回繞；建立與更新都取回寫入後的列；`BigInt` 轉 number 前檢查範圍    |
| `apps/api/src/users/home-layout.service.spec.ts`                  | 單元測試                                                               |
| `apps/api/test/home-layout.e2e-spec.ts`、`-isolation.e2e-spec.ts` | SC-Y11 新條目與隔離                                                    |
| `docs/specs/phase-2l-home-layout.md`、`docs/handoff.md`           | 協調者已改（spec 修訂、編號 260～262）                                 |

不改：網頁（#202 的儲存前 GET 保留）、`packages/shared`、錯誤碼、CI、相依套件。

## 做法

1. 更新用 Prisma `update`，`where` 放主鍵加上 `revision: BigInt(expectedRevision)`，`data.revision: { increment: 1 }`，`select` 取回 schemaVersion、revision、layout。沒有符合的列時 Prisma 丟 `P2025`，轉成既有的 409。這是一條 SQL 的條件更新，不先讀再寫。
2. 建立維持用主鍵 `create`，撞 `P2002` 回 409；同樣用 `select` 取回寫入的列。
3. `get` 與 `put` 共用一個轉換函式：`BigInt` → number。值大於 `Number.MAX_SAFE_INTEGER` 或小於 0 時丟一般的內部錯誤（全站 filter 回 500，不帶細節）。不用 `toJSON` 之類的全域 patch。
4. 測試大數值時直接用 Prisma 把列設成指定的 revision（測試資料庫），不跑幾十億次 PUT。

## 風險與對策

| 風險                                          | 對策                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------- |
| `BigInt` 直接進 JSON，每次 GET 都 500         | 轉換函式集中在 service；e2e 檢查 `typeof body.revision === 'number'` |
| 部署時舊 API 讀到 `BigInt`                    | 先停 API，再跑 migration，再起新 API（spec §8）                      |
| `P2025` 也可能來自別的原因                    | 只有這一個 update 會丟；catch 只轉 `P2025`，其他照丟                 |
| 9007199254740991 以上的輸入在 JSON 解析後失真 | DTO 上限是 9007199254740990；失真後的值仍大於上限，照樣 400          |
| 回復到 `INTEGER` 時有超過上限的值             | §8：先查最大值；超過就只能往前修                                     |

## 任務

| #   | 任務                                | 驗收                                                                                                                | 誰      |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------- |
| B1  | schema 與 migration                 | migration 只有一條 `ALTER COLUMN`；對 `.env.test` 的資料庫 `migrate deploy` 成功；`prisma generate` 後 typecheck 過 | backend |
| B2  | DTO 上限與 OpenAPI                  | 單元或 e2e：9007199254740990 通過、9007199254740991 回 400                                                          | backend |
| B3  | service：不回繞、快照、轉換         | 單元測試涵蓋 2147483647 → 2147483648、快照、`P2025` → 409、超出範圍丟錯                                             | backend |
| B4  | e2e：SC-Y11 新條目、SC-Y10 隔離仍過 | `home-layout*.e2e-spec.ts` 全過                                                                                     | backend |
| B5  | 協調者驗收                          | 逐行看 schema、migration、service、DTO 的 diff；自己重跑 API e2e（`ledger_layoutbig_test`）                         | 協調者  |
| B6  | PR、CI、合併、dev 部署              | CI 全綠；dev 先停 API 再 migration；GET 回 number                                                                   | 協調者  |

## 實作紀錄

- Migration：`apps/api/prisma/migrations/20261029080000_home_layout_revision_bigint/migration.sql`。已逐字檢查，全文只有以下一條 SQL，沒有更新既有資料：

  ```sql
  ALTER TABLE "UserHomeLayout" ALTER COLUMN "revision" SET DATA TYPE BIGINT;
  ```

- 已明確檢查 `.env.test` 的資料庫名稱為 `ledger_layoutbig_test`；API e2e 的 global setup 載入該檔並執行 `prisma migrate deploy`，29 個 migrations（含本次）套用成功。`prisma generate` 成功，產生的 revision 型別為 `bigint`。
- P2025 實測：在真實 PostgreSQL 上以主鍵加 `revision: 2n` 呼叫 `update`，分別測試「尚未建立列」與「已建立但 revision 為 1」，兩者都收到 `code: 'P2025'`，整張表內容不變；相同條件透過 HTTP PUT 均回 409 `HOME_LAYOUT_REVISION_CONFLICT`。並發建立與條件更新各恰有一個 200、一個 409，成功回應與該請求送出的版面一致。
- GET、create、update 共用安全轉換；單元測試驗證 `9007199254740991n` 精確轉成 number，負數與 `9007199254740992n` 丟一般 Error。PUT 直接回傳寫入快照，不再額外 GET。
- 驗證：首頁版面單元測試 1 suite／25 tests 通過；首頁版面 e2e 2 suites／32 tests 通過。根目錄 `pnpm lint`、`pnpm typecheck` 均為 3 packages 通過，`pnpm test` 為 shared 160 tests、API 60 suites／967 tests、Web 137 files／1153 tests 全過（共 2280 tests），`pnpm format:check` 通過。`pnpm --filter @ledger/api test:e2e` 完整 API e2e 為 59 suites／624 tests 全過，耗時 357.015 秒；未執行 Web e2e。
- 偏離：無。測試快照使用區域性的 BigInt 序列化以比較資料不變，沒有修改全域 `BigInt.prototype.toJSON`；原始 SQL 查詢的 revision 斷言同步改為 bigint。初次單元測試因 shared 尚無 dist 而失敗，執行既有的 `pnpm --filter @ledger/shared build` 後通過，未改 shared 原始碼。
- 修正驗證發現的問題：新增 e2e 斷言直接存取 Supertest 的 any body，首輪 lint 報 11 個 `no-unsafe-member-access`；已改用明確的 response 型別，重跑 lint 與 typecheck 通過。
- 文件待協調者同步：spec §4.2 第 1 點仍寫 `updateMany`，與核可 plan 的 `update` 不一致；已透過 Orca 回報，該 spec 不在本 worker 的修改範圍。
