import type { StatisticsGroupKind, StatisticsPerspective, StatisticsTotals } from '@ledger/shared';
import { Prisma } from '../generated/prisma/client';
import { statisticsGroupKindSql } from './statistics-groups';
import type { TaipeiPeriod } from './taipei-period';

/** 正式查詢唯一的歸屬來源。呼叫端先檢查成員資格，並在同一個 RepeatableRead 快照執行查詢。 */
export interface StatisticsScope extends TaipeiPeriod {
  ledgerId: string;
  userId: string;
}

export interface StatisticsTotalsRow {
  income: bigint;
  expense: bigint;
}

export interface StatisticsPerspectiveTotalsRow extends StatisticsTotalsRow {
  perspective: StatisticsPerspective;
}

export interface StatisticsGroupRow {
  direction: 'INCOME' | 'EXPENSE';
  kind: StatisticsGroupKind;
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  key: string;
  amount: bigint;
}

export interface StatisticsPersonRow extends StatisticsTotalsRow {
  personId: string;
  name: string;
  isMe: boolean;
}

export interface StatisticsTrendRow extends StatisticsTotalsRow {
  month: string;
}

/** SQL bigint 轉輸出金額的共同邊界；溢位直接失敗，絕不接受截斷或捨入的金額。 */
export function safeStatisticsInteger(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new RangeError('Statistics amount exceeds safe integer');
  return result;
}

/** 收支各自驗證，再以精確整數相減；回傳 shared 契約所需的摘要。 */
export function statisticsTotalsFromRow(row: StatisticsTotalsRow): StatisticsTotals {
  return {
    income: safeStatisticsInteger(row.income),
    expense: safeStatisticsInteger(row.expense),
    net: safeStatisticsInteger(row.income - row.expense),
  };
}

/**
 * 回傳 WITH 子句，最後的 attribution 是「交易 × 歸屬人」：amount 是該人的份額。
 * 先按交易彙總份額成單一陣列才 JOIN，再刻意展開每人一列；後續只能加總 amount，
 * 不把原交易金額重複帶入。沒有 LedgerPerson 的私人帳本，以 creatorId 作內部歸屬鍵。
 */
export function statisticsAttributionCte(scope: StatisticsScope): Prisma.Sql {
  return Prisma.sql`WITH filtered_transactions AS (
    SELECT * FROM "Transaction"
    WHERE "ledgerId" = ${scope.ledgerId} AND "deletedAt" IS NULL
      AND "type" IN ('INCOME', 'EXPENSE')
      AND "date" >= ${scope.start}::timestamp AND "date" < ${scope.end}::timestamp
  ), split_allocations AS (
    SELECT ls."transactionId",
      jsonb_agg(jsonb_build_object('personId', s."personId", 'amount', s."share")) AS allocations
    FROM "LedgerSplit" ls
    JOIN filtered_transactions t ON t."id" = ls."transactionId"
    JOIN "LedgerShare" s ON s."ledgerSplitId" = ls."id"
    GROUP BY ls."transactionId"
  ), grouped_transactions AS (
    SELECT t.*, ${statisticsGroupKindSql(scope.userId)} AS kind,
      c."name" AS "categoryName", c."icon" AS "categoryIcon",
      COALESCE(sa.allocations, jsonb_build_array(jsonb_build_object(
        'personId', COALESCE(t."payerPersonId", creator_person."id"), 'amount', t."amount"
      ))) AS allocations
    FROM filtered_transactions t
    LEFT JOIN split_allocations sa ON sa."transactionId" = t."id"
    LEFT JOIN "LedgerPerson" creator_person
      ON creator_person."ledgerId" = t."ledgerId" AND creator_person."userId" = t."creatorId"
    LEFT JOIN "Category" c ON c."id" = t."categoryId"
    LEFT JOIN "DebtEntry" own_entry ON own_entry."transactionId" = t."id"
    LEFT JOIN "Counterparty" entry_owner ON entry_owner."id" = own_entry."counterpartyId"
    LEFT JOIN "DebtEntry" difference_entry ON difference_entry."transactionId" = t."differenceOfId"
    LEFT JOIN "Counterparty" difference_owner ON difference_owner."id" = difference_entry."counterpartyId"
  ), attribution AS (
    SELECT t."id" AS "transactionId", t."date", t."type"::text AS direction,
      t.kind, t."categoryId", t."categoryName", t."categoryIcon",
      t.kind || ':' || COALESCE(t."categoryId", '') AS key,
      COALESCE(p."id", t."creatorId") AS "personId",
      CASE WHEN p."userId" IS NOT NULL THEN person_user."name"
        WHEN p."id" IS NOT NULL THEN p."name" ELSE creator."name" END AS name,
      COALESCE(CASE WHEN p."id" IS NULL THEN t."creatorId" ELSE p."userId" END = ${scope.userId}, false) AS "isMe",
      allocation.amount
    FROM grouped_transactions t
    CROSS JOIN LATERAL jsonb_to_recordset(t.allocations) AS allocation("personId" text, amount bigint)
    LEFT JOIN "LedgerPerson" p ON p."id" = allocation."personId"
    LEFT JOIN "User" person_user ON person_user."id" = p."userId"
    JOIN "User" creator ON creator."id" = t."creatorId"
  )`;
}

