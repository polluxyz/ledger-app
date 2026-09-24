# Session 交接

每次換 session 就更新這一份，**只寫重點**，細節連到 spec、plan 或 PR。新 session 第一件事讀它。
程序見 `docs/orca-multi-agent.md` §6；新 session 一律用 `claude --dangerously-skip-permissions` 開。

---

## 最新交接（2026-09-24）

### 現況

- 3b-1 借還已改成**每個人一本往來帳**並合併（#67）。規格：`docs/specs/phase-3b-debts.md`（決策 33～45）、`docs/specs/phase-3b1-web.md`。實作紀錄：`tasks/archive/phase-3b1-ledger-plan.md`。
- 同日另外合併：#66（交易列表拿掉鉛筆、金額對齊）、#65（worker 改 Codex 優先）、#64（agy 一律 skip permissions）。
- dev 資料庫已套用到 `20260924200000_replace_debts_with_ledger`。
- `main` 乾淨，沒有進行中的分支或 Orca worker。

### 下一步

1. **開發者會在新 session 指派往來帳版的修改**（操作後的回饋）。照 `CLAUDE.md` §5：先釐清、必要時先改 spec，再動工。
2. 之後：依往來帳重新設計 3b-2 連動的 spec（方向：一對好友連一本往來帳，見 `phase-3b-debts.md` §11）。

### 開發者的偏好與約束（不在 spec 裡的）

- 回覆用繁體中文；設計涉及金錢時「不能繁瑣，但不能失去嚴謹」。
- 看到成果再調整：開發者習慣先操作畫面再回饋，spec 視為活文件。
- worker 順序：Codex（`gpt-6-luna` max）→ Pi GLM → Antigravity Gemini；不必再問（`CLAUDE.md` §11）。
- 開發者的 dev API 用 `node dist/main` 跑、不是 watch：後端改完要提醒他 `pnpm build` 後重開 API；改了 `packages/shared` 也要重開 Vite。

### 已知問題

- 無未處理的已知問題。
