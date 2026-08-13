-- ────────────────────────────────────────────────────────────────────────────
-- 階段 2c：帳戶與餘額（破壞性遷移）
--
-- 把「付款方式」（綁帳本的標籤）換成「帳戶」（綁使用者、有餘額）。含資料轉換：
-- 為每位既有使用者建立預設帳戶，並把既有交易掛到「記帳者本人的現金帳戶」。
--
-- 本檔的語句由 Prisma 產生的部分與手寫的資料轉換混合而成，順序不可調動：
-- 必須先建好 Account 與新欄位，才能搬資料；資料搬完並通過斷言後，才可刪付款方式。
-- ────────────────────────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "initialBalance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_userId_name_key" ON "Account"("userId", "name");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Ledger" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "tracksBalance" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "accountId" TEXT,
ADD COLUMN     "toAccountId" TEXT,
ALTER COLUMN "categoryId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Transaction_accountId_idx" ON "Transaction"("accountId");

-- CreateIndex
CREATE INDEX "Transaction_toAccountId_idx" ON "Transaction"("toAccountId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────────────────
-- 資料轉換（手寫；Prisma 不會產生這一段）
-- ────────────────────────────────────────────────────────────────────────────

-- 為每位既有使用者建立預設的「現金」帳戶，初始餘額 0（與註冊時的種子一致）。
-- 只建現金：「銀行」「信用卡」是帳戶的種類而非帳戶本身，由使用者自行新增真實名稱。
INSERT INTO "Account" ("id", "userId", "name", "initialBalance", "createdAt", "updatedAt")
SELECT gen_random_uuid(), u."id", '現金', 0, NOW(), NOW()
FROM "User" u;

-- 既有交易一律掛到「該筆記帳者本人的現金帳戶」。
-- 既有帳本的 tracksBalance 皆為預設的 true，因此每一筆都必須有帳戶。
-- 共享帳本中的交易會依記帳者分散到各自名下——這是正確的，帳戶屬於個人。
UPDATE "Transaction" t
SET "accountId" = a."id"
FROM "Account" a
WHERE a."userId" = t."creatorId"
  AND a."name" = '現金';

-- 斷言：寧可整個 migration 當場失敗回滾，也不要留下 accountId 為 NULL 的壞資料
-- ——那種錯誤會安靜地存在很久，直到餘額算出來不對才被發現。
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count FROM "Transaction" WHERE "accountId" IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION '資料轉換失敗：仍有 % 筆交易沒有對應帳戶', orphan_count;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 移除付款方式（資料已轉換完畢，可以安全刪除）
-- ────────────────────────────────────────────────────────────────────────────

-- DropForeignKey
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_paymentMethodId_fkey";

-- DropForeignKey
ALTER TABLE "PaymentMethod" DROP CONSTRAINT "PaymentMethod_ledgerId_fkey";

-- DropIndex
DROP INDEX "Transaction_paymentMethodId_idx";

-- AlterTable
ALTER TABLE "Transaction" DROP COLUMN "paymentMethodId";

-- DropTable
DROP TABLE "PaymentMethod";
