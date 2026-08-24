# Spec：階段二 (2e) — Web 端對端測試（Playwright）

> 狀態：**已實作**（核可並完成於 2026-08-24）。與本文的差異記在 §11。
> 依據：2b Slice 2 收尾時的定案，見 `docs/specs/phase-2-web-mvp.md` §9 技術債表。
> 定位：**測試基礎建設**，不新增任何產品功能。自成一個 PR，不併入功能 slice。
> 執行順序：2b Slice 2（已完成，PR #28）→ **本步** → 2b Slice 3。

---

## 1. 目標與成功樣貌

讓「真的用瀏覽器打開網站、真的打到後端 API」這件事變成每個 PR 都會自動跑一次的檢查。

現況是 `apps/web` 的所有測試都 mock 掉 `fetch`。畫面邏輯測得很細，但只要問題出在「兩個行程之間」，一個都抓不到。這已經咬過三次：

1. CORS 沒設好，瀏覽器擋掉所有請求。
2. `@ledger/shared` 沒重新建置，型別與執行期不一致。
3. `@ledger/shared` 的 CJS 產物在瀏覽器載入失敗，**整頁全白**。

第三次最值得記著：當時 `pnpm lint`、`typecheck`、`test`、`build` **全部是綠的**。任何不開瀏覽器的檢查都救不了。

成功的樣子：`pnpm --filter @ledger/web test:e2e` 會啟動 API 與 web 兩個伺服器、開 Chromium、用兩個真實帳號走完 Slice 2 的六個情境，全綠。CI 每個 PR 自動跑同一套。

### 範圍內

- 引入 `@playwright/test`，設定檔與目錄慣例。
- 自動啟動 API 與 web 兩個伺服器，測試結束自動關掉。
- 測試資料策略：每個測試前清空測試資料庫，資料一律打真實 API 建立。
- 把 `apps/api/test/e2e-utils.ts` 的 `resetDb` 從「固定資料表清單」改成動態查詢（D2）。
- 自動化 `tasks/phase-2b-slice-2-plan.md` §7 的六個情境。
- CI 新增 Playwright 步驟與瀏覽器快取。
- 工具鏈涵蓋新目錄：tsconfig、ESLint、Prettier。

### 範圍外

- **build 產物的執行期驗證**。本步只測 dev server，理由與代價見 D1。
- **跨瀏覽器**。只跑 Chromium，見 D5。
- **視覺回歸測試**（screenshot diff）。畫面還在大改，現在釘住只會製造雜訊。
- **行動裝置視窗尺寸**。RWD 尚未是本階段的成功條件。
- **Slice 0 與 Slice 1 的情境**（註冊登入、帳戶管理）。本步先把地基與六個情境做完；補齊其他 slice 屬後續。
- **取代既有的 Vitest 元件測試**。兩者分工不同，元件測試繼續是主力。

---

## 2. 已定案的決策

### D1：測 dev server，不測 build 產物

`vite preview` 跑的是建置產物，比較接近正式環境。但 **`optimizeDeps.include` 是 dev server 專屬的設定**——修好整頁全白的那一行就在那裡。也就是說，如果用 `preview` 測，白屏那次**還是抓不到**。

選 dev server 的理由：

- 三次事故都發生在 dev server。
- 那是開發者每天實際在用的東西，壞掉的成本最高。
- CI 已經跑 `pnpm build`，建置本身失敗仍然攔得住。

**接受的代價**：建置產物的執行期問題測不到（例如只在 Rollup 打包後才出現的 CJS 問題）。這是已知缺口，記在 §8。

### D2：清資料改成動態查詢資料表

`apps/api/test/e2e-utils.ts` 的 `resetDb` 目前寫死一份資料表清單。那個檔案自己的註解就警告過：漏掉新資料表的症狀是「單獨跑會過，整套跑才爛」。

