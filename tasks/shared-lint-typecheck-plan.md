# Shared lint 與測試型別檢查提案

狀態：開發者已核可做法 A 與 7 個 devDependency（2026-10-28）。

## 核可後的實作補正

- `tsconfig.json` 設 `noEmit: true` 與 `allowImportingTsExtensions: true`，納入測試；`tsconfig.build.json` 覆寫為 `noEmit: false`、`allowImportingTsExtensions: false`、`types: []`，並排除 `src/**/*.test.ts`。保留原有 `rootDir`、`outDir`、`declaration` 與 module 設定；不改測試的 `.ts` 匯入，也不改 package `type`。
- ESLint 的 Node globals 只套用到測試檔。`@typescript-eslint/no-floating-promises` 保持啟用，只在測試檔允許 `node:test` 的 `describe`、`it`、`test` 呼叫；不關閉規則，也不以 `void` 消除診斷。
- 移除 `packages/shared/src/home-layout.test.ts:226` 不必要的 `as Json` 型別斷言。
- 驗收額外記錄 lockfile diff（只新增 shared importer，既有解析版本不變）、與新增 7 個套件相關的 `pnpm audit` advisories，以及清除 dist 後重建並比對產物檔名清單。

## 問題與原因

- 根目錄 `package.json:10-13` 的 `lint` 與 `typecheck` 都使用 `pnpm -r`。`packages/shared/package.json:12-14` 目前沒有 `lint` script，所以遞迴 lint 不會檢查 shared。
- `packages/shared/tsconfig.json:11-12` 將 `src/**/*.test.ts` 排除在 TypeScript 專案外，雖然 `packages/shared/package.json:13` 已有 typecheck script，測試檔仍不會進入檢查。
- `packages/shared/package.json:12` 的 build 直接使用預設 tsconfig；若只移除測試排除規則，`tsc` 會把測試檔也輸出到 `dist`。
- ESLint flat config 目前位於 `apps/api/eslint.config.mjs:11-26` 與 `apps/web/eslint.config.mjs:12-27`，兩者都用 `eslint.configs.recommended`、`typescript-eslint` 的 `recommendedTypeChecked`、Prettier 整合與 `projectService`。Web 另加 React 專用規則，shared 不需要。
- API 與 Web 的 ESLint 工具版本有差異；例如 `apps/web/package.json:29-49` 已用 ESLint 9.39.4、typescript-eslint 8.63.0，API 使用較舊範圍（`apps/api/package.json:44-70`）。提案沿用 Web 已有的較新版本，不新增 monorepo 未見過的套件版本。
- CI 的 `Build shared package` 仍會先建置 shared，接著在 `.github/workflows/ci.yml:63,66` 執行根目錄 `pnpm lint` 與 `pnpm typecheck`。不需修改 workflow；新增 package scripts 與擴大 shared tsconfig 後，CI 的既有步驟自然會涵蓋 shared lint 與測試型別。
- 實作前基線：`fnm exec --using=24.22.1 pnpm --filter @ledger/shared test` 通過 **160 tests、32 suites**，0 失敗。

## 做法比較

| 做法      | 設計                                                                                                                                                              | 優點                                                                                                                | 代價                                                                                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| A（推薦） | 讓 `tsconfig.json` 包含 `src` 下的實作與測試；新增 `tsconfig.build.json`，只在建置設定中排除 `*.test.ts`。`typecheck` 使用一般設定，`build` 明確指定 build 設定。 | 一次 typecheck 即涵蓋實作與測試；ESLint `projectService` 可從同一個 tsconfig 取得完整型別；建置排除測試的界線明確。 | 需新增一個 tsconfig，並調整 build script。                                                                                                       |
| B         | 保留目前 `tsconfig.json` 作為只含實作的設定，新增 `tsconfig.test.json`；typecheck 依序檢查兩個專案，build 維持現況。                                              | build 設定幾乎不動；實作與測試的型別專案分開。                                                                      | typecheck script 需維護兩個命令；type-aware ESLint 也要同時載入兩個專案設定，或增加測試檔例外設定，較容易讓 lint 與 typecheck 的檔案範圍不一致。 |

### 推薦方案

採用做法 A：`packages/shared/tsconfig.json` 保持 `include: ["src"]`，移除測試檔的排除；新增 `packages/shared/tsconfig.build.json` 並排除 `src/**/*.test.ts`。`build` 改為 `tsc -p tsconfig.build.json`，`typecheck` 使用 `tsc --noEmit -p tsconfig.json`。這樣測試進入 typecheck 與 type-aware lint 的同一個專案，而產物只由 build 專案產生。

Shared lint 使用新的 `packages/shared/eslint.config.mjs`，規則採 ESLint recommended、`typescript-eslint` `recommendedTypeChecked`、`eslint-plugin-prettier/recommended`，設定 `projectService: true`，並只對測試檔套用 Node globals 與 `node:test` 非同步呼叫例外；另沿用 app 設定的 `prettier/prettier` `endOfLine: 'auto'`。不載入 React plugins。`lint` script 檢查 `src/**/*.ts`，同時涵蓋實作與測試；若發現 lint 問題，只修正 `packages/shared/src` 範圍內的程式碼。

測試使用 Node 內建 `node:test`，檔案已匯入 `node:test` 與 `node:assert/strict`。為讓 shared 自己的 tsconfig 能解析這些型別，需將既有 monorepo 版本的 `@types/node` 直接列為 shared devDependency。

## 影響檔案

