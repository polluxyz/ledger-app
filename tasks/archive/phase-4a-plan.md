# 4a 實作計畫：AI 文字記帳（一句話變成交易草稿）

spec：`docs/specs/phase-4a-ai-text.md`（決策 237～253、W208～W214、SC-P1～SC-P12）。後端、畫面、e2e 合成一個 PR。

> 核可：開發者 2026-10-23 核可（含 §5 的 4 項）。送審前已徵詢 advisor（Codex），意見已併入本版。

## 0. 起點

- 分支 `feature/phase-4a-ai`，worktree `ai-4a`，測試資料庫 `ledger_ai_test`。這個 session 兼任協調者與整合，只有它寫這條分支。
- 先開 docs PR（spec 的修正、本 plan、todo）合進 `main`，再把 `main` 併回這條分支開始實作。
- worker 各開自己的 worktree，從這條分支開子分支 `feature/ai4a-<名>`，驗收後 merge 回這條分支。
- 角色：模型輸出的檢查、帳本權限、限流派 `backend`；GLM provider、畫面、e2e 派 `default`。模型看 `docs/orca-multi-agent.md` §0。網頁只派 Codex。
- **不改 schema，沒有 migration**（spec §3）。部署不必備份資料庫。
- 與 2j 平行。共用的檔案（`app.module.ts`、`packages/shared/src/index.ts`、`docs/README.md`、`CLAUDE.md` §4）每處只多幾行，後合併的一方用 `gh pr update-branch` 解。

## 1. 元件與相依

### 1.1 協調者自己做（T0：契約與隔離測試）

- `packages/shared/src/types/ai.ts`：`ParseTransactionRequest`、`TransactionDraft`、`ParseTransactionResponse`（spec §4.1），常數 `AI_TEXT_MAX_LENGTH = 200`、`AI_MAX_DRAFTS = 10`。
- 同檔純函式 `isDraftComplete(draft)`（spec §4.1 的「草稿完整」），Node test runner 單元測試涵蓋：
  - 金額、日期、帳戶缺一就不完整。
  - 收支：分類缺就不完整。轉帳：轉入帳戶缺、或與轉出帳戶相同就不完整；分類是 null 不算缺。
  - 名稱（title）是 null 不影響完整。
- `constants/error-codes.ts` 加 2 個錯誤碼，都是 503：`AI_NOT_CONFIGURED`（沒設定）、`AI_UNAVAILABLE`（provider 錯誤或逾時）。分開是為了 W213 顯示不同的訊息。
- `apps/api/src/ai/llm-provider.ts`（決策 247），讓 T1、T2 能平行：
  - `LLMProvider` 介面：輸入 `system`（指示）、`user`（句子）、`schema`（要求的 JSON 結構）；輸出 `{ content: unknown; usage?: { promptTokens; completionTokens } }`。`content` 是 `null` 代表模型回的不是 JSON。
  - 注入 token `LLM_PROVIDER`（`Symbol`）。
  - `LlmProviderError`：只帶 `kind`（`http`／`timeout`／`network`）、狀態碼、耗時。不帶句子、回應內容、URL、`cause`。
- `apps/api/src/ai/ai-wire-format.ts`：模型回應的格式（見 §1.2「模型回應的格式」），T1 的檢查與 T2 的 `schema` 都引用它。
- 隔離測試 `apps/api/test/ai-parse-isolation.e2e-spec.ts`，先看到紅燈。provider 用測試注入的 stub（直接回指定的內容），不靠假 provider 的劇本：
  - SC-P9 的權限：別人的帳本 404、退出的帳本 404、檢視者 403、封存 409。每條配正向對照（我的帳本 200）。並斷言被拒絕時 stub 沒被呼叫。
  - SC-P7 的隔離部分：stub 回別人的帳本代號、原始 UUID、別人的帳戶、臨時帳戶、別本帳本的分類 → 斷言**精確值**：帳本等於目前帳本，帳戶與分類是 `null`，其他好欄位保留。

### 1.2 後端 A：`AiModule` 與解析（T1，`backend`）

只依賴 T0。

**檔案**：`apps/api/src/ai/` 下的 `ai.module.ts`、`ai.controller.ts`（`@ApiTags('ai')`）、`dto/parse-transaction.dto.ts`、`ai.service.ts`、`ai-catalog.ts`、`ai-draft-validation.ts`、`fake-llm.provider.ts`、`llm-provider.factory.ts`、`ai-user-throttle.guard.ts`。在 `app.module.ts` 註冊。factory 這時只認得 `fake`，不 import 還沒合併的 GLM 檔案。

**帳本權限**（spec 的 API 不變）：

- `ledgerId` 在 body，現有的 `LedgerAccessGuard` 只讀路徑參數。做法是把 guard 裡「成員 → 角色 → 封存」的判斷抽成 ledgers 模組的共用函式，guard 與 `AiService` 都呼叫它。
- 共用函式的參數：使用者、帳本、最低角色、是否允許封存。回傳角色，guard 照舊設定 `request.ledgerRole`。順序固定：不是成員 404 → 角色不足 403 → 封存且要寫入 409。
- guard 的既有行為不變：GET、`@AllowOnArchived`、沒標 decorator、沒有路徑參數。由既有 API e2e 保證。
- `AiService` 先檢查目前帳本的權限，通過才讀清單、檢查 provider 設定、呼叫模型。