再抄一份到 Playwright 這邊，就是兩份會各自漂移的清單。改成查 `pg_tables` 動態列出所有資料表（排除 `_prisma_migrations`），兩邊都不必再維護清單。

**順帶修改 api 既有的 `resetDb`**——這超出 Playwright 本身的範圍，但留著一份寫死清單就等於沒解決問題。

`resetDb` 的實作在兩邊各留一份（約 10 行）。這次可以接受重複：重複的是「查出所有資料表再清空」這個固定邏輯，不會隨 schema 漂移。抽成共用套件的成本此刻不划算。**不放進 `packages/shared`**——那個套件要能被瀏覽器載入，塞資料庫程式碼進去會污染前端 bundle。

### D3：測試資料一律打真實 API 建立

除了「清空資料庫」以外，不直接寫資料庫。帳號、帳本、成員、交易都透過 `POST /api/auth/register` 等真實端點建立。

理由：直接塞資料庫會繞過驗證與業務規則，測出來的狀態可能是產品根本走不到的。而且 seed 程式碼會跟著 schema 一起腐爛。

### D4：測試序列執行

`workers: 1`、`fullyParallel: false`。所有測試共用同一個資料庫，而每個測試前要清空它。平行跑必定互相汙染。

六個情境的執行時間可接受。真的變慢再考慮「每個 worker 一個資料庫」，現在不做。

### D5：只跑 Chromium

跨瀏覽器差異是另一個議題，CI 時間乘三、瀏覽器下載量乘三，換到的資訊有限。要加再加。

### D6：專用埠號，不搶開發者的 dev server

測試用的伺服器固定跑在 **API 3100 / web 5273**，不是平常的 3000 / 5173。

理由：開發者手邊很可能正開著 dev server。用同樣的埠號會導致「測試莫名其妙連到你手動改過的環境」或直接搶不到埠。

`CORS_ORIGIN` 要跟著設成 `http://localhost:5273`，否則瀏覽器會擋掉全部請求——這正是事故一。

### D7：CI 接在現有 job 之後，不另開 job

現有的 `ci` job 已經跑完 install、`prisma generate`、build，也已經有 postgres service。另開 job 要把這些全部再做一次。

**接受的代價**：Playwright 失敗時，整個 job 是紅的，要看步驟名稱才知道是哪一類測試爛掉。步驟命名要能自我說明（見 §6）。

### D8：不重試

`retries: 0`。重試會把不穩定的測試藏起來，變成偶爾紅一次、大家習慣重跑。這個專案規模小，不穩定就當成 bug 修掉。

---

## 3. 可驗證的成功條件

- **SC-E1**：`pnpm --filter @ledger/web test:e2e` 在乾淨的環境下可執行，自動啟動並關閉兩個伺服器，不需要人工先開任何東西。
- **SC-E2**：六個情境（§7）全部自動化並通過。
- **SC-E3**：測試序列執行，重複跑三次結果一致，不需手動清資料庫。
- **SC-E4**：測試只清空 `ledger_test`，不會碰到開發資料庫。
- **SC-E5**：`apps/api/test/e2e-utils.ts` 的 `resetDb` 不再有寫死的資料表清單，且 api 既有 e2e 全綠。
- **SC-E6**：把 `apps/web/vite.config.ts` 的 `optimizeDeps.include` 拿掉之後，e2e **會失敗**——證明它真的抓得到白屏那一類問題。（這條是驗證用的手動實驗，驗完把設定改回來。）
- **SC-E7**：`pnpm lint`、`pnpm typecheck`、`pnpm format:check` 涵蓋新的 `e2e/` 目錄且全綠。
- **SC-E8**：`pnpm test` **不會**跑到 Playwright（它仍然只跑 Vitest 與 Jest）。
- **SC-E9**：CI 通過，且瀏覽器下載有命中快取（第二次之後的 PR 看得到 cache hit）。

---

## 4. 技術設計

### 目錄與檔案

