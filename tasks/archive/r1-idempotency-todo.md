# R1 任務清單：防重複送出（Idempotency-Key）

plan：`tasks/archive/r1-idempotency-plan.md`；spec：`docs/specs/r1-idempotency.md`。

- [x] **D docs PR**（協調者）：spec、plan、todo、`docs/README.md`、`docs/handoff.md` 編號、審查報告進度。
      驗收：format:check 綠；CI 全綠、squash merge；主工作區 `git pull` 完成。
- [x] **T0 契約與先紅的測試**（依賴 D；協調者）：plan §1.1。
      驗收：shared 有 3 個 `errorCode` 與 header 常數，`pnpm --filter @ledger/shared build` 綠；`e2e-utils.ts` 有 `idempotencyKey()`；`idempotency-isolation.e2e-spec.ts` 的 SC-IK3 紅（建立 2 筆）、SC-IK9 綠；typecheck、lint 綠；沒有改正式程式。
- [x] **T1a 後端核心**（依賴 T0；`r1-api`，`backend`）：plan §1.2。
      驗收：
  - migration 只新增 1 張表與 2 個 enum，不改現有的表；SQL 列在交付說明。
  - 共用服務單元測試綠：搶鍵、P2002 轉重送、其他 P2002 往外丟、3 種比對不符、`write` 回空值時回滾、雜湊正規化。
  - Prisma 7 的 P2002 `meta` 實測結果寫進 plan §7。
  - `idempotency.e2e-spec.ts` 綠：SC-IK1、SC-IK2、SC-IK4～SC-IK8、SC-IK10、SC-IK11；每條都斷言筆數與金額效果。
  - T0 的 `idempotency-isolation.e2e-spec.ts` 轉綠，斷言沒改。
  - 5 個 service 的業務規則、鎖順序、錯誤碼沒變；既有單元測試只改呼叫方式。
  - 只改 `apps/api`；沒有新套件；CORS 選項內容沒變。
- [x] **T1b 既有 API e2e 補 header**（依賴 T0；`r1-api-e2e`，`default`）：plan §1.3。
      驗收：呼叫 5 個端點的請求都帶 `.set(idempotencyKey())`；diff 只有 header 與 import；沒改斷言、測試資料、`e2e-utils.ts`；在沒有 T1a 的分支上 API e2e 全綠。
- [x] **T2 網頁**（依賴 T0；`r1-web`，Codex）：plan §1.4。
      驗收：
  - Vitest 綠：SC-IK12、SC-IK13、SC-IK15。
  - 既有 Vitest 的斷言沒改。
  - 5 個呼叫處都帶鍵；編輯模式不帶。
  - `api-client` 不自己產生鍵；沒用 `crypto.randomUUID`；沒寫 `localStorage`。
  - 「尚未確認，請重試」「已記錄過」「這筆已刪除」照 spec 文字。
  - Web e2e 種資料補 header；SC-IK14 寫好。
  - 只改 `apps/web`；沒有新套件；Web typecheck、lint 綠。
- [ ] **T3 整合、驗收、PR、部署**（依賴 T1a、T1b、T2；協調者）：plan §1.5。
      驗收：逐行看完 diff；lint、typecheck、test、format:check、build 綠；API e2e 全綠（含 SC-IK3、SC-IK9）；Web e2e 全綠（含 SC-IK14）；CI 全綠、squash merge；dev 先 `pg_dump` 再 `migrate deploy`；部署後手動記 1 筆成功；worker 的 worktree、分支、終端機、測試資料庫清掉。
- [ ] **T4 文件收尾**（依賴 T3，併進同一個 PR；協調者）：plan §1.6。
      驗收：審查報告 R1 標完成；`apps/api/CLAUDE.md` 加防重提醒；`專案決策脈絡.md`、`CLAUDE.md` §4、`docs/README.md`、`docs/handoff/main.md` 更新；spec 標已完成；plan 與 todo 移到 `tasks/archive/`。
