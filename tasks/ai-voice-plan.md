# 4a 補充實作計畫：語音記帳（桌機 Chrome，Web Speech API）

spec：`docs/specs/phase-4a-voice.md`（決策 346～360、W257～W259、W288、SC-SR1～SR18）。只改 `apps/web`。第 1 版功能一個 PR（#209），第 3 版改版（§1.3b）另一個 PR。

> 核可：spec 第 2 版由開發者 2026-10-29 回「核可」核可（含 §10 第 2 版要確認的 3 點）。本 plan、todo（含 §5 的 2 點解讀）開發者 2026-10-29 回「核可」核可。
>
> 第 3 版：開發者 2026-10-29 回「同意」核可 spec §10 第 3 版的 4 點。§1.3b 的 T0b、T1b、T2b 與 §5 第 3、4 點，開發者 2026-10-30 回「核可」核可。
>
> 第 4 版：spec §10 第 4 版的 4 點、§1.3c 的 T1k 與 T2b 追加驗收、§5 第 5 點，開發者 2026-10-30 回「繼續」核可。

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

### 1.3b 第 3 版改版（T0b 協調者、T1b `default` 的 Codex、T2b 協調者）

開發者看過 #209 後要 3 項修改：拿掉可見的狀態文字改用麥克風動畫、輸入欄加清除鈕、拿掉取消按鈕改成再按麥克風取消。spec 第 3 版寫成決策 358～360、W258、W259、W288、SC-SR17、SC-SR18。T3 排在改版之後，真實驗收測的是改版後的畫面。

分支：docs PR 用 `docs/ai-voice-v3`（現在的 `docs/ai-voice-t3` 改名）。整合分支 `feature/ai-voice-v3`，從合併後的 `main` 開，用 `ai-4a` worktree。worker 子分支 `feature/aiv-voice-v3-ui`。

**T0b：協調者先改隔離測試，讓它先紅。** 只改 `AiEntry.voice-isolation.test.tsx`，防線的斷言一條都不刪：

- `micButton` 的名稱改成「開始語音記帳」或「取消語音」。`startListening` 等到「取消語音」。
- SC-SR5 (1) 改成準備中、聆聽中、辨識中各 1 條：再按麥克風 → `abort` 1 次、`stop` 0 次 → 舊實例晚送的事件不改輸入欄、不顯示錯誤、`parse` 0 次。原本「停止後 final 照常填入」的案例移到 SC-SR8 (1)（30 秒上限），由 T1b 寫。
- 取消條件表的「按『取消語音』」改成「再按麥克風」。其餘 9 種不動。
- 新增 SC-SR7 (1) 連按：同一個 `user` 連按 2 次 → 1 個實例、`start` 1 次、`abort` 1 次。
- 新增「沒有第 2 顆取消按鈕」：辨識期間名稱是「取消語音」的按鈕只有 1 顆，就是麥克風。
- 紅的原因只接受 2 種：找不到名稱是「取消語音」的麥克風，或準備中、辨識中的麥克風停用按不到。commit 後先不 push。

**T1b：Codex 實作。** 樣式、圖示、動畫由 Codex 決定，只用 `global.css` 的設計 token。行為照決策 358～360：

1. `use-voice-input.ts`：準備中、聆聽中、辨識中再按都走取消。hook 內部的停止（`stopOperation`）只留給 30 秒上限。連按用同步的鎖判斷，不加延遲或 debounce。
2. `AiEntry.tsx`：
   - 拿掉「取消語音」按鈕。麥克風在準備中、辨識中也能按（現在 `AiEntry.tsx:179` 的 `canStop`、`microphoneDisabled` 會擋）。
   - 拿掉可見的狀態文字，保留視覺隱藏的 live region（W258）。
   - 加清除鈕（W288），顯示條件與處理函式的檢查照決策 360 (a)。
   - 錯誤的優先序維持 `lengthError ?? voice.error ?? error`（`AiEntry.tsx:81`）。清除鈕要讓 3 個都消失。