```
apps/web/
├── e2e/
│   ├── env.ts               # 埠號、位址、載入 .env.test（設定檔與測試共用）
│   ├── global-setup.ts      # 開跑前套用 migration
│   ├── fixtures.ts          # Playwright fixture：清資料庫、建帳號、登入
│   ├── db.ts                # 動態 TRUNCATE（D2）
│   ├── api.ts               # 打真實 API 的輔助函式（註冊、建帳本、記交易）
│   ├── smoke.spec.ts        # 首頁載得起來、帳號登得進去
│   └── ledgers.spec.ts      # §7 的六個情境
├── playwright.config.ts
└── tsconfig.e2e.json
```

放在 `apps/web/` 之下，與它測的 app 同一層。指令沿用 api 的命名：`test:e2e`。

### 伺服器啟動

用 Playwright 的 `webServer` 設定，它支援陣列，會等到伺服器就緒才開始測，結束時自動關閉。

| 伺服器 | 指令                              | 埠   | 注入的環境變數                                                                                  |
| ------ | --------------------------------- | ---- | ----------------------------------------------------------------------------------------------- |
| API    | `pnpm --filter @ledger/api start` | 3100 | `DATABASE_URL`、`JWT_SECRET`、`PORT=3100`、`CORS_ORIGIN=http://localhost:5273`、`NODE_ENV=test` |
| Web    | `pnpm --filter @ledger/web dev`   | 5273 | `VITE_API_BASE_URL=http://localhost:3100/api`                                                   |

API 用 `start`（`nest start`，會先編譯）而不是 `start:prod`（`node dist/main`）。`start:prod` 要求先跑過 `pnpm build`，本機忘記就會拿到過期的產物，是很難認的坑。代價是 CI 多編譯一次 api，約十幾秒。

`NODE_ENV=test` 會讓 ThrottlerModule 停用限流——測試會密集打 auth 端點，不關掉會被擋。這與 api 現有 e2e 的做法一致。

`reuseExistingServer: !process.env.CI`：本機重跑時沿用已啟動的伺服器，快很多；CI 一律重開。

### 環境變數來源

`playwright.config.ts` 先嘗試載入 `apps/api/.env.test`（本機用，已被 git ignore），載不到就用 `process.env`（CI 用）。這與 `apps/api/test/global-setup.ts` 是同一套做法。

**不新增任何要開發者填的變數。** 上表那些值由設定檔直接注入。

### Migration

Playwright 的 `globalSetup` 執行 `prisma migrate deploy`，與 api e2e 一樣。跑在 API 伺服器啟動之前。

### 清資料

新增 `pg` 與 `@types/pg` 作為 `apps/web` 的 devDependency，用原生 SQL 清空。

**為什麼不用 `@prisma/client`**：產生出來的 client 綁在 api 的 schema 與 api 的 `node_modules`，從 web 匯入會拿到未產生的空殼。清資料只是一行 SQL，不需要 ORM。

清法：

```sql
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND tablename <> '_prisma_migrations';
```

再對查到的資料表一次 `TRUNCATE ... RESTART IDENTITY CASCADE`。

`apps/api/test/e2e-utils.ts` 的 `resetDb` 改用同一套查詢（D2），寫死的清單與那段警告註解一併刪除。

### 測試資料

每個測試前清空資料庫，所以可以用固定的 email：`a@example.com`（帳號 A，帳本 owner）與 `b@example.com`（帳號 B，被邀請的成員）。

fixture 提供「已登入的頁面」——透過 API 註冊並登入，把 token 寫進 `localStorage`，再開頁面。**不走畫面登入**：登入流程本身由 Slice 0 的元件測試覆蓋，每個 e2e 都重跑一次只是浪費時間。

---

## 5. 對專案結構與工具鏈的影響

