# 4a 補充實作計畫：語音記帳（桌機 Chrome，Web Speech API）

spec：`docs/specs/phase-4a-voice.md`（決策 346～357、W257～W259、SC-SR1～SR16）。只改 `apps/web`，一個 PR。

> 核可：spec 第 2 版由開發者 2026-10-29 回「核可」核可（含 §10 第 2 版要確認的 3 點）。本 plan、todo（含 §5 的 2 點解讀）開發者 2026-10-29 回「核可」核可。

## 0. 起點

- 先開 docs PR（spec、plan、todo、交接檔、編號登記），合進 `main`。
- 整合分支 `feature/ai-voice`，從合併後的 `main` 開，用 `ai-4a` worktree。只有這個 session 寫這條分支。
- worker 開自己的 worktree，從整合分支開子分支 `feature/aiv-voice-ui`，驗收後 merge 回整合分支。
- 角色：網頁的設計與實作全交給 Codex，派 `default`。模型看 `docs/orca-multi-agent.md` §0。
- 不改 schema、不改 API、不改 `packages/shared`、不加套件、不改 CI、不改後端。
- TypeScript 5.7 的 `lib.dom` 只有 `SpeechRecognitionResult` 這類結果型別，沒有 `SpeechRecognition` 本身。型別在專案內自己宣告最小的介面，不裝 `@types/dom-speech-recognition`（那是新套件）。

## 1. 元件與相依

### 1.1 協調者自己做（T0：假辨識器與先紅的隔離測試）

spec §6 指定 SC-SR5、SC-SR6 由協調者先寫、先紅。這兩條管「舊結果套到錯的身分、帳本或輸入」，是資料隔離的防線。測試只透過畫面操作（按鈕名稱照 W259），不綁內部 API，讓 Codex 自己決定 hook 的形狀。

- 新檔 `apps/web/src/features/ai/test-support/fake-speech-recognition.ts`（只給測試用，沒有正式程式匯入）：
  - `installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' | 'SpeechRecognition' | 'both', secure?: boolean })`：在 `window` 掛上假建構子，並用 `Object.defineProperty` 設 `window.isSecureContext`（jsdom 不保證有這個值）。回傳控制器，`uninstall()` 還原。
  - 控制器記錄每個實例：`lang`、`continuous`、`interimResults`、`maxAlternatives`，以及 `start`、`stop`、`abort` 的呼叫次數。
  - 每個實例可手動觸發：`emitStart()`、`emitAudioStart()`、`emitAudioEnd()`、`emitResult(text, { isFinal })`、`emitError(code)`、`emitEnd()`。
  - 事件同時送給 `on*` 屬性與 `addEventListener` 註冊的處理函式，實作用哪一種都測得到。
  - `start()` 可設定成丟例外（SC-SR7 第 2 項用）。
  - 不自己觸發任何事件。`abort()` 之後要不要送 error、end，由測試決定，才能模擬「舊實例晚到的事件」。
- 新檔 `apps/web/src/features/ai/AiEntry.voice-isolation.test.tsx`：
  - 測試包裝照 `AiEntry.test.tsx` 的 `renderEntry`（mock `useAuth`、`useCurrentUser`、`useAiParse`、`useCreateTransactionForLedger`）。另加一個測試用元件，用 `useAiSession().setText` 從外部改輸入欄。
  - 每一條都斷言 `parse` 被呼叫的次數（語音流程一律 0）與輸入欄的值。
  - SC-SR5：
    1. 聆聽中按「停止聆聽」→ `stop` 1 次、`abort` 0 次 → 之後的 final 照常填入。
    2. 每個取消條件各 1 個案例（`it.each`）：按「取消語音」、Escape、按星芒按鈕收合、`isVisible=false`、切帳本、卸載、登出、換使用者、開新的一輪、`visibilitychange` 變成 hidden。取消後 `abort` 1 次，再送 result、error、end：輸入欄不變、沒有錯誤訊息、`parse` 0 次。
    3. 取消後馬上開新一輪 → 舊實例送 end → 新一輪仍是「聆聽中」。
    4. 對照：`window` 觸發 `blur` 不算取消（決策 350 (e)）。
  - SC-SR6：
    1. 帳本 A 開始 → rerender 成 B → 再回 A → 舊實例送 final：不填入。
    2. 登出、換使用者後舊實例送 final：不填入。
    3. 聆聽中，外部 `setText('x')` 再 `setText('')`（字串回到原樣、版本已變）→ 舊實例送 final：輸入欄是空的。
    4. `isVisible=false`（元件沒卸載）→ `abort` 1 次。
    5. 卸載 → `abort` 1 次，`console.error` 沒有被呼叫。
    6. 在 `<StrictMode>` 裡重跑第 1 項與 SC-SR5 第 1、3 項，結果相同。
