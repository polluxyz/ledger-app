# R6 實作計畫：登出讓憑證失效（登入紀錄表）

spec：`docs/specs/r6-token-revocation.md`（決策 373～384、W293～W296、SC-TV1～SC-TV16）。後端與網頁合成一個 PR（決策 381 (a)）。

> 核可：spec 由開發者 2026-11-18 回「核可」（含 §10：登出最多等 5 秒）。本 plan 與 `tasks/r6-token-revocation-todo.md` 開發者 2026-11-18 回「核可」。

## 0. 起點

- 先開 docs PR（spec、plan、todo、`docs/README.md` 索引、`docs/handoff.md` 編號、審查報告的進度註記），合進 `main`。
- 整合分支 `feature/r6-token-revocation`，從合併後的 `main` 開，用 `review-specs` worktree。只有協調者寫這條分支。
- 測試資料庫：把本 worktree 的 `apps/api/.env.test` 從 `ledger_test` 改指向 `ledger_review_test`（spec §6），先建好資料庫再跑 `prisma migrate deploy`。這樣 API e2e 可以和其他工作區平行跑。Web e2e 仍共用固定 port，跑之前確認 3100、5273 沒被占（CLAUDE.md §11 第 4 條）。
- worker 各開自己的 worktree 與測試資料庫，從整合分支開子分支，驗收後 merge 回整合分支。
- 角色（`docs/orca-multi-agent.md` §0）：
  - migration、guard、登入與登出屬於授權與高準確的工作，派 `backend`。
  - 3 個測試改成真登入是機械性改動，但牽涉 SC-P9 與配額的斷言，併進 `backend` 的任務一起做（理由見 §2）。
  - 網頁派 Codex（`apps/web` 只交給 Codex）。
- **schema、API、共用型別的變更**開發者已同意（spec 依據第 3 行）。不加套件，不改 CI。

## 1. 元件與相依

### 1.1 協調者自己做（T0：契約與先紅的測試）

**shared 契約**（`packages/shared/src/types/auth.ts:23`）：

- `JwtPayload` 加 `sid: string`，註解寫「登入紀錄的 id（決策 375、383）」。
- 跑 `pnpm --filter @ledger/shared build`。
- 加了必填欄位後，`auth.service.ts:122` 組 payload 的地方與 `jwt-auth.guard.ts:39` 設定 `request.user` 的地方會 typecheck 失敗。T0 只為了讓 typecheck 綠，在這 2 處先補上暫時的值：
  - `auth.service.ts`：`sid` 先填 `randomUUID()`（`node:crypto`），註解標「T1 換成登入紀錄的 id」。
  - guard：`sid` 先從 payload 讀出，型別不符時當空字串。
  - 這 2 處不改其他行為。guard 仍只驗簽章，所以先紅的測試仍會紅。

**e2e 輔助函式**（`apps/api/test/e2e-utils.ts`）：

- `loginAgain(app, email): Promise<string>`：用 `PASSWORD` 再登入 1 次，回傳新憑證。SC-TV2、SC-TV3 與 T1 的 3 個測試改寫都用它，避免各寫一份。
- `signRawToken(app, payload, options?)`：直接用 `JwtService` 簽憑證，註解寫「只給負面測試用（決策 384 (c)）」。SC-TV5、SC-TV6、SC-TV7 第 2 項用它。

**先紅的 API e2e**（新檔 `apps/api/test/auth-session-isolation.e2e-spec.ts`）：

- SC-TV1：登入 → `/users/me` 200 → 登出 → 同一張憑證 `/users/me` 401，回應不含 email 與 id。
- SC-TV2：同一人登入 2 次得 A、B。登出 A → A 401；B 200，且 B 能新增 1 筆交易（帶 `idempotencyKey()`），資料庫多 1 筆。
- SC-TV5：A、B 各登入。用正確密鑰簽 `{ sub: B, email: B, sid: A 的 sid }` → 401，回應不含 A、B 的資料；A 的紀錄 `revokedAt` 仍為 null，A 的憑證仍 200。
- SC-TV6：4 種憑證都 401，每種都斷言回應不含使用者資料。
- 紅綠的分法：
  - T0 時沒有登出端點，SC-TV1、SC-TV2 會在登出那一步拿到 404（紅）。
  - guard 只驗簽章，SC-TV5、SC-TV6 第 1、3、4 項會放行（紅）。
  - SC-TV6 第 2 項（沒有 `exp`）也會放行（紅）。
  - SC-TV5 讀 A 的 `sid` 要靠登入紀錄表，T0 時表還不存在。T0 先從 A 的憑證解出 `sid`（`jwt.decode`），只斷言 HTTP 結果；「紀錄沒有被撤銷」那一句在 T1 建表後由 T1 補上，斷言不放寬。