3. `ai-session.tsx`：加一個只清文字與錯誤的動作（例如 `clearInput`）。現在的 `setText`（`ai-session.tsx:137`）不清 `session.error`，不能直接拿來用。輸入版本照現有規則加 1。
4. CSS：
   - 收回為取消按鈕預留的寬度與偏移（`AiEntry.module.css:35`、`:165`、`:217`）。
   - 輸入欄右側預留清除鈕的空間。
   - 麥克風的「等待」「收音」2 種樣子用形狀與動畫區分（SC-SR18 看狀態屬性，例如 `data-voice-look`）。
   - `data-motion='off'` 時改用靜態形狀。現有固定 700ms 的 spinner 不會因為 motion token 歸零而停，新動畫要自己處理。
5. 測試：
   - `AiEntry.voice.test.tsx` 改寫按「停止聆聽」與「取消語音」的案例。`AiEntry.voice.test.tsx:413`「找不到 status」改成驗 live region 存在而且內容是空的。
   - SC-SR8 (1) 用假 timer 驗 30 秒上限仍是 `stop()`，final 照常填入。SC-SR8 (3) 原本靠按麥克風進入停止，改成用 `audioend` 或 30 秒上限觸發。
   - 補 SC-SR3 (4) 的清除鈕路徑、SC-SR12、SC-SR17 4 項、SC-SR18 3 項。
   - `e2e/ai-voice.spec.ts:175` 的取消改成按麥克風（SC-SR13 (2)）。
6. 不改 T0b 隔離測試的斷言。不改 API、`packages/shared`，不加套件。

**T2b：協調者驗收。** 照 §1.3，另加：

- 逐行看 diff：再按麥克風一律走取消路徑，`stop()` 只剩 30 秒上限會呼叫；清除鈕不碰草稿、不送 API。
- 突變檢查 3 處，各自要讓測試變紅，再還原：
  1. 再按麥克風改回呼叫 `stop()`。
  2. 清除鈕的處理函式拿掉「解析中」的檢查。
  3. `data-motion='off'` 時 2 種樣子改成相同。
- 全部 Web e2e。合併後請開發者在 Chrome 按 `Ctrl + Shift + R`，看動畫與清除鈕。（第 4 版起改成合併前看，見 §1.3c。）
- 真的 Chrome 冒煙：在 3 個時間點各按一次麥克風取消：第一次要權限的視窗出現時、收音中、`audioend` 之後。這 3 項併進 T3 的 SC-SR16 冒煙，照實記。

### 1.3c 第 4 版動畫（T1k `backend` 的 Codex；驗收併入 T2b）

開發者看 #212 後要改動畫。T1c～T1j 在對比頁（`docs/artifacts/`，不進版控）試了 B1～B4，開發者 2026-10-30 採用 B4「外圈落點」。spec 第 4 版寫成決策 359 (f)～(h)、`SC-SR18` (4)～(7)。各輪經過記在 §7。

T1k 依開發者「更強的codex」的要求用 `backend` 角色，因為要處理可中斷的連續變形與生命週期驗證。這是本任務的例外，其他網頁任務仍派 `default`。模型與強度只看角色表。

分支：worker 子分支 `feature/aiv-voice-v3-anim`（沿用，已合併到整合分支 `64e75e5`）。從整合分支最新的 commit 繼續。

**T1k：Codex 把 B4 實作進正式頁面。** 做法採 advisor 推薦的 A：純函式負責規劃與取樣，`requestAnimationFrame` 只寫 SVG。

1. 新增純函式模組（例如 `voice-glyph-geometry.ts`）。拆成 2 個函式：「規劃轉場」輸入目前的完整形狀與目標樣子；「取樣」輸入規劃結果與經過的時間，輸出完整形狀（每個點的身分、座標、不取餘數的轉角、筆畫形狀）。不要用「狀態＋進度」當輸入。幾何與時間參考對比頁 B4，閒置的形狀用原本麥克風圖示的路徑。
2. B4 原型有 3 處不照抄：
   - 辨識中會合回麥克風（原型的 `snap()` 把 recognizing 當閒置）。正式版辨識中一直是 5 點在轉（決策 359 (f)）。
   - 動畫關閉時仍在排幀。正式版不排（決策 359 (h) 3）。
   - 固定等 900ms 才進收音，拆解途中收到 `audiostart` 會跳位。正式版從當下形狀接（決策 359 (h) 2）。
