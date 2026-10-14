-- 3h：每一筆帳都要對到帳戶（spec docs/specs/phase-3h-every-entry-has-account.md §3）。
-- 順序很重要：資料搬移要在刪掉 Ledger.tracksBalance 之前做，因為要靠它找出「不計入餘額」的帳本。

-- 1. 結構：臨時帳戶旗標、結清分支的自我關聯。
ALTER TABLE "Account" ADD COLUMN "isTemporary" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Transaction" ADD COLUMN "differenceOfId" TEXT;
CREATE UNIQUE INDEX "Transaction_differenceOfId_key" ON "Transaction"("differenceOfId");
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_differenceOfId_fkey" FOREIGN KEY ("differenceOfId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 每個使用者剛好一個臨時帳戶（決策 167）。Prisma schema 寫不出部分索引，只在這裡。
CREATE UNIQUE INDEX "Account_userId_temporary_key" ON "Account"("userId") WHERE "isTemporary";

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

-- 3. 只補實際資金流；非成員與別人替我付／收沒有我的帳戶流向，仍保留空值。
-- 軟刪除的列也補帳戶，以免歷史結構與現存列不同。
UPDATE "Transaction" t SET "accountId" = a."id"
FROM "LedgerPerson" p, "Account" a
WHERE t."type" IN ('EXPENSE', 'INCOME') AND t."accountId" IS NULL
  AND t."payerPersonId" = p."id" AND p."userId" IS NOT NULL
  AND a."userId" = p."userId" AND a."isTemporary"
  AND NOT EXISTS (SELECT 1 FROM "DebtEntry" d WHERE d."transactionId" = t."id"
    AND d."kind" IN ('PAID_FOR_ME', 'RECEIVED_FOR_ME'));

UPDATE "Transaction" t SET "accountId" = a."id"
FROM "Ledger" l, "Account" a
WHERE t."type" IN ('EXPENSE', 'INCOME') AND t."accountId" IS NULL
  AND t."payerPersonId" IS NULL AND t."ledgerId" = l."id" AND NOT l."tracksBalance"
  AND a."userId" = t."creatorId" AND a."isTemporary"
  AND NOT EXISTS (SELECT 1 FROM "DebtEntry" d WHERE d."transactionId" = t."id"
    AND d."kind" IN ('PAID_FOR_ME', 'RECEIVED_FOR_ME'));

-- 結清兩側各自找成員；非成員那一側不補。
UPDATE "Transaction" t SET "accountId" = a."id"
FROM "LedgerSettlement" s, "LedgerPerson" p, "Account" a
WHERE t."type" = 'TRANSFER' AND t."accountId" IS NULL
  AND s."transactionId" = t."id" AND p."id" = s."fromPersonId"
  AND p."userId" IS NOT NULL AND a."userId" = p."userId" AND a."isTemporary";

UPDATE "Transaction" t SET "toAccountId" = a."id"
FROM "LedgerSettlement" s, "LedgerPerson" p, "Account" a
WHERE t."type" = 'TRANSFER' AND t."toAccountId" IS NULL
  AND s."transactionId" = t."id" AND p."id" = s."toPersonId"
  AND p."userId" IS NOT NULL AND a."userId" = p."userId" AND a."isTemporary";

-- 非結清的舊轉帳原本不入餘額；兩側空值皆由記帳人的臨時帳戶承接。
UPDATE "Transaction" t SET "accountId" = a."id"
FROM "Ledger" l, "Account" a
WHERE t."type" = 'TRANSFER' AND t."accountId" IS NULL
  AND t."ledgerId" = l."id" AND NOT l."tracksBalance"
  AND NOT EXISTS (SELECT 1 FROM "LedgerSettlement" s WHERE s."transactionId" = t."id")
  AND a."userId" = t."creatorId" AND a."isTemporary";

UPDATE "Transaction" t SET "toAccountId" = a."id"
FROM "Ledger" l, "Account" a
WHERE t."type" = 'TRANSFER' AND t."toAccountId" IS NULL
  AND t."ledgerId" = l."id" AND NOT l."tracksBalance"
  AND NOT EXISTS (SELECT 1 FROM "LedgerSettlement" s WHERE s."transactionId" = t."id")
  AND a."userId" = t."creatorId" AND a."isTemporary";

UPDATE "Split" s SET "accountId" = a."id" FROM "Account" a
WHERE s."payerCounterpartyId" IS NULL AND s."accountId" IS NULL
  AND a."userId" = s."ownerId" AND a."isTemporary";

