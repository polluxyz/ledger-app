# 4a 補充實作計畫：AI 先挑現有分類，沒有才提議新分類

spec：`docs/specs/phase-4a-ai-new-category.md`（決策 280～291、W240～W244、SC-P13～SC-P17）。後端、畫面、e2e 合成一個 PR。

> 核可：開發者 2026-10-24 核可（含 spec §10 的 5 項）。假設 1～11 已於 2026-10-24 核可；`advisor` 的意見已併入 spec。

## 0. 起點

- 先開 docs PR（本 spec、plan、todo、4a spec 的加註、交接檔），合進 `main`。
- 整合分支 `feature/ai-new-category`，從合併後的 `main` 開，用 `ai-4a` worktree，測試資料庫 `ledger_ai_test`。只有這個 session 寫這條分支。
- worker 各開自己的 worktree，從整合分支開子分支 `feature/ainc-<名>`，驗收後 merge 回整合分支。
- 角色：寫入 API（交易、併發、原子）派 `backend`；解析與提示詞派 `default`；網頁只派 Codex。模型看 `docs/orca-multi-agent.md` §0。
- **不改 schema，沒有 migration**。會改 API（spec §4）。

## 1. 元件與相依

### 1.1 協調者自己做（T0：契約與隔離測試）

- `packages/shared/src/types/ai.ts`：
  - `TransactionDraft` 加 `newCategoryName: string | null`。
  - `isDraftComplete`：支出／收入改成 `categoryId !== null || newCategoryName !== null`。轉帳不變。
  - 單元測試加：有提議、沒有分類 → 完整；兩者都沒有 → 不完整；轉帳帶提議不影響轉帳規則。
- `packages/shared` 的 `CreateTransactionRequest` 加 `newCategoryName?: string`，註解寫「和 `categoryId` 恰好填一個」。
- 常數 `CATEGORY_NAME_MAX_LENGTH`（50）：先查 shared 有沒有，沒有就加，新增分類的 DTO 和這次共用。
- 跑 `pnpm --filter @ledger/shared build`。
- 隔離測試 `apps/api/test/transactions-new-category-isolation.e2e-spec.ts`，先看到紅燈：
  - SC-P15：別人的帳本 404、檢視者 403、封存 409。每條配正向對照（編輯者 201），並斷言被拒絕時那本帳本的分類數不變。
  - SC-P14 第 4 項：帳戶不合法 → 400，分類數不變。個人與共享帳本各一條。

### 1.2 後端 A：寫入 API（T1，`backend`）

只依賴 T0。

**DTO**（`apps/api/src/transactions/dto/create-transaction.dto.ts`）：

- 加 `newCategoryName?: string`：`@IsOptional() @IsString()`，先 trim 再檢查 1～50 字（`@Transform` 或 service 裡檢查都可，但 400 的訊息要一致）。
- 「恰好一個」「轉帳不能帶」放 service 的 `assertCategoryRules` 裡檢查，因為要看 `type`。

**分類的取得或建立**（`apps/api/src/categories/categories.service.ts`）：

- 加 `findOrCreateByName(tx, ledgerId, type, name)`，回傳分類 id。
- 做法：`tx.category.createMany({ data: [...], skipDuplicates: true })`，再用唯一鍵 `ledgerId_type_name` 讀回來。
  - `skipDuplicates` 在 PostgreSQL 是 `ON CONFLICT DO NOTHING`。同名已存在時不報錯，不會讓資料庫交易中止。
  - 不能用 `create` 加 `catch P2002`。PostgreSQL 的資料庫交易遇到錯誤後就不能再下指令。
  - 併發時，後到的 `INSERT` 會等先到的資料庫交易結束，再決定略過。讀回時看得到對方已提交的那一列。
- `nextSortOrder` 改成接受 client 參數（預設 `this.prisma`），讓它在資料庫交易裡算。兩個併發請求可能算到同一個 `sortOrder`，但只會有一個成功建立，所以沒關係。
- 名稱比對用 trim 後的完整字串，區分大小寫，同既有唯一鍵。

**新增交易**（`apps/api/src/transactions/transactions.service.ts:379` 的 `create`）：

