-- 決策 M1：全系統金額統一用「分」（0.01 元），避免同一數值在不同功能代表不同單位。
-- 決策 M8：直接將既有整數元乘 100，保留原欄位，讓既有資料換算後的實際金額不變。
UPDATE "Transaction" SET "amount" = "amount" * 100;
UPDATE "Account" SET "initialBalance" = "initialBalance" * 100;
UPDATE "DebtEntry" SET "delta" = "delta" * 100;
UPDATE "DebtProposal" SET "amount" = "amount" * 100;
