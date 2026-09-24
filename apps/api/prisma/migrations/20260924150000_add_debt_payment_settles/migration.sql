-- AlterTable
ALTER TABLE "DebtPayment" ADD COLUMN "settles" BOOLEAN NOT NULL DEFAULT false;

-- 以下為手寫：Prisma schema 表達不了部分唯一索引（spec §4.3 第 4 條、決策 30）。
-- 一筆債務最多一筆未刪除的結清還款。刪掉它（軟刪除）之後，才能再記下一筆。
CREATE UNIQUE INDEX "DebtPayment_debtId_active_settlement_key"
  ON "DebtPayment" ("debtId")
  WHERE "settles" AND "deletedAt" IS NULL;