- `packages/shared/package.json`：新增 `lint` script、切換 build 設定，並在核可後新增 ESLint 與 Node 型別 devDependencies。
- `packages/shared/tsconfig.json`：納入測試檔型別檢查。
- `packages/shared/tsconfig.build.json`：新增，只供 build 使用並排除測試檔。
- `packages/shared/eslint.config.mjs`：新增 shared 的 flat config。
- `packages/shared/src/**`：僅在 lint 發現問題時修正。
- `pnpm-lock.yaml`：核可依賴後更新。
- `tasks/shared-lint-typecheck-plan.md`：本提案。

不修改 apps、Prisma schema、API 介面或 `.github/workflows`。

## 可驗收條件

- [x] `pnpm --filter @ledger/shared lint` exit 0。
- [x] 根目錄 `pnpm lint` 的執行輸出包含 `packages/shared lint` 並 exit 0。
- [x] 在 shared 測試檔暫時加入可辨識的型別錯誤，`pnpm --filter @ledger/shared typecheck` 因該測試檔而失敗；還原後同一命令 exit 0。
- [x] `pnpm --filter @ledger/shared build` exit 0，`packages/shared/dist` 不含測試檔輸出。
- [x] 清除 `packages/shared/dist` 後重新 build，檔名清單與實作前的 **52 個檔案**完全一致。
- [x] `pnpm --filter @ledger/shared test` 維持基線 **160 tests、32 suites** 全數通過。
- [x] `git diff pnpm-lock.yaml` 只新增 shared importer 條目，既有套件版本沒有變動；已記錄 7 個新增套件相關的 audit advisories。
- [x] 根目錄 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm format:check`、`pnpm build` 全部 exit 0。
- [x] 未修改 `.github/workflows`、apps、Prisma schema 或 API 介面。

## 測試策略

1. Node 版本固定使用 `fnm exec --using=24.22.1`。
2. 先執行 shared build，再檢查 `dist` 沒有 `.test.js` 或 `.test.d.ts`。
3. 跑 shared lint 與根目錄 lint；typecheck 以暫時加入並還原測試檔型別錯誤，實際證明測試有進入型別檢查。
4. 比對 shared test 前後的通過數（基線 160）及 suites 數（基線 32）。
5. 最後執行根目錄 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm format:check`；不跑 e2e。

## 需要開發者核可

新增以下 `packages/shared` devDependencies 才能讓該 package 的 lint 設定與測試型別自給自足。版本均沿用 monorepo 已使用的版本，並以 Web 目前版本為準；這些項目是 shared 的新直接依賴，核可後才修改 manifest 與 lockfile。

| 套件                     | 版本       | 用途                                                    | 可否沿用 monorepo 版本                               |
| ------------------------ | ---------- | ------------------------------------------------------- | ---------------------------------------------------- |
| `@eslint/js`             | `^9.39.4`  | ESLint 核心推薦規則                                     | 可以；Web 已用 `^9.39.4`。                           |
| `eslint`                 | `^9.39.4`  | 執行 shared lint                                        | 可以；Web 已用 `^9.39.4`。                           |
| `eslint-config-prettier` | `^10.1.8`  | 關閉與 Prettier 衝突的格式規則                          | 可以；Web 已用 `^10.1.8`。                           |
| `eslint-plugin-prettier` | `^5.5.6`   | 讓 lint 執行 Prettier 規則                              | 可以；Web 已用 `^5.5.6`。                            |
| `globals`                | `^17.7.0`  | 提供 Node globals 給測試與 lint 設定                    | 可以；Web 已用 `^17.7.0`。                           |
| `typescript-eslint`      | `^8.63.0`  | TypeScript ESLint parser 與 type-aware 規則             | 可以；Web 已用 `^8.63.0`。                           |
| `@types/node`            | `^24.13.3` | 解析測試使用的 `node:test` 與 `node:assert/strict` 型別 | 可以；Web 已用 `^24.13.3`，API 亦使用 Node 24 型別。 |

`typescript` 與 `prettier` 已由 shared 或根目錄提供，不新增版本。此方案不改 Prisma schema、API 介面或 CI 設定。

## 實作與驗收紀錄

- `pnpm --filter @ledger/shared lint` 與根目錄 `pnpm lint` 均 exit 0；根目錄輸出列出 `packages/shared lint`，確認遞迴 lint 已執行 shared。
- 在 `src/types/ai.test.ts` 暫時加入 `const typecheckSentinel: string = 1;`，`pnpm --filter @ledger/shared typecheck` 以 `TS2322: Type 'number' is not assignable to type 'string'` 失敗；移除 sentinel 後再跑同一命令 exit 0。
- 清空原有 `packages/shared/dist` 後執行 shared build，成功產生 **52 個檔案**，與修改前檔名清單完全一致，沒有 `.test.js` 或 `.test.d.ts`。根目錄 build 亦 exit 0。
- shared 測試前後皆為 **160 tests、32 suites、0 failures**。根目錄 test exit 0：API **956 tests**、Web **1,133 tests**、shared **160 tests**。
- 根目錄 `pnpm typecheck`、`pnpm format:check`、`pnpm build` 均 exit 0。`pnpm format:check` 在本紀錄更新後重新執行並通過。
- `git diff pnpm-lock.yaml` 僅在 `packages/shared` importer 增加核可的 7 個直接依賴條目；`packages` snapshot 區塊未變，沒有既有套件解析版本異動。
- `pnpm audit --json` 因 monorepo 整體 audit 結果 exit 1（全 workspace 共 96 筆：3 critical、43 high、41 moderate、9 low）。沿 shared 新增的 lint 依賴圖找到 7 筆傳遞相依 advisory：`brace-expansion@5.0.7` 有 5 筆（1130591 high、1130734 high、1240103 moderate、1240107 high、1240111 high）；`js-yaml@4.3.0` 有 2 筆（1138115 high、1193727 high）。
- 未修改 apps、`.github/workflows`、Prisma schema 或 API 介面。
