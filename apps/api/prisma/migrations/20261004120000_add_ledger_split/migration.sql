-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "payerPersonId" TEXT;

-- CreateTable
CREATE TABLE "LedgerPerson" (
    "id" TEXT NOT NULL,
    "ledgerId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerSplit" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "method" "SplitMethod" NOT NULL,
    "precision" "SplitPrecision" NOT NULL DEFAULT 'CENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerShare" (
    "id" TEXT NOT NULL,
    "ledgerSplitId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "share" INTEGER NOT NULL,
    "ratio" INTEGER,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "LedgerShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerSettlement" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "fromPersonId" TEXT NOT NULL,
    "toPersonId" TEXT NOT NULL,

    CONSTRAINT "LedgerSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LedgerPerson_ledgerId_idx" ON "LedgerPerson"("ledgerId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerPerson_ledgerId_userId_key" ON "LedgerPerson"("ledgerId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerSplit_transactionId_key" ON "LedgerSplit"("transactionId");

-- CreateIndex
CREATE INDEX "LedgerShare_personId_idx" ON "LedgerShare"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerShare_ledgerSplitId_personId_key" ON "LedgerShare"("ledgerSplitId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerSettlement_transactionId_key" ON "LedgerSettlement"("transactionId");

-- CreateIndex
CREATE INDEX "LedgerSettlement_fromPersonId_idx" ON "LedgerSettlement"("fromPersonId");

-- CreateIndex
CREATE INDEX "LedgerSettlement_toPersonId_idx" ON "LedgerSettlement"("toPersonId");

-- CreateIndex
CREATE INDEX "Transaction_payerPersonId_idx" ON "Transaction"("payerPersonId");

-- AddForeignKey
ALTER TABLE "LedgerPerson" ADD CONSTRAINT "LedgerPerson_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "Ledger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerPerson" ADD CONSTRAINT "LedgerPerson_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_payerPersonId_fkey" FOREIGN KEY ("payerPersonId") REFERENCES "LedgerPerson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerSplit" ADD CONSTRAINT "LedgerSplit_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerShare" ADD CONSTRAINT "LedgerShare_ledgerSplitId_fkey" FOREIGN KEY ("ledgerSplitId") REFERENCES "LedgerSplit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerShare" ADD CONSTRAINT "LedgerShare_personId_fkey" FOREIGN KEY ("personId") REFERENCES "LedgerPerson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerSettlement" ADD CONSTRAINT "LedgerSettlement_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerSettlement" ADD CONSTRAINT "LedgerSettlement_fromPersonId_fkey" FOREIGN KEY ("fromPersonId") REFERENCES "LedgerPerson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerSettlement" ADD CONSTRAINT "LedgerSettlement_toPersonId_fkey" FOREIGN KEY ("toPersonId") REFERENCES "LedgerPerson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma cannot express partial indexes or these cross-field constraints.
CREATE UNIQUE INDEX "LedgerPerson_active_guest_name_key"
ON "LedgerPerson"("ledgerId", "name")
WHERE "userId" IS NULL AND "deletedAt" IS NULL;

ALTER TABLE "LedgerPerson" ADD CONSTRAINT "LedgerPerson_user_or_name_check"
CHECK (("userId" IS NULL) = ("name" IS NOT NULL));

ALTER TABLE "LedgerShare" ADD CONSTRAINT "LedgerShare_positive_share_check"
CHECK ("share" > 0);

ALTER TABLE "LedgerSettlement" ADD CONSTRAINT "LedgerSettlement_distinct_people_check"
CHECK ("fromPersonId" <> "toPersonId");

-- Current members retain their join order in the settlement summary.
INSERT INTO "LedgerPerson" ("id", "ledgerId", "userId", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, m."ledgerId", m."userId", NULL, m."createdAt", CURRENT_TIMESTAMP
FROM "LedgerMember" AS m
JOIN "Ledger" AS l ON l."id" = m."ledgerId"
WHERE l."kind" = 'SHARED';

-- A former member may still have authored transactions, including soft-deleted ones.
-- Preserve that person once per ledger; no historical payer is inferred.
INSERT INTO "LedgerPerson" ("id", "ledgerId", "userId", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, t."ledgerId", t."creatorId", NULL, MIN(t."createdAt"), CURRENT_TIMESTAMP
FROM "Transaction" AS t
JOIN "Ledger" AS l ON l."id" = t."ledgerId"
LEFT JOIN "LedgerMember" AS m ON m."ledgerId" = t."ledgerId" AND m."userId" = t."creatorId"
WHERE l."kind" = 'SHARED' AND m."userId" IS NULL
GROUP BY t."ledgerId", t."creatorId";
