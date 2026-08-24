# 任務清單：階段二 (2e) — Web 端對端測試（Playwright）

> 狀態：**待核可**（2026-08-24）
> 依據：`docs/specs/phase-2e-web-e2e.md`、`tasks/phase-2e-plan.md`（皆已核可）。
> 用法：依序執行；每個任務有驗收條件。勾選＝「開發者已驗收」。
> 通用驗收（每任務皆適用，不再重複）：`pnpm --filter @ledger/web lint`、`typecheck` 綠。
> 分支：`feature/web-e2e-playwright`。**本步不改產品程式碼**（唯一例外見 P2）。

### 已核可的決策（實作時一律照此）

| #   | 結論                                                                         |
| --- | ---------------------------------------------------------------------------- |
| D1  | 測 dev server，不測 build 產物。`optimizeDeps.include` 是 dev 專屬設定       |
| D2  | 清資料動態查 `pg_tables`，不維護清單。順帶改 api 的 `resetDb`                |
| D3  | 測試資料一律打真實 API 建立；直接寫資料庫只限「清空」                        |
| D4  | `workers: 1`、`fullyParallel: false`。共用一個資料庫，不能平行               |
| D5  | 只跑 Chromium                                                                |
| D6  | 專用埠：API 3100、web 5273。`CORS_ORIGIN` 要跟著設                           |
| D7  | CI 接在現有 `ci` job 之後，不另開 job                                        |
| D8  | `retries: 0`。不穩定就當 bug 修                                              |
| P1  | 伺服器就緒判定：API 等 `GET /docs`，web 等 `GET /`                           |
| P2  | 一律用可及性選取器。選不到才加 `data-testid`，**加之前先問**。禁用 CSS class |
| P3  | 兩個帳號 = 同一測試內開兩個 `browser.newContext()`                           |
| P4  | 情境 6 的前置交易用 API 建立，不走畫面                                       |
| P5  | 情境 6 的 409 引導文字要先確認前端真的有；沒有就停下來說                     |

### 對 Plan §5 的一處細化

Plan 把「兩個伺服器」整包放在 Step 2。實作時拆得更細：**Step 1 只起 web server**，Step 2 才補 API。

理由：web 單獨起得來、首頁單獨打得開，本身就是一個有意義的檢查點——白屏那次正是這一關過不了。先把它釘住，Step 2 出問題時才分得清是誰壞了。

---

## Step 1：裝套件與最小設定

- [ ] **1.1 安裝相依**（**Ask first**）
  - 內容：`apps/web` 加 devDependency：`@playwright/test`、`pg`、`@types/pg`。再跑一次 `playwright install chromium` 下載瀏覽器。
  - 驗收：`pnpm install` 綠；`pnpm --filter @ledger/web exec playwright --version` 有輸出。
- [ ] **1.2 `playwright.config.ts` 最小版**
  - 內容：`testDir: './e2e'`、只有 chromium、`workers: 1`、`fullyParallel: false`、`retries: 0`、`webServer` 先只起 web（埠 5273，`--strictPort`）、`timeout` 給到 120 秒。
  - 驗收：設定檔存在且 `playwright test --list` 列得出測試。
- [ ] **1.3 tsconfig 涵蓋**
  - 內容：新增 `apps/web/tsconfig.e2e.json`，`include` 涵蓋 `e2e` 與 `playwright.config.ts`。**不加進 `tsconfig.json` 的 references**。改 `typecheck` script 同時檢查兩個 project。
  - 驗收：`pnpm --filter @ledger/web typecheck` 綠，且故意寫一個型別錯誤在 `e2e/` 下會被抓到。
- [ ] **1.4 ESLint 涵蓋**
  - 內容：`lint` script 的範圍加上 `e2e/**/*.ts` 與 `playwright.config.ts`；`eslint.config.mjs` 加一個區塊給這些檔案掛 `globals.node`（它們跑在 Node，不是瀏覽器）。
  - 驗收：`pnpm --filter @ledger/web lint` 綠，且 `e2e/` 下用 `process.env` 不會被判成未定義。
- [ ] **1.5 `.gitignore`**
  - 內容：加 `apps/web/test-results/`、`apps/web/playwright-report/`。
  - 驗收：跑完測試後 `git status` 乾淨。