3. 新增獨立的 `VoiceGlyph` 子元件，避免 `AiEntry` 的 early return 讓 Hook 變成有條件呼叫。
   - 當下的形狀、frame id、世代編號都存在 ref。每幀直接寫 5 個 path 的 `d`，不呼叫 `setState`。
   - 寫法參考 `use-trend-animation.ts`（rAF、ref、MutationObserver）。
   - 動畫開關用 `isMotionEnabled`（`apps/web/src/app/use-motion.ts`）並觀察 `data-motion` 的變化。`useMotion()` 不會跟著設定改變，不能直接用。
   - 圖示整個 `aria-hidden`、`focusable="false"`、`pointer-events: none`，不加 `role` 或 `title`。取消記號是固定在角落的獨立元素，跟著「語音進行中」立刻出現。
4. `AiEntry.tsx`：`data-voice-look`、`aria-label`、live region、停用、焦點照現有方式在 render 當下改，不等動畫（決策 359 (h) 1）。`use-voice-input.ts` 預期不需要改，不能用 `transitionend` 或動畫結束的回呼決定語音狀態。
5. `AiEntry.module.css`：拿掉被取代的虛線環與跳動長條的樣式與 keyframes。只用 `global.css` 的設計 token。
6. 測試：
   - 新純函式的單元測試，照 `SC-SR18` (4)。
   - `AiEntry.voice.test.tsx` 補 `SC-SR18` (5)～(7)。假 rAF 要能手動推進；假 timer 不要用 `runAllTimers`（繞圈不會停）。
   - 現有的 (1)～(3) 行為照舊要綠。綁舊圖示 class 或舊 CSS 的斷言（約在第 990～1074 行）可以改成驗新的 SVG。第 1103 行自稱 SR18(4) 的那條，併進新的 (5)。
   - 隔離測試檔不改。e2e `ai-voice.spec.ts` 點擊後馬上送 `audiostart` 的寫法不改，不加等待。
7. 不呼叫 `getUserMedia`、`MediaRecorder`、`AudioContext`。不改 API、`packages/shared`，不加套件。不跑 Web e2e。

**T2b 追加的驗收：**

- 逐行看 diff：`requestAnimationFrame` 在卸載、狀態改變、motion 改成 off 時都有取消；狀態判斷沒有被動畫延後；舊動畫的回呼不會蓋掉新的。
- 突變檢查追加 4 處，各自要讓測試變紅，再還原：
  1. 落點對應改錯一根（例如左邊的點落到第 2 根）。
  2. motion off 時照樣排 `requestAnimationFrame`。
  3. 轉角改成走最短路徑或反向。
  4. 途中改變時，改從預設姿態開始，不從當下形狀接。
- T2b 原本的 3 處突變檢查重跑一次。第 3 處要真的改繪圖輸出（收音也畫成 5 點），不能只改 `data-voice-look`。
- 在正式頁面用可以控制的假事件跑 4 段轉場（拆解、落點、聆聽中取消、準備中取消），加上快速連按與途中改變。錄影或逐幀看，和對比頁的 B4 比對。
- 可以先 push 跑 CI。給開發者看 5174 預覽，開發者同意、CI 全綠後才合併 #212。這條取代 §1.3b 與 §5 第 3 點「合併後再看、不擋合併」的安排。

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
5. 第 3 版 docs PR（spec 第 3 版、plan、todo、編號登記）合併。
6. T0b：協調者在 `feature/ai-voice-v3` 改隔離測試，確認紅的原因正確，commit（先不 push）。
7. T1b：派 Codex。
8. T2b：驗收、merge 子分支、PR、部署。
9. T3：開發者現場測（含 §1.3b 的 3 個取消時間點）。
10. T4：收尾 docs PR。

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
| 第 3 版：使用者以為再按麥克風會保留說過的話，結果被取消                | 圖示不用方形的停止符號（決策 358 (g)）。T3 照實記開發者的感受，要改再問                                           |
| 第 3 版：連按 2 次被當成「開始又馬上取消再開始」，建出 2 個實例        | 同步的鎖，T0b 的 SC-SR7 (1) 驗 1 個實例、`start` 1 次、`abort` 1 次                                               |
| 第 3 版：準備中、辨識中的麥克風仍停用，使用者只能等                    | T0b 的 SC-SR5 (1) 在 3 個狀態各按一次，停用就紅                                                                   |
| 第 3 版：清除鈕順手清掉草稿或送出 API                                  | 決策 360 (c)。SC-SR17 (2) 驗草稿保留、請求數不變；T2b 突變檢查                                                    |
| 第 3 版：關掉動畫後 2 種樣子變得一樣，只剩隱藏文字不同                 | SC-SR18 (2) 看狀態屬性；T2b 突變檢查                                                                              |
| 第 3 版：改寫既有語音測試時順手刪掉防線                                | T0b 的隔離測試由協調者改，T1b 不能動斷言；T2b 比對 diff                                                           |

