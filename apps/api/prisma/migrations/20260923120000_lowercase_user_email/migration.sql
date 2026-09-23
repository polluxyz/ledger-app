-- 讓 User.email 只存小寫。
--
-- 1. 先檢查：若有兩個帳號只差在大小寫（例如 Foo@x.com 與 foo@x.com），轉小寫後會
--    撞上唯一索引。這種情況「留哪個帳號」必須由人決定，所以直接報錯停下，不自動合併。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "User" GROUP BY lower("email") HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'User emails that differ only by case exist; resolve them manually before this migration.';
  END IF;
END $$;

-- 2. 既有資料轉小寫。
UPDATE "User" SET "email" = lower("email") WHERE "email" <> lower("email");

-- 3. 從此只接受小寫。應用程式在 DTO 層已經轉過，這條約束是忘記轉時的最後防線。
--    Prisma schema 表達不了 CHECK 約束，所以只存在於 migration。
ALTER TABLE "User" ADD CONSTRAINT "User_email_lowercase" CHECK ("email" = lower("email"));
