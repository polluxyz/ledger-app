-- CreateTable
CREATE TABLE "LedgerPersonPointer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ledgerPersonId" TEXT NOT NULL,
    "counterpartyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerPersonPointer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LedgerPersonPointer_counterpartyId_idx" ON "LedgerPersonPointer"("counterpartyId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerPersonPointer_userId_ledgerPersonId_key" ON "LedgerPersonPointer"("userId", "ledgerPersonId");

-- AddForeignKey
ALTER TABLE "LedgerPersonPointer" ADD CONSTRAINT "LedgerPersonPointer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerPersonPointer" ADD CONSTRAINT "LedgerPersonPointer_ledgerPersonId_fkey" FOREIGN KEY ("ledgerPersonId") REFERENCES "LedgerPerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerPersonPointer" ADD CONSTRAINT "LedgerPersonPointer_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
