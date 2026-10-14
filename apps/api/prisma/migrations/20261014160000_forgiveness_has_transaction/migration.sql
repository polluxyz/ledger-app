-- 3h 決策 162：免除改記呆帳與債務免除，FORGIVE、FORGIVEN 現在會帶交易。舊的免除仍是 null，所以只放寬、不強制。
-- 結清差額（SETTLEMENT）照舊不帶交易：3h 起不再新增，只剩舊資料。
ALTER TABLE "DebtEntry" DROP CONSTRAINT "DebtEntry_transaction_by_kind";
ALTER TABLE "DebtEntry" ADD CONSTRAINT "DebtEntry_transaction_by_kind" CHECK (
  ("kind"::text <> 'SETTLEMENT' OR "transactionId" IS NULL)
  AND ("kind"::text NOT IN ('PAID_FOR_ME', 'RECEIVED_FOR_ME') OR "transactionId" IS NOT NULL)
);