| 項目           | 變更                                                                                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新增相依       | `apps/web` devDependency：`@playwright/test`、`pg`、`@types/pg`、`@types/node`（`@types/node` 是實作時才發現的必要項，見 §11）                                              |
| `package.json` | `apps/web` 新增 `test:e2e`。`test` 維持 `vitest run` 不變（SC-E8）                                                                                                          |
| tsconfig       | 新增 `apps/web/tsconfig.e2e.json`，涵蓋 `e2e/` 與 `playwright.config.ts`，並掛進 `tsconfig.json` 的 references（**2026-08-24 修正，原本寫「不加進」，理由見 §11 第 2 條**） |
| build          | `build` script 改成 `tsc -b tsconfig.app.json tsconfig.node.json`，明確指定要建的 project。**`pnpm build` 因此仍然不碰 e2e**——測試檔壞掉不該讓產品建置失敗                  |
| typecheck      | `apps/web` 的 typecheck 改成同時檢查 app 與 e2e 兩個 project                                                                                                                |
| ESLint         | lint 的檔案範圍加上 `e2e/**/*.ts` 與 `playwright.config.ts`；新增一個設定區塊給這些檔案掛 `globals.node`（它們跑在 Node，不是瀏覽器）。該區塊另關掉兩條規則，見 §11         |
| Vitest         | `vite.config.ts` 加 `test.exclude` 排除 `e2e/**`——否則 Vitest 會撿走 Playwright 的 `*.spec.ts`（SC-E8）                                                                     |
| Prettier       | 不需改設定，`prettier --check .` 本來就涵蓋全部                                                                                                                             |
| `.gitignore`   | 加 `apps/web/test-results/`、`apps/web/playwright-report/`                                                                                                                  |

---

## 6. CI 變更（已核可並實作）

在現有 `ci` job 的 `Build` 之後、`E2E test` 附近插入，並把既有步驟改名以區分兩種 e2e：

| 順序 | 步驟名稱                    | 內容                                                                     |
| ---- | --------------------------- | ------------------------------------------------------------------------ |
| 既有 | `API E2E (supertest)`       | 原本叫 `E2E test`，只改名                                                |
| 新增 | `Cache Playwright browsers` | `actions/cache`，路徑 `~/.cache/ms-playwright`，key 掛 lockfile 的 hash  |
| 新增 | `Install Chromium`          | `pnpm --filter @ledger/web exec playwright install --with-deps chromium` |
| 新增 | `Web E2E (Playwright)`      | `pnpm --filter @ledger/web test:e2e`，注入 `DATABASE_URL`、`JWT_SECRET`  |

兩種 e2e 共用同一個 `ledger_test` 資料庫，但 CI 是序列步驟，不會互相干擾。**本機不要同時跑這兩套。**

失敗時要看得到證據：失敗才上傳 `playwright-report/`（`if: failure()`）。

---

## 7. 測試情境（對應 Plan §7）

| #   | 情境                                                                     | 對應成功條件 |
| --- | ------------------------------------------------------------------------ | ------------ |
| 1   | 建立「出遊分帳」（不連動）→ 切過去 → 記帳表單**沒有帳戶欄位** → 送出成功 | SC-16        |
| 2   | 切回個人帳本 → 帳戶欄位回來 → 餘額正確變動                               | SC-14、SC-18 |
| 3   | 帳號 B 被加為成員 → 改角色 → B 看得到該帳本                              | SC-8         |
| 4   | 非 owner 看不到成員管理的操作                                            | SC-8         |
| 5   | 封存 → 帳本從切換器消失 → 開啟「顯示已封存」才看得到                     | SC-17        |
| 6   | 刪除帳本：confirm 字串不符被擋；有別人的交易時回 409 並引導去封存        | SC-7         |

第 6 條要先讓**帳號 B 在共享帳本記一筆交易**，否則後端不會回 409，那條分支根本走不到。這是六條裡唯一需要額外前置資料的。

第 3、4 條需要兩個瀏覽器 context（各自的 `localStorage`），Playwright 原生支援。

