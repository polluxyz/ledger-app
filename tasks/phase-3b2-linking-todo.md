# 任務清單：3b-2 往來帳連動（後端）

> 依據：`tasks/phase-3b2-linking-plan.md`、`docs/specs/phase-3b2-linking.md`。依順序做；全部由協調者自己做。

- [ ] **S1 shared 契約**
  - 內容：`Counterparty.link`、`DebtEntry.sync`／`paired`、`FORGIVEN`、`DebtProposal` 型別與請求、`FriendRequest.forLink`、預覽的 `forLink`、接受請求的 `counterparty`、4 個錯誤碼。
  - 驗收：`pnpm --filter @ledger/shared build` 通過。
- [ ] **S2 schema + migration**
  - 內容：spec §4 的 model 與 §4.1 的手寫 SQL。
  - 驗收：`prisma migrate dev` 產生 migration；對 `ledger_test` 重跑無 pending；CHECK 與部分唯一索引用 SQL 查得到。
- [ ] **S3 隔離測試先行**
  - 內容：`debt-linking-isolation.e2e-spec.ts`（SC-K15）。
  - 驗收：跑一次，全部紅燈，原因是端點或行為還不存在。
- [ ] **S4 連動**
  - 內容：`POST /counterparties`、`?q=`、連動邀請（email、連結）、接受、`DELETE /counterparties/{id}/link`、`DELETE /friends` 連帶解除、刪除擋連動中。
  - 驗收：單元測試涵蓋 plan §3.2 的檢查順序；SC-K1～K4、K12、K13 的 e2e 綠燈。
- [ ] **S5 提議**
  - 內容：`debt-recording.ts` 抽出、送出提議（新增、修改、刪除、免除）、`/debt-proposals` 列表、接受、拒絕。
  - 驗收：種類對照、角度轉換、取代規則有單元測試；SC-K5～K11、K16、K17 的 e2e 綠燈。
- [ ] **S6 回應欄位**
  - 內容：`link.theirBalance`、`sync`、`paired`。
  - 驗收：`sync` 推導有單元測試；SC-K14 的 e2e 綠燈；S3 的隔離測試全部綠燈。
- [ ] **S7 收尾**
  - 內容：Web 假資料與標籤的最小調整（plan §3.7）；spec 狀態、`docs/README.md`、`docs/handoff.md`。
  - 驗收：`pnpm lint / typecheck / test / build / format:check`、兩套 e2e 全綠（SC-K18）。
