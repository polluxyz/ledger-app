# apps/api — 後端規範

補充根目錄 `CLAUDE.md`，只寫這一層的慣例。全局規則（安全性、界線、Git 流程）仍以根目錄那份為準。

## 結構

```
src/
  auth/ users/ ledgers/ accounts/ categories/ transactions/   領域模組
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
- **金額用整數（最小貨幣單位）或 `Decimal`**，不可用 `number` 做運算。
- 交易是軟刪除（`deletedAt`），查詢記得排除。
- 每個 controller 加 `@ApiTags`，DTO 標註型別，讓 Swagger 正確。

## Prisma

Schema 在 `prisma/schema.prisma`。**schema 變更前要先說明並取得同意**（見根目錄 §14）。

```bash
pnpm --filter @ledger/api exec prisma migrate dev --name <描述>  # 建 migration 並套用
pnpm --filter @ledger/api exec prisma generate                   # 重新產生 Client
pnpm --filter @ledger/api exec prisma studio                     # 看資料
```

- **不可手動改資料庫**，一律走 migration。
- `pnpm install` 會透過 `postinstall` 自動跑 `prisma generate`。新 worktree 裡忘了裝相依，型別就會整批紅。

## 測試

```bash
pnpm --filter @ledger/api test       # 單元測試
pnpm --filter @ledger/api test:e2e   # e2e，需要 apps/api/.env.test
```

e2e 跑的是真的應用程式對真的 `ledger_test` 資料庫，每個測試前清空。**不要與 web 的 Playwright 同時跑**，兩者共用同一個資料庫。

## 環境變數

由 `src/config/` 以 Zod 驗證後載入，缺值直接啟動失敗。**新增變數時同步更新 `.env.example` 與 `.worktreeinclude` 相關說明**，實際值只放 `apps/api/.env`（不進版控）。