---

## 8. 已知缺口（刻意接受）

| 缺口                            | 為什麼接受                                       | 補救時機         |
| ------------------------------- | ------------------------------------------------ | ---------------- |
| build 產物不測（D1）            | 測 dev server 才抓得到已經發生過三次的那一類問題 | 上線前另評估     |
| 只有 Chromium（D5）             | CI 成本乘三，換到的資訊有限                      | 有跨瀏覽器需求時 |
| 只涵蓋 Slice 2 的情境           | 先把地基做完；補其他 slice 是後續的小工          | 各 slice 收尾時  |
| 無視覺回歸測試                  | 畫面還在大改，現在釘住只會製造雜訊               | 畫面定型後       |
| CI 失敗時看不出是哪類 e2e（D7） | 靠步驟命名區分，成本比另開 job 低                | 覺得痛的時候     |

---

## 9. 界線（Always / Ask first / Never）

### Always

- 測試資料透過真實 API 建立（D3）。
- 每個測試前清空資料庫，測試之間不共享狀態。
- 新增測試時同步確認它在序列執行下可重複跑。

### Ask first

- 安裝 `@playwright/test`、`pg`、`@types/pg`。
- 修改 `.github/workflows/ci.yml`（§6）。
- 修改 `apps/api/test/e2e-utils.ts` 的 `resetDb`（D2，動到既有測試工具）。
- 為了讓測試好寫而修改產品程式碼（例如加 `data-testid`）——可以做，但要先說。

### Never

- 連到開發資料庫。測試只認 `.env.test` / CI 注入的 `DATABASE_URL`。
- 把真實帳號、真實 email、真實密碼寫進測試。
- 直接寫資料庫來建立業務資料（清空是唯一例外）。
- 把 Playwright 併進 `pnpm test`。
- 用 `retries` 掩蓋不穩定的測試（D8）。

---

## 10. Step 拆分概觀（核可後寫入 `tasks/`）

1. **裝套件與最小設定**：`@playwright/test`、`playwright.config.ts`、tsconfig / ESLint 涵蓋，一個「打得開首頁」的冒煙測試。驗收：`test:e2e` 綠，`lint` / `typecheck` / `format:check` 綠。
2. **兩個伺服器與資料庫**：`webServer` 陣列、`globalSetup` 跑 migration、`db.ts` 動態清空、順手改 api 的 `resetDb`。驗收：測試能登入並看到真實資料。
3. **fixture 與 API 輔助函式**：註冊、登入、建帳本、記交易。驗收：兩個帳號的 context 各自獨立。
4. **六個情境**：§7 逐條實作。驗收：SC-E2、SC-E3。
5. **驗證真的有效**：SC-E6 的實驗——拿掉 `optimizeDeps.include`，確認 e2e 會紅。
6. **CI**：§6 的步驟與快取。**動工前另行確認。** 驗收：SC-E9。

> 每個 Step 仍遵守門控：開工前說明、等同意；完成後展示與驗收再進下一步。

---

## 11. 實作結果與與本文的偏離（2026-08-24）

八條測試：兩條冒煙（`smoke.spec.ts`）＋ §7 的六個情境（`ledgers.spec.ts`）。本機一輪約 15 秒。

### 成功條件的驗證結果

| 條件  | 結果                                                                                         |
| ----- | -------------------------------------------------------------------------------------------- |
| SC-E1 | ✅ 不必先手動開任何伺服器                                                                    |
| SC-E2 | ✅ 六個情境全綠                                                                              |
| SC-E3 | ✅ 連跑三次結果一致                                                                          |
| SC-E4 | ✅ 另加一道保險絲：資料庫名稱不以 `_test` 結尾就拒絕清空                                     |
| SC-E5 | ✅ api e2e 38 條全綠                                                                         |
| SC-E6 | ✅ 拿掉 `optimizeDeps.include` 後冒煙測試變紅：找不到 h1「記帳系統」，整頁沒渲染。驗完已改回 |
| SC-E7 | ✅                                                                                           |
| SC-E8 | ✅ `pnpm test` 只跑 Vitest 與 Jest                                                           |
| SC-E9 | 待 PR 上 CI 後確認                                                                           |

