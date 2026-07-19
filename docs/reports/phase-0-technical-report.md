# 階段零技術報告：專案初始化

|              |                                                                    |
| ------------ | ------------------------------------------------------------------ |
| **階段目標** | 建立 GitHub repo、monorepo 骨架、CI、分支保護與開發流程規範        |
| **期間**     | 2026-07-11 〜 2026-07-20                                           |
| **狀態**     | ✅ 完成（PR #1 已 squash merge 進 `main`）                         |
| **對應規範** | CLAUDE.md §4（開發階段）、§5（工作流程）、§11（Git / GitHub 流程） |

---

## 1. 目標與達成狀況

| 目標項目             | 結果                                                         |
| -------------------- | ------------------------------------------------------------ |
| 建立 GitHub repo     | ✅ `polluxyz/ledger-app`，後轉為 public                      |
| monorepo scaffolding | ✅ pnpm workspaces：`apps/api`（NestJS）＋ `packages/shared` |
| 基礎 CI workflow     | ✅ `.github/workflows/ci.yml`，PR 必跑五道檢查               |
| 分支保護             | ✅ Ruleset `protect-main`（Active，含 required check）       |
| 倉庫文件             | ✅ `.gitignore`、`.env.example`、README、CLAUDE.md           |
| 開發流程規範         | ✅ CLAUDE.md 增訂 spec-driven 工作流程與 Step 門控           |

依 CLAUDE.md §4 的學習目標，GitHub 端設定（建 repo、分支保護、轉 public、PR 操作）皆由開發者親手完成；Claude Code 負責產生設定檔內容與逐行講解。

## 2. 技術棧與版本

| 項目          | 選擇                   | 備註                                                                                        |
| ------------- | ---------------------- | ------------------------------------------------------------------------------------------- |
| Runtime       | Node 22                | 由 fnm 管理；版本鎖定於 `.node-version`                                                     |
| Package 管理  | pnpm 11.3.0            | winget 獨立安裝（不用 corepack——Node 25 起移除）；鎖定於 `package.json` 的 `packageManager` |
| 後端框架      | NestJS 11              | `apps/api`，`nest new` 產生後併入 workspace                                                 |
| 語言          | TypeScript 5.x         | `tsconfig.base.json` 統一 `strict: true` ＋ `noUncheckedIndexedAccess`                      |
| 格式化 / Lint | Prettier 3 ＋ ESLint 9 | Prettier 由 root 統一管理；ESLint 目前僅 api                                                |
| 測試          | Jest 30                | NestJS 內建整合                                                                             |

選型理由詳見《專案決策脈絡》；此處不重複。

## 3. Monorepo 結構

```
/
├── apps/
│   └── api/        # NestJS 後端
├── packages/
│   └── shared/     # 共用型別（placeholder，階段一起放 API 契約型別）
├── docs/
│   ├── reports/    # 各階段技術報告（本文件）
│   └── specs/      # 功能 spec（隨功能建立）
├── tasks/          # plan.md / todo.md（隨功能建立）
└── .github/workflows/ci.yml
```

關鍵設計：

- **`@ledger/api` 以 `workspace:*` 依賴 `@ledger/shared`**：API 的 request / response 型別未來由 shared 單一來源供給前後端，是「前後端型別一致」原則的基礎設施。
- **root scripts 用 `pnpm -r` 遞迴**：`lint` / `typecheck` / `test` / `build` 一個指令跑全 workspace；沒有該 script 的 package 自動略過。
- **暫不引入 Turborepo**：現階段 package 數少，避免過度複雜。

## 4. CI 設計（GitHub Actions）

單一 job，步驟依「由快到慢」排列，任一步失敗即中止：

```
checkout → setup pnpm(11.3.0) → setup node(.node-version, pnpm cache)
→ pnpm install --frozen-lockfile
→ build shared          ← 相依前置（見 §5 事故記錄）
→ format:check → lint → typecheck → test → build
```

設計要點：

- **版本單一事實來源**：Node 版本讀 `.node-version`、pnpm 版本對齊 `packageManager`，本地與 CI 永不漂移。
- **`--frozen-lockfile`**：lockfile 與 `package.json` 不符直接失敗，保證 lockfile 可信。
- **只有一個 job**：web / mobile 尚不存在，不預先拆分（Step 門控規則 6）。
- 觸發：`pull_request` → main、`push` → main。首跑約 33〜40 秒。

## 5. 事故記錄：CI 首跑紅燈（TS2307）

本階段最有教學價值的一次除錯，完整記錄如下。

- **現象**：CI 於 Type check 步驟失敗——`apps/api: error TS2307: Cannot find module '@ledger/shared'`；本地同一指令全綠。
- **根因**：`@ledger/shared` 的型別宣告位於 build 產物 `dist/index.d.ts`。本地因先前跑過 build、`dist/` 殘留而通過；CI 是全新環境，install 後直接 typecheck，此時 shared 尚未 build。
- **修法**：CI 在 install 之後加一步 `pnpm --filter @ledger/shared build`（commit `cf72591`）。
- **教訓**：
  1. CI 的價值正在於乾淨環境——它專門暴露被本地殘留產物掩蓋的相依問題。
  2. 步驟排序除了「由快到慢」，還必須考慮 **package 間的建置相依**。
  3. 未來 web / mobile 加入後同樣依賴此前置步驟，此修法已一併涵蓋。

## 6. Git / GitHub 流程落地

- **分支模型**：GitHub Flow。`main` 受保護，開發走 `類型/描述` 命名的分支（如 `chore/monorepo-scaffolding`）。
- **Commit 規範**：Conventional Commits（`feat:` / `fix:` / `docs:` / `chore:` / `ci:` …），支撐未來自動 changelog。
- **PR #1**：7 個 commit → squash merge 成 `main` 上單一 commit `1124792`。過程性 commit（含紅燈與修復）保留於 PR 頁面供回顧，主幹歷史維持「一個 PR = 一件事 = 一個 commit」。
- **分支保護（Ruleset `protect-main`）**：
  - Require a pull request before merging（禁止直接 push main）
  - Require status checks：`Lint, typecheck, test, build`（CI 綠燈為合併硬條件）
  - Block force pushes、Restrict deletions
  - 註：免費方案下 private repo 不強制執行 ruleset，故將 repo 轉為 **public**（亦符合未來開源與作品集定位）。

## 7. 已知限制與技術債

| 項目                             | 說明                                              | 處理時機               |
| -------------------------------- | ------------------------------------------------- | ---------------------- |
| `packages/shared` 無 lint / test | 目前僅 placeholder export，無實質內容可檢驗       | 階段一放入真實型別時補 |
| `apps/api` 自帶 prettier 3.4.2   | `nest new` 產物，與 root 3.6.2 重複、版本可能漂移 | 階段一動到 api 時清理  |
| CI 無覆蓋率 / 安全掃描 / CD      | CLAUDE.md §11 列為未來擴充項                      | 功能穩定後評估         |
| `apps/web`、`apps/mobile` 未建立 | 依階段規劃，前端於後續階段建立                    | 階段一之後             |

## 8. 下一階段

**階段一 — 地基**：核心記帳系統（認證授權、個人 / 家庭帳本、交易 CRUD）。依 CLAUDE.md §5 工作流程，將從 `docs/specs/` 的第一份 spec 開始：先列假設清單 → spec 審核 → `tasks/plan.md` → `tasks/todo.md` → 逐 Step 實作。
