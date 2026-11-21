# 測試環境

Read before DB tests, Prisma DB commands or scheduling concurrent acceptance.

- Run `pnpm test` for unit tests. If local Web concurrency causes timeouts, use `pnpm --filter @ledger/web exec vitest run --maxWorkers=2`.
- API: `pnpm --filter @ledger/api test:e2e`. Web: first run `pnpm --filter @ledger/web exec playwright install chromium`, then `pnpm --filter @ledger/web test:e2e`. Web starts API on 3100 and Web on 5273. Both suites use `apps/api/.env.test` and apply test migrations.
- Both default to `ledger_test` and clear data. Serialize suites sharing a DB. API suites with separate DBs may run concurrently. Web uses fixed ports: one suite per host.
- `.worktreeinclude` copies environment files. The copied `apps/api/.env` may target the developer’s `ledger_dev`. Before dispatch the coordinator points **both** env files in each Prisma worktree to its own `ledger_<名稱>_test`. Before `migrate` or `db` the worker verifies the actual connection targets the test DB specified by `.env.test`. Web may clear only DBs ending in `_test`.
- Use synthetic data. Keep test accounts/passwords in local `docs/handoff/.env.test-accounts`. Never commit them. For e2e credentials follow [API 憑證規則](../../apps/api/CLAUDE.md#測試).

| 工作區       | 測試資料庫           |
| ------------ | -------------------- |
| main         | `ledger_test`        |
| ai-4a        | `ledger_ai_test`     |
| review-specs | `ledger_review_test` |

In 3c and 3e, misdirected env files applied migrations to dev before merge. Verify the actual target at dispatch and acceptance.