**送給模型的清單**（決策 253，`ai-catalog.ts`）：

- 我能寫入的帳本：EDITOR 以上、未封存。退出的帳本沒有成員列，自然不在清單上。
- 這些帳本的分類（名稱、型別、所屬帳本），我的帳戶（排除臨時帳戶）。
- id 換成短代號：帳本 `L1…`、分類 `C1…`（跨帳本全部連號，不重複）、帳戶 `A1…`。對照表每次請求一份 `Map`，只留在伺服器記憶體。代號用 `Map` 精確查找，不用 `parseInt`。
- 清單另外帶 `currentLedger`（目前帳本的代號）與 `today`。用 `JSON.stringify` 放進 system 指示，明確標成「資料」。使用者句子只放 user 訊息。
- system 指示寫明：只產生支出、收入、轉帳；借還、查詢、修改、別人付款、分帳都不要轉成交易。

**模型回應的格式**（`ai-wire-format.ts`，T0 定義）：`{ drafts: [...] }`，每筆草稿的每個 key 都必填：

| key          | 值                                                        |
| ------------ | --------------------------------------------------------- |
| `type`       | `EXPENSE`／`INCOME`／`TRANSFER`                           |
| `ledger`     | 帳本代號，或 `null`（沒提）                               |
| `amountYuan` | 元的字串，只有數字與最多 2 位小數，或 `null`              |
| `date`       | `YYYY-MM-DD`，或 `null`（沒提）                           |
| `title`      | 字串，或 `null`                                           |
| `category`   | 分類代號，或 `null`                                       |
| `account`    | 帳戶代號；`null`＝沒提；`"?"`＝提了但對不到               |
| `toAccount`  | 帳戶代號；`null`＝沒提；`"?"`＝提了但對不到（只有轉帳用） |

元的字串只存在模型與後端之間。API 回應與交易 API 照舊用整數的分。`money.ts` 的註解補一句這個例外。

**逐欄檢查**（決策 245，`ai-draft-validation.ts`）：

- 純函式。輸入是模型的 `unknown`、清單、各帳本的預設帳戶、`today`。各帳本的預設帳戶由 `AiService` 先用 `UsersService.getRecordDefaults` 查好再傳入。
- 逐欄建新物件，不把模型的物件展開進輸出。多出來的欄位（`payerPersonId`、`ledgerSplit` 等）直接忽略。
- 結構：
  - 不是物件、沒有 `drafts` 陣列 → `drafts: []`（決策 246）。
  - 先取前 10 筆，再逐筆檢查（決策 237）。不能先濾掉壞的再從第 11 筆以後補。
  - 元素不是物件，或 `type` 不是三種之一 → **略過這一筆**，其他筆照留。這是決策 245 的例外，見 §5 第 2 項。
- 欄位：
  - `ledger`：在清單裡就用它。`null`、不在清單、原始 UUID、格式不對 → **用目前帳本**（決策 240，見 §5 第 1 項）。
  - `category`：必須屬於最後的帳本、型別相符。轉帳一律 `null`。
  - `account`：值**精確是** `null` → 用該帳本的預設帳戶（決策 242），沒有預設就 `null`。`"?"`、不在清單、缺 key、錯型別 → `null`。
  - `toAccount`：只有轉帳用，不在清單 → `null`，不給預設。收支一律 `null`。兩個帳戶相同時保留，由「草稿完整」擋下。
  - `amountYuan`：先用嚴格格式檢查（`^\d+(\.\d{1,2})?$`，不接受逗號、符號、科學記號、數字型別），再用 shared 的 `parseMoneyInput` 換成分。≤ 0 或超過 `MAX_AMOUNT_CENTS` → `null`。不經過浮點數。
  - `date`：值精確是 `null` → `today`。不是真實存在的日期（例如 `2026-02-30`）→ `null`。不用 `new Date()` 判斷（它會把 2 月 30 日自動換成 3 月 2 日）。
  - `title`：去掉前後空白。不是字串、空字串、超過 100 字 → `null`（見 §5 第 3 項）。
- DTO 的 `today` 也用同樣的真實日期檢查。

**假 provider**（決策 250，`fake-llm.provider.ts`）：

- 依句子查固定的劇本，劇本用名稱寫（帳本名＋分類型別＋分類名）。執行時解析 system 指示裡標出的 JSON 清單，換成代號。所以假 provider 也驗證了清單真的有送出。
- 劇本的名稱在清單裡找不到 → 丟錯，讓測試直接失敗，不自己編代號。
- 不重用 `ai-draft-validation.ts` 或代號對照表，避免兩邊一起錯。
- 涵蓋 spec §1 的句子。不在劇本裡的句子回 0 筆。
- 惡意與壞格式的情境（SC-P7、SC-P8）不寫進假 provider，由測試注入 stub。

**provider 選擇與環境變數**（決策 249）：