- 驗證：`pnpm --filter @ledger/api test:e2e -- auth-session-isolation` 跑出預期的紅，typecheck、lint 綠。

### 1.2 後端（T1，`backend`）

依賴 T0。順序照下面寫，每步後跑 `pnpm --filter @ledger/api test`。

**1. schema 與 migration**（`apps/api/prisma/schema.prisma`）：

- 照 spec §3 新增 `AuthSession`，`User` 加反向關聯 `authSessions AuthSession[]`。表名與欄位照 spec，不改。
- 依 `apps/api/CLAUDE.md` 的非互動指引：`prisma migrate diff --from-schema <基底 schema> --to-schema prisma/schema.prisma --script` 產生 SQL，名稱 `<時間戳>_r6_auth_session`，再 `prisma migrate deploy`。只對 worker 自己的 `.env.test` 資料庫。
- migration SQL 逐行列在交付說明。預期只有 1 個 `CREATE TABLE`、2 個 `CREATE INDEX`、1 個外鍵，不改既有的表。
- 確認 `resetDb`（`e2e-utils.ts`）清得到新表。它動態列出 public 的表再 `TRUNCATE ... CASCADE`，R1 已實測過這個做法，這次一樣實測 1 次。

**2. 效期設定**（`apps/api/src/config/env.validation.ts:10`）：

- 新增 `parseDurationToMs(value: string): number`，放在 `apps/api/src/config/duration.ts`：
  - 規則：`/^[1-9]\d*[smhd]$/`，換算成毫秒。
  - 換算結果不是安全整數，或加上現在時間後不是合法日期 → 丟錯。這是「格式正確」的技術下限，不是新的效期上限。
- `JWT_EXPIRES_IN` 改成 `z.string().default('7d').refine(...)`，用上面的函式驗證。錯誤訊息寫「必須是正整數加 s、m、h、d，例如 7d」。
- 單元測試（SC-TV10 第 2 項）：`0d`、`-1d`、`7`、`7x`、空字串、`1.5d`、`7D` 失敗；`7d`、`24h`、`30m`、`45s` 通過。大小寫只接受小寫，和 spec 列的範例一致。
- `.env.example:9` 的註解改成：「登入憑證效期。格式：正整數加 s、m、h、d（例如 7d、24h）。只影響之後的登入。」

**3. 簽發**（`auth.module.ts:20`、`auth.service.ts:107`）：

- `auth.module.ts`：拿掉 `signOptions.expiresIn`。理由：`jsonwebtoken` 不允許 payload 有 `exp` 又同時給 `expiresIn`，會丟錯。改由 `login` 自己放 `exp`。
- `login` 驗完密碼後：
  1. `const now = Date.now()`；`expiresAt = new Date(Math.floor((now + 效期毫秒) / 1000) * 1000)`。取整到秒，讓 `exp` 與 `expiresAt` 完全相等（SC-TV10 第 1 項）。
  2. `prisma.authSession.create({ data: { userId, expiresAt } })`，取得 `id`。
  3. `jwt.signAsync({ sub, email, sid: id, exp: expiresAt / 1000 })`。
  4. 執行清理（下一步），再回傳 `{ accessToken }`。
- 效期毫秒從 `ConfigService` 讀 `JWT_EXPIRES_IN` 再用 `parseDurationToMs` 換算，在 constructor 算 1 次。
- 拿掉 T0 的暫時 `randomUUID()`。
- 密碼錯誤的路徑不寫紀錄、不清理，維持「回應時間與 email 是否存在無關」的現有行為。

**4. 清理**（決策 380）：

- 批次大小：**100 筆**。理由：自用規模每天登入次數個位數，100 筆足以追上；每次登入最多多 2 個小查詢。
- 做法（不用原生 SQL，PostgreSQL 的 `DELETE` 不支援 `LIMIT`）：
  1. `findMany({ where: { expiresAt: { lt: now } }, select: { id: true }, take: 100 })`。
  2. 有結果才 `deleteMany({ where: { id: { in: ids }, expiresAt: { lt: now } } })`。
