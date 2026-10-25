# 交接：4a AI 文字記帳（`ai-4a`）

入口與跨工作區規則見 [`../handoff.md`](../handoff.md)。

## 4a 現況（2026-10-23）

- worktree `ai-4a`，測試資料庫 `ledger_ai_test`。`feature/phase-4a-ai` 已經 squash merge（#155，`f35485b`）並部署到 dev。
- T0～T6 完成。T6 用真的模型 `glm-5.3`（z.ai）跑 SC-P10，15 次全對。各任務的 commit、6 輪實測、dev 驗證結果見 `tasks/archive/phase-4a-plan.md` §1.7、§7。
- 主工作區的 `apps/api/.env` 設了 `LLM_PROVIDER=glm`、z.ai 端點、`GLM_REASONING_EFFORT=low`。金鑰只在那裡。
- dev 的 a@a.com 在「test 的帳本」多了「早餐」「午餐」分類與「信用卡」帳戶，給假 provider 的固定句子用。
- 預覽頁（不進版控）：`docs/artifacts/step-4a-ai-draft-preview.html`。

## 新分類提議（2026-10-24 核可，#161 合併，已部署並驗完真的模型）

- spec `docs/specs/phase-4a-ai-new-category.md`，plan 與 todo 在 `tasks/archive/ai-new-category-*.md`。T0～T6 都做完；實作紀錄見 plan §7。
- T5：dev 已重新 build（沒有 migration）。a@a.com 的「test 的帳本」與「tttest」各多一個「日用品」分類，測試交易已軟刪除。
- T6：glm-5.3 跑 SC-P17 與 4a SC-P10 第 5、6、8 步，24/24。保留預設分類的對照輪，分類 9/9 對，1 次 25 秒逾時。
- 會改 API：草稿與新增交易都多一個 `newCategoryName`。不改 schema。
- 開發者原話：「z.ai只會用到28號 之後就會換其他模型喔 先暫時用這個」。所以：
  - 不做 z.ai 專屬的工作。`GLM_BASE_URL` 的預設值（bigmodel.cn）先不改。`advisor` 建議現在改成 `https://api.z.ai/api/paas/v4`，開發者核可 spec §10 第 5 項時同意延到換模型那次處理。
  - 換模型時提示詞可能要重調，SC-P10、SC-P17 要重測。做法照 plan §7 T6（暫時的 e2e 對 `ledger_ai_test`）。
- z.ai 條款：`advisor` 2026-10-24 讀過官方條款與 DPA。結論是開放給其他人前要補告知與同意、並向供應商確認用途；現在只有開發者自己用，不必先做。阻擋項見 `../handoff.md`。
- Jev：開發者想之後把分類交給 Jev。`advisor` 建議先用 GLM 做完，Jev 另寫評估 spec，達標才換（spec §2.4）。這次不建任何 Jev 的檔案。

## 每日額度與輸出上限（2026-10-24 核可，#166 合併，已部署並驗完真的模型）

- spec `docs/specs/phase-4a-ai-quota.md`（決策 292～299、W245、SC-P18～P27），plan 與 todo 在 `tasks/archive/ai-parse-quota-*.md`。
- 開發者在 dev 試過 4a 與新分類提議：「目前測試看起來沒甚麼問題」，費用控管「先繼續做」。
- 每人每日 50 次、全站每日 500 次，台灣日曆日；呼叫模型前扣額度，扣了不退。新增 2 張表，要跑 migration。
- `advisor` 給了 4 輪意見，都已併入 spec 與 plan，雙方沒有留下分歧。
- T0～T5 都做完。T4 兩軸審查找到 3 個測試缺口，已補並做過突變檢查。各任務 commit、驗證數字、審查結果見 plan §7。
- 部署：dev 已套用 migration `20261024120000_ai_parse_daily_usage`，部署前的備份在 `/tmp/aiq/backup/ledger_dev-before-aiq.dump`。冒煙測試用 a@a.com 送了 2 句，所以 a@a.com 10-24 已用 2 次額度。
- T5：glm-5.3 跑 SC-P27（10 筆 3 次，加 SC-P17、4a SC-P10 第 5、6、8 步各 3 次），27/27，都沒有被截斷。10 筆最多用 609 個輸出 token，所以上限維持 2048。思考 token 算在輸出 token 裡。表的次數與 token 和 provider 回報一致。
- 新的環境變數：`AI_PARSE_DAILY_LIMIT_PER_USER`（50）、`AI_DAILY_LIMIT_GLOBAL`（500）、`AI_PARSE_MAX_OUTPUT_TOKENS`（2048）。空白就用預設值。

