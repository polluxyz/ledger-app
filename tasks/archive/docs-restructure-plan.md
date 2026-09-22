# 實作計畫：文件整理 + Orca 工作環境

> 狀態：**已完成**（2026-09-22，PR #35）。核可於對話中逐題確認。
> 性質：純文件與設定變更，不動程式碼、不動 schema、不動 API。

---

## 1. 目標

1. **降低每個 session 的固定 token 成本**：`CLAUDE.md` 從 33 KB 砍到 15 KB 上下，做法是去重與分層，不是刪規則。
2. **把 Orca 納入工作流程**：開發改到 Orca（多個 agent 各自在獨立 git worktree 工作）上進行，worktree 模型帶來的實際限制要寫成規則。
3. **專案主軸由「學習 / 作品集」改為「交付可用產品」**：連同各項選型的理由一起改寫，結論不變。
4. **文件歸位**：已完成階段的 plan / todo 歸檔，檔名一致，加上索引頁。

---

## 2. 決策紀錄

| 編號 | 決策                                                       | 理由                                                                                                                                                      |
| ---- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1   | 分層規範拆到 `apps/api/CLAUDE.md`、`apps/web/CLAUDE.md`    | 子檔只在動到該目錄時才載入，根目錄那份因此只留全局規則                                                                                                    |
| D2   | 刪除原 §13「與 Claude Code 協作的約定」                    | 整章重複 §5 與 §12                                                                                                                                        |
| D3   | 界線總表只保留 Ask first 與 Never                          | Always 那段逐條重複前面章節；Ask first / Never 才是真正需要查表的護欄                                                                                     |
| D4   | 歷史沿革移出 CLAUDE.md，進《專案決策脈絡》                 | CLAUDE.md 是「現在怎麼做」，不是變更紀錄                                                                                                                  |
| D5   | 《專案決策脈絡》直接改寫，不加修訂註記                     | 開發者指定。目標段與各選型理由一起改，避免下半部讀起來與新目標不相容                                                                                      |
| D6   | 不共享 `node_modules`，改成新 worktree 自動 `pnpm install` | pnpm 的 store 用硬連結，多開一個 worktree 只多幾十 MB；分支之間 lock 檔可能不同，共享會互相覆蓋；`prisma generate` 產出就在 `node_modules` 裡，更不能共用 |
| D7   | 不建立 `orca.yaml`                                         | 唯一用途（共享目錄）已被 D6 否決。`environmentRecipes` 是容器 / VM 的題目，現在用不到                                                                     |
| D8   | 建立 `.worktreeinclude`                                    | git worktree 只給版控內的檔案。`apps/api/.env`、`.env.test` 不進版控，沒有它們 API 起不來、e2e 全紅                                                       |

---

## 3. 變更清單

### 3.1 新增

| 檔案                 | 內容                                               |
| -------------------- | -------------------------------------------------- |
| `.worktreeinclude`   | 新 worktree 要複製過去的未版控檔案清單             |
| `apps/api/CLAUDE.md` | NestJS / Prisma / 授權 / 測試的分層規範            |
| `apps/web/CLAUDE.md` | React / Vite / CSS Modules / Playwright 的分層規範 |
| `docs/README.md`     | 文件索引：每份 spec、plan、todo 的用途與狀態       |

### 3.2 改寫

| 檔案              | 主要動作                                                                  |
| ----------------- | ------------------------------------------------------------------------- |
| `CLAUDE.md`       | 全面精簡；新增「Orca 工作環境」一節；去掉學習導向的敘述；歷史沿革移出     |
| `專案決策脈絡.md` | 目標段改為交付導向；各選型理由同步改寫；補上 2026-09-22 之後的階段狀態    |
| `README.md`       | 狀態列更新（Web 已完成大半，不再是「later phase」）；文件連結跟著改名調整 |

### 3.3 搬移與改名

| 從                                       | 到                                              |
| ---------------------------------------- | ----------------------------------------------- |
| `tasks/plan.md`                          | `tasks/archive/phase-1-plan.md`                 |
| `tasks/todo.md`                          | `tasks/archive/phase-1-todo.md`                 |
| `tasks/phase-2*.md`（全部已完成）        | `tasks/archive/`                                |
| `docs/specs/phase-2a-payment-methods.md` | `docs/specs/archive/`（檔頭標「已由 2c 取代」） |

`tasks/` 清空後只放進行中的工作。本計畫自己留在 `tasks/docs-restructure-plan.md`，完成後一併歸檔。

---

## 4. Orca 帶來的規則（寫進 CLAUDE.md 新增章節）

1. **一個任務 = 一個 worktree = 一個分支**。worktree 是硬碟上獨立的一份簽出，共用 `.git`。同一分支不能同時簽出在兩個 worktree。
2. **新 worktree 第一件事跑 `pnpm install`**。它會連帶執行 `postinstall: prisma generate`，把 Prisma Client 產到該 worktree 自己的 `node_modules`。
3. **同時只有一個 worktree 跑 e2e**。兩套 e2e 共用 `ledger_test` 資料庫，且每個測試前都清空；兩個 worktree 同時跑會互相洗掉資料。dev server 的 port（API 3000 / Vite 5173）與 e2e 的 port（3100 / 5273）也是固定的，會撞。
4. **多個 PR 同時開著是常態**，不是例外。先合併的讓 `main` 前進，後面的要 `gh pr update-branch <n>` 再等 CI 重跑。
5. **codebase-memory-mcp 的索引綁在主工作區路徑**（`D-Projects-ledger-app`）。在 worktree 裡它回報的檔案位置可能指向主工作區，據以斷言前要回去讀實際檔案。**此限制尚未實測**，第一次在 worktree 裡用之前先跑 `index_status` 確認。
6. **Orca 本身不是專案相依**。hook 裝在 `~/.claude/settings.json` 與 `~/.orca/`，skill 裝在 `~/.agents/skills/`，都在 repo 之外。CI 用不到，也不可讓任何建置或測試流程依賴它。

---

## 5. 驗證點

| 項目             | 方式                                                              |
| ---------------- | ----------------------------------------------------------------- |
| 格式             | `pnpm format:check` 全綠（Prettier 會檢查所有 Markdown）          |
| 既有檢查未受影響 | `pnpm lint`、`pnpm typecheck`、`pnpm test` 全綠                   |
| 文件連結沒斷     | 搜尋 `tasks/plan.md`、`tasks/todo.md`、`phase-2a` 的殘留參照      |
| `CLAUDE.md` 體積 | 目標 15 KB 上下（原 33 KB）                                       |
| 規則沒有漏掉     | 逐條比對舊版 §12 界線總表，確認每條都還在（或已移進子 CLAUDE.md） |

---

## 6. 風險

- **精簡有刪掉規則的風險**。對策是以舊版 §12 界線總表當檢查表逐條核對，PR 描述附上核對結果。
- **子 CLAUDE.md 可能不被載入**。Claude Code 會在讀取該目錄檔案時載入巢狀 CLAUDE.md，但若實際行為不如預期，規則就等於消失。對策：把**安全相關**的規則留在根目錄那份，子檔只放慣例與風格。
- **`.worktreeinclude` 的格式未實測**。依官方文件是「一行一個路徑」。第一次開 worktree 時要確認 `apps/api/.env` 真的被複製過去。