- `env.validation.ts` 加 `LLM_PROVIDER`（`glm`／`fake`，預設 `fake`）、`GLM_API_KEY`、`GLM_MODEL`、`GLM_BASE_URL`（預設 `https://open.bigmodel.cn/api/paas/v4`）。都不是必填，啟動不因此失敗。
- `glm` 但金鑰去空白後是空的，或沒設 `GLM_MODEL` → AI 端點回 503 `AI_NOT_CONFIGURED`，其他端點照常。設定錯了不偷偷改用假 provider。

**限流**（決策 251）：

- 全域的 `ThrottlerGuard`（每個 IP 每分鐘 100 次，以 controller＋handler 分開計）照舊，不改。
- AI 端點另外掛 `AiUserThrottleGuard`：繼承 `ThrottlerGuard`，`throttlers` 只有一個 `ai-user`（60 秒 10 次），`getTracker` 回傳 JWT 驗證過的 `user.sub`。沒有 `user` → 401，不退回用 IP。名字不同，所以不會和 `default` 共用計數。
- AI 端點不加 `@Throttle({ default: ... })`（那會把全域那道改成 10），也不加 `@SkipThrottle()`。
- 限制：計數存在 API 程序的記憶體。目前只有一個 API 程序，夠用。之後開多個程序要改共用儲存，記進實作紀錄。

**不存、不記**（決策 252）：

- `AiService` 不寫資料庫。
- 只有 `LlmProviderError` 轉成 503 `AI_UNAVAILABLE`。權限、DTO 的錯誤照原本的狀態碼。
- 日誌只記錯誤種類、狀態碼、耗時。

**測試**：

- 單元：逐欄檢查每條規則一個案例。金額另測 `0.01`、`0.29`、上限、超上限、`0`、負數、3 位小數、科學記號、逗號、數字型別。`title` 測 0／100／101 字、中文、emoji。代號換回、清單只含可寫入的帳本與非臨時帳戶、分類代號跨帳本不重複。權限被拒時 provider 沒被呼叫。
- API e2e `ai-parse.e2e-spec.ts`，provider 一律由測試覆寫，不依賴本機 `.env`：
  - SC-P1～P6：用假 provider，精確斷言每筆的型別、分、日期、分類、帳戶、順序。SC-P3 用和伺服器不同的 `today`；SC-P4 含「換帳本後用那本的預設帳戶」與「沒有任何紀錄時 null」；SC-P6 含檢視者、封存、退出的帳本名稱回目前帳本。
  - SC-P7、P8：用 stub。P8 涵蓋 0 筆、`content: null`、`drafts` 不是陣列、陣列含 null 或數字、11 筆、前 10 筆含壞元素。
  - SC-P9：401、OWNER／EDITOR 正向、429、503（`AI_NOT_CONFIGURED` 用覆寫設定的方式另建 app；`AI_UNAVAILABLE` 用丟 `LlmProviderError` 的 stub）。
  - 限流：比照 `friends-throttle.e2e-spec.ts` 暫改 `NODE_ENV`。驗：同一個人換 token／IP／帳本仍共用 10 次；兩個人同 IP 各 10 次；其他端點的限流照舊。
  - SC-P11：成功、看不懂、`LlmProviderError`、逾時四種路徑都攔 Nest `Logger` 與 `console`，找不到特殊字串。先放一個會被攔到的正向對照，證明攔截有效。再用 SQL 掃所有文字欄位，並比對解析前後各表的筆數不變。
  - 隔離測試轉綠。

### 1.3 後端 B：GLM provider（T2，`default`）

只依賴 T0，跟 T1 平行。

- `apps/api/src/ai/glm-llm.provider.ts`：實作 `LLMProvider`（決策 248）。
  - OpenAI 相容的 chat completions，Node 內建 `fetch`，不加 SDK。`stream: false`，`response_format: { type: 'json_object' }`，system 指示附上 `schema`。
  - 網址：`GLM_BASE_URL` 去掉結尾的 `/` 再接 `/chat/completions`。不用 `new URL('/chat/completions', base)`（會丟掉 `/api/paas/v4`）。
  - 25 秒逾時（T6 由 15 秒改，見 §1.7）涵蓋 `fetch` 與讀完整個 body，`finally` 才清掉計時器。不自動重試。
  - `redirect: 'error'`，不跟著轉址，避免句子與清單被送到別處。
  - 回應 body 設大小上限（夠放 10 筆草稿），超過當成看不懂。
  - 只讀 `choices[0].message.content`，不讀 `reasoning_content`。
  - 分類：HTTP 4xx／5xx、網路錯誤、讀 body 失敗、逾時 → 丟 `LlmProviderError`。200 但 `choices` 空、`content` 不是字串、`JSON.parse` 失敗 → `content: null`。`JSON.parse` 的例外在這一層吞掉（它的訊息會帶回應片段）。
  - `usage` 有就回傳數字，給 T6 記 token 用量。
- 單元（mock `fetch`，逾時用會回應 `signal` 的 mock）：網址有／無結尾 `/`、標頭、內容格式、金鑰只在 `Authorization`；逾時；4xx／5xx；網路錯誤；轉址；`choices` 空、`content` 是 null、不是 JSON、截斷。錯誤物件與日誌都不含句子、回應內容、金鑰。
- 不接進 factory。T1、T2 都合併後由協調者接上。

