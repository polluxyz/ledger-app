# apps/api — 後端規範

補充根目錄 `CLAUDE.md`，只寫這一層的慣例。全局規則（安全性、界線、Git 流程）仍以根目錄那份為準。

## 結構

```
src/
  auth/ users/ ledgers/ accounts/ categories/ transactions/
  friends/ debts/ splits/ ledger-people/ settlements/ ledger-groups/
  ai/ statistics/  領域模組
  common/     跨模組共用（filter、guard、decorator、pipe）
  config/     環境變數載入與 Zod 驗證
  prisma/     PrismaService 與模組
  generated/  Prisma Client 產出（不要手改、不要提交）
test/         e2e（*.e2e-spec.ts）
```

每個領域模組依 NestJS 慣例命名：`*.module.ts`、`*.controller.ts`、`*.service.ts`、`*.dto.ts`。單元測試 `*.spec.ts` 與被測檔案同目錄。

## 慣例

- **Controller 只處理請求 / 回應與驗證，業務邏輯一律在 service。**
- **每個對外端點都要有 DTO**，用 class-validator 標註。沒有 DTO 的輸入不准進 service。
- **授權在 service 層把關，不是只在 guard。** 查詢一律先以「使用者有權存取的帳本」過濾，預設拒絕。新增任何讀寫帳本資料的方法時，同時補一個「別人的帳本讀不到」的測試。
- **金額用最小貨幣單位的整數或 `Decimal`**。`number` 運算只用整數，不能用浮點金額。
- 交易是軟刪除（`deletedAt`），查詢記得排除。
- **建立金錢紀錄的新端點要接 `IdempotencyService`**（R1）：controller 用 `@IdempotencyKeyHeader()` 取 header、`parseIdempotencyKey` 驗格式，service 把寫入放進 `idempotency.run` 給的 `tx`，重送時用資源目前所在的帳本重驗權限。e2e 請求帶 `.set(idempotencyKey())`。規則見 `docs/specs/r1-idempotency.md` 決策 361～370。
- 每個 controller 加 `@ApiTags`，DTO 標註型別，讓 Swagger 正確。

## Prisma

Schema 在 `prisma/schema.prisma`。變更前依根目錄 §14 取得同意。非互動環境以 `prisma migrate diff --from-schema <舊> --to-schema <新> --script` 產生 migration SQL，放進新的 migration 資料夾。用 `pnpm --filter @ledger/api exec prisma generate` 重新產生 Client。`pnpm install` 會透過 postinstall 產生 Client。執行資料庫指令前讀[測試環境](../../docs/operations/test-environment.md)。

## 測試

單元測試用 Jest：`pnpm --filter @ledger/api test`。端對端測試見[測試環境](../../docs/operations/test-environment.md)。

- **e2e 的憑證一律用真的登入取得**（`registerAndLogin`、`loginAgain`）。guard 會查登入紀錄，自己簽的憑證沒有紀錄，會被擋成 401。只有負面測試（驗證「這種憑證要被拒絕」）可以用 `signRawToken`。規則見 `docs/specs/r6-token-revocation.md` 決策 384。

## 環境變數

由 `src/config/` 以 Zod 驗證後載入，缺值直接啟動失敗。**新增變數時同步更新 `.env.example` 與 `.worktreeinclude` 相關說明**，實際值只放 `apps/api/.env`（不進版控）。