- 用 `try/catch` 包住，失敗用 Nest `Logger.warn` 記錯誤名稱，不記憑證與 email，不往外丟（SC-TV11 第 3 項）。
- 用 `await` 跑完才回應，不放背景。理由：e2e 可以在登入回應後立刻斷言結果；多出的時間只有 2 個小查詢。
- 已撤銷但未到期的紀錄不刪（條件只看 `expiresAt`）。

**5. Guard**（`jwt-auth.guard.ts`，決策 376、377）：

- 注入 `PrismaService`（`PrismaModule` 是 `@Global`，不用改 module 的 import）。
- 順序照決策 376 的 6 步：
  - 第 2 步的 `verifyAsync` 放在自己的 `try/catch`，失敗丟 `UnauthorizedException('Invalid or expired token')`。
  - 第 3 步用一個型別守衛函式 `isSessionPayload(value: unknown)` 檢查 `sub`、`email`、`sid` 是非空字串、`exp` 是有限數字。不符丟同一個 401。
  - 第 4 步的 `findUnique({ where: { id: sid } })` **不包在** `try/catch` 裡。資料庫錯誤原樣往外丟，由全域 filter 回 500（決策 377）。
  - `sid` 不是 UUID 格式時，Prisma 對 `String` 欄位照樣查詢、查不到就回 null，不會丟錯。T1 實測 1 次並寫進 §7。若會丟錯，先檢查格式再查，格式不符直接 401，不可以把錯誤吞成 401。
  - 第 5 步的 4 個條件不符都丟同一個 401。`expiresAt` 與 `new Date()` 比較。
  - 第 6 步設定 `request.user = { sub, email, sid }`。
- 現有的 `Missing bearer token` 訊息保留不動（第 1 步）。
- 單元測試（`jwt-auth.guard.spec.ts`）：
  - 每一種拒絕條件各 1 條：沒有 `sid`、沒有 `exp`、`sub` 或 `sid` 型別不符或空字串、紀錄不存在、`userId` 不符、已撤銷、已到期、`expiresAt` 剛好等於現在。
  - SC-TV9：`findUnique` 丟錯 → guard 丟出的錯誤不是 `UnauthorizedException`，也沒有回 `true`。
  - 通過時 `request.user` 只有 `sub`、`email`、`sid` 3 個欄位。
  - 既有的「public 路由放行」「沒有 Bearer」測試保留。

**6. 登出端點**（`auth.controller.ts`、`auth.service.ts`，決策 378）：

- `@Post('logout')`、`@HttpCode(HttpStatus.NO_CONTENT)`、`@ApiBearerAuth('jwt')`、`@ApiNoContentResponse`、`@ApiUnauthorizedResponse`。不加 `@Public()`，不加 `@Throttle`（用全站預設）。
- controller：`logout(@CurrentUser() user: JwtPayload): Promise<void>`，只把 `user.sub`、`user.sid` 傳給 service。不收 body。
- service：`updateMany({ where: { id: sid, userId: sub, revokedAt: null }, data: { revokedAt: new Date() } })`。
  - `count` 是 0 時丟 401 `UNAUTHORIZED`。這只在「同一張憑證的 2 個登出請求同時通過 guard」時發生，回 401 和決策 378 (d) 一致。
- 單元測試：`count` 為 1 時不丟錯；`count` 為 0 時丟 401；`where` 條件含 `userId` 與 `revokedAt: null`。

**7. 新 e2e**（新檔 `apps/api/test/auth-session.e2e-spec.ts`）：

- SC-TV3：`Promise.all` 同時登入 2 次，`sid` 不同，資料表 2 筆。
- SC-TV4：重複登出、不帶憑證、亂碼憑證都 401；前後比對所有紀錄的 `revokedAt`，沒有變化。
- SC-TV7：
  1. 直接把紀錄的 `expiresAt` 改成過去 → 401。
  2. 用 `signRawToken` 簽一張 `exp` 已過、`sid` 指向未到期紀錄的憑證 → 401。
