# dev 部署

## 替開發者部署

Use for dev deployment from main only. R5 tracks production backups and deployment location.

The developer runs dev in the main workspace (`D:\Projects\ledger-app`, confirmed 2026-10-21). API runs `node dist/main` without watch.

- Frontend only: Vite updates automatically. Ask the developer to press `Ctrl + Shift + R`.
- Backend or `packages/shared` changes:
  1. Run `git pull` in the main workspace on `main` (attached HEAD).
  2. Run `pnpm --filter @ledger/shared build`. Vite refreshes prebundling without deleting `.vite`.
  3. For schema changes, back up `ledger_dev` with `pg_dump` first. In `apps/api` run `prisma generate` manually (`pnpm install --frozen-lockfile` may skip it), then `prisma migrate deploy`.
  4. In `apps/api` run `pnpm build`. Ask the developer to restart API and Vite.
- Before creating synthetic test data isolate the DB per [測試環境](test-environment.md). If the developer’s port 3000 is idle, temporarily use `PORT=3200 node dist/main` and stop it afterward. Log in once per account to respect the rate limit.
- For Chinese queries on an approved DB, write SQL to a UTF-8 file and run `psql` with `PGCLIENTENCODING=UTF8` and `-f` to avoid shell encoding errors.
