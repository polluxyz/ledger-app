# CLAUDE.md

Reply to the developer in Traditional Chinese. Read the applicable app guide and spec for each task.

## 1. 專案目標

Ship deployable personal and family accounting on one ledger model. Web and mobile share a backend API. Keep business logic on the backend. AI drafts transactions. After user confirmation, use the existing write path.

## 2. 技術選型（已定案，勿擅自更換）

Use strict TypeScript, NestJS, PostgreSQL, Prisma, class-validator (DTOs), Zod (environment), OpenAPI, React + Vite, React Native + Expo (mobile pending), and pnpm workspaces. Before replacing any choice, read [專案決策脈絡](專案決策脈絡.md), explain why and obtain approval.

## 3. 架構與專案結構

- Before editing an app, read its [API](apps/api/CLAUDE.md) or [Web](apps/web/CLAUDE.md) guide.
- Put shared types and utilities in `packages/shared`. After changes run `pnpm --filter @ledger/shared build` before checking consumers.
- Shared uses Node’s test runner. In files under test, use only `import type` to avoid unresolved extensionless value imports.
- Preserve UTF-8 when editing Traditional Chinese.
- Before committing run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm format:check`. In parallel work format only your files.

## 4. 開發階段

See [開發階段](docs/README.md#開發階段). Implement only approved current scope and explicitly requested extension points.

## 5. 開發工作流程

1. For new features or major changes, get developer confirmation of assumptions first. Then write a spec in `docs/specs/` with goals, structural impact, boundaries, test strategy and verifiable success criteria.
2. After spec approval, write the plan and task list in `tasks/`. Cover dependencies, order, risks, alternatives, rationale and per-item acceptance. Submit both for review together.
3. After plan approval, execute through completion. Resolve in-scope issues and log them in the plan. Get approval before deviating. For design changes update the spec first and commit it with the code. Archive the completed plan and task list in `tasks/archive/`.
4. For a self-contained fix, state acceptance criteria first. Before a developer decision, consult two independent advisors concurrently per [§1.1](docs/orca-multi-agent.md#11-徵詢-advisor).

### 專案 skills

Use [pr](.agents/skills/pr/SKILL.md) to create or update PRs. Only the user starts [implement-spec](.agents/skills/implement-spec/SKILL.md) and [retro](.agents/skills/retro/SKILL.md). Their canonical files and pr live in `.agents/skills/`. Claude Code discovers them via `.claude/skills/`.

### 決策門控

§14 applies even to planned work. For Git and CI follow §10.

### 報告方式

At phase end report completed scope, acceptance evidence and counts, deviations and open issues. For cross-workspace milestones see [§1](docs/orca-multi-agent.md#1-分工).

## 6. 資料模型原則

- Isolate data by ledger. Every transaction belongs to a ledger. Scope every query to ledgers accessible to the user.
- Personal and family ledgers share one model. `Ledger.kind` (`PERSONAL` / `SHARED`) is immutable. A shared ledger can have one member. Never infer kind from member count.
- Users and ledgers are many-to-many via memberships with roles (owner/editor/viewer).
- Use integer minor units or Prisma `Decimal` for money. Never use floating point.
- Accounts belong to users. Compute balances live from transactions, never store balances.
- Each transaction needs an account (3h). When another member pays, use their temporary account. Exceptions: a debt where money bypasses my account (`docs/specs/phase-3h-every-entry-has-account.md` decisions 159–162), or a shared ledger whose account owner has left (3k decision 192).
- Keep `createdAt` / `updatedAt` on important tables. Soft-delete transactions with `deletedAt` for audit and future sync.

## 7. 程式碼與 API 規範

- Use strict TypeScript. Avoid `any`. Narrow `unknown` when needed. Use meaningful names.
- Write comments in Traditional Chinese. Introduce each file/class. Explain why for complex authorization, transactions, guards and DTO trust boundaries. One line suffices for obvious logic. Above each test `describe` state the suite’s purpose and strategy.
- Services own business logic. Controllers handle requests, responses and validation. Validate all external input with DTOs before trusting it.
- Change schema only via Prisma migrations. Never edit the database manually.
- Use a NestJS exception filter and standard HTTP exceptions. Give clear user errors without stacks, SQL or secrets.
- Use REST with NestJS-generated OpenAPI. Use plural resources (`/ledgers`, `/transactions`), nesting for ownership (`GET /ledgers/{ledgerId}/transactions`) and action routes where appropriate (`POST /ai/parse-transaction`).
- Status: 200/201/204 success, 400 invalid input, 401 unauthenticated, 403 forbidden, 404 missing, 409 conflict.
- Design list endpoints for pagination, filtering and sorting from the start (`?page=&limit=&from=&to=&categoryId=`).
- Add `@ApiTags` to every controller and annotate DTO types fully. OpenAPI is the client/server contract.

## 8. 安全性（不可妥協）

- Check the current user’s ledger permission at every ledger/transaction endpoint. Deny by default. Filter queries by ledger access to prevent unauthorized reads and writes.
- Hash passwords with bcrypt/argon2. Never store or log plaintext.
- Keep DB connections, JWT secrets and LLM API keys in environment variables. Never hardcode or commit secrets. Update `.env.example` for new variables.
- Rate-limit external APIs, especially auth and AI. Redact passwords, tokens and API keys from logs.

See `docs/specs/security-baseline.md` across phases.

## 9. 測試

Test new features. Unit-test transactions, authorization and ledger isolation. See app guides for test locations. Before database or end-to-end tests read [測試環境](docs/operations/test-environment.md).

## 10. Git / GitHub 流程

### 分支與 commit

Branch from `main`. Never push directly to `main`. Use `feature/`, `fix/`, `refactor/`, `docs/`, `test/` or `chore/`. Keep each commit focused.

### Pull Request

One PR per task. Use Conventional Commits for commits and English PR titles. Follow [pr](.agents/skills/pr/SKILL.md). Link the spec section and report results for the tested commit. Self-review before submission.

### 自動化（不必逐次徵求同意）

Within authorized scope, commit, push, open the PR, monitor CI, fix and repush automatically. If behind `main`, use `gh pr update-branch` and wait for fresh CI. Never bypass protection with `--admin`. Squash merge after all checks pass. Update `main` from the main workspace.

### CI

`.github/workflows/` checks format, lint, types, unit tests, builds and both end-to-end suites.

## 11. Orca 工作環境

- Give independent implementations separate worktrees and branches. Reuse suitable ones. Read-only consultations may share an existing worktree. Run `pnpm install` in each new worktree. Never share `node_modules`. Add untracked files that need copying to `.worktreeinclude`. Builds and tests must run without Orca. Maintain `CLAUDE.md` here. Do not add `AGENTS.md`.
- Follow [測試環境](docs/operations/test-environment.md) for shared e2e resources. Deploy dev from the main workspace per [部署手冊](docs/operations/dev-deployment.md).

### 多代理

- Main allocates scope. Each workspace delegates and verifies within its approval. Report completed milestones to main only if they could affect other branches.
- For dispatch, planning roles, handoff or cleanup read [多代理指南](docs/orca-multi-agent.md). Use `orca skills get <名稱>` for current operating instructions.
- On takeover read the [handoff index](docs/handoff.md) and your workspace handoff. Dispatched workers follow their Task’s sections and spec.

## 12. 程式碼檢索（codebase-memory-mcp）

The user-level SessionStart hook supplies tool instructions. Before first use, check `index_status` against HEAD for `D-Projects-ledger-app`. Rebuild stale indexes first. Verify conclusions against files. See [程式碼檢索](docs/README.md#程式碼檢索codebase-memory-mcp).

## 13. 人可讀產出（HTML artifact）

Markdown is authoritative for specs, plans and decisions. Write HTML only in `docs/artifacts/`. Never commit artifacts, include secrets or proactively scan that directory. Before generating read [HTML 產出](docs/README.md#html-產出docsartifacts).

## 14. 界線總表

### Ask first（先說明、取得同意才做）

Explain and obtain developer approval **before**:

- Changing schema/data models or API interfaces. For API changes also flag Web/mobile impact.
- Adding dependencies or changing CI settings/GitHub workflows.
- Deviating from an approved spec or approach.
- Replacing the chosen stack. Propose the rationale first.
- Destructive/irreversible Git operations: `force push`, `reset --hard`, rebasing existing history, deleting a remote branch other than this PR’s source, changing branch protection or repo settings.

Commit, push, PR creation and merge follow §10 automatically.

### Never（絕不做）

- Never push directly to `main`. Obtain approval before §14’s destructive Git actions.
- Never commit `.env`, keys or secrets, use floating-point money, put business logic in clients, or write AI results to a ledger before user confirmation.
- Never change the database manually outside migrations or leak internals in errors or logs.
- Never track HTML artifacts or use them in place of spec/plan/todo Markdown. Never include `.env` contents, DB connection strings, `JWT_SECRET`, real email or tokens in artifacts.
