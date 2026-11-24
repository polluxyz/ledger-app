import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type {
  CategoryIcon,
  LedgerStatistics,
  StatisticsGroup,
  StatisticsPerspective,
  StatisticsTrend,
} from '@ledger/shared';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  GetLedgerStatisticsDto,
  GetStatisticsTrendDto,
  INVALID_STATISTICS_FILTER,
  StatisticsFiltersDto,
} from './dto/get-statistics.dto';
import { allocatePercentageBps } from './percentage-bps';
import {
  safeStatisticsInteger,
  statisticsGroupsSql,
  statisticsPeopleSql,
  statisticsTotalsFromRow,
  statisticsTotalsSql,
  statisticsTrendSql,
} from './statistics-sql';
import type {
  StatisticsGroupRow,
  StatisticsPersonRow,
  StatisticsPerspectiveTotalsRow,
  StatisticsTotalsRow,
  StatisticsTrendRow,
} from './statistics-sql';
import { taipeiDatePeriod, taipeiMonthPeriod, taipeiMonths } from './taipei-period';

const EMPTY_TOTALS = { income: 0n, expense: 0n };

/** 只使用共同 SQL 歸屬來源；授權與同一份回應的所有彙總都在可重複讀取的快照中完成。 */
@Injectable()
export class StatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getStatistics(
    userId: string,
    ledgerId: string,
    query: GetLedgerStatisticsDto,
  ): Promise<LedgerStatistics> {
    const period = this.validatePeriod(() => taipeiDatePeriod(query.from, query.to));
    return this.withSafeAmounts(() =>
      this.prisma.$transaction(
        async (tx) => {
          const ledger = await this.requireMembership(tx, userId, ledgerId);
          await this.validateFilters(tx, userId, ledgerId, ledger.kind, query);
          const scope = { ledgerId, userId, ...period };
          const totals = await tx.$queryRaw<StatisticsPerspectiveTotalsRow[]>(
            statisticsTotalsSql(scope),
          );
          const groups = await tx.$queryRaw<StatisticsGroupRow[]>(
            statisticsGroupsSql(scope, query.perspective, query),
          );
          const people =
            ledger.kind === 'SHARED'
              ? await tx.$queryRaw<StatisticsPersonRow[]>(statisticsPeopleSql(scope))
              : null;
          const total = (perspective: StatisticsPerspective) =>
            statisticsTotalsFromRow(
              totals.find((row) => row.perspective === perspective) ?? EMPTY_TOTALS,
            );
          const ledgerTotals = total('LEDGER');
          const mine = total('MINE');
          const filtered = groups.reduce<StatisticsTotalsRow>(
            (sum, row) =>
              row.direction === 'INCOME'
                ? { ...sum, income: sum.income + row.amount }
                : { ...sum, expense: sum.expense + row.amount },
            EMPTY_TOTALS,
          );
          return {
            ledgerId,
            from: query.from,
            to: query.to,
            ledger: ledgerTotals,
            mine,
            totals:
              query.personIds?.length ||
              query.categoryIds?.length ||
              query.accountIds?.length ||
              query.includeUncategorized ||
              query.includeOtherAccounts
                ? statisticsTotalsFromRow(filtered)
                : query.perspective === 'MINE'
                  ? mine
                  : ledgerTotals,
            expenseGroups: this.groups(groups, 'EXPENSE'),
            incomeGroups: this.groups(groups, 'INCOME'),
            people:
              people?.map((row) => ({
                personId: row.personId,
                name: row.name,
                isMe: row.isMe,
                income: safeStatisticsInteger(row.income),
                expense: safeStatisticsInteger(row.expense),
              })) ?? null,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      ),
    );
  }

  async getTrend(
    userId: string,
    ledgerId: string,
    query: GetStatisticsTrendDto,
  ): Promise<StatisticsTrend> {
    const months = this.validatePeriod(() => taipeiMonths(query.endMonth, query.months));
    const start = taipeiMonthPeriod(months[0]!).start;
    const end = taipeiMonthPeriod(query.endMonth).end;
    return this.withSafeAmounts(() =>
      this.prisma.$transaction(
        async (tx) => {
          const ledger = await this.requireMembership(tx, userId, ledgerId);
          await this.validateFilters(tx, userId, ledgerId, ledger.kind, query);
          const rows = await tx.$queryRaw<StatisticsTrendRow[]>(
            statisticsTrendSql({ ledgerId, userId, start, end }, query.perspective, query),
          );
          // 開帳月份依整本帳本的交易日期判定，篩選與收支類型都不能縮小分母。
          const first = await tx.transaction.findFirst({
            where: { ledgerId, deletedAt: null },
            orderBy: { date: 'asc' },
            select: { date: true },
          });
          const byMonth = new Map(rows.map((row) => [row.month, row]));
          const now = Date.now();
          const eligible = months.filter((month) => {
            const monthEnd = taipeiMonthPeriod(month).end.getTime();
            return first !== null && first.date.getTime() < monthEnd && monthEnd <= now;
          });
          let income = 0n;
          let expense = 0n;
          for (const month of eligible) {
            const row = byMonth.get(month) ?? EMPTY_TOTALS;
            income += row.income;
            expense += row.expense;
          }
          const count = BigInt(eligible.length);
          // 非負整數以加半個分母再整除，恰好半分時進位。
          const average = (sum: bigint) =>
            count === 0n ? null : safeStatisticsInteger((sum + count / 2n) / count);
          return {
            ledgerId,
            months: months.map((month) => ({
              month,
              ...statisticsTotalsFromRow(byMonth.get(month) ?? EMPTY_TOTALS),
            })),
            averageIncome: average(income),
            averageExpense: average(expense),
            averageMonthCount: eligible.length,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      ),
    );
  }

  private async requireMembership(tx: Prisma.TransactionClient, userId: string, ledgerId: string) {
    const membership = await tx.ledgerMember.findUnique({
      where: { ledgerId_userId: { ledgerId, userId } },
      select: { ledger: { select: { kind: true } } },
    });
    // 不透露帳本是否存在；即使繞過 controller，也不能直接讀取別人的統計。
    if (!membership) throw new NotFoundException('Ledger not found.');
    return membership.ledger;
  }

  private async validateFilters(
    tx: Prisma.TransactionClient,
    userId: string,
    ledgerId: string,
    ledgerKind: 'PERSONAL' | 'SHARED',
    query: StatisticsFiltersDto,
  ) {
    const invalid = () => new BadRequestException([INVALID_STATISTICS_FILTER]);
    if (query.perspective === 'MINE' && query.personIds?.length) throw invalid();
    const personIds = [...new Set(query.personIds)];
    const categoryIds = [...new Set(query.categoryIds)];
    const accountIds = [...new Set(query.accountIds)];
    // 私人帳本沿用歸屬查詢的建立者鍵。共享帳本只能使用這本帳本的成員鍵。
    const ledgerPersonIds =
      ledgerKind === 'PERSONAL' ? personIds.filter((id) => id !== userId) : personIds;
    // 一次依合法範圍比對，避免用回應區分不存在與無權使用的 ID。
    const [people, categories, accounts] = await Promise.all([
      ledgerPersonIds.length
        ? tx.ledgerPerson.count({ where: { ledgerId, id: { in: ledgerPersonIds } } })
        : 0,
      categoryIds.length ? tx.category.count({ where: { ledgerId, id: { in: categoryIds } } }) : 0,
      accountIds.length ? tx.account.count({ where: { userId, id: { in: accountIds } } }) : 0,
    ]);
    if (
      people !== ledgerPersonIds.length ||
      categories !== categoryIds.length ||
      accounts !== accountIds.length
    ) {
      throw invalid();
    }
  }

  private groups(
    rows: StatisticsGroupRow[],
    direction: StatisticsGroupRow['direction'],
  ): StatisticsGroup[] {
    return allocatePercentageBps(
      rows
        .filter((row) => row.direction === direction)
        .map((row) => ({
          key: row.key,
          kind: row.kind,
          category:
            row.kind === 'CATEGORY'
              ? {
                  id: row.categoryId!,
                  name: row.categoryName!,
                  icon: row.categoryIcon as CategoryIcon | null,
                }
              : null,
          amount: safeStatisticsInteger(row.amount),
        })),
    ).map(({ kind, category, amount, percentageBps }) => ({
      kind,
      category,
      amount,
      percentageBps,
    }));
  }

  private validatePeriod<T>(read: () => T): T {
    try {
      return read();
    } catch (error) {
      if (error instanceof RangeError) throw new BadRequestException('Invalid statistics period.');
      throw error;
    }
  }

  private async withSafeAmounts<T>(read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      if (error instanceof RangeError)
        throw new InternalServerErrorException('Statistics could not be calculated.');
      throw error;
    }
  }
}