-- 不計入餘額的帳本裡，借還交易（借出、借入、收回、償還，含代墊）也沒有帳戶；錢是記帳人的，由他的臨時帳戶承接。
-- 要在第 4 段之前，分支才會跟著還款拿到同一個帳戶。
UPDATE "Transaction" t SET "accountId" = a."id"
FROM "Ledger" l, "Account" a
WHERE t."type" IN ('LEND', 'BORROW', 'COLLECT', 'REPAY') AND t."accountId" IS NULL
  AND t."ledgerId" = l."id" AND NOT l."tracksBalance"
  AND a."userId" = t."creatorId" AND a."isTemporary";

-- 4. 舊差額僅在唯一配對時轉成分支；同秒但被其他紀錄隔開的不猜測。
-- 單一 SQL 同步修改還款、交易和差額，避免只轉好其中一部分。
WITH matches AS (
  SELECT s."id" settlement_id, r."id" repayment_id
  FROM "DebtEntry" s
  JOIN "DebtEntry" r ON r."counterpartyId" = s."counterpartyId"
    AND r."kind" IN ('COLLECT', 'REPAY') AND r."deletedAt" IS NULL
    AND r."transactionId" IS NOT NULL
    AND ((s."settlesEntryId" IS NOT NULL AND r."id" = s."settlesEntryId")
      OR (s."settlesEntryId" IS NULL
        AND r."createdAt" BETWEEN s."createdAt" - INTERVAL '1 second' AND s."createdAt"
        AND NOT EXISTS (
          SELECT 1 FROM "DebtEntry" middle
          WHERE middle."counterpartyId" = s."counterpartyId" AND middle."deletedAt" IS NULL
            AND middle."id" <> r."id" AND middle."id" <> s."id"
            AND middle."createdAt" > r."createdAt" AND middle."createdAt" < s."createdAt")))
  JOIN "Transaction" t ON t."id" = r."transactionId" AND t."deletedAt" IS NULL
  WHERE s."kind" = 'SETTLEMENT' AND s."deletedAt" IS NULL
), unique_matches AS (
  SELECT settlement_id, MIN(repayment_id) repayment_id
  FROM matches GROUP BY settlement_id HAVING COUNT(*) = 1
), amounts AS (
  SELECT m.settlement_id, m.repayment_id, r."transactionId" transaction_id,
    r."kind" repayment_kind, r."delta" + s."delta" new_delta,
    ABS(r."delta" + s."delta") cleared, t."amount" actual
  FROM unique_matches m
  JOIN "DebtEntry" s ON s."id" = m.settlement_id
  JOIN "DebtEntry" r ON r."id" = m.repayment_id
  JOIN "Transaction" t ON t."id" = r."transactionId"
  WHERE (SELECT COUNT(*) FROM unique_matches other WHERE other.repayment_id = m.repayment_id) = 1
    AND r."delta" + s."delta" <> 0
    AND t."amount" <> ABS(r."delta" + s."delta")
), changed_debts AS (
  UPDATE "DebtEntry" r SET "delta" = a.new_delta, "updatedAt" = now()
  FROM amounts a WHERE r."id" = a.repayment_id RETURNING r."id"
), changed_transactions AS (
  UPDATE "Transaction" t SET "amount" = a.cleared, "updatedAt" = now()
  FROM amounts a WHERE t."id" = a.transaction_id RETURNING t."id"
), branches AS (
  INSERT INTO "Transaction" ("id", "ledgerId", "accountId", "creatorId", "type",
    "amount", "date", "differenceOfId", "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, t."ledgerId", t."accountId", t."creatorId",
    CASE
      WHEN a.repayment_kind = 'COLLECT' AND a.actual < a.cleared THEN 'EXPENSE'::"TransactionType"
      WHEN a.repayment_kind = 'COLLECT' THEN 'INCOME'::"TransactionType"
      WHEN a.actual < a.cleared THEN 'INCOME'::"TransactionType"
      ELSE 'EXPENSE'::"TransactionType"
    END,
    ABS(a.actual - a.cleared), t."date", t."id", t."createdAt" + INTERVAL '1 millisecond', now()
  FROM amounts a JOIN "Transaction" t ON t."id" = a.transaction_id
  JOIN changed_debts cd ON cd."id" = a.repayment_id
  JOIN changed_transactions ct ON ct."id" = a.transaction_id
  RETURNING "differenceOfId"
)
UPDATE "DebtEntry" s SET "deletedAt" = now(), "updatedAt" = now()
FROM amounts a JOIN branches b ON b."differenceOfId" = a.transaction_id
WHERE s."id" = a.settlement_id;

-- 5. 最後才刪掉 tracksBalance（決策 165）。
ALTER TABLE "Ledger" DROP COLUMN "tracksBalance";