- [ ] **1.6 冒煙測試：首頁打得開**
  - 內容：`e2e/smoke.spec.ts`，開 `/`，斷言頁面骨架有渲染出來（用可及性選取器，例如站名或主要地標）。此時 API 沒起來，資料區塊出錯是預期的，**不要斷言資料**。
  - 驗收：`pnpm --filter @ledger/web test:e2e` 綠。這一關證明 Vite 起得來、bundle 載得進瀏覽器——也就是白屏那一類問題的守門員。

---

## Step 2：API 伺服器與測試資料庫

- [ ] **2.1 `globalSetup` 跑 migration**
  - 內容：載入 `apps/api/.env.test`（載不到就用 `process.env`），執行 `prisma migrate deploy`。做法對齊 `apps/api/test/global-setup.ts`。
  - 驗收：對一個空的 `ledger_test` 跑，資料表會被建出來。
- [ ] **2.2 `webServer` 加上 API**
  - 內容：加第二個 `webServer`，指令 `pnpm --filter @ledger/api start`，埠 3100，就緒判定等 `GET /docs`（P1，寫註解說明為什麼不是 `/`）。注入 `DATABASE_URL`、`JWT_SECRET`、`PORT=3100`、`CORS_ORIGIN=http://localhost:5273`、`NODE_ENV=test`。
  - 驗收：測試啟動時兩個伺服器都起來；測試結束兩個都關掉，埠沒被占住。
  - 風險：Windows 上可能殺不乾淨（Plan §6）。若發生，改成不透過 pnpm 直接呼叫底層指令，**並回報**。
- [ ] **2.3 `e2e/db.ts` 動態清空**
  - 內容：用 `pg` 連 `DATABASE_URL`。查 `pg_tables`（`schemaname = 'public'`，排除 `_prisma_migrations`），一次 `TRUNCATE ... RESTART IDENTITY CASCADE`。
  - 驗收：手動塞資料後呼叫它，資料表全空；且**不會**動到開發資料庫（SC-E4）。
- [ ] **2.4 改 api 的 `resetDb`**（**Ask first**）
  - 內容：`apps/api/test/e2e-utils.ts` 改用同一套動態查詢。刪掉寫死的資料表清單與那段「新增資料表時務必補進清單」的警告註解——那個坑不再存在。
  - 驗收：`pnpm --filter @ledger/api test:e2e` 全綠（SC-E5）。
- [ ] **2.5 冒煙測試升級**
  - 內容：擴充 1.6，改成打得到後端才算過（例如先用 API 註冊帳號，再確認登入頁 / 首頁行為符合預期）。
  - 驗收：`test:e2e` 綠，且把 API 的埠改錯會讓它紅。

---

## Step 3：測試輔助與 fixture

- [ ] **3.1 `e2e/api.ts`**
  - 內容：打 `http://localhost:3100/api` 的輔助函式——註冊、登入、建帳本（含 `kind` 與 `tracksBalance`）、加成員、記交易、取帳戶。用 Playwright 的 `request` API，不另外裝 HTTP 套件。
  - 驗收：每個函式都有明確回傳型別，`typecheck` 綠。
- [ ] **3.2 `e2e/fixtures.ts`**
  - 內容：擴充 Playwright 的 `test`，提供：每個測試前自動清資料庫；`signedInPage`——透過 API 註冊並登入，把 token 寫進 `localStorage` 再開頁面（不走畫面登入）。
  - 驗收：兩個測試連續跑，後面那個看不到前面留下的資料。
- [ ] **3.3 兩個 context 各自獨立**
  - 內容：確認 P3 的做法可行——同一測試內兩個 `newContext()`，各自登入不同帳號。
  - 驗收：一個測試裡 A 與 B 同時登入，兩邊看到的帳本清單不同。

---

## Step 4：六個情境

- [ ] **4.0 先確認 409 的畫面**（P5）
  - 內容：讀前端刪除帳本的錯誤處理，確認 409 時真的有「去封存」的引導，並記下實際措辭。
  - 驗收：找到那段文字並寫進 4.6 的斷言。**若發現沒有，停下來說明，不要順手改產品程式碼。**
