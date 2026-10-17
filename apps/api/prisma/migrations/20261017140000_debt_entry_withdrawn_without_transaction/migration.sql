-- 3j 決策 186 / spec §3：撤銷後可解除帳本交易引用，保留往來紀錄與連動提議。
ALTER TABLE "DebtEntry" DROP CONSTRAINT "DebtEntry_transaction_by_kind";
ALTER TABLE "DebtEntry" ADD CONSTRAINT "DebtEntry_transaction_by_kind" CHECK (
  ("kind"::text <> 'SETTLEMENT' OR "transactionId" IS NULL)
  AND ("kind"::text NOT IN ('PAID_FOR_ME', 'RECEIVED_FOR_ME') OR "transactionId" IS NOT NULL OR "deletedAt" IS NOT NULL)
);
