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

## 下一步

1. 開發者下次開 dev：重開 API 與 Vite，按 `Ctrl + Shift + R`，自己試「衛生紙 189」這類句子。
2. 10-28 後換模型：處理 `GLM_BASE_URL` 預設值（spec §10 第 5 項延到這次），重調提示詞，重跑 SC-P10、SC-P17。
3. 費用控管與 `max_tokens` 之後再設。

## 已知問題

- 假 provider 遇到固定句子、但帳本裡沒有對應的分類或帳戶時回 500（plan 核可的行為）。劇本以外的句子回 0 筆草稿。
- glm-5.3 關不掉思考。`low` 時轉帳句偶爾要 16～19 秒，超過 25 秒回 503，使用者重送。
- `low` 時名稱（title）常是 null，使用者要自己補。
- `apps/web/e2e/debts.spec.ts:258`（還款）合併後失敗過 1 次，重跑都過。與 4a 無關。
- `TransactionForm.tsx` 共享帳本送出路徑（約 1209 行）沒有帶 `newCategoryName` 的元件測試；API e2e 有覆蓋共享帳本寫入。