## 4. 驗證點

- T0 後：`pnpm --filter @ledger/web typecheck`、`lint` 綠；新測試只因「找不到麥克風按鈕」而紅；既有測試全綠。
- T1 後：Web 單元測試全綠（含 T0 的隔離測試）；既有 AI 測試內容沒改；`git diff` 只碰 `apps/web`；`package.json` 與 lockfile 沒變。
- T2 後：全部檢查與 Web e2e 綠；2 處突變檢查都會變紅；CI 全綠。
- T0b 後：隔離測試只因 §1.3b 列的 2 種原因而紅；Web typecheck、lint 綠。
- T1b 後：Web 單元測試全綠（含 T0b 的隔離測試）；SC-SR17、SR18 有測試；`git diff` 只碰 `apps/web`；`package.json` 與 lockfile 沒變。
- T1k 後：Web 單元測試全綠（含 `SC-SR18` (4)～(7)）；隔離測試檔沒改；`git diff` 只碰 `apps/web`；`package.json` 與 lockfile 沒變。
- T2b 後：全部檢查與 Web e2e 綠；7 處突變檢查都會變紅；開發者看過預覽並同意；CI 全綠。
- T3 後：SC-SR14～SR16 的表填完，門檻結果照實記。

## 5. 要開發者決定的事

沒有新的取捨。以下 2 點是 plan 對 spec 的解讀，核可本 plan 時一起確認：

1. 辨識期間按 Escape 只取消，不收合入口；焦點回到麥克風按鈕。不在辨識期間，Escape 照現有行為收合。
2. 按星芒按鈕收合時，辨識取消，焦點留在星芒按鈕（使用者剛按的那顆），不跳到麥克風按鈕。

第 3 版（§1.3b）另外 2 點，核可時一起確認：

3. 動畫與清除鈕的樣式由 Codex 決定。合併後你在 Chrome 看。想改就另開一個小 PR，不擋這次合併。（動畫部分已被第 4 版取代：合併前看預覽，見 §1.3c。）
4. 隔離測試原本有 1 條「按停止聆聽，final 照常填入」。使用者已經按不到停止，這條改由 T1b 寫在 SC-SR8 (1)，用 30 秒上限觸發停止。其他防線斷言照舊保留。

第 4 版（§1.3c）另外 1 點，核可時一起確認：

5. T1k 派 `backend` 的 Codex，不是 §6 寫的 `default`。理由見 §1.3c。

## 6. 派工