### 1.4 畫面（T3，`default`，Codex）

只依賴 T0 的契約，跟 T1、T2 平行（元件測試用 `vi.mock` 替換 API）。

| 區塊                     | 決策       | 主要檔案                                                                                    |
| ------------------------ | ---------- | ------------------------------------------------------------------------------------------- |
| AI 輸入框                | W208、W213 | 新元件 `features/ai/AiDraftInput.tsx`；`pages/TransactionsPage.tsx`                         |
| 草稿清單、✓、×、全部確認 | W209～W211 | 新元件 `features/ai/AiDraftList.tsx`、`features/ai/use-ai-parse.ts`                         |
| 點草稿 → 右側欄帶好欄位  | W212       | `TransactionWorkbench.tsx`、`TransactionForm.tsx`（新增 `draft` 模式，不偽裝成 `copyFrom`） |
| 草稿只在畫面上           | W214       | 草稿狀態放在 `TransactionsPage` 的 state                                                    |

- 送出時帶 `today`：用 `lib/format.ts` 的 `toDateInputValue()`，和手動新增的預設日期一致（見 §5 第 4 項）。不用 `toISOString()`。
- 每筆草稿給一個畫面內的穩定 key。同一筆不能被 ✓、全部確認、表單同時送出。
- ✓ 停用與「全部確認」跳過的判斷，用 shared 的 `isDraftComplete`，前端不自己寫一份。
- 寫入：
  - 只呼叫既有的 `POST /ledgers/{草稿的帳本}/transactions`。不帶 `payerPersonId`、`ledgerSplit`，也就是本人付、不分帳（決策 244）。
  - `useCreateTransaction(ledgerId)` 把帳本綁死在 hook 建立時。把它的 mutation 抽成可以指定帳本的版本，原 hook 改呼叫它，失效重抓的範圍不變。草稿寫入時用草稿的帳本。
- 「全部確認」依序寫入、跳過不完整的；中途失敗就停下（W211）：已寫入的移除，失敗那筆顯示錯誤，其餘留著。重試不會再寫已成功的。
- `TransactionForm` 的 `draft` 模式：
  - 每個欄位照草稿帶入，包含日期與帳本。`null` 的欄位留空，不自動補第一個帳戶或今天。
  - 共享帳本預設不分帳。
  - 新增成功要通知頁面，頁面移除這筆草稿。關閉表單不移除。失敗不移除。
  - 換點另一筆草稿，表單換成那筆；收起再開不沿用上一筆。
- 錯誤訊息照 W213：看不懂（0 筆）、429、`AI_NOT_CONFIGURED`、`AI_UNAVAILABLE`，各一句。句子留在框裡，可以重送。送出中不能改字、不能重送。
- W214：草稿不放 localStorage、sessionStorage、URL、query 快取。離開頁面後才回來的回應不會讓草稿出現。
- 介面文字極簡，照預覽頁 `docs/artifacts/step-4a-ai-draft-preview.html`（在主工作區）。
- 元件測試具名涵蓋：
  - W208：位置；送出中鎖住；Enter 與連點不重送。
  - W209：六個欄位、轉帳 A → B、別本帳本的名稱、空欄位的提示；名稱是 null 不擋 ✓。
  - W210：✓ 的條件；× 不呼叫 API；成功移除、失敗保留並顯示錯誤。
  - W211：清單「完整 A、不完整 B、完整 C、完整 D」，C 失敗 → A 消失、B／C／D 留著、錯誤掛在 C、D 沒送出；重試不再寫 A。
  - W212：逐欄帶入（含 null 日期、null 帳戶、別本帳本、共享帳本不分帳）；成功移除、關閉與失敗不移除；換草稿表單跟著換。
  - W213：4 種錯誤各一句，句子保留。
  - W214：重新整理後沒有草稿；離開頁面後回來的回應不顯示。
  - 草稿寫入別本帳本後，那本的交易與帳戶 query 失效。

#### 1.4.1 版面修正（T3b，`default`，Codex；2026-10-23 開發者選方案 E）

T4 跑完整 Web e2e 時，既有的 SC-24.3（1440×900 交易頁首屏至少 10 筆）掉到 8 筆。原因是 T3 的 AI 卡片約 124px 高。advisor（Codex）與協調者都推薦方案 E，開發者核可。被否決的方案：A 縮小卡片（推算 9 筆，不夠）、B 併入明細工具列（餘裕約 5px，換行就失敗）、C 降門檻、D 按鈕展開（違反常駐入口）。

- 輸入框（文字框＋送出鈕）放進 `app/PageToolbar` 的頂端橫條。2i 起這條就預留給 AI。
  - 用 context 提供的插槽節點＋`createPortal` 放進去，只有交易頁會填。其他頁照舊空著。
  - 橫條高度不變（`min-height: 3.5rem`），輸入列垂直置中。窄螢幕時文字框縮短，送出鈕不換行。
