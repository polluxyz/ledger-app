-- CreateTable
CREATE TABLE "TransactionMark" (
    "userId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionMark_pkey" PRIMARY KEY ("userId","transactionId")
);

-- CreateIndex
CREATE INDEX "TransactionMark_transactionId_idx" ON "TransactionMark"("transactionId");

-- AddForeignKey
ALTER TABLE "TransactionMark" ADD CONSTRAINT "TransactionMark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionMark" ADD CONSTRAINT "TransactionMark_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