- T1 用 `orca orchestration` 派給 `default` 角色（兩段式啟動），Task spec 照 `docs/orca-multi-agent.md` §3 的格式。開頭寫「先讀根目錄與 `apps/web` 的 `CLAUDE.md`」，附本 plan §1.2 全文與 spec 決策 347～354、W257～W259、§5、§7。
- Constraints 加寫：只改 `apps/web`；不加套件；不跑 Web e2e；不改 T0 測試的斷言；不改既有 AI 測試的內容。
- 驗收：協調者逐行看 diff，自己重跑 Web 單元測試與全部 Web e2e。
- worker 驗收合併後，立刻清 worktree、分支、終端機。
- T1b 一樣派 `default` 的 Codex。附本 plan §1.3b 全文與 spec 決策 350、353、358～360、W258、W259、W288、SC-SR3、SR5、SR7、SR8、SR12、SR13、SR17、SR18。
- T1b 的 Constraints：T1 的那幾條，但「不改既有 AI 測試的內容」改成「只改語音相關測試裡按停止與取消按鈕的案例」。打字流程的 AI 測試仍然不能改。
- T1k 派 `backend` 的 Codex（一行啟動），在 `aiv-voice-v3-anim` worktree。附本 plan §1.3c 全文與 spec 決策 358 (g)、359、W258、`SC-SR18`。Constraints：T1 的那幾條，加上「隔離測試檔不改；語音測試只改綁舊圖示的斷言；不 push」。

## 7. 實作紀錄

### T0（2026-10-29，協調者，`94ef4ab`）

- 新增 `apps/web/src/features/ai/test-support/fake-speech-recognition.ts` 與 `AiEntry.voice-isolation.test.tsx`。
- 隔離測試 19 條全紅，原因都是找不到「開始語音記帳」按鈕。
- 既有 Web 單元測試 1153 條全綠（138 個檔，只有新檔失敗）。typecheck、lint 綠。
- 「開新的一輪」不放進 9 種取消條件的表：決策 348 (b) 規定辨識中不能開始新一輪，改由 SC-SR5 (3) 測「取消後馬上開新一輪」。

### T1（2026-10-29 派工）

- worktree `aiv-voice-ui`，分支 `feature/aiv-voice-ui`（從 `feature/ai-voice` 的 `94ef4ab` 開），`default` 的 Codex。
- 第 1 輪交付 `c90c7e6`。驗收退回 3 個必修問題，都先用臨時測試在 worker 的 worktree 重現：
  1. 語音填入一次後，每打一個字游標都跳到最後（焦點 effect 每次 `text` 改變都重跑）。
  2. 按「取消語音」後焦點掉到 body，不回麥克風按鈕（W259）。
  3. 「請精簡至 200 字內。」刪到 200 字後還留著（決策 349 (g)）。
  - 另 2 個小調整：不在辨識期間只有輸入欄的 Escape 會收合；假辨識器過時的註解。
- 第 1 次退回用 `reply`，Codex 沒收到，空等 50 分鐘。`worker_done` 後任務就結束了，改成對同一個終端機重新 `worker-start`（已補進 `docs/orca-multi-agent.md` §2）。
- 第 2 輪交付 `b7f41d4`，3 個問題都修好，各補 1 條單元測試。驗收通過。
- Codex 回報的 10 條逾時是當時機器負載：同一台機器在整合分支重跑沒有逾時。

### T2（2026-10-29，協調者）

- 協調者補 `ab6c788`：同一批更新裡「改字再改回」的隔離測試。原本的 SC-SR6 (3) 分成 2 次 `act`，中間有一次 render 看得到 `x`，「輸入欄有字就不能開始」先取消了這一輪，拿掉輸入版本檢查也不會紅。
- 突變檢查（`use-voice-input.ts` 的 `isCurrentOperation`）：
  - 帳本 id 檢查改成 `true`：3 條變紅（SC-SR6 (1) 2 條、SC-SR5 (2) 切帳本）。
  - 輸入版本檢查改成 `true`：補了 `ab6c788` 之後 1 條變紅。
  - 兩處都已還原。
- `git merge --no-ff feature/aiv-voice-ui`（`46c7bb6`）。
- 根目錄檢查（`b7f41d4`）：lint、typecheck、format:check、test 全部 exit 0。shared 160/160、api 60 個 suite 956 條、web 139 個檔 1215 條。
- grep：語音檔案沒有呼叫 `parse(`，沒有 `console.`、`localStorage`、`getUserMedia`、`MediaRecorder`。`parse(` 只在 `AiEntry.tsx` 的 `handleSubmit`。
- `pnpm build` exit 0。全部 Web e2e（`46c7bb6`）140 passed（6.7 分鐘），含 `ai-voice.spec.ts` 的 SC-SR13 第 1～3 項，0 failed、0 flaky。

