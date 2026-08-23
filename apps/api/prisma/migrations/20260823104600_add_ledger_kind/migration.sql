-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('PERSONAL', 'SHARED');

-- AlterTable
ALTER TABLE "Ledger" ADD COLUMN     "kind" "LedgerKind" NOT NULL DEFAULT 'PERSONAL';

-- 回填既有帳本：成員超過一人的視為共享，其餘維持預設的 PERSONAL。
--
-- 這是唯一能從既有資料推得的答案。**必須與上面的 DDL 在同一份 migration**——
-- 分開套用會有一段空窗，期間既有的共享帳本被當成私人帳本，從此加不了人，
-- 而且畫面上看不出原因。
UPDATE "Ledger"
SET "kind" = 'SHARED'
WHERE "id" IN (
  SELECT "ledgerId" FROM "LedgerMember" GROUP BY "ledgerId" HAVING COUNT(*) > 1
);