- SC-TV8：登出後 `app.close()`，再 `createE2EApp()` 起新實例 → 舊憑證 401。
- SC-TV10 第 1 項：解出憑證的 `exp`，等於紀錄 `expiresAt` 的秒數。
- SC-TV11 第 1～2 項：先插入 1 筆別人的過期紀錄、1 筆已撤銷未到期紀錄，再登入 → 前者刪掉，後者還在。
- SC-TV12：讀 Swagger 文件，`/api/auth/logout` 的 `post` 有 `security` 含 `jwt`，回應有 `204`、`401`；`/api/auth/login` 回應的 schema 和現在相同。讀文件的方式照現有 OpenAPI 測試（T1 先找有沒有現成的；沒有就在 e2e 裡用 `SwaggerModule.createDocument`）。
- SC-TV11 第 3 項放 `auth.service.spec.ts`：讓 `findMany` 丟錯，`login` 仍回憑證。`auth.service.spec.ts:168` 的預期改成含 `sid` 與 `exp`。
- T0 的 SC-TV5 補上「A 的紀錄 `revokedAt` 仍為 null」，T0 的 4 條轉綠，原有斷言不改。

**8. 3 個測試改成真登入**（決策 384 (b)）：

| 檔案                                 | 現在                                       | 改成                                                                       | 不能放寬的斷言       |
| ------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------- | -------------------- |
| `ai-quota-isolation.e2e-spec.ts:143` | `signAsync({ sub, email }, { expiresIn })` | `loginAgain(app, bob.email)`                                               | 用新憑證仍得 429     |
| `ai-parse.e2e-spec.ts:517`           | `sign({ sub, email, jti })`                | `loginAgain(app, bob.email)`，並斷言 2 張憑證不同                          | SC-P9 原本的全部斷言 |
| `stats-perf.perf-spec.ts:150`        | `signAsync({ sub, email })`                | 打 `/api/auth/login`，密碼用 `:138` 已有的 `'stats-perf-fixture-password'` | 原本的效能門檻       |

- 這 3 個檔案 diff 只能是「取得憑證」的那幾行與 import。
- `stats-perf` 不在 CI 的 e2e 裡跑；T1 手動跑 1 次，結果寫進 §7。
- `ai-parse.e2e-spec.ts:491`、`ai-vertex-isolation.e2e-spec.ts:45` 在環境覆寫裡設 `JWT_EXPIRES_IN: '7d'`，格式合法，不用改。

### 1.3 網頁（T2，Codex）

依賴 T0。和 T1 平行。Vitest 用 mock，不需要後端。

**1. 拆成 2 個函式**（`apps/web/src/features/auth/AuthProvider.tsx:42`）：

- `clearLocalSession()`：現在 `logout` 的內容（首頁編輯狀態、憑證、`setToken(null)`、作用中帳本、查詢快取）。
- `logout()`：按鈕用的登出流程（W293）。
- `onTokenExpired`（`:53`）改接 `clearLocalSession`（W294）。
- context 對外的 `logout` 名稱不變，`UserMenu.tsx:214` 不用改呼叫方式。

**2. 按鈕的登出流程**（W293、W295 (b)）：

1. 用 ref 記「登出進行中」。進行中再按直接 return，不重送（SC-TV13 第 3 項）。
2. 讀出當下的憑證。沒有憑證就只清本機。
3. 立刻送 `POST /auth/logout`。`api-client` 送出時讀的就是同一張憑證，所以不用新增「指定憑證」的選項。Vitest 斷言 header 等於點擊當下的憑證。
4. 用 `AbortController` 加 `setTimeout(5000)` 中止，方便 Vitest 用假時鐘。不用 `AbortSignal.timeout`。
5. 不管成功、失敗、逾時、中止，都在 `finally` 清本機。
6. 清本機時，憑證的部分改用「比對後才清」：只有存的仍是點擊當下那張才清（同 `invalidateToken` 的做法）。理由：另一個分頁可能在等待期間登入了新帳號，localStorage 是分頁共用的。React 狀態、首頁編輯狀態、作用中帳本、查詢快取照常清。
7. 不顯示任何文字（W293 (a)）。

**3. 401 與晚到的回應**（W294、W295 (a)）：

- `api-client.ts:67` 的 `invalidateToken(token)` 做法不動。登出請求本身收到 401（例如已在別處登出）也走這條，只清同一張憑證。
- 現有 `api-client.test.ts:107` 保留。

**4. 測試**：