- 共享帳本的收支路徑已經在 `$transaction` 裡（`:394`）。把 `:416` 的 `assertCategoryRules` 換成「檢查並決定分類 id」，用 `tx`。
- 其他路徑（個人帳本、共享帳本的轉帳）目前沒有外層資料庫交易（`:440`～`:458`）。帶 `newCategoryName` 時要包進 `$transaction`：
  - 先檢查帳戶（`assertAccountRules`），再取得或建立分類，最後建交易。
  - 帳戶檢查會失敗的話，要在建分類前失敗，或在同一個資料庫交易裡失敗。兩種都能讓分類不留下來；選後者比較單純，整段包起來。
  - 不帶 `newCategoryName` 的請求行為不變。可以一律包進資料庫交易，但要確認既有 e2e 全綠。
- `assertCategoryRules`（`:1424`）改成接受 client 參數，回傳最後的 `categoryId`：
  - 轉帳：`categoryId` 或 `newCategoryName` 有任一個 → 400。
  - 收支：兩個都有或兩個都沒有 → 400。
  - 有 `categoryId` → 照舊檢查（404、型別不符 400）。
  - 有 `newCategoryName` → trim、檢查長度、呼叫 `findOrCreateByName`。
  - 其他呼叫點（`update`、`updateShared`、`updateMerged`、`:1267`、`:1304`）只傳 `categoryId`，行為不變。
- 權限不用改：controller 的 `LedgerAccessGuard` 已經擋了非成員、檢視者與封存帳本。T0 的隔離測試確認擋在建分類之前。

**測試**：

- 單元：`findOrCreateByName` 的既有、新建、併發；`assertCategoryRules` 的 400 規則。
- API e2e（`apps/api/test/transactions-new-category.e2e-spec.ts`）：SC-P14 第 1～5 項。第 5 項用 `Promise.all` 同時送 2 個請求。
- 既有 API e2e 全綠。

### 1.3 後端 B：解析（T2，`default`）

只依賴 T0。可以和 T1 平行。

- `apps/api/src/ai/ai-wire-format.ts`：`AiWireDraft` 加 `newCategory: string | null`；`AI_WIRE_JSON_SCHEMA` 的 `required` 與 `properties` 加這一欄（`maxLength: 50`）。
- `apps/api/src/ai/ai-catalog.ts:55～57` 的提示詞改成決策 280、281：
  - 拿掉「不能新增分類」和「沒有意思相符就用 null，不要硬選相近的」。
  - 改成：先用意思相符或相近的分類；用途不同不算相近。都沒有，但項目歸得進一個類別 → `category` 用 `null`，`newCategory` 填類別名稱（和現有分類同一層級，不是品項）。真的歸納不了 → 用「其他」；沒有「其他」→ 兩者都 `null`。轉帳兩者都 `null`。
  - 「不能新增帳本或帳戶」保留。
- `apps/api/src/ai/ai-draft-validation.ts`：依決策 283 的 (a)～(e) 產出 `newCategoryName`。同名轉換要用分類清單（同帳本、同型別、完整名稱）。
- `apps/api/src/ai/fake-llm.provider.ts`：加劇本，對應 spec §1 第 2、5、6 步（衛生紙、旅行基金機票、洗碗精與垃圾袋）。
- 測試：`ai-draft-validation.spec.ts` 加 SC-P13；`apps/api/test/ai-parse.e2e-spec.ts` 加假 provider 的對應句子；4a 的 SC-P6 改成新的期待值。

### 1.4 畫面（T3，Codex）

依賴 T0。可以和 T1、T2 平行，用 shared 型別寫，e2e 等 T1、T2 合進來再跑。

