# 交接：2j 統計、2k 首頁改版（`stats-2j`）

入口與跨工作區規則見 [`../handoff.md`](../handoff.md)。

## 現況（2026-10-24）

- 2j 已以 PR #154 合進 `main`，程式隨 4a 部署到 dev（#156）。plan 與 todo 在 `tasks/archive/phase-2j-*.md`，驗收數字在 plan §6。
- 2k 首頁改版：spec `docs/specs/phase-2k-home-redesign.md`、plan `tasks/phase-2k-plan.md`、todo `tasks/phase-2k-todo.md`，開發者 2026-10-24 核可。
- 討論過程：參考圖與三個版本的比較、分類條配色 demo 都在 `docs/artifacts/home-redesign/`（不進版控）。advisor（Codex）審過 spec 一輪、plan 兩輪，修訂紀錄在 spec §11 與 plan §6。
- 已知限制（2j spec §1）：交易頁的日期篩選用瀏覽器時區換算，統計用台灣時間。
- 效能（SC-R13）：統計端點 p95 約 260～310ms，機器有其他負載時曾量到 907～967ms。

## 下一步

1. docs PR 合併後，從 `origin/main` 開 `feature/phase-2k-home-redesign-impl`，跑 `pnpm install`（plan §0）。
2. 第 1 波平行派 Codex：W1 共用失效函式、W2 首頁卡片元件、W4 配色設定。之後依序 W3 首頁組裝、W5 Web e2e（plan §2、§5）。
3. W5 開跑前確認 3100、5273、5274 沒被佔，也沒有別的 worktree 在跑 Web e2e。

## 開發者在這次討論給的偏好

- 首頁選 A 版，右上放資產趨勢小圖，資產卡裡放支出分類（跟原 A 版互換）。
- 新增交易後，首頁所有圖卡要同時更新。
- 分類條配色做成設定：彩色、金色、灰色三選一。
