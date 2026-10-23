import type { StatisticsGroupKind } from '@ledger/shared';
import { Prisma } from '../generated/prisma/client';

/** 分類優先；固定分組只沿往來的真正擁有人判定，避免洩漏共享帳本中別人的借還。 */
export interface StatisticsGroupSource {
  categoryId: string | null;
  differenceOf: { debtEntry: StatisticsDebtSource | null } | null;
  debtEntry: StatisticsDebtSource | null;
}

export interface StatisticsDebtSource {
  kind: string;
  counterparty: { ownerId: string };
}

/** 純函式對照；不依賴收付人、帳戶、分類名稱或往來對象名稱。 */
export function classifyStatisticsGroup(
  transaction: StatisticsGroupSource,
  userId: string,
): StatisticsGroupKind {
  if (transaction.categoryId !== null) return 'CATEGORY';
  if (transaction.differenceOf !== null) {
    return transaction.differenceOf.debtEntry?.counterparty.ownerId === userId
      ? 'DIFFERENCE'
      : 'UNCATEGORIZED';
  }
  if (transaction.debtEntry?.counterparty.ownerId === userId) {
    if (transaction.debtEntry.kind === 'FORGIVE') return 'BAD_DEBT';
    if (transaction.debtEntry.kind === 'FORGIVEN') return 'DEBT_FORGIVEN';
  }
  return 'UNCATEGORIZED';
}

/** 金額同分與最大餘數同分時都用此鍵，排序不依賴顯示文字或地區設定。 */
export function statisticsGroupKey(kind: StatisticsGroupKind, categoryId: string | null): string {
  return `${kind}:${kind === 'CATEGORY' ? categoryId : ''}`;
}

/** 僅供歸屬 CTE 使用；別名 t、own_entry、entry_owner、difference_owner 由 CTE 定義。 */
export function statisticsGroupKindSql(userId: string): Prisma.Sql {
  return Prisma.sql`CASE
    WHEN t."categoryId" IS NOT NULL THEN 'CATEGORY'
    WHEN t."differenceOfId" IS NOT NULL THEN
      CASE WHEN difference_owner."ownerId" = ${userId} THEN 'DIFFERENCE' ELSE 'UNCATEGORIZED' END
    WHEN entry_owner."ownerId" = ${userId} AND own_entry."kind" = 'FORGIVE' THEN 'BAD_DEBT'
    WHEN entry_owner."ownerId" = ${userId} AND own_entry."kind" = 'FORGIVEN' THEN 'DEBT_FORGIVEN'
    ELSE 'UNCATEGORIZED'
  END`;
}