- `apps/web/src/features/ai/AiDraftList.tsx`：分類欄有 `newCategoryName` 時顯示虛線框的「＋名稱」（W240）。`aria-label` 寫「變更分類：名稱，確認時新增」。
- ✓ 與「全部確認」的請求帶 `newCategoryName`（W242）。請求組裝在 `apps/web/src/pages/TransactionsPage.tsx:293` 的 `draftRequest`。
- `apps/web/src/features/transactions/TransactionForm.tsx`（draft 模式，約 `:505`）：分類選單在最後加「＋名稱」選項並預選（W243）。改選現有分類 → 送 `categoryId`；留在「＋名稱」→ 送 `newCategoryName`。
- 寫入成功後讓那本帳本的分類查詢失效（W244）。沿用現有的 query key。
- 元件測試：W240～W244，含「改選現有分類就不送 `newCategoryName`」。

### 1.5 Web e2e（T4，Codex）

依賴 T1、T2、T3。

- `apps/web/e2e/ai-draft.spec.ts` 加：
  1. 衛生紙 → 看到「＋日用品」→ 按 ✓ → 分類頁有「日用品」、明細有這筆。
  2. 洗碗精與垃圾袋 → 「全部確認」→ 只有 1 個「日用品」、2 筆交易。
  3. 點「＋日用品」草稿 → 表單改選「其他」→ 新增 → 沒有「日用品」。
- Playwright 明設 `LLM_PROVIDER=fake`。跑之前確認埠沒被別的 worktree 占用。

### 1.6 整合、文件、PR、部署（T5，協調者）

- merge 各子分支；隔離測試紅轉綠。
- 全部檢查：`pnpm lint / typecheck / test / build / format:check`，API e2e、兩套 Web e2e。
- 文件依 spec §9。
- PR 依模板，CI 全綠，squash merge。
- 部署 dev（主工作區）：沒有 migration。build shared 與 API；請開發者重開 API 與 Vite、按 `Ctrl + Shift + R`。
- 用假 provider 在 dev 走過 spec §1 第 2、3、6、7 步。
- 清掉 worker 的 worktree、分支、終端機。

### 1.7 真的模型（T6，協調者）

- 在主工作區的 dev 環境跑 spec SC-P17：5 句各 3 次，加 4a SC-P10 的第 5、6、8 步各 3 次。
- 記錄：模型、提示詞版本（commit）、每格結果、token 用量、耗時。失敗也照記。
- z.ai 只用到 2026-10-28。來不及就等換模型後跑，並記下用的模型。
- 不合格時：先調提示詞，最多 2 輪。還不合格就停下來報告，不放寬標準。

## 2. 實作順序

1. docs PR 合併。
2. T0（協調者）。
3. T1、T2、T3 平行派出。
4. T1、T2 驗收合併後，派 T4。
5. T5。
6. T6（10-28 前）。

## 3. 風險與對策

| 風險                                                                 | 對策                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 提示詞拿掉「不要硬選相近的」後，模型又把機票歸到住宿（4a T6 出現過） | 提示詞寫明「用途不同不算相近」並舉例；SC-P17 第 4 句專門驗；不合格照 §1.7 處理 |
| 模型把能歸到既有分類的項目也提議新分類（例如高鐵提議「交通運輸」）   | SC-P17 第 1、5 句驗；決策 283 (c) 的同名轉換只能救完全同名的情況               |
| 在資料庫交易裡處理同名衝突，寫錯會讓整個交易中止                     | 用 `createMany skipDuplicates`；SC-P14 第 5 項併發 e2e                         |
| 個人帳本路徑包進資料庫交易，改變既有行為                             | 既有 API e2e 全綠；T1 驗收時逐行看 diff                                        |
| 新分類永遠新增、不合併，帳本裡可能出現「日用品」「生活用品」兩個分類 | 範圍外（spec §1）。提示詞要求先用現有分類，第二次就會用第一次建的              |
| z.ai 只用到 10-28                                                    | T6 排在 10-28 前；來不及就換模型後跑                                           |
| Codex 額度用完                                                       | 依 `docs/orca-multi-agent.md` §4 換層；網頁只等 Codex                          |

## 4. 驗證點

- T0 後：shared build 通過；`isDraftComplete` 測試綠；隔離 e2e 紅。
- T1 後：隔離 e2e 綠；SC-P14 綠；既有 API e2e 全綠。
- T2 後：SC-P13 綠；`ai-parse.e2e-spec.ts` 全綠。
- T3、T4 後：W240～W244 元件測試與 Web e2e 綠。
- T5 後：CI 全綠；dev 手動走過。
- T6 後：SC-P17 的表全對。

