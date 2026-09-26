-- 舊邀請綁定對象的語意已失效；先關閉，避免移除欄位後被新流程誤接受。
UPDATE "FriendRequest" SET status = 'CANCELLED', "respondedAt" = now() WHERE status = 'PENDING';
UPDATE "FriendInviteLink" SET "revokedAt" = now() WHERE "usedAt" IS NULL AND "revokedAt" IS NULL;

-- DropForeignKey
ALTER TABLE "FriendRequest" DROP CONSTRAINT "FriendRequest_counterpartyId_fkey";

-- DropForeignKey
ALTER TABLE "FriendInviteLink" DROP CONSTRAINT "FriendInviteLink_counterpartyId_fkey";

-- AlterTable
ALTER TABLE "FriendRequest" DROP COLUMN "counterpartyId";

-- AlterTable
ALTER TABLE "FriendInviteLink" DROP COLUMN "counterpartyId";

-- AlterTable
ALTER TABLE "Counterparty" ADD COLUMN     "askMerge" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "name" DROP NOT NULL;

-- 連動對象可以沿用對方帳號名稱，因此 null 是合法的「沒有自訂暱稱」。
ALTER TABLE "Counterparty" DROP CONSTRAINT "Counterparty_name_trimmed";
ALTER TABLE "Counterparty" ADD CONSTRAINT "Counterparty_name_trimmed"
  CHECK ("name" IS NULL OR ("name" = btrim("name") AND char_length("name") BETWEEN 1 AND 100));
