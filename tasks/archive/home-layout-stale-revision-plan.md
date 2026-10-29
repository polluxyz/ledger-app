# 首頁版面舊 revision 回繞風險提案

狀態：2026-10-28 協調者已受開發者授權核可方案 (b)，含下列兩項修訂；實作與驗證完成。

## 問題與原因

以下行號以調查基準 commit `83b2163` 為準。

- `apps/web/src/features/home/use-home-layout.ts:32` 設定 `staleTime: Infinity`；同檔 `:50–54` 直接從快取建立編輯工作階段。分頁可以長時間持有舊版面及 revision。
- `apps/api/src/users/home-layout.service.ts:45–53` 的原子更新只比對 revision，2147483647 的下一版回到 1。若舊分頁 revision 剛好再次出現，後端無法辨認它來自上一輪。
- `apps/web/src/features/home/use-home-layout.ts:100–109` 只有使用者選「用我的覆蓋」時才先 GET；普通「完成」直接 PUT。即使只在進入編輯時刷新，編輯中停放的分頁仍有相同問題。
- `apps/web/src/features/home/home-layout-save.ts:68–74` 處理的是 PUT 失敗後補查，無法阻止這種會成功的覆蓋。

可重現情境：分頁 A 取得 `{ revision: 7, layout: X }` 並保留草稿 Z；分頁 B 的更新經過完整回繞後變成 `{ revision: 7, layout: Y }`，其中 Y 與 X、Z 都不同。A 按「完成」，現況直接 PUT 會蓋掉 Y。測試直接模擬回繞後的伺服器狀態，不真的執行數十億次儲存。

## 做法比較

| 做法                                       | 保障與殘留風險                                                                                                                                                                                                                                       | 成本與相容性                                                                                                                               | schema / API                                      |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| (a) 接受風險，僅更新 spec                  | 風險完全保留；需明確接受分頁跨完整一輪 revision 後可能覆蓋                                                                                                                                                                                           | 無執行成本，沒有額外請求                                                                                                                   | 都不改                                            |
| (b) 前端刷新及儲存前比對（推薦儲存前比對） | 僅進編輯或 focus 時刷新只能縮短舊快取壽命，無法涵蓋長時間編輯；改為每次普通儲存前直接 GET，同時比對原 revision 與原始版面，可以攔住已發生的回繞。GET 到 PUT 之間仍非原子，若此間又完整回繞且內容改變，仍有理論風險；其他／舊版 client 也未獲保護     | 每次有改動的普通儲存多一次 GET 與最多 10 秒等待；GET 失敗時保留草稿、顯示錯誤，不冒險 PUT。沿用現有衝突彈窗、世代及中止機制                | 都不改                                            |
| (c) 後端擴充原子條件                       | GET 回傳另一個版本識別、PUT 帶 expected 值，資料庫原子比對兩者。現有 updatedAt 可免 schema，但只靠牆鐘時間可能同毫秒／時鐘回退，需保證每次更新至少比前值多一毫秒；另一種是新增 BigInt 單調版本，以字串傳輸且到上限拒絕寫入而不回繞，避免再次出現 ABA | 契約、DTO、shared 型別與所有呼叫端需同步；新增單調版本還要 migration／既有資料轉換。可在伺服器層避免所有 client 的同類覆蓋，但變更明顯較廣 | updatedAt 方案改 API；BigInt 方案改 schema 與 API |

## 推薦與假設

推薦 (b) 的「普通儲存前 GET + 比對原版面與 revision」，理由是風險源自跨完整回繞的長期分頁，將風險窗口縮到一次 GET→PUT，即可實質降低風險，且無需修改既有契約。只改 staleTime、進入編輯或 focus 刷新不夠，因此不採作主要防線，也不額外加入背景請求。

已核可的假設：本次目標是實質降低現行 Web 的風險，接受上表明列的短暫競態與舊 client 風險；若要求所有 client 都有原子保障，應改選 (c)，擴大 ownership 後另定具體契約。

前端的比對只是避免誤送，後端 revision 樂觀鎖仍是寫入一致性的權威。依核可修訂，若 GET 內容已與草稿結構相同，先視為已存，採用 GET 的 revision 並離開編輯，不發 PUT；否則任何 revision 或原版面差異都進現有衝突流程。普通儲存通過比對後仍使用原 revision；明確選「用我的覆蓋」維持先 GET 最新 revision 再 PUT 的既有行為。

## 影響檔案

- `apps/web/src/features/home/use-home-layout.ts`：普通儲存先走既有 `getLatestHomeLayout`，檢查世代、revision 及 `initialStoredLayout`；內容比較沿用 `isSameSavedLayout`，差異時保留草稿並設定衝突。
- `apps/web/src/features/home/use-home-layout.test.tsx`：增加回繞同 revision、不同 revision、GET 失敗／逾時、取消與換使用者、重設與 null 邊界等測試；調整既有請求數與 PUT 後補查 fixture。
- `docs/specs/phase-2l-home-layout.md`：依核可修訂既有決策 329，補充成功條件、成本與殘留競態，不新增決策號、不改 333 的 API 契約；SC-Y 新號先確認現有最大值。
- `tasks/home-layout-stale-revision-plan.md`：記錄核可、驗證結果及偏離。

`home-layout-save.ts` 的既有比較與逾時函式可直接重用，預期無需改；API 程式、DTO、schema、shared、CI、相依套件都不修改。

## 需要開發者核可