- Vitest：
  - SC-TV13：送出的 header 是點擊當下的憑證；成功、失敗（500）、5 秒逾時 3 種情況，4 樣本機狀態都清乾淨；等待期間連按只送 1 次。
  - SC-TV14：一般請求 401 → 本機清乾淨、沒有送登出請求；舊憑證晚到的 401 不清新憑證；登出請求晚到的回應不清之後登入的新憑證。
- Playwright SC-TV15（新檔 `apps/web/e2e/logout.spec.ts`，或併進 `smoke.spec.ts`，由 Codex 依現有慣例選）：登入 → 讀出 localStorage 的憑證 → 按登出 → 回到登入頁 → 用剛才的憑證打 `/api/users/me` 得 401。要對後端跑，T1 合併前會失敗，屬預期。T3 由協調者在整合分支跑。
- 既有 Vitest 與 Playwright 的斷言不改。現有測試若 mock 了 `logout` 的同步行為而壞掉，只改 mock 的方式。

### 1.4 整合、驗收、PR、部署（T3，協調者）

依賴 T1、T2。

- 依序 merge T1 → T2 進整合分支。
- 逐行看 diff：
  - migration SQL。
  - guard 的 6 步順序；資料庫錯誤沒有被 `catch` 吞成 401；沒有任何路徑只驗簽章就放行。
  - `login` 先寫紀錄再簽；`exp` 與 `expiresAt` 同一個值；`auth.module.ts` 已拿掉 `expiresIn`。
  - 登出的 `where` 含 `userId` 與 `revokedAt: null`。
  - 清理的條件只看 `expiresAt`，失敗不往外丟，log 不含憑證與 email。
  - 3 個改成真登入的測試，diff 只有取得憑證的行。
  - 網頁：`onTokenExpired` 接的是只清本機的函式；登出流程的 `finally`；比對憑證後才清。
- 自己重跑：
  - 根目錄 lint、typecheck、test、format:check、build。
  - API e2e 全部，含先紅的 `auth-session-isolation` 與 `auth-session`。
  - Web e2e 全部，含 SC-TV15。跑之前確認 3100、5273 沒被占。
- 用 `pr` skill 開 PR，盯 CI，squash merge。
- 部署 dev（主工作區，spec §8）：`pg_dump` 備份 `ledger_dev` → `pnpm install` → build shared → `prisma generate` → `prisma migrate deploy` → 重開 API 與 Vite。提醒開發者：要重新登入 1 次，並按 `Ctrl + Shift + R`。
- 部署後手動走 1 次：登入 → 記 1 筆交易成功 → 登出 → 回到登入頁。用 `curl` 拿登出前的憑證打 `/api/users/me` 得 401。憑證只在終端機裡用，不寫進任何檔案或報告。
- 清掉 worker 的 worktree、分支、終端機、測試資料庫。

### 1.5 文件收尾（T4，協調者）

併進 T3 的 PR。

- `docs/reports/2026-11-11-project-review.md`：R6 標完成，附 PR 號。
- `docs/specs/security-baseline.md`：SEC-2 標註已由本 spec 達成，連回決策 376、378。
- `apps/api/CLAUDE.md`：加 1 條「e2e 用真的登入取得憑證（`registerAndLogin`、`loginAgain`），只有負面測試可以用 `signRawToken`」。
- `專案決策脈絡.md`：記「為什麼用登入紀錄表、為什麼效期維持 7 天」，連回 spec 決策 374、379。
- `CLAUDE.md` §4、`docs/README.md`、`docs/handoff.md`、`docs/handoff/review-specs.md`：進度與狀態。
- spec 狀態改成「已完成」。本 plan 與 todo 移到 `tasks/archive/`。

## 2. 實作順序

1. docs PR → 合進 `main`。
2. T0（協調者）→ 整合分支 commit。
3. T1（`backend`）、T2（Codex）同時派出。
4. T3（協調者）：合併、驗收、PR、部署。T4 併進同一個 PR。

不像 R1 拆出 `default` 的 T1b：要改的測試只有 3 個，而且必須在 guard 改完後才驗得出「斷言沒放寬」。分給另一個 worker，交接的成本比改動本身大。

## 3. 風險與對策

