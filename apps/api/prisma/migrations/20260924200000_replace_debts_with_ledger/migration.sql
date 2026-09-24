-- CreateEnum
CREATE TYPE "DebtEntryKind" AS ENUM ('LEND', 'BORROW', 'COLLECT', 'REPAY', 'PAID_FOR_ME', 'SETTLEMENT', 'FORGIVE');

-- DropForeignKey
ALTER TABLE "Debt" DROP CONSTRAINT "Debt_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "Debt" DROP CONSTRAINT "Debt_transactionId_fkey";

-- DropForeignKey
ALTER TABLE "DebtPayment" DROP CONSTRAINT "DebtPayment_debtId_fkey";

-- DropForeignKey
ALTER TABLE "DebtPayment" DROP CONSTRAINT "DebtPayment_transactionId_fkey";

-- DropTable
DROP TABLE "Debt";

-- DropTable
DROP TABLE "DebtPayment";

-- DropEnum
DROP TYPE "DebtDirection";

-- 以下一段為手寫（spec 3b 決策 45）：逐筆債務版產生的借還交易一併刪除。
-- Debt / DebtPayment 已經在上面 drop（連同指向交易的外鍵），這裡才刪得掉被它們引用過的交易。
-- 這版只存在於 dev 測試資料，開發者 2026-09-24 同意清掉；尚未部署到任何正式環境。
DELETE FROM "Transaction" WHERE "type" IN ('LEND', 'BORROW', 'COLLECT', 'REPAY');

-- CreateTable
CREATE TABLE "Counterparty" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Counterparty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebtEntry" (
    "id" TEXT NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "kind" "DebtEntryKind" NOT NULL,
    "delta" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "transactionId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DebtEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Counterparty_ownerId_name_key" ON "Counterparty"("ownerId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "DebtEntry_transactionId_key" ON "DebtEntry"("transactionId");

-- CreateIndex
CREATE INDEX "DebtEntry_counterpartyId_deletedAt_idx" ON "DebtEntry"("counterpartyId", "deletedAt");

-- AddForeignKey
ALTER TABLE "Counterparty" ADD CONSTRAINT "Counterparty_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtEntry" ADD CONSTRAINT "DebtEntry_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtEntry" ADD CONSTRAINT "DebtEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 以下為手寫：Prisma schema 表達不了的 CHECK 約束（spec 3b §4.3）。
-- 名字由 service 去掉前後空白後才寫入；這裡擋住任何繞過 service 的寫入。
ALTER TABLE "Counterparty" ADD CONSTRAINT "Counterparty_name_trimmed"
  CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 1 AND 100);

-- delta 的正負號必須與種類相符（spec §3.2）。SETTLEMENT 兩種正負號都可能，只要求不為 0。
ALTER TABLE "DebtEntry" ADD CONSTRAINT "DebtEntry_delta_sign" CHECK (
  "delta" <> 0
  AND ("kind" NOT IN ('LEND', 'REPAY') OR "delta" > 0)
  AND ("kind" NOT IN ('BORROW', 'COLLECT', 'PAID_FOR_ME', 'FORGIVE') OR "delta" < 0)
);

-- 調整紀錄不產生交易；代付一定產生一筆支出交易（spec §3.2）。
ALTER TABLE "DebtEntry" ADD CONSTRAINT "DebtEntry_transaction_by_kind" CHECK (
  ("kind" NOT IN ('SETTLEMENT', 'FORGIVE') OR "transactionId" IS NULL)
  AND ("kind" <> 'PAID_FOR_ME' OR "transactionId" IS NOT NULL)
);