- 拿掉卡片外框與可見標題「AI 記帳」。保留 `<label>`（視覺隱藏），讓螢幕閱讀器讀得到。
- 錯誤訊息（W213）與草稿清單（W209）留在交易頁內容裡、「明細」上方，有內容才出現。不放進橫條，因為橫條會固定在畫面上方。
- 送出中送出鈕顯示轉圈（W208），維持鎖住文字框、不重送。
- 離開交易頁時，插槽裡的輸入框跟著卸載。草稿仍照 W214 只存在頁面 state。
- `e2e/layout.spec.ts` 的 `fullyVisibleRows` 只數交易列表裡的列，不數 `main` 裡所有的 `li`。門檻維持 10，不改。

驗收：SC-24.3 轉綠（無草稿、無錯誤的初始狀態）；完整 Web e2e 全綠；W208、W213 元件測試跟著位置更新；其他頁的橫條高度不變。

### 1.5 e2e（T4，`default`，Codex）

依賴 T1、T3。

- Web e2e `apps/web/e2e/ai-draft.spec.ts`。Playwright 啟動的 API 明確設 `LLM_PROVIDER=fake`（`playwright.config.ts` 的 webServer env）。
- 走 spec §1 第 1～4 步：
  - ✓ 寫入的交易出現在明細、帳戶餘額照變、草稿從清單消失。
  - 點草稿改金額後寫入的是改過的金額；關閉表單時草稿還在。
  - 一筆寫進別本帳本的草稿，切到那本看得到。
- 跑之前先確認 3100／5273 埠沒被 2j 占用（`docs/handoff.md` 跨工作區規則）。

### 1.6 整合、文件、PR（T5，協調者）

依賴 T1～T4。

- 把 T2 接進 factory：`LLM_PROVIDER=glm` 且設定完整時用 GLM provider。
- 合併所有 worker 後，自己重跑 lint、typecheck、test、build、format:check 與兩套 e2e。
- spec 的修正（跟本 plan 一起進 docs PR，見 §5）：SC-P7、決策 245、§6 的帳本 fallback 與 type 例外；SC-P10 改成 15 次的表；§9 的 `.env.example` 路徑（實際在**根目錄**）。
- spec §9 的其他文件：`docs/README.md`、`專案決策脈絡.md`、`CLAUDE.md` §4、根目錄 `.env.example`。
- PR 依模板，CI 全綠後 squash merge。部署照 spec §8，在主工作區做。
- T5 只能宣稱假 provider 範圍驗收完；SC-P10 留給 T6。

### 1.7 真的模型（T6，協調者，等金鑰）

- 開發者提供 GLM 金鑰與要用的模型，只寫進主工作區的 `apps/api/.env`。確認金鑰種類與 `GLM_BASE_URL` 對得上（一般 API 與 Coding 端點不同）。
- 這個模型預設會「思考」的話，在可關的情況下關掉，避免超過逾時。glm-5.3 關不掉，改用 `GLM_REASONING_EFFORT=low`（見下方 T6 結果）。
- SC-P10：固定模型、清單、`today`，5 句各跑 3 次。結果填這張表（每一格記對或錯、錯在哪一欄）：

| 句子（spec §1） | 預期                 | 第 1 次 | 第 2 次 | 第 3 次 |
| --------------- | -------------------- | ------- | ------- | ------- |
| 第 1 步         | 2 筆，欄位照 spec    | 對      | 對      | 對      |
| 第 5 步         | 照 spec              | 對      | 對      | 對      |
| 第 6 步         | 照 spec              | 對      | 對      | 對      |
| 第 7 步         | 照 spec              | 對      | 對      | 對      |
| 第 8 步         | 0 筆（今天天氣很好） | 對      | 對      | 對      |

上表是第 5 輪（正式設定）。前 4 輪的失敗與第 6 輪對照見 §7「T6」。

- 每次失敗都記下來，不只留調整後成功的那次。另外記模型、system 指示版本、token 用量。
- 不過的句子：先調 system 指示。要改送給模型的資料或流程，就停下來問開發者（spec §7 Ask first）。
- 沒有金鑰前，這項維持未完成。

## 2. 實作順序

1. 開發者核可本 plan、todo 與 §5 → docs PR（spec 修正、plan、todo）合進 `main` → 併回 `feature/phase-4a-ai`。
2. T0（協調者）→ push 契約 commit。
3. 第 1 波平行：T1（`backend`）、T2（`default`）、T3（Codex）。
4. T1、T3 合併回分支後派 T4。
5. T5：整合、文件、PR、部署。
6. T6：金鑰到了再做，可以在 T5 部署之後。

## 3. 風險與對策