- 紅的原因：現在沒有麥克風按鈕，`getByRole('button', { name: '開始語音記帳' })` 找不到。只接受這個原因。其他原因（型別錯、mock 寫錯）先修好再交出去。
- 這兩個檔案只是測試，不改正式程式。「協調者不改網頁程式」有一個例外：隔離測試先寫、先紅（根目錄 `CLAUDE.md` §11）。

### 1.2 語音 hook 與畫面（T1，`default` 的 Codex）

依賴 T0。版面、樣式、圖示由 Codex 決定，只用 `global.css` 的設計 token。下面寫的是行為要求與建議的分檔，函式名稱可以改。

**1. 偵測與型別**（建議新檔 `apps/web/src/features/ai/speech-recognition.ts`）：

- 自己宣告最小的辨識器介面：5 個設定欄位、`start`、`stop`、`abort`、6 個事件。結果沿用 `lib.dom` 的 `SpeechRecognitionResultList`。
- 取建構子：`window.SpeechRecognition ?? window.webkitSpeechRecognition`，而且 `window.isSecureContext === true`。兩者缺一就回 `null`（決策 348 (a)）。
- 設定照假設 2：`lang='zh-TW'`、`continuous=false`、`interimResults=false`、`maxAlternatives=1`。每一輪 new 一個實例（決策 347 (b)）。
- 不呼叫 `getUserMedia`、`MediaRecorder`（決策 347 (d)）。

**2. `ai-session.tsx` 對外多 2 種能力**（只改前端內部，不改 API）：

- 輸入版本：一個同步可讀的數字（建議 `getTextVersion()`，背後是 ref）。輸入欄的文字每改一次就加 1，包括 `setText`、`parse` 改寫或清空 `text`、身分改變時重設。用版本比，不比字串（決策 351 (c)）。
- 身分快照與檢查：建議 `getIdentitySnapshot()` 與 `isIdentityCurrent(snapshot)`，沿用現有的 `identityRef` 與 `isCurrentSession`。
- 既有的 `ai-session.test.tsx` 內容不改，全部照舊通過。

**3. 語音 hook**（建議新檔 `apps/web/src/features/ai/use-voice-input.ts`）：

- 狀態：閒置、準備中、聆聽中、辨識中，加一個語音錯誤訊息。
  - 準備中：`start()` 之後、`audiostart` 之前。
  - 聆聽中：`audiostart` 之後。
  - 辨識中：按停止、`audioend`，或 30 秒上限到了之後，等 final。
- 一輪的資料：操作 id、身分快照、來源帳本 id、輸入版本、辨識器實例、「已交付」旗標、這一輪的 timer。
- 全站同時只有一輪：用模組層級的「目前這一輪」。開新的一輪先取消舊的（假設 6）。
- 開始：先同步設鎖，再 new 實例、掛事件、`start()`（決策 349 (a)）。`start()` 丟例外 → 解鎖，顯示決策 354 (e) 的訊息。
- 每個事件與 timer 先檢查 4 項：操作 id 還是目前這一輪、身分快照仍有效、帳本 id 相同、輸入版本相同（決策 351 (b)）。任一不同就忽略。
- `onresult`：只取 `isFinal=true` 的第 1 個候選。trim 後是空的 → 顯示「沒聽清楚，請再試一次。」。否則先標「已交付」，再 `setText`，再把焦點移到輸入欄、游標放最後（決策 349 (b)、W259）。**不呼叫 `parse()`**。
- `onerror`、`onend`、timer：照決策 349 (c)～(e)、353、354。只收束一次。
- 取消：先作廢操作 id，再 `abort()`，再清 timer（決策 350 (b)）。不清空已填入的文字（決策 352）。
- 卸載與 `isVisible=false` 都要明確取消（決策 351 (d)）。清理可以重複執行（StrictMode）。
- `visibilitychange` 變成 hidden 才算取消，`blur` 不算（決策 350 (e)）。
- 開始新的一輪時清掉上一輪的語音錯誤（決策 354 (h)）。
- 不把辨識文字寫進 `console`、log、`localStorage`（spec §7 Never）。

