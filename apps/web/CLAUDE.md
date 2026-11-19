# apps/web — 前端規範

Apply root `CLAUDE.md` for global security, boundaries and Git rules. All business logic, money calculations, authorization and consistency checks belong on the backend. Client required-field and format hints serve UX. The backend response determines validity.

## 結構

```text
src/
  app/         routing, providers, AppShell / Sidebar / TopBar, ProtectedRoute
  pages/       one page component per route
  features/    domains, e.g. accounts / ai / debts / statistics / transactions
  components/  shared stateless UI (Button, Dialog, TextField…)
  lib/         api-client, formatting, localStorage
  styles/      global.css defines design tokens
e2e/           Playwright tests
```

Keep `features/` platform independent for React Native. Give new domains a folder here, outside `pages/`.

## 慣例

- Use CSS Modules (`X.module.css`) and CSS variables from `global.css`. Use design tokens for every color.
- Colocate components, their `.module.css` and `.test.tsx`.
- Route backend calls through `lib/api-client.ts`. Never `fetch` directly in a component.
- Centralize token access in `lib/token-storage.ts`. **除了 token，任何機敏資訊都不進前端或 log。** Redact tokens in logs per root §8.
- Check login on every protected page with `app/ProtectedRoute.tsx`.

## 已知陷阱

- Keep `@ledger/shared` in `vite.config.ts`’s `optimizeDeps.include`. Shared emits CommonJS. Without prebundling linked workspace packages, the first value import (unlike `import type`) blanks the page.
- Rebuild after `packages/shared` changes. No need to delete `.vite`. Keep `sharedPrebundleRefreshPlugin` in `vite.config.ts`: it hashes shared `dist` into the cache key and watches `dist` to restart dev. Without it dev and Web e2e can use stale output (“xxx is not a function”).
- Closing the right sidebar keeps its contents mounted (#84). Set the panel target before opening from a new entry point. Gate list selection highlighting on `isOpen`.
- For debt transactions `note` is always `null`. Display and edit `Transaction.debt.note`.
- On a shared ledger, only the owner sees a grouped split. Other members see individual transactions with `split` set to `null` (spec 3c SC-S16).

## 指令

See [project README](../../README.md#common-commands). Run Vitest with `pnpm --filter @ledger/web test`. For e2e see [測試環境](../../docs/operations/test-environment.md).

## 新增相依

Explain new frontend dependencies before installation. Root §14 requires approval.