### T0b（2026-10-30，協調者）

- 只改 `AiEntry.voice-isolation.test.tsx`，防線的斷言沒刪。SC-SR5 (1) 分成準備中、聆聽中、辨識中 3 條；新增 SC-SR7 (1) 連按、決策 358 (b)「只有麥克風 1 顆取消鈕」2 條；取消條件表第 1 項改成「再按麥克風」。
- 28 條全紅，原因只有 plan 允許的 2 種：
  - 26 條：麥克風名稱不是「取消語音」。
  - 2 條（SC-SR7 (1)，一般與 StrictMode）：準備中麥克風停用，第 2 下按不到，`abort` 是 0。
- `startPreparing` 與 `startListening` 的 `waitFor` 設 `timeout: 2000`。`src/test/setup.ts` 的 `asyncUtilTimeout` 是 5000，和測試逾時一樣長，不設的話紅燈會顯示成逾時，看不出原因。
- Web typecheck、lint、prettier 綠。

### T1b（2026-10-30 派工）

- worktree `aiv-voice-v3-ui`，分支 `feature/aiv-voice-v3-ui`（從 `feature/ai-voice-v3` 的 `39137f6` 開），`default` 的 Codex。dispatch `ctx_01a38b02e519`。
- Orca 的 setup 沒有裝相依套件，協調者在 worker 的 worktree 手動跑 `pnpm install`。
- 第一次開的 Codex 終端機跳出更新提示，選 3 後關掉重開才派工。
- 交付 `6f8b3e1`，改 6 個檔，都在 `apps/web`：`use-voice-input.ts`、`AiEntry.tsx`、`AiEntry.module.css`、`ai-session.tsx`、`AiEntry.voice.test.tsx`、`e2e/ai-voice.spec.ts`。隔離測試檔沒改。
- `use-voice-input.ts`：拿掉 `stop`，改成 `toggle`。有進行中的語音就取消，否則開始。`stop` 只剩 30 秒上限在用。
- 麥克風：閒置名稱是「開始語音記帳」，其他狀態是「取消語音」。只有閒置且不能開始時才停用。`data-voice-look` 分 idle、recording、waiting 3 種樣子。
- 拿掉獨立的取消按鈕與可見的狀態文字。live region 保留，用 `visuallyHidden` 藏起來。
- 清除鈕：名稱是「清除輸入文字」，沒字時隱藏。解析中、語音進行中、不可寫入時按了不動作。按下後清掉文字與錯誤，再把焦點移回輸入欄。
- 動畫：聆聽中是 3 條跳動的長條，準備中與辨識中是旋轉的虛線環。`data-motion='off'` 時停掉動畫，2 種樣子改用不同的靜態圖形。
- 已知小瑕疵，不擋合併：SC-SR18 (2) 有部分靠比對 CSS 原始碼；圖示尺寸用 px 寫死。

### T2b（2026-10-30，協調者）

- 整合分支合併 worker 分支（`b4aa16b`）。
- 突變檢查 3 處，都已還原：
  1. `toggle` 改回呼叫 `stopOperation`：16 條紅。
  2. 清除處理拿掉解析中的檢查：1 條紅（SC-SR17 (3)）。
  3. 聆聽中也畫成等待的圖形：2 條紅（SC-SR18 (1)、(2)）。
- 根目錄 lint、format:check、test 綠：shared 160、api 1039、web 1234。
- typecheck 第一次紅在 `apps/api/src/users/home-layout.service.ts`（bigint 與 number 不符）。原因是這個 worktree 的 Prisma client 沒跟上 #206，跑 `prisma generate` 後綠。與本次改動無關。
- grep：語音檔案沒有 `console.`、`localStorage`、`getUserMedia`、`MediaRecorder`、`AudioContext`。`parse(` 只在送出處理。
- `pnpm build` exit 0。全部 Web e2e（`b4aa16b`）140 passed（6.6 分鐘），含 SC-SR13 第 1～3 項，0 flaky。
- worker 的終端機、worktree、分支已清掉。
