# ledger-app

Personal & family expense tracking system with AI-powered entry (NestJS + React + React Native monorepo).

Supports two modes on one ledger model: **personal** (one member) and **family** (multiple members sharing a ledger, with role-based permissions). AI-assisted entry is planned for a later phase.

> **Status:** Phase 1 (backend core) — authentication, ledgers, members, categories, and transactions. Web and mobile apps come in later phases.

## Tech stack

| Layer      | Technology                            |
| ---------- | ------------------------------------- |
| Language   | TypeScript (strict)                   |
| Backend    | NestJS 11                             |
| ORM        | Prisma 7 (pg driver adapter)          |
| Database   | PostgreSQL 18                         |
| Validation | class-validator (DTOs) · Zod (env)    |
| API docs   | OpenAPI / Swagger (`@nestjs/swagger`) |
| Monorepo   | pnpm workspaces                       |

## Repository layout

```
apps/
  api/         NestJS backend (this phase)
  web/         React + Vite frontend (later phase)
  mobile/      React Native + Expo app (later phase)
packages/
  shared/      Shared TypeScript types, constants (API contract)
docs/specs/    Feature specifications
tasks/         Implementation plan & task list
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

- **e2e tests** (`apps/api/test/*.e2e-spec.ts`) run the real application against the `ledger_test` database. They require `apps/api/.env.test` (see setup) and apply migrations automatically before running:

  ```bash
  pnpm --filter @ledger/api test:e2e
  ```

CI runs lint, type check, unit tests, build, and e2e (against a PostgreSQL service container) on every pull request.

## Documentation

- Phase 1 specification: [`docs/specs/phase-1-core-ledger.md`](docs/specs/phase-1-core-ledger.md)
- Implementation plan & tasks: [`tasks/plan.md`](tasks/plan.md), [`tasks/todo.md`](tasks/todo.md)
- Working conventions for contributors and AI assistance: [`CLAUDE.md`](CLAUDE.md)
