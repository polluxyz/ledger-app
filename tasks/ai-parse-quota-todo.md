# 4a 補充任務清單：AI 記帳的每日額度與輸出上限

plan：`tasks/ai-parse-quota-plan.md`；spec：`docs/specs/phase-4a-ai-quota.md`。

- [ ] **T0 契約與先紅的測試**（協調者）：plan §1.1。
      驗收：`pnpm --filter @ledger/shared build` 通過；API／Web typecheck 通過；既有測試行為不變；`ai-quota-isolation.e2e-spec.ts` 的額度與兩張表斷言紅、正向對照（200、provider 被呼叫）綠；查表只用 `$queryRaw`。
- [ ] **T1 資料表與扣額度**（依賴 T0；`aiq-api`，`backend`）：plan §1.2。
      驗收：migration 用 `prisma migrate diff` 產生，只有 2 張表與 1 個外鍵；SC-P18～P24、SC-P26 綠；隔離 e2e 轉綠；既有 API e2e 全綠；SQL 只用 `$queryRaw` tagged template；寫入順序先個人後全站；扣額度的資料庫錯誤轉成不帶原始例外的 500；日誌不含 userId、句子、名稱。
- [ ] **T2 provider 層**（依賴 T0；`aiq-provider`，`default`）：plan §1.3。
      驗收：SC-P25 第 1～4 項單元測試綠；length 即使 JSON 完整也算截斷；64 KiB 保護保留；所有 provider stub 補 `descriptor`；`ai-parse.e2e-spec.ts` 全綠。
- [ ] **T3 畫面**（依賴 T0；`aiq-web`，Codex）：plan §1.4。
      驗收：W245 元件測試綠（含其他 429 仍顯示舊訊息）；Web lint、typecheck、test 全綠。
- [ ] **T4 整合、文件、PR、部署**（依賴 T1～T3；協調者）：plan §1.5。
      驗收：全部檢查與 e2e 綠；spec §9 的文件都改了；CI 全綠、squash merge；dev 跑過 migration，送 1 句後兩張表與日誌照預期；worker 的 worktree、分支、終端機清掉。
- [ ] **T5 真的模型**（依賴 T4；協調者）：plan §1.6。
      驗收：SC-P27 的表填完（含 SC-P17 五句與 SC-P10 第 5、6、8 步各 3 次），失敗也照記；模型、提示詞版本、token、是否有思考 token 欄位記進實作紀錄。
