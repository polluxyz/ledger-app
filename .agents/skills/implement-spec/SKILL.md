---
name: implement-spec
description: '以 Orca 依任務相依關係完成已核可的 ledger-app spec／子階段，持續續派、整合與驗收。'
license: MIT
metadata:
  source: 'mattpocock/skills@5beb35b040e3de97e54fa9e386d7e42d15c295c2'
---

# 完成整份 Spec

改寫自 Matt Pocock 1.3.1 的 [implement-spec](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/implement-spec/SKILL.md)。授權見 [MIT notice](../LICENSE.mattpocock.txt)。

以使用者指定且已核可的 spec／plan／todo 為範圍，透過 Orca 持續推進可開工的任務，直到整份範圍通過整合驗收。核可過的決定與測試介面沿用，執行中不逐張向使用者重問；例外見「決策門控」。

## 載入契約與恢復現況

1. 讀 [CLAUDE.md §5、§10、§11](../../../CLAUDE.md)、[多代理派工規則](../../../docs/orca-multi-agent.md)，以及 `CLAUDE.md` §11 指定的交接文件（目前的分工、平行分支與共用資源）。動到 `apps/api` 或 `apps/web` 的任務，另讀該 app 的 `CLAUDE.md`。
2. 下 Orca 指令前，用 `orca skills get orchestration` 與 `orca skills get orca-cli` 取得版本相符指南（指南由 orca 執行檔提供，不依賴 agent 是否裝了同名 skill）。展開任務圖時另取 `orca skills get orchestration --reference references/coordinator-loop.md`，新 worktree 放置與整合分支基底依 `--reference references/placement-and-remote.md`；這兩份不在本 skill 目錄。沿用其確認過的 CLI，不以 Claude Code 內建的 Agent tool 取代 Orca。
3. 解析傳入的 spec 路徑或階段代號（如 `3l`、`2j`），讀 `docs/specs/` 的 spec、`tasks/<功能>-plan.md`、`tasks/<功能>-todo.md` 與成功條件。確認哪些範圍已核可；只有核可狀態或範圍確實缺失時，才提出需要使用者決定的問題。
4. 先查分支、未提交變更、既有 Run／Task／Dispatch、已整合的 commit 與驗收紀錄。恢復同一批工作時接續已確認的狀態，避免重建任務、重派仍在工作的 worker，或覆寫他人的修改。
5. 依[多代理指南 §1](../../../docs/orca-multi-agent.md#1-分工)確認本工作區已核可的範圍，由當地協調者拆分及指派任務。

## 建立任務圖

在 todo 中記下每項任務的角色、驗收條件、真正的前置任務與 Target／Ownership。沒有明寫的依賴要標為推論並以實際介面核對。缺少任務清單時，先提出拆分。

依賴圖要無循環；檢查每個成功條件都有任務或整合驗收覆蓋。沿用 Orca Task 的依賴與狀態作為執行記錄，plan 的實作紀錄留對應 ID、分支、commit 與驗收證據。Orca 的 ready view 是派工候選；協調者另外確認前置成果已驗收且整合，才實際派工。

可開工代表前置任務已驗收且整合到本批工作的基底。資源限制另行協調，資源忙碌時先派可獨立進行的工作，不能把忙碌判成任務失敗：

- **測試資料庫**：派工前由協調者依[測試環境](../../../docs/operations/test-environment.md)配置及核對。worker 禁止接觸 `ledger_dev`。
- **Web e2e**：Playwright 用固定 port 3100／5273，整台機器同時只能一個 worktree 跑，平行的其他分支 session 也算在內。跑之前先看 port 有沒有被占。API e2e 各用各的資料庫就能平行。
- **dev 環境**：port 3000／5173 是開發者在主工作區跑的 dev 伺服器。部署到 dev 只在主工作區做，依交接文件的部署步驟。
- **Codex 額度**：每次啟動子工作區的新規劃前，依 `docs/orca-multi-agent.md` §4 查當前 5 小時與週用量。該門檻只用於那次規劃。實作與顧問各依 §0 的角色表。
- **會花錢的外部呼叫**：例如真的 LLM provider。只在 spec 或使用者授權的驗收項目執行。
- **檔案 Ownership**：重疊的檔案不能同時派給兩個 worker。

## 派工與持續續派

- 以一個已確認的 feature 分支收斂本批成果。合適的既有工作區與分支直接沿用。新 worker 預設用 `--worktree new-child`，並指定整合基底。預建時用 `--parent-worktree` 明確指定父工作區。只有開發者明確要求才建頂層。保留既有未整合成果。
- 依 `docs/orca-multi-agent.md` §3 的 Task spec 契約派出可開工的任務。模型與強度依 §0 的角色表。實作範圍、網頁分工與備援依 §1 及 §4。
- 派出可以獨立進行的任務後，先做可推進的當地工作。無事可推進時結束回合，等 Orca 喚醒。依回執處理下一步。
- 讓 worker 以已核可的介面寫行為測試，逐項實作。預設不跑 e2e；未授權執行的 e2e 或外部呼叫在回報中標為未執行，留給協調者驗收。任何測試指令都不能繞過資源限制。
- 接收 `worker_done` 後，依當前 Dispatch 核對結果、完整的 `git status` 與 `git diff`、驗收證據及是否有計畫外變更。當地協調者自己重跑 `pnpm typecheck` 與 `pnpm test`。Orca 會結算有效的完成回報。驗收未過時依指南修正並暫停後續相依任務。原因不明時先依 `systematic-debugging` 找根因。通過且整合後才解除相依。循版本相符指南處理 Dispatch。
- 一次只做一項整合。worker 合併當前整合分支後重跑受影響檢查，再整合其成果；有衝突時由一位指定 owner 處理並重新驗證。被依賴任務完成後立即重算可開工集合並續派，無需使用者逐張下 prompt。
- worker 驗收並整合後，依當前 Orca 指南處理其 Dispatch。工作區與分支交由主工作區依 `docs/orca-multi-agent.md` §7.2 清理。
- 額度、失敗、逾時與重派依 `docs/orca-multi-agent.md` §4 及 Orca 回傳的下一步處理。未知存活狀態不代表已退出，不啟動重複 editor；保留已完成的修改與任務對照，供恢復時查證。

## 決策門控與溝通

- `CLAUDE.md` §5 「決策門控」的四件事（資料模型、API 介面、相依套件、CI），即使 plan 已寫到，動手前仍先向使用者說明。偏離已核可的 spec 或 plan 之前先停下說明；在核可範圍內解得掉的問題，解掉並記進 plan 的實作紀錄。
- 跟自己派出的 worker 透過 `orca orchestration` 溝通。需要開發者決定時，在當地依 `docs/orca-multi-agent.md` §1.1 同時徵詢 2 位獨立顧問，再直接與開發者討論。
- 跨線節點回報與共用資源衝突依[多代理指南 §1](../../../docs/orca-multi-agent.md#1-分工)。

## 整份驗收與收尾

各任務通過後，在整合分支驗收所有 spec 成功條件與 `CLAUDE.md` §3 的品質檢查，兩套 e2e 依上述資源限制執行。動到 schema、API、授權的部分，協調者逐行看 diff（授權條件、交易邊界、migration SQL），並自己重跑隔離測試與兩套 e2e。最後由當地協調者指派未實作該部分的 reviewer 唯讀審查，也涵蓋協調者自己寫的部分。審查涵蓋專案規範與 spec 的完整性、正確性及範圍。保留兩類結果與修正後的證據。

PR 依 [pr skill](../pr/SKILL.md) 撰寫，開 PR、CI、落後 `main` 時的處理與合併依 `CLAUDE.md` §10。只有已驗收且整合的任務才能標記完成。整份 spec 須通過全部成功條件才算完成。主工作區依 `docs/orca-multi-agent.md` §7.2 整理工作區與分支。整合分支專屬的測試資料庫先列名單給開發者確認再刪。`ledger_dev`、`ledger_test` 與仍在使用的 worktree 的資料庫保留。

依 `CLAUDE.md` §5「報告方式」交代：已完成範圍、整合 commit／PR、驗收的實際數字、偏離 plan 與剩餘問題。同時更新 `docs/README.md` 的 spec 狀態，把做完的 plan／todo 移到 `tasks/archive/`。遇到範圍外設計、缺少必要權限或無法確認的執行狀態時，保存狀態並明確回報需要處理的部分。使用者之後可手動啟動 `retro`，本流程不自動修改環境規則。
