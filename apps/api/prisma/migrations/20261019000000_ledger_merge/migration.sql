-- AlterEnum
ALTER TYPE "DebtEntryKind" ADD VALUE 'LEDGER_CARRY_OVER';

-- AlterTable
ALTER TABLE "DebtEntry" ADD COLUMN     "mergeId" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "mergeId" TEXT,
ADD COLUMN     "mergedFromId" TEXT;

-- CreateTable
CREATE TABLE "LedgerMerge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceLedgerId" TEXT NOT NULL,
    "sourceLedgerName" TEXT NOT NULL,
    "targetLedgerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerMerge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LedgerMerge_userId_sourceLedgerId_idx" ON "LedgerMerge"("userId", "sourceLedgerId");

-- CreateIndex
CREATE INDEX "LedgerMerge_targetLedgerId_idx" ON "LedgerMerge"("targetLedgerId");

-- CreateIndex
CREATE INDEX "DebtEntry_mergeId_idx" ON "DebtEntry"("mergeId");

-- CreateIndex
CREATE INDEX "Transaction_mergeId_idx" ON "Transaction"("mergeId");

-- CreateIndex
CREATE INDEX "Transaction_mergedFromId_idx" ON "Transaction"("mergedFromId");

-- AddForeignKey
ALTER TABLE "LedgerMerge" ADD CONSTRAINT "LedgerMerge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerMerge" ADD CONSTRAINT "LedgerMerge_targetLedgerId_fkey" FOREIGN KEY ("targetLedgerId") REFERENCES "Ledger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_mergeId_fkey" FOREIGN KEY ("mergeId") REFERENCES "LedgerMerge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtEntry" ADD CONSTRAINT "DebtEntry_mergeId_fkey" FOREIGN KEY ("mergeId") REFERENCES "LedgerMerge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3k spec §3：Prisma schema 無法表達 CHECK，資料庫仍須保護合併來源與往來種類。
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_merge_origin_check" CHECK (
  ("mergedFromId" IS NULL) = ("mergeId" IS NULL)
);

-- PostgreSQL 在新增 enum 值的交易提交前禁止直接使用該 enum 常值；
-- 比照既有 migration，把 kind 轉為 text，讓此 migration 在同一交易內也能套用。
ALTER TABLE "DebtEntry" ADD CONSTRAINT "DebtEntry_merge_by_kind_check" CHECK (
  (("kind"::text = 'LEDGER_CARRY_OVER') = ("mergeId" IS NOT NULL))
  AND ("kind"::text <> 'LEDGER_CARRY_OVER' OR "transactionId" IS NULL)
);