/** 兩種口徑一起回傳；空帳本也有兩列 0，people 的份額不會放大帳本金額。 */
export function statisticsTotalsSql(scope: StatisticsScope): Prisma.Sql {
  return Prisma.sql`${statisticsAttributionCte(scope)}
    SELECT perspective,
      COALESCE(SUM(amount) FILTER (WHERE direction = 'INCOME'), 0)::bigint AS income,
      COALESCE(SUM(amount) FILTER (WHERE direction = 'EXPENSE'), 0)::bigint AS expense
    FROM (VALUES ('LEDGER'), ('MINE')) AS perspectives(perspective)
    LEFT JOIN attribution ON perspective = 'LEDGER' OR "isMe"
    GROUP BY perspective ORDER BY perspective`;
}

function perspectiveFilter(perspective: StatisticsPerspective): Prisma.Sql {
  return perspective === 'MINE' ? Prisma.sql`AND "isMe"` : Prisma.empty;
}

/** 分類金額大於 0 才回傳；順序固定為方向、金額遞減、分組鍵。百分比交給最大餘數法。 */
export function statisticsGroupsSql(
  scope: StatisticsScope,
  perspective: StatisticsPerspective = 'LEDGER',
): Prisma.Sql {
  return Prisma.sql`${statisticsAttributionCte(scope)}
    SELECT direction, kind, "categoryId", "categoryName", "categoryIcon", key,
      SUM(amount)::bigint AS amount
    FROM attribution WHERE true ${perspectiveFilter(perspective)}
    GROUP BY direction, kind, "categoryId", "categoryName", "categoryIcon", key
    HAVING SUM(amount) > 0
    ORDER BY direction, amount DESC, key COLLATE "C"`;
}

/** 成員永遠依帳本口徑，包含非成員與已離開的人；不接受 perspective 以免誤用。 */
export function statisticsPeopleSql(scope: StatisticsScope): Prisma.Sql {
  return Prisma.sql`${statisticsAttributionCte(scope)}
    SELECT "personId", name, "isMe",
      COALESCE(SUM(amount) FILTER (WHERE direction = 'INCOME'), 0)::bigint AS income,
      COALESCE(SUM(amount) FILTER (WHERE direction = 'EXPENSE'), 0)::bigint AS expense
    FROM attribution GROUP BY "personId", name, "isMe"
    HAVING SUM(amount) > 0
    ORDER BY expense DESC, "personId" COLLATE "C"`;
}

/** 僅回傳有歸屬的月份；呼叫端用 taipeiMonths 補 0。scope 應涵蓋完整曆月。 */
export function statisticsTrendSql(
  scope: StatisticsScope,
  perspective: StatisticsPerspective = 'LEDGER',
): Prisma.Sql {
  return Prisma.sql`${statisticsAttributionCte(scope)}
    SELECT to_char(("date" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Taipei', 'YYYY-MM') AS month,
      COALESCE(SUM(amount) FILTER (WHERE direction = 'INCOME'), 0)::bigint AS income,
      COALESCE(SUM(amount) FILTER (WHERE direction = 'EXPENSE'), 0)::bigint AS expense
    FROM attribution WHERE true ${perspectiveFilter(perspective)}
    GROUP BY month ORDER BY month`;
}
