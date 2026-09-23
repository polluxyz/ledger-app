# ledger-app

Personal & family expense tracking system with AI-powered entry (NestJS + React + React Native monorepo).

Supports two modes on one ledger model: **personal** (one member) and **family** (multiple members sharing a ledger, with role-based permissions). AI-assisted entry is planned for a later phase.

> **Status:** The backend core and the web app are both complete — authentication, ledgers and
> members, accounts with live balances, category management, transactions (including transfers,
> filtering and pagination), and a profile page. The mobile app and AI-assisted entry come in later
> phases.

## What the web app does

- **Sign up and sign in.** Registering also creates your personal ledger, seeded with a default set
  of categories.
- **Ledgers and members.** Create personal or shared ledgers, invite members by email, and assign
  roles (owner / editor / viewer). Ledgers can be archived, which makes them read-only.
- **Accounts with live balances.** Balances are derived from transactions, never stored. Accounts
  belong to you, not to a ledger, so a shared ledger never exposes whose account paid.
- **Transactions.** Record expenses, income and transfers; edit, delete (soft), filter by date,
  category or type, and page through the list.
- **Category management.** List, add, rename and delete a ledger's categories, split into expense
  and income groups. The page picks its own ledger, independently of the one you are recording
  into — it says so on screen when the two differ.
- **Profile.** View your email (fixed) and change your display name.

## Tech stack

| Layer      | Technology                            |
| ---------- | ------------------------------------- |
| Language   | TypeScript (strict)                   |
| Backend    | NestJS 11                             |
| ORM        | Prisma 7 (pg driver adapter)          |
| Database   | PostgreSQL 18                         |
| Validation | class-validator (DTOs) · Zod (env)    |
| API docs   | OpenAPI / Swagger (`@nestjs/swagger`) |
| Web        | React 19 + Vite + CSS Modules         |
| Web tests  | Vitest · Playwright (end-to-end)      |
| Monorepo   | pnpm workspaces                       |

## Repository layout

```
apps/
  api/         NestJS backend
  web/         React + Vite frontend
  mobile/      React Native + Expo app (later phase)
packages/
  shared/      Shared TypeScript types, constants (API contract)
docs/README.md Documentation index
docs/specs/    Feature specifications
tasks/         Plans & task lists for work in progress
```

## Prerequisites

- **Node.js 22+** (see `.node-version`)
- **pnpm** (`packageManager` in `package.json`)
- **PostgreSQL 18** running locally

## Local setup

1. **Install dependencies** (from the repo root):

   ```bash
   pnpm install
   ```

2. **Create the databases** (a dev database and a separate one for e2e tests):

   ```sql
   CREATE ROLE ledger WITH LOGIN PASSWORD 'your-password' CREATEDB;
   CREATE DATABASE ledger_dev  OWNER ledger;
   CREATE DATABASE ledger_test OWNER ledger;
   ```

3. **Configure environment** — copy `.env.example` and fill in values:
   - `apps/api/.env` → `DATABASE_URL` pointing at `ledger_dev`, plus `JWT_SECRET`.
   - `apps/api/.env.test` → same keys but `DATABASE_URL` pointing at `ledger_test` (only needed to run e2e locally).

4. **Apply migrations** to the dev database:

   ```bash
   pnpm --filter @ledger/api exec prisma migrate dev
   ```

5. **Run the API** in watch mode:

   ```bash
   pnpm --filter @ledger/api start:dev
   ```

   - API base path: `http://localhost:3000/api`
   - **Swagger UI / interactive docs:** `http://localhost:3000/docs`

## Working in a git worktree

Each task runs in its own [git worktree](https://git-scm.com/docs/git-worktree), so several
branches can be checked out at the same time in separate directories. A worktree only contains
files that are under version control, which means two things:

1. **Run `pnpm install` first.** `node_modules` does not carry over. The install also runs
   `prisma generate` through `postinstall`. Do not share `node_modules` between worktrees —
   branches can differ in their lockfile and Prisma schema.
2. **Environment files are copied by `.worktreeinclude`** (`apps/api/.env`, `apps/api/.env.test`).
   Add any new untracked-but-required file to that list.

⚠️ **Run the e2e suites in one worktree at a time.** They share the `ledger_test` database and
fixed ports, so parallel runs wipe each other's data.

## Common commands

Run from the repo root (recurse across packages):

```bash
pnpm lint          # ESLint
pnpm typecheck     # TypeScript type check
pnpm test          # Unit tests
pnpm build         # Build all packages
pnpm format        # Prettier (write)
pnpm format:check  # Prettier (check only, used by CI)
```

Target a single package with `pnpm --filter <name> <script>` (e.g. `pnpm --filter @ledger/api test`).

## Testing

- **Unit tests** (`*.spec.ts`, colocated with source):

  ```bash
  pnpm --filter @ledger/api test
  ```

- **API e2e tests** (`apps/api/test/*.e2e-spec.ts`) run the real application against the `ledger_test` database. They require `apps/api/.env.test` (see setup) and apply migrations automatically before running:

  ```bash
  pnpm --filter @ledger/api test:e2e
  ```

- **Web e2e tests** (`apps/web/e2e/*.spec.ts`) drive a real Chromium browser against a real API. Playwright starts both servers itself (API on port 3100, web on port 5273), so nothing needs to be running beforehand. They use the same `ledger_test` database and `apps/api/.env.test`:

  ```bash
  pnpm --filter @ledger/web exec playwright install chromium   # once, downloads the browser
  pnpm --filter @ledger/web test:e2e
  ```

> ⚠️ **Do not run the two e2e suites at the same time locally.** They share the `ledger_test` database and each wipes it before every test, so running them concurrently makes both fail in confusing ways. CI runs them as sequential steps, so it is unaffected.

CI runs formatting, lint, type check, unit tests, build, and both e2e suites (against a PostgreSQL service container) on every pull request. When the Playwright suite fails, its HTML report is uploaded as a build artifact.

## Documentation

- **Start here:** [`docs/README.md`](docs/README.md) — index of every spec, plan and report.
- Working conventions for contributors and AI assistance: [`CLAUDE.md`](CLAUDE.md), plus
  [`apps/api/CLAUDE.md`](apps/api/CLAUDE.md) and [`apps/web/CLAUDE.md`](apps/web/CLAUDE.md) for the
  backend and frontend layers.
- Why each technology was chosen: [`專案決策脈絡.md`](專案決策脈絡.md) (Traditional Chinese).
