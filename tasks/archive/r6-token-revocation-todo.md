# R6 任務清單：登出讓憑證失效（登入紀錄表）

plan：`tasks/archive/r6-token-revocation-plan.md`；spec：`docs/specs/r6-token-revocation.md`。

- [x] **D docs PR**（協調者）：spec、plan、todo、`docs/README.md`、`docs/handoff.md` 編號、審查報告進度。
      驗收：format:check 綠；CI 全綠、squash merge；主工作區 `git pull` 完成。
- [x] **T0 契約與先紅的測試**（依賴 D；協調者）：plan §1.1。
      驗收：
  - shared 的 `JwtPayload` 有 `sid: string`，`pnpm --filter @ledger/shared build` 綠。
  - `.env.test` 指向 `ledger_review_test`，migration 已套用。
  - `e2e-utils.ts` 有 `loginAgain()`、`signRawToken()`。
  - `auth-session-isolation.e2e-spec.ts` 的 SC-TV1、SC-TV2、SC-TV5、SC-TV6 紅，紅的原因是登出端點不存在或 guard 只驗簽章，不是測試本身寫錯。
  - 正式程式只有 plan §1.1 的 2 處暫時值；typecheck、lint 綠。
- [x] **T1 後端**（依賴 T0；`r6-api`，`backend`）：plan §1.2。
      驗收：
  - migration 只新增 `AuthSession` 1 張表、2 個索引、1 個外鍵，不改現有的表；SQL 列在交付說明。
  - `JWT_EXPIRES_IN` 驗證的單元測試綠（SC-TV10 第 2 項）；`.env.example` 註解已改。
  - `auth.module.ts` 沒有 `expiresIn`；`login` 先寫紀錄再簽，`exp` 等於 `expiresAt`。
  - guard 單元測試綠：每種拒絕各 1 條、SC-TV9（資料庫錯誤不是 401、不放行）。
  - 登出與清理的單元測試綠，含 SC-TV11 第 3 項。
  - `auth-session.e2e-spec.ts` 綠：SC-TV3、SC-TV4、SC-TV7、SC-TV8、SC-TV10 第 1 項、SC-TV11 第 1～2 項、SC-TV12。每條「被拒絕」都同時斷言狀態碼與資料沒被讀到或改到。
  - T0 的 `auth-session-isolation.e2e-spec.ts` 轉綠，原有斷言沒改，只補 SC-TV5 的「紀錄沒被撤銷」。
  - 3 個測試改成真登入，diff 只有取得憑證的行與 import；`stats-perf` 手動跑 1 次通過。
  - 既有 API 單元測試與 API e2e 全綠。
  - `sid` 非 UUID 的 Prisma 實測結果寫進 plan §7。
  - 只改 `apps/api`、`.env.example` 與 plan §7；沒有新套件。
- [x] **T2 網頁**（依賴 T0；`r6-web`，Codex）：plan §1.3。
      驗收：
  - Vitest 綠：SC-TV13、SC-TV14。
  - 既有 Vitest 的斷言沒改；`api-client.test.ts:107` 還在。
  - `onTokenExpired` 接只清本機的函式；按鈕登出用 `finally` 清本機，最多等 5 秒；清憑證前比對點擊當下的憑證。
  - 登出不顯示任何文字。
  - Playwright SC-TV15 寫好。
  - 只改 `apps/web`；沒有新套件；Web typecheck、lint 綠。
- [ ] **T3 整合、驗收、PR、部署**（依賴 T1、T2；協調者）：plan §1.4。
      驗收：逐行看完 diff；lint、typecheck、test、format:check、build 綠；API e2e 全綠（含 SC-TV1～SC-TV8）；Web e2e 全綠（含 SC-TV15）；CI 全綠、squash merge；dev 先 `pg_dump` 再 `migrate deploy`；部署後手動走 1 次登入、記帳、登出，舊憑證 401；worker 的 worktree、分支、終端機、測試資料庫清掉。
- [x] **T4 文件收尾**（依賴 T3，併進同一個 PR；協調者）：plan §1.5。
      驗收：審查報告 R6 標完成；`security-baseline.md` SEC-2 標達成；`apps/api/CLAUDE.md` 加 e2e 憑證規則；`專案決策脈絡.md`、`CLAUDE.md` §4、`docs/README.md`、`docs/handoff.md`、`docs/handoff/review-specs.md` 更新；spec 標已完成；plan 與 todo 移到 `tasks/archive/`。