| 風險                                           | 對策                                                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 模型回別人的 id 或亂寫的 id                    | 模型只看得到代號，代號只對到清單裡的 id。帳本對不到用目前帳本，其他欄位 null。隔離測試斷言精確值     |
| 抽出權限判斷時弄壞 `LedgerAccessGuard`         | 參數保留最低角色與允許封存；既有 API e2e 全部要綠；404／403／409 都配正向對照                        |
| AI 限流蓋掉或重算全域限流                      | 另一個名字的 guard，不動 `default`；e2e 驗其他端點照舊、兩個人同 IP 各 10 次                         |
| 句子經由錯誤堆疊或 `JSON.parse` 例外進了日誌   | `JSON.parse` 在 GLM 層吞掉；provider 錯誤只帶種類、狀態碼、耗時；SC-P11 四種路徑都攔日誌，含正向對照 |
| 金額經過浮點數，或「1,2」被當成 12 元          | 嚴格格式先檢查，再用 `parseMoneyInput` 換成分                                                        |
| 假 provider 與檢查共用程式，兩邊一起錯         | 假 provider 自己解析清單，不重用檢查與代號表；惡意情境改用 stub                                      |
| 測試吃到本機 `.env` 的 `glm`                   | API e2e 覆寫 provider；Playwright 明設 `fake`                                                        |
| 表單把 AI 留空的欄位自動補上                   | `draft` 模式不自動補；W212 元件測試逐欄斷言                                                          |
| 草稿寫進別本帳本，但 hook 綁的是目前帳本       | 抽出可以指定帳本的 mutation；元件測試＋T4 驗切到那本看得到                                           |
| 「全部確認」寫到一半失敗，使用者不知道哪些寫了 | 已寫入的移除，只留失敗與沒寫的；W211 元件測試                                                        |
| GLM 回應太慢（思考模式）或很大                 | 25 秒涵蓋讀 body；body 大小上限；T6 用 `GLM_REASONING_EFFORT=low` 降低思考強度                       |
| Web e2e 與 2j 搶埠                             | 跑之前查埠；同一時間只有一邊跑                                                                       |
| 分類很多時 system 指示太長、費用變高           | 4a 不設上限，也不裁清單（會改變決策 253）。T6 記 token 用量給之後參考                                |

## 4. 驗證點

- 每個 worker：`pnpm lint / typecheck / test / format:check`；後端再跑自己資料庫的 API e2e。
- 協調者：
  - 逐行看權限判斷的抽出、`ai-catalog.ts`、`ai-draft-validation.ts`、限流 guard、GLM provider 的錯誤處理、表單的 `draft` 模式。
  - 自己重跑隔離測試（紅轉綠）、兩套 e2e、`pnpm build`。
- 部署後：dev 上用假 provider 走 spec §1 第 1～4、8、9 步。用 a@a.com，寫入的交易事後刪掉。金鑰到了再走 T6。

## 5. 要開發者決定的事

前 3 項要改已核可的 spec，跟本 plan 一起進 docs PR。

1. **SC-P7 的帳本**：SC-P7 寫「別人的帳本 id → `null`」，但 `TransactionDraft.ledgerId` 不能是 null，決策 240 寫「對不到 → 用目前帳本」。plan 照決策 240，改 SC-P7、決策 245、§6 的寫法。
2. **型別不合法**：模型回的 `type` 不是三種之一，或元素根本不是物件 → 略過這一筆，其他筆照留。這是決策 245「不整筆丟」的例外。
3. **名稱超過 100 字**：給 `null`，不截斷。名稱是選填，使用者可以自己補。
4. **今天的日期**：前端用和手動新增一樣的方式算「今天」（瀏覽器所在時區）。在台灣用就是台灣時間。不另外寫死台灣時區。

不需要決定、但改了 spec 文字的：SC-P10 改成 4 句有草稿＋1 句 0 筆的 15 次表；`.env.example` 的路徑。

## 6. 派工

| 波次 | worker     | 角色      | 範圍 | 驗收                                                                       |
| ---- | ---------- | --------- | ---- | -------------------------------------------------------------------------- |
| 0    | 協調者     | —         | §1.1 | shared build 後 typecheck 通過；`isDraftComplete` 單元測試綠；隔離測試紅燈 |
| 1    | `ai4a-api` | `backend` | §1.2 | §1.2「測試」全部通過；隔離測試轉綠；既有 API e2e 全綠                      |
| 1    | `ai4a-glm` | `default` | §1.3 | §1.3 的單元測試；錯誤與日誌不含句子、回應、金鑰；沒有新增套件              |
| 1    | `ai4a-web` | `default` | §1.4 | §1.4 列的元件測試；Web 檢查全綠                                            |
| 2    | `ai4a-e2e` | `default` | §1.5 | Web e2e 全綠，含 §1.5 的三個斷言                                           |

- 每個後端 worker 一個 `ledger_ai_<名>_test` 資料庫，`.env` 與 `.env.test` 都指向它（`docs/orca-multi-agent.md` §3）。
- worker 不改 `packages/shared`、`llm-provider.ts`、`ai-wire-format.ts`（要改先問協調者）。
- T1 與 T2 都在 `apps/api/src/ai/`，但檔案分開（T2 只有 `glm-llm.provider.ts` 與它的測試）。
- T3 擁有 `TransactionForm.tsx`、`TransactionWorkbench.tsx`、`use-transactions.ts` 的改動；T4 不改這些檔。

## 7. 實作紀錄

### T0（commit `34157bb`）

