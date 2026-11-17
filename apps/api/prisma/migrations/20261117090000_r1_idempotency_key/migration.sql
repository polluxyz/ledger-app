-- CreateEnum
CREATE TYPE "IdempotencyOperation" AS ENUM ('TRANSACTION_CREATE', 'DEBT_ENTRY_CREATE', 'SPLIT_CREATE', 'SETTLEMENT_CREATE', 'COUNTERPARTY_FORGIVE');

-- CreateEnum
CREATE TYPE "IdempotencyResultType" AS ENUM ('TRANSACTION', 'DEBT_ENTRY', 'SPLIT');

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "operation" "IdempotencyOperation" NOT NULL,
    "scopeId" TEXT,
    "requestHash" TEXT NOT NULL,
    "resultType" "IdempotencyResultType" NOT NULL,
    "resultId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_userId_key_key" ON "IdempotencyKey"("userId", "key");

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
