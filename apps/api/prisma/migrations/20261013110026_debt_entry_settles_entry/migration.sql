-- 3g 決策 156：結清差額記下它屬於哪一筆還款。只加欄位與關聯，不回填舊資料
--（決策 157：3g 之前的差額 settlesEntryId 為 null，照舊可以單獨撤銷）。

-- AlterTable
ALTER TABLE "DebtEntry" ADD COLUMN     "settlesEntryId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "DebtEntry_settlesEntryId_key" ON "DebtEntry"("settlesEntryId");

-- AddForeignKey
ALTER TABLE "DebtEntry" ADD CONSTRAINT "DebtEntry_settlesEntryId_fkey" FOREIGN KEY ("settlesEntryId") REFERENCES "DebtEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