- 推薦 (b) 與上列風險界線已核可。協調者回覆本次受開發者授權審批，不另徵詢 advisor（本風險原由 advisor 提出）；決策 336 已占用，改修訂決策 329。
- 本推薦沒有新增套件、schema、API 或 CI 變更。若改選 (c)，須另行核可 schema／API 變更與 ownership 擴大，至少包括 response DTO、shared request/response 型別，BigInt 版本還包括 Prisma schema／migration；Web 與未來 App 都受契約影響。

## 實作順序與驗收清單

- [x] 協調者核可後先更新 2l spec，再新增同 revision／不同版面測試，確認修正前紅燈並保留結果。
- [x] 普通儲存先從網路 GET；最新版面與草稿不同、且同 revision 但原版面不同時不發 PUT、草稿不變，進既有衝突彈窗。
- [x] 最新版面與草稿不同、且 revision 不同時同樣不發 PUT；revision 與原版面都相同時仍以原 revision 儲存。
- [x] 最新版面與草稿結構相同（含重設 null）時採用 GET revision 並完成，不 PUT、不跳彈窗。
- [x] `null` 與明確存入預設版面維持不同語意；重設草稿不影響比對的原始基準。
- [x] GET 失敗／逾時不發 PUT、保留草稿與錯誤；請求中凍結草稿、避免重複送出，取消／登出／換使用者後晚到結果無效。
- [x] 「載入最新」重建比對基準；「用我的覆蓋」保留原本的明確覆蓋行為，仍可能因後續並發 PUT 收到 409。
- [x] home-layout 相關單元測試全部通過並回報實際數字。
- [x] 只執行 `apps/api/test/home-layout.e2e-spec.ts`，確認目標是 `ledger_revstale_test`，不執行 Web e2e，回報實際數字。
- [x] 使用 Node 24.22.1 跑 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm format:check`，全部 exit 0。
- [x] 自我 review、僅格式化修改檔案，在自己的分支 commit（英文 Conventional Commits），不 push、不開 PR。

## 測試策略

以 hook 單元測試控制 GET 回傳值，直接建立 A 的舊 revision／X，再切換成同 revision／Y，驗證 finishEditing 保留 Z 並且 PUT 次數為 0。這個測試在現況會失敗，可確實重現覆蓋風險；補測 revision 差異、null、正常儲存、覆蓋、GET 錯誤與中止，既有純儲存恢復測試繼續驗 PUT 後 409／網路錯誤／逾時。

測試指令均加 `fnm exec --using=24.22.1`：

```text
pnpm --filter @ledger/web test src/features/home/use-home-layout.test.tsx src/features/home/home-layout-save.test.ts src/app/home-layout-edit-store.test.ts src/features/home/home-layout-size.test.ts
pnpm --filter @ledger/api test --runInBand --runTestsByPath src/users/home-layout.service.spec.ts src/users/home-layout-body.guard.spec.ts
pnpm --filter @ledger/api test:e2e --runTestsByPath test/home-layout.e2e-spec.ts
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
```

## 執行紀錄

- 2026-10-28：讀過根目錄、Web、API 的 CLAUDE.md；`pnpm install` exit 0。當時尚未修改程式、尚未執行測試。
- 核可修訂：不新增決策號，在 329 末尾加入日期修訂；確認現有最大成功條件為 SC-Y30 後新增 SC-Y31；最新版面等於草稿時優先視為已存。已依此更新提案後實作，沒有其餘方向偏離。
- 紅燈證據：只新增重現測試、尚未修改 hook 時，`pnpm --filter @ledger/web test src/features/home/use-home-layout.test.tsx -t 'preserves the draft without PUT'` exit 1，2 failed／10 skipped；其中 revision 7 是完整回繞後同號、不同版面的情境，實際拿到 conflict null（舊程式接受 PUT 並結束編輯）。修正後此兩例與其他回歸全部通過。
- 相關 Web 單元：4 檔 51 passed；API 單元：2 suites、25 passed；指定 API e2e：1 suite、21 passed。e2e 啟動輸出確認資料庫為 ledger_revstale_test，只套用既有 28 份 migration，沒有跑其他 API e2e 或 Web e2e。
- 全專案最終 `pnpm test` exit 0：shared 160、API 956（60 suites）、Web 1147（137 files），合計 2263 passed。中途一次與 lint 同時執行時，Web 有 13 個不同檔案的第一個測試遇到 5 秒逾時（1134 passed）；停止平行檢查後，原指令重跑全綠（Web 29.22 秒），未因此修改程式或測試逾時設定，現象符合資源競爭，但未獨立證明因果。
- 最終 `pnpm lint`、`pnpm typecheck`、`pnpm format:check` 均 exit 0；`git diff --check` 通過。全部使用 Node 24.22.1。
- 驗證中修正新增測試的 async act lint 與 nullable renderHook props 型別；未修改相依、API、schema 或 CI。首次用 home-layout 路徑 pattern 跑 API 單元時，因 worktree 名稱也包含 home-layout 而選到全套 956 項；後來改用 runTestsByPath，獨立確認相關 25 項。
- 自我 review：普通儲存沿用原 revision 與原始基準、GET 不取查詢快取、相同草稿優先完成、null 語意獨立、明確覆蓋維持 GET 後 PUT；取消／登出／換使用者與逾時的晚到結果不會 PUT。僅修改 ownership 內 4 個檔案，沿用現有比較與逾時函式。
- 已核可的限制：每次普通儲存增加一個 GET、GET→PUT 間完整回繞的競態及舊 client 未受保護。