### 偏離與補充

| #   | 事項                                                                                                                                     | 為什麼                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 多裝 `@types/node`（`apps/web` devDependency）                                                                                           | `e2e/` 要用 `process.env`，`@types/pg` 的型別也依賴它。types-only，不進任何 bundle                                                                                                                                                                                                                                                                                                                                    |
| 2   | **`tsconfig.e2e.json` 改為掛進 `tsconfig.json` 的 references**，並把 `build` script 綁定成 `tsc -b tsconfig.app.json tsconfig.node.json` | 原本照 §5 不掛，代價是**沒有任何工具找得到這個 project**：ESLint 報 `not found by the project service`，編輯器則退回一組預設設定，`e2e/env.ts` 出現五、六條假紅字（找不到 `node:fs`、`import.meta` 不允許、`process` 未定義），而 CLI 全綠。一開始只用 ESLint 的 `project` 選項繞過，治了 lint 沒治編輯器。改掛 references 一次治好兩邊；`pnpm build` 的範圍靠綁定 script 維持不變，§5 那條規定的**用意**因此完全保留 |
| 3   | e2e 區塊另關 `react-hooks/rules-of-hooks` 與 `no-empty-pattern`                                                                          | 前者把 Playwright fixture 的 `use` 參數誤判成 React 的 `use()` hook；後者擋掉 Playwright 慣用的 `async ({}, use)`。e2e 目錄裡沒有 React 程式碼                                                                                                                                                                                                                                                                        |
| 4   | `vite.config.ts` 加 `test.exclude` 排除 `e2e/**`                                                                                         | Vitest 預設會撿走所有 `*.spec.ts`，撿到 Playwright 的就爆掉（SC-E8）                                                                                                                                                                                                                                                                                                                                                  |
| 5   | 多一個 `e2e/env.ts`                                                                                                                      | 埠號與 `.env.test` 的載入同時被設定檔與測試使用。放設定檔裡的話，測試要反過來匯入設定檔                                                                                                                                                                                                                                                                                                                               |
| 6   | 讀 `.env.test` 用 Node 內建的 `process.loadEnvFile`，不裝 dotenv                                                                         | 專案要求 Node 22，內建可用。少一個相依                                                                                                                                                                                                                                                                                                                                                                                |
| 7   | `globalSetup` 的 migration 實際上在兩個伺服器啟動**之後**才跑（Playwright 的順序），不是 §4 寫的「之前」                                 | 不影響：Prisma 是查詢時才連線，而 migration 一定在第一條測試之前完成                                                                                                                                                                                                                                                                                                                                                  |
| 8   | 情境 5 多建一本帳本（「社團公款」）                                                                                                      | 封存後若只剩一本，`LedgerSwitcher` 會從下拉變成一段文字。多一本才問得出「選項少了那一本」                                                                                                                                                                                                                                                                                                                             |

### 沒有發生的風險

- **Windows 殺不掉子行程**（Plan §6 的頭號風險）：沒有發生。測試結束後 3100 與 5273 都沒有殘留，不需要繞過 pnpm。
- **需要 `data-testid`**（P2）：沒有發生。六個情境全部用 `getByRole` / `getByLabel` / `getByText` 選得到，**產品程式碼一行都沒改**。

### 已知但不處理

`apps/api` 跑 e2e 時會印 `pg` 的 `DeprecationWarning: Calling client.query() when the client is already executing a query`。這在改 `resetDb` **之前就存在**（已用 `git stash` 比對確認），與本步無關。屬 `@prisma/adapter-pg` 的行為，另案處理。
