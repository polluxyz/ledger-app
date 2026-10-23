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
import { GetLedgerStatisticsDto, GetStatisticsTrendDto } from './dto/get-statistics.dto';
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
  StatisticsTrendRow,
} from './statistics-sql';
import { taipeiDatePeriod, taipeiMonthPeriod, taipeiMonths } from './taipei-period';

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
          const scope = { ledgerId, userId, ...period };
          const totals = await tx.$queryRaw<StatisticsPerspectiveTotalsRow[]>(
            statisticsTotalsSql(scope),
          );
          const groups = await tx.$queryRaw<StatisticsGroupRow[]>(
            statisticsGroupsSql(scope, query.perspective),
          );
          const people =
            ledger.kind === 'SHARED'
              ? await tx.$queryRaw<StatisticsPersonRow[]>(statisticsPeopleSql(scope))
              : null;
          const total = (perspective: StatisticsPerspective) =>
            statisticsTotalsFromRow(
              totals.find((row) => row.perspective === perspective) ?? { income: 0n, expense: 0n },
            );
          return {
            ledgerId,
            from: query.from,
            to: query.to,
            ledger: total('LEDGER'),
            mine: total('MINE'),
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
          await this.requireMembership(tx, userId, ledgerId);
          const rows = await tx.$queryRaw<StatisticsTrendRow[]>(
            statisticsTrendSql({ ledgerId, userId, start, end }, query.perspective),
          );
          const byMonth = new Map(rows.map((row) => [row.month, row]));
          return {
            ledgerId,
            months: months.map((month) => ({
              month,
              ...statisticsTotalsFromRow(byMonth.get(month) ?? { income: 0n, expense: 0n }),
            })),
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
