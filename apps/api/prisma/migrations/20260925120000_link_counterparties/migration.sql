-- CreateEnum
CREATE TYPE "DebtProposalType" AS ENUM ('CREATE', 'AMEND', 'DELETE');

-- CreateEnum
CREATE TYPE "DebtProposalStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "DebtEntryKind" ADD VALUE 'FORGIVEN';

-- AlterTable
ALTER TABLE "FriendRequest" ADD COLUMN     "counterpartyId" TEXT;

-- AlterTable
ALTER TABLE "FriendInviteLink" ADD COLUMN     "counterpartyId" TEXT;

-- AlterTable
ALTER TABLE "DebtEntry" ADD COLUMN     "pairedEntryId" TEXT;

-- CreateTable
CREATE TABLE "CounterpartyLink" (
    "id" TEXT NOT NULL,
    "userLowId" TEXT NOT NULL,
    "userHighId" TEXT NOT NULL,
    "counterpartyLowId" TEXT NOT NULL,
    "counterpartyHighId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CounterpartyLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebtProposal" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "type" "DebtProposalType" NOT NULL,
    "sourceEntryId" TEXT NOT NULL,
    "targetEntryId" TEXT,
    "entryKind" "DebtEntryKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "settle" BOOLEAN NOT NULL DEFAULT false,
    "status" "DebtProposalStatus" NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DebtProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CounterpartyLink_counterpartyLowId_key" ON "CounterpartyLink"("counterpartyLowId");

-- CreateIndex
CREATE UNIQUE INDEX "CounterpartyLink_counterpartyHighId_key" ON "CounterpartyLink"("counterpartyHighId");

-- CreateIndex
CREATE INDEX "CounterpartyLink_userHighId_idx" ON "CounterpartyLink"("userHighId");

-- CreateIndex
CREATE UNIQUE INDEX "CounterpartyLink_userLowId_userHighId_key" ON "CounterpartyLink"("userLowId", "userHighId");

-- CreateIndex
CREATE INDEX "DebtProposal_toUserId_status_idx" ON "DebtProposal"("toUserId", "status");

-- CreateIndex
CREATE INDEX "DebtProposal_fromUserId_status_idx" ON "DebtProposal"("fromUserId", "status");

-- CreateIndex
CREATE INDEX "DebtProposal_sourceEntryId_status_idx" ON "DebtProposal"("sourceEntryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DebtEntry_pairedEntryId_key" ON "DebtEntry"("pairedEntryId");

-- AddForeignKey
ALTER TABLE "FriendRequest" ADD CONSTRAINT "FriendRequest_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendInviteLink" ADD CONSTRAINT "FriendInviteLink_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtEntry" ADD CONSTRAINT "DebtEntry_pairedEntryId_fkey" FOREIGN KEY ("pairedEntryId") REFERENCES "DebtEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounterpartyLink" ADD CONSTRAINT "CounterpartyLink_userLowId_fkey" FOREIGN KEY ("userLowId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounterpartyLink" ADD CONSTRAINT "CounterpartyLink_userHighId_fkey" FOREIGN KEY ("userHighId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounterpartyLink" ADD CONSTRAINT "CounterpartyLink_counterpartyLowId_fkey" FOREIGN KEY ("counterpartyLowId") REFERENCES "Counterparty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounterpartyLink" ADD CONSTRAINT "CounterpartyLink_counterpartyHighId_fkey" FOREIGN KEY ("counterpartyHighId") REFERENCES "Counterparty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtProposal" ADD CONSTRAINT "DebtProposal_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtProposal" ADD CONSTRAINT "DebtProposal_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtProposal" ADD CONSTRAINT "DebtProposal_sourceEntryId_fkey" FOREIGN KEY ("sourceEntryId") REFERENCES "DebtEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtProposal" ADD CONSTRAINT "DebtProposal_targetEntryId_fkey" FOREIGN KEY ("targetEntryId") REFERENCES "DebtEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 以下為手寫：Prisma schema 表達不了的約束（spec 3b-2 §4.1）。
--
-- 注意：上面剛用 ALTER TYPE 加進 'FORGIVEN'。PostgreSQL 不允許在同一個交易裡把新的 enum 值
-- 當成 enum 常值使用，所以下面的 CHECK 一律把 "kind" 轉成 text 再比較。

-- delta 的正負號必須與種類相符：加上 FORGIVEN（被免除，我欠的歸零，delta > 0）。
ALTER TABLE "DebtEntry" DROP CONSTRAINT "DebtEntry_delta_sign";
ALTER TABLE "DebtEntry" ADD CONSTRAINT "DebtEntry_delta_sign" CHECK (
  "delta" <> 0
  AND ("kind"::text NOT IN ('LEND', 'REPAY', 'FORGIVEN') OR "delta" > 0)
  AND ("kind"::text NOT IN ('BORROW', 'COLLECT', 'PAID_FOR_ME', 'FORGIVE') OR "delta" < 0)
);

-- 調整紀錄不產生交易：加上 FORGIVEN。
ALTER TABLE "DebtEntry" DROP CONSTRAINT "DebtEntry_transaction_by_kind";
ALTER TABLE "DebtEntry" ADD CONSTRAINT "DebtEntry_transaction_by_kind" CHECK (
  ("kind"::text NOT IN ('SETTLEMENT', 'FORGIVE', 'FORGIVEN') OR "transactionId" IS NULL)
  AND ("kind"::text <> 'PAID_FOR_ME' OR "transactionId" IS NOT NULL)
);

-- 一筆紀錄不能跟自己配對。
ALTER TABLE "DebtEntry" ADD CONSTRAINT "DebtEntry_not_paired_with_self" CHECK (
  "pairedEntryId" IS NULL OR "pairedEntryId" <> "id"
);

-- 一對使用者只存一筆，排序規則同 Friendship_ordered（UUID 只含 0-9a-f-，位元組順序即可）。
ALTER TABLE "CounterpartyLink" ADD CONSTRAINT "CounterpartyLink_ordered" CHECK (
  "userLowId" COLLATE "C" < "userHighId" COLLATE "C"
);

-- 同一筆紀錄同時最多一個待確認的提議（決策 68）。新的變更先把舊的改成 CANCELLED 再建立。
CREATE UNIQUE INDEX "DebtProposal_one_pending_per_source"
  ON "DebtProposal" ("sourceEntryId") WHERE "status" = 'PENDING';

-- 提議的金額一律是正整數（delta 的正負號由種類決定）。
ALTER TABLE "DebtProposal" ADD CONSTRAINT "DebtProposal_amount_positive" CHECK ("amount" > 0);

-- CREATE 沒有目標紀錄；AMEND、DELETE 在送出當下一定有（之後可能因對方刪帳號變成 NULL）。
-- 所以這裡只擋「CREATE 卻帶了目標」。
ALTER TABLE "DebtProposal" ADD CONSTRAINT "DebtProposal_create_has_no_target" CHECK (
  "type"::text <> 'CREATE' OR "targetEntryId" IS NULL
);