- `test/e2e-utils.ts` 的 `createE2EApp` 多一個選填參數 `configure(builder)`，預設不改。讓 e2e 能用 `overrideProvider(LLM_PROVIDER)` 注入 stub。既有呼叫不受影響。
- 隔離測試比 §1.1 多驗決策 253 的清單內容：`user` 等於去掉前後空白的句子；system 含可寫入的帳本名，不含檢視者、封存、退出的帳本名，不含別人的帳本與帳戶名，不含句子本身，不含任何 UUID。
- 紅燈結果：11 條中 7 條失敗（路由還不存在）。4 條「404」案例暫時通過，因為路由不存在也回 404。正向對照（我的帳本 200、stub 被呼叫 2 次）會在 T1 前保持紅燈，所以 T1 完成後這 4 條才有意義。
- 需要真代號的情境（例如代號對到型別不符的分類）stub 寫不出來，交給 T1 的 `ai-parse.e2e-spec.ts`。

### 派工環境

- 第 1 波改在新的 Orca run `run_9f754145ed8b` 派工。舊 run `run_d40c9ec85c2b` 綁的是上一個 session 的終端機，用它派工會回 `consumer_fenced`。
- 角色表寫 `default` 用 max 強度，但 Orca 只接受到 xhigh。T3、T4、T3b 實際都用 Codex xhigh。

### T1（commit `114cfb5`，合併 `e0d0f97`）

- 照 §1.2 實作。T0 的隔離測試全部轉綠。API e2e 458/458、API 單元測試 707/707。
- 假 provider 遇到劇本以外的句子會丟錯，端點回 500。這是 plan 核可的行為：假 provider 只給測試與 dev 用，不該悄悄回空草稿，讓測試誤以為「0 筆」是對的。

### T2（commit `deacb67`）

- 照 §1.3 實作，19 條單元測試通過，沒有新增套件。
- 已知小瑕疵：HTTP 回非 2xx 時沒有取消讀 body。只影響連線多佔一下，不影響結果與日誌，先不修。

### T3（commit `efdbe2b`，合併 `03cc1fa`）

- 照 §1.4 實作，Web 單元測試 827/827。
- 已知小瑕疵 1：「全部確認」進行中，如果表單同時在存另一筆，迴圈會停下但不顯示錯誤。已寫入的會移除，沒寫的留在清單，資料不會錯，只是少一句提示。
- 已知小瑕疵 2：W214 的測試只檢查特定的 storage key，沒有掃整個 storage。

### T4（commit `3f8cd3b`，合併 `601a62c`）

- `ai-draft.spec.ts` 3/3，連跑 3 次都綠。`playwright.config.ts` 的 API webServer 明設 `LLM_PROVIDER: 'fake'`。
- T4 跑完整 Web e2e 時，既有的 `layout.spec.ts`「SC-24.3：1440×900 首屏至少 10 筆」掉到 8 筆。原因是 T3 在「明細」上方加了約 124px 高的 AI 輸入卡片。

### SC-24.3 與 T3b（commit `7b20384`，合併 `d525dd2`）

- 依決策門控先問 advisor（Codex）。advisor 推算 4 個方案的首屏筆數，並指出 `PageToolbar` 的頂端橫條從 2i 起就預留給 AI。開發者選方案 E：輸入框放進頂端橫條，錯誤訊息與草稿留在「明細」上方，有內容才出現。spec 與本 plan 的修改在 commit `9e56d19`（§1.4.1）。
- advisor 另外找到 2 個問題，一併在 T3b 修：W208 要求的轉圈原本只有文字；`fullyVisibleRows` 原本會數到 `main` 裡所有的 `li`。
- 做法：`PageToolbarSlotProvider` 用 context 交出橫條內層的 DOM 節點，`AiDraftInput` 用 `createPortal` 把表單放進去。
- 結果：SC-24.3 量到 10 筆；交易、帳戶、首頁的橫條都是 57px；375px 寬時輸入框 260px、沒有橫向捲動。layout 21/21、ai-draft 3/3、完整 Web e2e 71/71、Web 單元測試 827/827。
- 小地方：送出中的按鈕同時有 `aria-label` 和視覺隱藏文字，念出來的名稱相同，不影響使用。

### 與 2j 搶埠

- Web e2e 用固定埠 3100／5273／5274。T3b 期間 stats-2j 的伺服器多次占用，worker 回報 3 次 escalation，最後改成輪詢、空了就跑。協調者不停別人的行程。

### T5

- 合併 T1～T4、T3b 後，在 `feature/phase-4a-ai` 重跑：format:check、lint、typecheck、build 通過；單元測試 shared 122、API 728、Web 827 全過；API e2e 458/458（`ledger_ai_test`）；完整 Web e2e 71/71（含 layout 與 ai-draft）。
- 併入 main 的 #154（2j）後再跑一次（`a1ff740`）：shared 122、API 825、Web 891；API e2e 520/520；Web e2e 第 1 次 75/76，`debts.spec.ts:258`（還款）找不到「你還小華」，單獨重跑 3 輪 12/12、完整重跑 76/76。這條與 4a 無關，記錄不修。
- PR #155 CI 全綠，squash merge 成 `f35485b`。沒有 migration、沒有新套件。
- 部署：主工作區 `git pull`、build shared 與 API。dev 的 `.env` 沒設 `LLM_PROVIDER`，所以是假 provider。
- dev 驗證用暫時的 API（埠 3200）以 a@a.com 打 API，沒有點畫面（畫面由 Web e2e 涵蓋）：
  - a@a.com 原本沒有「早餐」「午餐」「信用卡」，第 1 步的句子回 500（假 provider 對不到劇本）。在「test 的帳本」補了 2 個支出分類與 1 個帳戶，保留給開發者試用。
  - 第 1、2 步：2 筆草稿，$60 早餐／現金、$120 午餐／信用卡，日期是今天。
  - 第 3、4 步：照草稿新增第 1 筆、金額改 $125 新增第 2 筆，都 201；之後刪掉，交易數 17 → 19 → 17。
  - 第 5 步：「昨天計程車 250」→ 日期是昨天、分類交通、帳戶帶入。
  - 第 8 步：「今天天氣很好」→ `drafts: []`。
  - 第 9 步（×）只在前端，不打 API。
  - API 日誌沒有出現使用者的句子。