**4. `AiEntry.tsx`**：

- 麥克風按鈕（W257）：
  - 偵測不到建構子就不顯示。
  - 入口收合或展開都能按。收合時按下先展開，再開始聽。
  - 只能檢視的帳本照星芒按鈕的處理：可以聚焦、`aria-disabled`、tooltip「只能檢視」、按了不開始。
  - 能開始的條件照決策 348 (b)：帳本已載入、沒有錯誤、可寫入、沒有正在辨識或解析、輸入欄 trim 後是空的。
- 按鈕名稱照 W259：閒置時「開始語音記帳」，聆聽中「停止聆聽」。準備中、聆聽中、辨識中另有「取消語音」按鈕。
- 狀態文字照 W258，放在 live region，不搶焦點。不顯示說到一半的文字。
- 辨識期間輸入欄與送出按鈕停用（`isParsing || 辨識中`）。
- Escape：辨識期間＝取消，不收合，焦點回到麥克風按鈕。不在辨識期間，照現有行為收合。輸入欄在辨識期間停用，所以 Escape 要掛在整個入口上，不只輸入欄。
- 收合（按星芒按鈕）＝取消。焦點照現有的收合規則回到星芒按鈕，因為那是使用者剛按的按鈕。
- 切帳本（`ledger.id` 改變）＝取消。
- 語音錯誤顯示在現有的 `role="alert"`。解析錯誤與語音錯誤同時只顯示一個，以最新的為準。
- 送出時的長度檢查：`handleSubmit` 加「trim 後 `[...text].length > AI_TEXT_MAX_LENGTH`」→ 顯示「請精簡至 200 字內。」，不送出（決策 349 (g)、354 (g)）。打字被 `maxLength` 限在 200 個 UTF-16 單位內，code point 數只會更少，所以這條不影響打字。
- 介面文字只用 spec 寫的按鈕名稱、狀態、錯誤訊息，不加說明句（開發者偏好極簡）。

**5. 單元測試**（Vitest，假 timer）：

- SC-SR1～SR4、SR7～SR12，用 T0 的假辨識器。
- T0 的 `AiEntry.voice-isolation.test.tsx` 要轉綠，斷言不改。真的非改不可（例如按鈕名稱的寫法），只能改選取元素那幾行，並在交付說明列出來。
- 既有的 `AiEntry.test.tsx`、`ai-session.test.tsx` 內容不改，全部照舊通過。

**6. Web e2e**（新檔 `apps/web/e2e/ai-voice.spec.ts`）：

- SC-SR13 第 1～3 項。用 `page.addInitScript` 在載入頁面前注入可控制的假建構子，由測試觸發事件。fake LLM 照現有 AI e2e 的設定。
- 斷言解析請求的次數：用 `page.on('request')` 計 `POST /api/ai/parse-transaction`。
- worker 不跑 Web e2e：Web Playwright 用固定埠（3100、5273）和共用的 `ledger_test`，同時只能一個 worktree 跑。協調者在 T2 跑，失敗時把輸出帶回給 Codex。

### 1.3 整合、文件、PR、部署（T2，協調者）