## 5. 要開發者決定的事

見 spec §10。

## 6. 派工

| 任務 | worktree／分支                     | 角色      | 依賴       |
| ---- | ---------------------------------- | --------- | ---------- |
| T0   | `ai-4a`／`feature/ai-new-category` | 協調者    | docs PR    |
| T1   | `ainc-api`／`feature/ainc-api`     | `backend` | T0         |
| T2   | `ainc-parse`／`feature/ainc-parse` | `default` | T0         |
| T3   | `ainc-web`／`feature/ainc-web`     | Codex     | T0         |
| T4   | `ainc-e2e`／`feature/ainc-e2e`     | Codex     | T1、T2、T3 |
| T5   | `ai-4a`                            | 協調者    | T1～T4     |
| T6   | 主工作區                           | 協調者    | T5         |

## 7. 實作紀錄

整合分支 `feature/ai-new-category` 的 commit 依序：`ab34d90`（T0 契約）、`da802e3`（T0 隔離 e2e）、`b8b3a16`（T3）、`ee55a00`（T1，cherry-pick 自 `2173b42`）、`0f2e625`（T2，cherry-pick 自 `a537ae1`）。

- **T0**：隔離 e2e 原本斷言回應的 `categoryId`，但 `Transaction` 回的是 `category: {id,name,icon}`，改成斷言 `category.id`。紅燈 5 個，T1 後轉綠。
- **T1**（`backend`）：計畫外多改了 `categories.module.ts`、`transactions.module.ts`，協調者核可。兩個 module 互相引用，Nest 啟動時循環相依，所以 `CategoriesModule` 用 `forwardRef`。錯誤沿用 `VALIDATION_FAILED`，沒加新代碼。DTO 與 service 都用 `Array.from` 算長度，50 個 emoji 的測試通過。worker 回報：新分類 e2e 25/25、API e2e 545/545、API 單元 838。
- **T2**（`default`）：提示詞第 2 行改成「不能新增帳本或帳戶。」，第 3 行是決策 280、281 的規則（高鐵→交通、機票≠住宿、轉帳兩者皆 null）。worker 回報：驗證單元 71/71、AI 解析 e2e 43/43、API 單元 840。
- **T3**（Codex）：表單在共享帳本路徑（`TransactionForm.tsx` 約 1209 行）送 `newCategoryName` 的分支沒有元件測試，只有個人帳本路徑有。T4 的 e2e 也只走個人帳本。留作已知缺口。
- **T4**：plan §6 寫新開 `ainc-e2e`，實際重用 `ainc-web` worktree（已 fast-forward 到 `0f2e625`），省一次 `pnpm install`。第一輪回報阻擋：提議草稿的 ✓ 是灰的。原因是測試資料，不是程式：假 provider 的新句子不帶帳戶，API 用「最近一筆交易的帳戶」補，e2e 新使用者沒有交易，帳戶留空，草稿本來就不完整。改成測試前先用 API 記一筆現金交易。另外 T2 改了「旅行基金 機票 8000 刷卡」的劇本，既有的跨帳本測試從「分類未提供、✓ 灰」改成「＋交通、✓ 可按」，改選機票後再斷言旅行基金沒有多出「交通」。新帳本預設有「交通」，會被決策 283 (c) 換成既有分類，所以這條測試先刪掉旅行基金的「交通」。commit `f6e554a`，fast-forward 進整合分支。worker 回報：`ai-draft.spec.ts` 6/6、Web e2e 79/79。
- **協調者 handle 換過**：上一個 session 的 run 綁舊 handle，所以 T4 起用新的 run `run_8381cfd25ab7`。
- **文件衝突**：docs PR #160 與 #159 改到同一份交接檔，合併前已解掉。
- **整合後協調者重跑**（T1～T3）：API e2e 54 個 suite 548/548、API 單元 850/850、Web 897/897、shared 126；typecheck、lint、format:check 通過。
- **T4 合入後協調者重跑**：Web e2e 79/79（含 CSP）；單元 shared 126、API 850、Web 897；lint、typecheck、build 通過。
- **合併**：#161 squash merge 進 `main`（`73b31db`）。

