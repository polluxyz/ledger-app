-- 3k spec §3：刪除合併的目標帳本時保留 LedgerMerge、目標改成 NULL。
-- 原本是 CASCADE：目標帳本有帳本轉入時，DebtEntry.mergeId 的 RESTRICT 會擋下刪除；
-- 沒有帳本轉入時合併紀錄被連帶刪掉，往來紀錄就拿不到來源帳本名稱。

-- DropForeignKey
ALTER TABLE "LedgerMerge" DROP CONSTRAINT "LedgerMerge_targetLedgerId_fkey";

-- AddForeignKey
ALTER TABLE "LedgerMerge" ADD CONSTRAINT "LedgerMerge_targetLedgerId_fkey" FOREIGN KEY ("targetLedgerId") REFERENCES "Ledger"("id") ON DELETE SET NULL ON UPDATE CASCADE;