- 逐行看 diff，重點：每個事件先檢查 4 項、取消先作廢再 `abort()`、語音流程沒有呼叫 `parse()`、沒有 log 或 `localStorage` 寫辨識文字、只改 `apps/web`、沒有新套件。
- 確認 T0 的測試檔斷言沒改。用突變檢查驗 2 處：拿掉「輸入版本」檢查、拿掉「帳本 id」檢查，各自要讓 SC-SR6 對應的案例變紅，再還原。
- 跑 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm format:check`、`pnpm build`。
- 先確認沒有別的 worktree 在跑 Web e2e，再跑全部 Web e2e（SC-SR13 第 4 項：既有 AI e2e 照舊通過）。後端沒改，API e2e 交給 CI。
- 文件：
  - `phase-4a-ai-text.md`「範圍外」加註（spec §9）。
  - `docs/handoff/ai-4a.md`、`docs/handoff.md` 更新現況。
- 用 `pr` skill 開 PR，盯 CI，squash merge。
- 部署：只改前端。主工作區 `git pull`，請開發者在 Chrome 按 `Ctrl + Shift + R`（spec §8）。
- 清掉 worker 的 worktree、分支、終端機。

### 1.4 真實驗收（T3，開發者現場，協調者記錄）

- 地點：主工作區的 dev，開發者的 Chrome 開 `localhost:5173`。不用 Playwright 的 Chromium。
- 順序：先 SC-SR16 冒煙（權限、麥克風、網路），再 SC-SR14 的 20 句，最後 SC-SR15 的 6 種逆境。
- 每句填入後不改字、直接按送出。結果照 spec §6.1 的表格欄位填進本 plan §7。失敗、逾時、沒結果都照記，不重試替換（決策 357）。
- 最多用 26 次解析（假設 10）。開始前確認開發者當天的額度夠用（每人每日 50 次）。
- 全程不按 ✓。測前測後各記一次交易筆數（SC-SR14 第 6 項）。
- 沒達門檻：先分辨是辨識聽錯還是模型解析錯（SC-SR14 第 5 項），把數字交給開發者決定，不自己改 prompt 或設定。

### 1.5 收尾（T4，協調者）

- 開一個 docs PR：`專案決策脈絡.md` 補「語音為什麼先用瀏覽器內建辨識」（spec §9）；`CLAUDE.md` §4 更新進度；plan 與 todo 移到 `tasks/archive/`。

## 2. 實作順序

1. docs PR 合併。
2. T0：協調者在 `feature/ai-voice` 寫假辨識器與隔離測試，跑一次確認紅的原因正確，commit（先不 push）。
3. T1：派 Codex。
4. T2：驗收、merge 子分支、文件、PR、部署。
5. T3：開發者現場測。
6. T4：收尾 docs PR。

## 3. 風險與對策

| 風險                                                                   | 對策                                                                                                              |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 真的 Chrome 的事件順序和假辨識器不同（例如沒有 `audiostart` 就 `end`） | 假辨識器不自動送事件，測試涵蓋 SC-SR4 的 6 種順序。T3 實測發現新的順序就補測試，不用延遲或自動重開掩蓋（spec §7） |
| jsdom 沒有 `SpeechRecognition`，也不保證有 `isSecureContext`           | T0 的安裝函式兩個都設，`uninstall()` 還原，避免污染其他測試                                                       |
| 實作用 `addEventListener`，假辨識器只支援 `on*`，測試照不到            | 假辨識器兩種都送                                                                                                  |
| 漏了某條改 `text` 的路徑沒加版本，舊結果蓋掉使用者剛打的字             | 版本放在 ai-session 裡統一處理。SC-SR6 第 3 項用「改了又改回原字串」驗，T2 用突變檢查確認這條測試真的擋得住       |
| StrictMode 讓 effect 跑兩次，第一次的清理把新一輪取消                  | 清理只取消「自己那一輪」的操作 id。SC-SR6 第 6 項在 StrictMode 重跑                                               |
| 點 Chrome 的權限視窗會讓頁面 `blur`，被誤判成取消                      | 只聽 `visibilitychange`。SC-SR5 第 4 項驗 `blur` 不取消                                                           |
| 分頁在背景時 timer 延後，時間上限不準                                  | 背景就取消（決策 350 (e)），不依賴背景的 timer                                                                    |
| 語音填入超過 200 字，`maxLength` 擋不住程式設的值，按送出被後端回 400  | `handleSubmit` 先用 code point 算長度擋下（SC-SR9 第 3 項）                                                       |
| Google 語音服務不通或有使用限制                                        | 錯誤訊息照決策 354，打字照常可用。T3 冒煙驗網路不通的情況                                                         |
| Playwright 的 Chromium 沒有真的語音服務                                | e2e 只用假建構子。真辨識只在 T3 用開發者的 Chrome                                                                 |
| Web e2e 不能平行跑，worker 跑會撞到別的 worktree                       | worker 不跑，協調者在 T2 先確認沒人在跑再跑                                                                       |
| T0 的紅測試留在整合分支上                                              | T1 轉綠之前不 push 整合分支                                                                                       |
| 第一次用時 Chrome 的權限視窗擋住畫面，15 秒開始上限先到                | 15 秒從 `start()` 算，使用者通常幾秒內就按允許。T3 第一次使用時記實際秒數；太短就照決策 353 (f) 記證據再問開發者  |
| Codex 額度用完                                                         | 網頁任務不換層（`docs/orca-multi-agent.md` §4），等額度恢復                                                       |
| 將來部署到外網沒有 HTTPS，按鈕消失                                     | spec §8 已寫明。這一輪只在 localhost                                                                              |

## 4. 驗證點

- T0 後：`pnpm --filter @ledger/web typecheck`、`lint` 綠；新測試只因「找不到麥克風按鈕」而紅；既有測試全綠。
- T1 後：Web 單元測試全綠（含 T0 的隔離測試）；既有 AI 測試內容沒改；`git diff` 只碰 `apps/web`；`package.json` 與 lockfile 沒變。
- T2 後：全部檢查與 Web e2e 綠；2 處突變檢查都會變紅；CI 全綠。
- T3 後：SC-SR14～SR16 的表填完，門檻結果照實記。

## 5. 要開發者決定的事

沒有新的取捨。以下 2 點是 plan 對 spec 的解讀，核可本 plan 時一起確認：

1. 辨識期間按 Escape 只取消，不收合入口；焦點回到麥克風按鈕。不在辨識期間，Escape 照現有行為收合。
2. 按星芒按鈕收合時，辨識取消，焦點留在星芒按鈕（使用者剛按的那顆），不跳到麥克風按鈕。

## 6. 派工

- T1 用 `orca orchestration` 派給 `default` 角色（兩段式啟動），Task spec 照 `docs/orca-multi-agent.md` §3 的格式。開頭寫「先讀根目錄與 `apps/web` 的 `CLAUDE.md`」，附本 plan §1.2 全文與 spec 決策 347～354、W257～W259、§5、§7。
- Constraints 加寫：只改 `apps/web`；不加套件；不跑 Web e2e；不改 T0 測試的斷言；不改既有 AI 測試的內容。
- 驗收：協調者逐行看 diff，自己重跑 Web 單元測試與全部 Web e2e。
- worker 驗收合併後，立刻清 worktree、分支、終端機。

## 7. 實作紀錄

### T0（2026-10-29，協調者，`94ef4ab`）

- 新增 `apps/web/src/features/ai/test-support/fake-speech-recognition.ts` 與 `AiEntry.voice-isolation.test.tsx`。
- 隔離測試 19 條全紅，原因都是找不到「開始語音記帳」按鈕。
- 既有 Web 單元測試 1153 條全綠（138 個檔，只有新檔失敗）。typecheck、lint 綠。
- 「開新的一輪」不放進 9 種取消條件的表：決策 348 (b) 規定辨識中不能開始新一輪，改由 SC-SR5 (3) 測「取消後馬上開新一輪」。

### T1（2026-10-29 派工）

- worktree `aiv-voice-ui`，分支 `feature/aiv-voice-ui`（從 `feature/ai-voice` 的 `94ef4ab` 開），`default` 的 Codex。