## AI 入口改成圖示（2026-10-25 進行中，等開發者回覆）

- 開發者原話：「ai的部分我不太想要直接放在上方欄位 我想要弄個icon點擊開來才輸入」「我想放在上方橫條的右邊」。看完第一版預覽後：「logo可以換嗎?」「橫條展開弄個動畫」，所以目前傾向 B 案，還沒明確拍板。
- worktree `C:/Users/Administrator/orca/workspaces/ledger-app/ai-icon`，分支 `feature/ai-icon-entry`（從 `c3e7f8a` 開，沒有 commit、沒有 push）。Node 更新後要在該 worktree 重跑 `pnpm install`。
- 預覽頁（不進版控，只在 ai-icon worktree）：`docs/artifacts/step-ai-icon-entry-preview.html`。A 案＝圖示下方彈出小框；B 案＝輸入欄從圖示往左展開，有動畫（只用 `--motion-*` token），有慢速播放鈕。頁首有 5 個圖示候選：1 星芒、2 星群、3 魔杖、4 麥克風加星芒、5 筆加星芒。
- 兩方意見：Codex（設計）推薦 B，理由是不遮交易明細；`advisor` 推薦 A，理由是小框放得下錯誤訊息，手機上 B 的輸入欄太窄。協調者原本傾向 A，但已告訴開發者 B 也可行，由他實際點過後選。
- 兩案共用的預設（advisor 提、協調者同意，已告知開發者，等他確認）：
  1. 只在交易頁「明細」出現（W214 離頁即消失不變）。
  2. 送出成功且至少產生 1 筆草稿時，清空並自動收起；草稿照舊加到列表上方。
  3. 空結果或錯誤時保留原句、不收起。
  4. 錯誤訊息改放在輸入欄下方。這偏離 4a spec W213，要先改 spec。
  5. 解析中可以收起，請求繼續；圖示顯示處理中。收起不取消、不退額度。
  - 不改 schema、API，不加套件。
- 待開發者回覆：圖示編號、A 或 B、上面 5 點、刪除 `ledger_aiq_api_test`／`ledger_aiq_provider_test`。
- 回覆後：
  1. 協調者更新主 spec `docs/specs/phase-4a-ai-text.md`（§1 第 1 步、W208、W213、W214、SC-P12、§6）與 `phase-2i-web-layout-v2.md` SC-38（入口靠右、橫條高度不變；SC-38 舊文寫帳本切換在橫條，與現況不符，要註明、不要照舊文搬回）。新決策用 W246 起。
  2. 派 Codex（`default`）在 ai-icon 實作，含單元測試與 Web e2e。
  3. PR → 部署 dev → 提醒開發者 `Ctrl + Shift + R` → 清 worktree、分支、終端機。
- advisor 列的實作驗收點：浮層與 sticky 橫條 `backdrop-filter` 的堆疊、375px 與手機虛擬鍵盤、readonly 與沒有帳本時的樣子、切換檢視時進行中的請求。另外 Esc 不要掛在 document 上，避免多個浮層一起關。
- Orca run `run_50f41e6dc0fb` 留著（Orca 沒有關閉 run 的指令）。advisor 與 Codex 的 worker 都已 release，終端機都已關閉；下次派工開新終端機。

## 下一步

1. 10-28 後換模型：處理 `GLM_BASE_URL` 預設值（新分類 spec §10 第 5 項延到這次），重調提示詞，重跑 SC-P10、SC-P17、SC-P27（做法見額度 plan §7 T5）。換模型前照額度 spec 決策 298 (j) 核對 context 長度、單價、輸入大小、拒絕方式。

## 已知問題

- 待開發者確認後刪除的測試資料庫：`ledger_aiq_api_test`、`ledger_aiq_provider_test`（額度 worker 用過的）。

- 假 provider 遇到固定句子、但帳本裡沒有對應的分類或帳戶時回 500（plan 核可的行為）。劇本以外的句子回 0 筆草稿。
- glm-5.3 關不掉思考。`low` 時轉帳句偶爾要 16～19 秒，超過 25 秒回 503，使用者重送。
- `low` 時名稱（title）常是 null，使用者要自己補。
- `apps/web/e2e/debts.spec.ts:258`（還款）合併後失敗過 1 次，重跑都過。與 4a 無關。
- `TransactionForm.tsx` 共享帳本送出路徑（約 1209 行）沒有帶 `newCategoryName` 的元件測試；API e2e 有覆蓋共享帳本寫入。