- [ ] **4.1 情境 1：不連動帳本沒有帳戶欄位**
  - 內容：建立「出遊分帳」（`SHARED`、不連動）→ 切過去 → 記帳表單沒有帳戶欄位 → 送出成功。
  - 驗收：斷言帳戶欄位不存在、交易出現在列表（SC-16）。
- [ ] **4.2 情境 2：切回個人帳本，餘額會動**
  - 內容：切回個人帳本 → 帳戶欄位回來 → 記一筆 → 餘額變動正確。
  - 驗收：斷言記帳前後的餘額差額等於金額（SC-14、SC-18）。
- [ ] **4.3 情境 3：成員加入與改角色**
  - 內容：A 把 B 加為成員 → 改角色 → B 的帳本清單看得到那本。
  - 驗收：兩個 context 各自斷言（SC-8）。
- [ ] **4.4 情境 4：非 owner 看不到管理操作**
  - 內容：B 開帳本明細頁。
  - 驗收：斷言加成員 / 移除成員 / 刪除帳本的操作都不存在。**同時註明這是體驗不是授權**，真正的防線在後端（Slice 2 的 D7）。
- [ ] **4.5 情境 5：封存**
  - 內容：封存帳本 → 它從切換器消失 → 開「顯示已封存」才看得到。
  - 驗收：斷言切換器選項的變化（SC-17）。
- [ ] **4.6 情境 6：刪除的兩道關卡**
  - 內容：先用 API 讓 B 在共享帳本記一筆交易（P4）。再由 A 嘗試刪除：打錯確認字串時按鈕不能按；打對之後後端回 409，畫面顯示 4.0 記下的引導。
  - 驗收：兩段都斷言到（SC-7）。

---

## Step 5：證明這套測試真的有效

- [ ] **5.1 SC-E6 實驗**
  - 內容：暫時拿掉 `apps/web/vite.config.ts` 的 `optimizeDeps.include`，跑 `test:e2e`。
  - 驗收：**測試必須紅**。紅了才代表它抓得到白屏那一類問題。驗完把設定改回來，並在 todo 記下實際的錯誤訊息。
  - 若它竟然是綠的：代表冒煙測試斷言得太淺，回頭補強 1.6，不要跳過這一關。
- [ ] **5.2 重複性**
  - 內容：連續跑三次 `test:e2e`。
  - 驗收：三次都綠，中間不手動清資料庫（SC-E3）。

---

## Step 6：CI（**動工前另行確認**）

- [ ] **6.1 既有步驟改名**
  - 內容：`E2E test` 改成 `API E2E (supertest)`。
  - 驗收：workflow 語法正確。
- [ ] **6.2 瀏覽器快取與安裝**
  - 內容：`actions/cache` 快取 `~/.cache/ms-playwright`，key 掛 lockfile 的 hash；接著 `playwright install --with-deps chromium`。
  - 驗收：第二次之後的 PR 看得到 cache hit（SC-E9）。
- [ ] **6.3 新增 Playwright 步驟**
  - 內容：`Web E2E (Playwright)`，注入 `DATABASE_URL`、`JWT_SECRET`。失敗時上傳 `playwright-report/`（`if: failure()`）。
  - 驗收：CI 全綠。

---

## Step 7：收尾與驗收

- [ ] **7.1 全套指令綠**
  - 驗收：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm format:check` 全綠，且 `pnpm test` 沒有跑到 Playwright（SC-E8）。
- [ ] **7.2 README**
  - 內容：補「怎麼跑 e2e」與**兩套 e2e 不可同時跑**的警告。
  - 驗收：照著 README 從零跑得起來。
- [ ] **7.3 回寫文件**
  - 內容：`docs/specs/phase-2-web-mvp.md` §9 技術債表把 Playwright 那列標記完成；spec 與 plan 的偏離處回寫。
  - 驗收：文件與程式碼一致。
- [ ] **7.4 PR**
  - 內容：草擬 PR 標題與描述（Markdown 區塊，依 `.github/pull_request_template.md`）。標題 `test(web): add playwright end-to-end tests for the ledger flows`。
  - 驗收：CI 全綠後由開發者 squash merge。
