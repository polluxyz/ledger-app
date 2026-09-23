-- CreateEnum
CREATE TYPE "DebtDirection" AS ENUM ('LENT', 'BORROWED');

-- AlterEnum


ALTER TYPE "TransactionType" ADD VALUE 'LEND';
ALTER TYPE "TransactionType" ADD VALUE 'BORROW';
ALTER TYPE "TransactionType" ADD VALUE 'COLLECT';
ALTER TYPE "TransactionType" ADD VALUE 'REPAY';

-- CreateTable
CREATE TABLE "Debt" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "direction" "DebtDirection" NOT NULL,
    "counterpartyName" TEXT NOT NULL,
    "principal" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "transactionId" TEXT,
    "forgivenAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Debt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebtPayment" (
    "id" TEXT NOT NULL,
    "debtId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "transactionId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DebtPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Debt_transactionId_key" ON "Debt"("transactionId");

-- CreateIndex
CREATE INDEX "Debt_ownerId_deletedAt_idx" ON "Debt"("ownerId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DebtPayment_transactionId_key" ON "DebtPayment"("transactionId");

-- CreateIndex
CREATE INDEX "DebtPayment_debtId_idx" ON "DebtPayment"("debtId");

-- AddForeignKey
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtPayment" ADD CONSTRAINT "DebtPayment_debtId_fkey" FOREIGN KEY ("debtId") REFERENCES "Debt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtPayment" ADD CONSTRAINT "DebtPayment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 以下為手寫：Prisma schema 表達不了的 CHECK 約束（spec §4.3）。
-- ─────────────────────────────────────────────────────────────────────────────

-- 金額一律是正整數（最小貨幣單位）。DTO 已經擋過；這兩條是繞過 DTO 的寫入的最後防線。
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_principal_positive" CHECK ("principal" > 0);
ALTER TABLE "DebtPayment" ADD CONSTRAINT "DebtPayment_amount_positive" CHECK ("amount" > 0);