### T5（部署 dev，2026-10-24）

- 主工作區已在 `73b31db`。重新 build shared 與 API；沒有 migration。開發者的 API 與 Vite 當時都沒在跑。
- 用暫時的 API（埠 3200、`LLM_PROVIDER=fake`，用完關掉）以 a@a.com 在 API 層走 spec §1。畫面層由 T4 的 Web e2e 覆蓋。
  - 第 2 步：「衛生紙 189」→ `categoryId: null`、`newCategoryName: 日用品`，帳戶帶最近一筆交易的帳戶。
  - 第 7 步：同一份草稿改選「其他」送出 → 201，分類「其他」；「test 的帳本」沒有多出「日用品」。
  - 第 3 步：帶 `newCategoryName` 送出 → 201，分類「日用品」，排在支出分類最後（早餐、午餐、日用品）。
  - 第 6 步：「test 的帳本」已有「日用品」時，2 筆草稿都直接是既有分類。在沒有「日用品」的「tttest」照「全部確認」依序送出 → 2 筆 201，只建 1 個「日用品」。
- 走完把 4 筆測試交易軟刪除，避免動到帳戶餘額。「test 的帳本」與「tttest」各留下一個「日用品」分類。
- worker 的 worktree（`ainc-*`）與分支先前已清掉。

### T6（真的模型，2026-10-24）

- 模型 `glm-5.3`，端點 `https://api.z.ai/api/paas/v4`，`GLM_REASONING_EFFORT=low`，逾時 25 秒。提示詞版本＝`73b31db`。
- 量測方式同 4a T6：暫時的 e2e（不進版控，跑完刪掉）對 `ledger_ai_test` 打 `POST /ai/parse-transaction`。資料照 spec §1：「日常」支出分類只有早餐、午餐、交通、其他；旅行基金只有住宿與薪資；帳戶現金、信用卡、儲蓄；記帳預設帳戶是儲蓄；`today`＝2026-10-21。
- 每格驗型別、帳本、金額、日期、分類、`newCategoryName`、帳戶、轉入帳戶，以及 200 且 25 秒內。結果 **24/24**：

| 句子                                      | 第 1 次 | 第 2 次 | 第 3 次 | 實際                       |
| ----------------------------------------- | ------- | ------- | ------- | -------------------------- |
| SC-P17 1「高鐵 1490」                     | 對      | 對      | 對      | 交通                       |
| SC-P17 2「衛生紙 189」                    | 對      | 對      | 對      | ＋日用品                   |
| SC-P17 3「雜支 50」                       | 對      | 對      | 對      | 其他                       |
| SC-P17 4「旅行基金 機票 8000 刷卡」       | 對      | 對      | 對      | 旅行基金、＋交通、信用卡   |
| SC-P17 5「早餐 60 現金、午餐 120 刷卡」   | 對      | 對      | 對      | 早餐／現金、午餐／信用卡   |
| 4a SC-P10 第 5 步「昨天計程車 250」       | 對      | 對      | 對      | 10-20、交通、儲蓄          |
| 4a SC-P10 第 6 步「從儲蓄轉 5000 到現金」 | 對      | 對      | 對      | 轉帳 儲蓄 → 現金，沒有分類 |
| 4a SC-P10 第 8 步「今天天氣很好」         | 對      | 對      | 對      | 0 筆                       |

- 延遲 1.3～3.5 秒。輸入 token 835～845，輸出 7～114。
- 名稱（title）不驗。「雜支 50」1 次、轉帳 3 次是 null。
- 對照輪（不計分）：「日常」保留新帳本的預設分類（餐飲、購物、居住等 10 個支出分類），SC-P17 第 1～3 句各 3 次。分類 9/9 都對，「衛生紙」仍提議「日用品」，沒有塞進「購物」。「雜支 50」有 1 次 25 秒逾時回 503，另 2 次 11.0、3.7 秒，是 4a 已知的 z.ai 延遲長尾。輸入 token 956～958。
- 不用調提示詞。
