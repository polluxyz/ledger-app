-- 分類只保存圖示代號，讓畫面日後更換圖示庫時不用搬動帳本資料。
-- 既有資料只回填名稱與型別都符合預設分類、且尚未選圖示的列；使用者已設定的圖示不能覆蓋。
-- 加欄位語句由 prisma migrate diff 產生，下方 UPDATE 依 DEFAULT_CATEGORIES 逐筆補值。
-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "icon" TEXT;

UPDATE "Category" SET "icon" = 'food' WHERE "name" = '餐飲' AND "type" = 'EXPENSE' AND "icon" IS NULL;
UPDATE "Category" SET "icon" = 'transport' WHERE "name" = '交通' AND "type" = 'EXPENSE' AND "icon" IS NULL;
UPDATE "Category" SET "icon" = 'shopping' WHERE "name" = '購物' AND "type" = 'EXPENSE' AND "icon" IS NULL;
UPDATE "Category" SET "icon" = 'home' WHERE "name" = '居住' AND "type" = 'EXPENSE' AND "icon" IS NULL;
UPDATE "Category" SET "icon" = 'fun' WHERE "name" = '娛樂' AND "type" = 'EXPENSE' AND "icon" IS NULL;
UPDATE "Category" SET "icon" = 'health' WHERE "name" = '醫療' AND "type" = 'EXPENSE' AND "icon" IS NULL;
UPDATE "Category" SET "icon" = 'education' WHERE "name" = '教育' AND "type" = 'EXPENSE' AND "icon" IS NULL;
UPDATE "Category" SET "icon" = 'other' WHERE "name" = '其他' AND "type" = 'EXPENSE' AND "icon" IS NULL;
UPDATE "Category" SET "icon" = 'salary' WHERE "name" = '薪資' AND "type" = 'INCOME' AND "icon" IS NULL;
UPDATE "Category" SET "icon" = 'bonus' WHERE "name" = '獎金' AND "type" = 'INCOME' AND "icon" IS NULL;
UPDATE "Category" SET "icon" = 'investment' WHERE "name" = '投資' AND "type" = 'INCOME' AND "icon" IS NULL;
UPDATE "Category" SET "icon" = 'other' WHERE "name" = '其他' AND "type" = 'INCOME' AND "icon" IS NULL;
