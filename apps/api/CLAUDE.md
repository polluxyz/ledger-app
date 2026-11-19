# apps/api — 後端規範

Apply root `CLAUDE.md` for global security, boundaries and Git rules.

## 結構

```text
src/
  auth/ users/ ledgers/ accounts/ categories/ transactions/
  friends/ debts/ splits/ ledger-people/ settlements/ ledger-groups/
  ai/ statistics/  domain modules
  common/     shared filters, guards, decorators, pipes
  config/     environment loading and Zod validation
  prisma/     PrismaService and module
  generated/  generated Prisma Client (never edit or commit)
test/         e2e (*.e2e-spec.ts)
```

Use `*.module.ts`, `*.controller.ts`, `*.service.ts` and `*.dto.ts` per NestJS conventions. Colocate `*.spec.ts` unit tests with the code.

## 慣例

- Controllers handle requests, responses and validation. Services own all business logic.
- Every public endpoint needs a class-validator DTO. Never pass input without a DTO into a service.
- Enforce authorization in services as well as guards. Filter queries by accessible ledgers first and deny by default. For every new ledger read/write method, test that another user’s ledger cannot be read.
- Use integer minor units or `Decimal` for money. Use only integer `number` arithmetic.
- Exclude soft-deleted transactions (`deletedAt`) from queries.
- New endpoints creating financial records must use `IdempotencyService` (R1). In the controller read the header with `@IdempotencyKeyHeader()` and validate via `parseIdempotencyKey`. Write using the `tx` supplied by `idempotency.run`. On replay recheck permission on the resource’s **current** ledger. Send `.set(idempotencyKey())` in e2e requests. See `docs/specs/r1-idempotency.md` decisions 361–370.
- Add `@ApiTags` to each controller and annotate DTO types for Swagger.

## Prisma

Before changing `prisma/schema.prisma` obtain approval per root §14. Noninteractively generate migration SQL with `prisma migrate diff --from-schema <舊> --to-schema <新> --script` and put it in a new migration directory. Regenerate Client with `pnpm --filter @ledger/api exec prisma generate`. `pnpm install` also generates Client via postinstall. Read [測試環境](../../docs/operations/test-environment.md) before database commands.

## 測試

Run Jest with `pnpm --filter @ledger/api test`. For e2e see [測試環境](../../docs/operations/test-environment.md). Obtain credentials by real login (`registerAndLogin`, `loginAgain`). The guard checks login records and returns 401 for a self-signed credential without a record. Use `signRawToken` only for negative tests of rejection. See `docs/specs/r6-token-revocation.md` decision 384.

## 環境變數

Load via Zod in `src/config/` and fail startup on missing values. For new variables update `.env.example` and relevant `.worktreeinclude` instructions. Keep actual values only in untracked `apps/api/.env`.
