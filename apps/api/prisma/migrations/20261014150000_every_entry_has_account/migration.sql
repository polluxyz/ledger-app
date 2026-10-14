-- 3h：每一筆帳都要對到帳戶（spec docs/specs/phase-3h-every-entry-has-account.md §3）。
-- 順序很重要：資料搬移要在刪掉 Ledger.tracksBalance 之前做，因為要靠它找出「不計入餘額」的帳本。

-- 1. 結構：臨時帳戶旗標、結清分支的自我關聯。
ALTER TABLE "Account" ADD COLUMN "isTemporary" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Transaction" ADD COLUMN "differenceOfId" TEXT;
CREATE UNIQUE INDEX "Transaction_differenceOfId_key" ON "Transaction"("differenceOfId");
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_differenceOfId_fkey" FOREIGN KEY ("differenceOfId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 每個使用者剛好一個臨時帳戶（決策 167）。Prisma schema 寫不出部分索引，只在這裡。
CREATE UNIQUE INDEX "Account_userId_temporary_key" ON "Account"("userId") WHERE "isTemporary";

-- 免除改記呆帳與債務免除（決策 162）：FORGIVE、FORGIVEN 現在會帶交易。舊的免除仍是 null，所以只放寬、不強制。
-- 結清差額（SETTLEMENT）照舊不帶交易：3h 起不再新增，只剩舊資料。
ALTER TABLE "DebtEntry" DROP CONSTRAINT "DebtEntry_transaction_by_kind";
ALTER TABLE "DebtEntry" ADD CONSTRAINT "DebtEntry_transaction_by_kind" CHECK (
  ("kind"::text <> 'SETTLEMENT' OR "transactionId" IS NULL)
  AND ("kind"::text NOT IN ('PAID_FOR_ME', 'RECEIVED_FOR_ME') OR "transactionId" IS NOT NULL)
);

-- 2. 替每個既有使用者建臨時帳戶。已經有同名帳戶的人取名「臨時帳戶 2」（Account 有 userId＋name 唯一約束）。
INSERT INTO "Account" ("id", "userId", "name", "initialBalance", "isTemporary", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  u."id",
  CASE
    WHEN EXISTS (SELECT 1 FROM "Account" a WHERE a."userId" = u."id" AND a."name" = '臨時帳戶')
      THEN '臨時帳戶 2'
    ELSE '臨時帳戶'
  END,
  0,
  true,
  now(),
  now()
FROM "User" u;

-- 3.（H1 補）帳戶待補與不計入餘額的交易，帳戶填成對應的臨時帳戶（spec §3.3 第 2 步）。

-- 4.（H1 補）差額轉成分支（spec §3.3 第 3 步）。

-- 5. 最後才刪掉 tracksBalance（決策 165）。
ALTER TABLE "Ledger" DROP COLUMN "tracksBalance";