| 風險                                                                          | 對策                                                                               |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| guard 的 `try/catch` 包太大，把資料庫錯誤吞成 401，資料庫一抖所有人被登出     | plan §1.2 第 5 步規定 `findUnique` 不在 `try/catch` 內。SC-TV9 單元測試。T3 逐行看 |
| 某條路徑退回只驗簽章（例如 `sid` 缺少時放行）                                 | SC-TV6 由協調者先寫、先紅；guard 單元測試每種拒絕各 1 條                           |
| `exp` 和 `expiresAt` 差 1 秒，憑證比紀錄晚到期或早到期                        | 截止時間先取整到秒，兩邊用同一個值。SC-TV10 第 1 項斷言相等                        |
| `auth.module.ts` 還留著 `expiresIn`，`signAsync` 因為 payload 有 `exp` 而丟錯 | T1 第 3 步拿掉；所有登入的 e2e 都會走到這條，留著就全紅                            |
| 漏改某個自己簽憑證的測試，部署後該測試 401                                    | 已用 `grep` 確認只有 3 處（§1.2 第 8 步）。合併後全跑 API e2e，漏掉的會 401        |
| 改成真登入時順手放寬斷言（例如把 429 改成接受 401）                           | §1.2 第 8 步列出不能放寬的斷言；T3 看這 3 個檔案的 diff 只有取得憑證的行           |
| 網頁 401 時也呼叫登出 API，401 → 登出 → 401 形成迴圈                          | `onTokenExpired` 改接只清本機的函式。SC-TV14 第 1 項斷言沒有送登出請求             |
| 登出等待期間，另一個分頁登入了新帳號，被這邊的清除清掉                        | 清憑證時比對點擊當下的那張。SC-TV14 第 3 項                                        |
| 每個請求多 1 次查詢，拖慢回應                                                 | 主鍵查詢，自用規模可接受（假設 10）。這次不量測；CI 的 e2e 時間若明顯變長再評估    |
| 部署後所有人被登出，開發者以為是故障                                          | 預期行為（決策 381 (b)）。部署前後都提醒開發者                                     |
| `sid` 不是 UUID 格式時，Prisma 查詢丟錯而不是回 null，變成 500                | T1 實測。若會丟錯，先在第 3 步檢查格式，格式不符回 401                             |
| 2 個登出請求同時通過 guard，第 2 個 `updateMany` 影響 0 筆                    | `count` 為 0 時回 401，和「重複登出回 401」一致                                    |

## 4. 驗證點

- T0 後：SC-TV1、SC-TV2、SC-TV5、SC-TV6 紅（原因是登出端點不存在、guard 只驗簽章）；typecheck、lint 綠；shared build 綠。
- T1 後：migration 只新增 1 張表；guard、登出、效期、清理的單元測試綠；T0 的 4 條轉綠；SC-TV3、SC-TV4、SC-TV7、SC-TV8、SC-TV10～SC-TV12 綠；既有 API 單元測試與 API e2e 全綠；`stats-perf` 手動跑 1 次通過。
- T2 後：Vitest 綠（SC-TV13、SC-TV14）；既有 Vitest 綠；Web typecheck、lint 綠。
- T3 後：SC-TV16 全綠；SC-TV15 綠；CI 全綠；dev 部署後手動走 1 次登入、記帳、登出，舊憑證 401。

## 5. 要開發者決定的事

- 沒有新的。以下都是 spec 交給 plan 的細節，不改 spec 的語意：
  - 清理批次 100 筆、跟著登入同步執行。
  - `JWT_EXPIRES_IN` 的單位只收小寫；換算後超出合法日期範圍也算格式錯誤。
  - 登出時憑證「比對後才清」，避免清掉別的分頁剛登入的憑證。這是 W295 (b) 的做法，不是新規則。

## 6. 派工

- 用 `orca orchestration` 派工，Task spec 照 `docs/orca-multi-agent.md` 的格式：
  - T1 給 `backend`，附本 plan §1.2 全文與 spec 決策 373～384、§3～§5。
  - T2 給 Codex，附本 plan §1.3 全文與 spec W293～W296、SC-TV13～SC-TV15、§1 範圍外。
- 派工前查各層額度（`docs/orca-multi-agent.md` §4）。
- 驗收：協調者逐行看 diff，自己重跑 SC-TV1、SC-TV2、SC-TV5、SC-TV6、全部 API e2e 與 Web e2e。
- worker 驗收合併後，立刻清 worktree、分支、終端機、測試資料庫。

## 7. 實作紀錄

（實作時填寫：migration SQL、`sid` 非 UUID 的 Prisma 實測、`stats-perf` 結果、偏離與待辦。）
