-- 3c 分帳：保存完整份額，連結交易與往來紀錄，並以 CHECK 保護金額與種類。
-- Prisma migrate diff 產生主體；檔尾補上 Prisma schema 無法表達的約束。

-- CreateEnum
CREATE TYPE "SplitType" AS ENUM ('EXPENSE', 'INCOME');

-- CreateEnum
CREATE TYPE "SplitMethod" AS ENUM ('EQUAL', 'AMOUNT', 'RATIO');

-- CreateEnum
CREATE TYPE "SplitPrecision" AS ENUM ('CENT', 'YUAN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DebtEntryKind" ADD VALUE 'PAID_FOR_THEM';
ALTER TYPE "DebtEntryKind" ADD VALUE 'RECEIVED_FOR_THEM';
ALTER TYPE "DebtEntryKind" ADD VALUE 'RECEIVED_FOR_ME';

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "splitId" TEXT,
ADD COLUMN     "title" TEXT;

-- AlterTable
ALTER TABLE "DebtEntry" ADD COLUMN     "splitId" TEXT;

-- AlterTable
ALTER TABLE "DebtProposal" ADD COLUMN     "title" TEXT;

-- CreateTable
CREATE TABLE "Split" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ledgerId" TEXT NOT NULL,
    "type" "SplitType" NOT NULL,
    "categoryId" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "title" TEXT,
    "note" TEXT,
    "payerCounterpartyId" TEXT,
    "accountId" TEXT,
    "method" "SplitMethod" NOT NULL,
    "precision" "SplitPrecision" NOT NULL DEFAULT 'CENT',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Split_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SplitParticipant" (
    "id" TEXT NOT NULL,
    "splitId" TEXT NOT NULL,
    "counterpartyId" TEXT,
    "share" INTEGER NOT NULL,
    "ratio" INTEGER,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "SplitParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Split_ownerId_deletedAt_idx" ON "Split"("ownerId", "deletedAt");

-- CreateIndex
CREATE INDEX "Split_ledgerId_idx" ON "Split"("ledgerId");

-- CreateIndex
CREATE UNIQUE INDEX "SplitParticipant_splitId_counterpartyId_key" ON "SplitParticipant"("splitId", "counterpartyId");

-- CreateIndex
CREATE INDEX "Transaction_splitId_idx" ON "Transaction"("splitId");

-- CreateIndex
CREATE INDEX "DebtEntry_splitId_idx" ON "DebtEntry"("splitId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_splitId_fkey" FOREIGN KEY ("splitId") REFERENCES "Split"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtEntry" ADD CONSTRAINT "DebtEntry_splitId_fkey" FOREIGN KEY ("splitId") REFERENCES "Split"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Split" ADD CONSTRAINT "Split_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Split" ADD CONSTRAINT "Split_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "Ledger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Split" ADD CONSTRAINT "Split_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Split" ADD CONSTRAINT "Split_payerCounterpartyId_fkey" FOREIGN KEY ("payerCounterpartyId") REFERENCES "Counterparty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Split" ADD CONSTRAINT "Split_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SplitParticipant" ADD CONSTRAINT "SplitParticipant_splitId_fkey" FOREIGN KEY ("splitId") REFERENCES "Split"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SplitParticipant" ADD CONSTRAINT "SplitParticipant_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma 不支援 CHECK 與部分唯一索引；資料庫在繞過 API 時仍須維持份額與種類的約束。
ALTER TABLE "DebtEntry" DROP CONSTRAINT "DebtEntry_delta_sign";
ALTER TABLE "DebtEntry" ADD CONSTRAINT "DebtEntry_delta_sign" CHECK (
  "delta" <> 0
  AND ("kind"::text NOT IN ('LEND', 'REPAY', 'FORGIVEN', 'PAID_FOR_THEM', 'RECEIVED_FOR_ME') OR "delta" > 0)
  AND ("kind"::text NOT IN ('BORROW', 'COLLECT', 'PAID_FOR_ME', 'FORGIVE', 'RECEIVED_FOR_THEM') OR "delta" < 0)
);
ALTER TABLE "DebtEntry" DROP CONSTRAINT "DebtEntry_transaction_by_kind";
ALTER TABLE "DebtEntry" ADD CONSTRAINT "DebtEntry_transaction_by_kind" CHECK (
  ("kind"::text NOT IN ('SETTLEMENT', 'FORGIVE', 'FORGIVEN') OR "transactionId" IS NULL)
  AND ("kind"::text NOT IN ('PAID_FOR_ME', 'RECEIVED_FOR_ME') OR "transactionId" IS NOT NULL)
);
ALTER TABLE "Split" ADD CONSTRAINT "Split_total_positive" CHECK ("total" > 0);
ALTER TABLE "Split" ADD CONSTRAINT "Split_payer_or_account" CHECK ("payerCounterpartyId" IS NULL OR "accountId" IS NULL);
ALTER TABLE "Split" ADD CONSTRAINT "Split_title_length" CHECK (length("title") <= 100);
ALTER TABLE "SplitParticipant" ADD CONSTRAINT "SplitParticipant_share_positive" CHECK ("share" > 0);
ALTER TABLE "SplitParticipant" ADD CONSTRAINT "SplitParticipant_ratio_range" CHECK ("ratio" IS NULL OR "ratio" BETWEEN 0 AND 10000);
CREATE UNIQUE INDEX "SplitParticipant_one_me_per_split" ON "SplitParticipant" ("splitId") WHERE "counterpartyId" IS NULL;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_title_length" CHECK (length("title") <= 100);
