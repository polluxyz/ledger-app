import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '@ledger/shared';
import type {
  Counterparty,
  CreateDebtEntryResponse,
  DebtEntry,
  ListCounterpartiesQuery,
  Paginated,
} from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  currentBalance,
  loadOwnedCounterparty,
  runningBalances,
  toCounterparty,
  toDebtEntry,
} from './debt-entry-rules';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * 往來對象：清單、單一對象、改名、刪除、往來紀錄、免除。規格見 `docs/specs/phase-3b-debts.md`
 * §3、§5.1。
 *
 * 對象屬於使用者、不屬於帳本（決策 17），所以不套 `LedgerAccessGuard`；授權就是「只有擁有者
 * 看得到」，其他人一律 404（`loadOwnedCounterparty`）。
 */
@Injectable()
export class CounterpartiesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 我的對象與往來餘額。排序：餘額不為 0 的在前（還有帳要算的人），其次依名字。
   *
   * 餘額用一次 `groupBy` 算出全部對象，不逐一查詢。排序依賴算出來的餘額，資料庫排不了，
   * 所以取出全部對象再切頁——一個人的往來對象數量有限，這是刻意的取捨。
   */
  async list(userId: string, query: ListCounterpartiesQuery): Promise<Paginated<Counterparty>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const [rows, sums] = await Promise.all([
      this.prisma.counterparty.findMany({ where: { ownerId: userId } }),
      this.prisma.debtEntry.groupBy({
        by: ['counterpartyId'],
        where: { deletedAt: null, counterparty: { ownerId: userId } },
        _sum: { delta: true },
      }),
    ]);
    const balances = new Map(sums.map((sum) => [sum.counterpartyId, sum._sum.delta ?? 0]));

    const items = rows
      .map((row) => toCounterparty(row, balances.get(row.id) ?? 0))
      .sort(
        (a, b) =>
          Number(a.balance === 0) - Number(b.balance === 0) ||
          a.name.localeCompare(b.name, 'zh-Hant'),
      );

    return {
      items: items.slice((page - 1) * limit, page * limit),
      page,
      limit,
      total: items.length,
    };
  }

  async get(userId: string, counterpartyId: string): Promise<Counterparty> {
    const row = await loadOwnedCounterparty(this.prisma, userId, counterpartyId);
    return toCounterparty(row, await currentBalance(this.prisma, row.id));
  }

  /** 改名（決策 44）。名字已在 DTO 去掉前後空白；撞名回 409。 */
  async rename(userId: string, counterpartyId: string, name: string): Promise<Counterparty> {
    const row = await loadOwnedCounterparty(this.prisma, userId, counterpartyId);
    try {
      const updated = await this.prisma.counterparty.update({
        where: { id: row.id },
        data: { name },
      });
      return toCounterparty(updated, await currentBalance(this.prisma, row.id));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.COUNTERPARTY_NAME_TAKEN,
          'You already have a counterparty with this name.',
        );
      }
      throw error;
    }
  }

  /**
   * 刪除對象：只有沒有任何未刪除的往來紀錄時才可以（決策 44）。有紀錄的對象刪掉，
   * 交易就找不到來源。已軟刪除的紀錄隨對象一起清掉——它們的交易也早已軟刪除。
   */
  async remove(userId: string, counterpartyId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const row = await loadOwnedCounterparty(tx, userId, counterpartyId);
      const alive = await tx.debtEntry.count({
        where: { counterpartyId: row.id, deletedAt: null },
      });
      if (alive > 0) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.COUNTERPARTY_HAS_ENTRIES,
          'This counterparty still has entries; delete them first.',
        );
      }
      await tx.counterparty.delete({ where: { id: row.id } });
    });
  }

  /**
   * 往來紀錄，新到舊，每筆附寫入後的累計餘額（SC-L13）。累計要從最舊的一筆算起，所以取出
   * 全部未刪除紀錄算完再切頁；一個對象的紀錄數量有限。
   */
  async entries(
    userId: string,
    counterpartyId: string,
    query: ListCounterpartiesQuery,
  ): Promise<Paginated<DebtEntry>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const row = await loadOwnedCounterparty(this.prisma, userId, counterpartyId);
    const rows = await this.prisma.debtEntry.findMany({
      where: { counterpartyId: row.id, deletedAt: null },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
    const running = runningBalances(rows);

    return {
      items: rows
        .slice((page - 1) * limit, page * limit)
        .map((entry) => toDebtEntry(entry, running.get(entry))),
      page,
      limit,
      total: rows.length,
    };
  }

  /**
   * 免除剩餘（決策 39）：對方欠我時，補一筆 `FORGIVE` 讓往來餘額歸零，不產生交易。
   * 餘額 ≤ 0（對方沒欠我、或是我欠對方）時沒有東西可以免除。
   */
  forgive(userId: string, counterpartyId: string): Promise<CreateDebtEntryResponse> {
    return this.prisma.$transaction(async (tx) => {
      const row = await loadOwnedCounterparty(tx, userId, counterpartyId);
      const balance = await currentBalance(tx, row.id);
      if (balance <= 0) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.NOTHING_TO_FORGIVE,
          'This counterparty does not owe you anything.',
        );
      }
      const entry = await tx.debtEntry.create({
        data: {
          counterpartyId: row.id,
          kind: 'FORGIVE',
          delta: -balance,
          date: new Date(),
          note: null,
          transactionId: null,
        },
      });
      return {
        counterparty: toCounterparty(row, 0),
        entries: [toDebtEntry(entry)],
      };
    });
  }
}