### T6（真的模型，SC-P10）

- 模型 `glm-5.3`，端點 `https://api.z.ai/api/paas/v4`（z.ai 國際版；`.env.example` 的預設仍是 bigmodel.cn）。金鑰只在主工作區的 `apps/api/.env`。
- 量測方式：暫時的 e2e（不進版控，跑完刪掉）真的呼叫 GLM，對 `ledger_ai_test` 打 `POST /ai/parse-transaction`。資料照 spec §1：bob 的「日常」有早餐、午餐與預設分類（含交通）；帳戶現金、信用卡、儲蓄；記帳預設帳戶是儲蓄；`today`＝2026-10-21。旅行基金用 `createSharedLedger` 建，帳本種類不影響解析。
- 關思考：`thinking: { type: disabled }` 被忽略；`enable_thinking: false` 回錯誤 1210（這個模型一定會思考，只能選 low、high、max）。預設是 max。
- 6 輪結果，每輪 15 次。「欄位」指型別、帳本、金額、日期、分類、帳戶、轉入帳戶：

| 輪  | 設定                                                          | 結果       | 失敗                                                                                | 延遲                     | 輸出 token |
| --- | ------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------- | ------------------------ | ---------- |
| 1   | 預設思考、旅行基金有預設分類、60 秒                           | 12/15      | 第 7 步 3 次都選旅行基金的「交通」（資料前提不符，見下）                            | 1.5～8.4 秒              | 36～477    |
| 2   | 預設思考、旅行基金只有住宿與薪資、60 秒                       | 欄位 14/14 | 第 5 步 1 次 16.2 秒；第 7 步 1 次 60 秒沒回、503                                   | 1.4～16.2 秒（不含逾時） | 36～523    |
| 3   | `low`（測試裡注入）、只有住宿與薪資、60 秒                    | 欄位 15/15 | 第 6 步 1 次 19.4 秒（只輸出 51 token）                                             | 1.1～19.4 秒             | 7～95      |
| 4   | 正式設定：factory、`GLM_REASONING_EFFORT=low`、25 秒；指示 v1 | 13/15      | 第 7 步 2 次把「機票」選成「住宿」                                                  | 端到端 1.6～5.8 秒       | 7～95      |
| 5   | 同第 4 輪，指示 v2                                            | **15/15**  | 無                                                                                  | 端到端 1.4～3.5 秒       | 7～95      |
| 6   | 同第 5 輪，但旅行基金有預設分類（對照）                       | 12/15      | 第 7 步 3 次選「交通」，是預期的正向對照：分類意思對得上就選，沒有被新指示壓成 null | 端到端 1.4～18.5 秒      | 7～95      |

- 輸入 token：旅行基金只有 2 個分類時 824～853，有預設分類時 1023～1052。
- 第 1 輪的失敗是資料前提不符：每本新帳本都會建預設分類，旅行基金因此有「交通」，「機票 → 交通」是合理選擇。開發者同意保留第 7 步預期 null，把 spec §1 與 SC-P6 寫明旅行基金只有住宿與薪資。
- 開發者同意的 3 項修正（先問 advisor，Codex，run `run_47b7e99ca237`）：
  1. 新增選填環境變數 `GLM_REASONING_EFFORT`（`low`／`high`／`max`，留空不送），主工作區設 `low`。參數錯誤時不自動拿掉欄位重試。
  2. 逾時 15 → 25 秒，不自動重試，寫死不開環境變數。spec 決策 248 一起改。
  3. 第 7 步維持 null，修正資料前提（上一點）。
- 指示 v2（`ai-catalog.ts`）：分類那句從「必須屬於該帳本且型別相符」改成「必須屬於該帳本、型別相符，而且意思對得上；沒有意思相符的分類就用 null，不要硬選相近的」。照本節「先調 system 指示」的規則改，沒有改送出的資料或流程。指示沒有版本常數，以 commit 區分。
- 名稱（title）SC-P10 不驗。`low` 時大多有填，預設思考時常是 null。
- 第 6 步（轉帳）3 輪各有 1 次 16～19 秒，輸出 token 卻只有 51。長尾出在 z.ai 那邊，不是輸出太長。25 秒逾時涵蓋得到，再慢就回 503，使用者重送。
- 沒做的：z.ai 的資料條款還沒查（送出的資料有帳本、分類、帳戶名與使用者的句子）；費用控管與 `max_tokens` 之後再設。
