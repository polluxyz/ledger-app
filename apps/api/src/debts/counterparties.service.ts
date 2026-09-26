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
  counterpartyLinked,
  findLinkOfCounterparty,
  linkInfoFor,
  otherSide,
  unlinkUsers,
} from './counterparty-links';
import {
  currentBalance,
  loadOwnedCounterparty,
  lockCounterparty,
  notFound,
  runningBalances,
  toCounterparty,
  toDebtEntry,
} from './debt-entry-rules';
import { proposeCreate, syncStatuses } from './debt-proposal-rules';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

type CounterpartyRow = Prisma.CounterpartyGetPayload<object>;

/**
 * 往來對象：新增、清單、單一對象、改名、刪除、往來紀錄、免除、解除連動。規格見
 * `docs/specs/phase-3b-debts.md` §3、§5.1 與 `phase-3b2-linking.md` §5.1。
 *
 * 對象屬於使用者、不屬於帳本（決策 17），所以不套 `LedgerAccessGuard`；授權就是「只有擁有者
 * 看得到」，其他人一律 404（`loadOwnedCounterparty`）。
 *
 * 連動中的對象，回應多帶 `link`（對方的顯示名稱與對方帳上的餘額，決策 60），由
 * `linkInfoFor` 一次算出；清單不逐一查詢。
 */
@Injectable()
export class CounterpartiesService {
  constructor(private readonly prisma: PrismaService) {}

  /** 不記帳先新增一個人（決策 55）。名字已在 DTO 去掉前後空白；撞名回 409。 */
  async create(userId: string, name: string): Promise<Counterparty> {
    try {
      const row = await this.prisma.counterparty.create({ data: { ownerId: userId, name } });
      return toCounterparty(row, 0, null);
    } catch (error) {
      throw mapNameTaken(error);
    }
  }

  /**
   * 我的對象與往來餘額。排序：餘額不為 0 的在前（還有帳要算的人），其次依名字。
   * `q` 同時比對暱稱和連動帳號名稱（包含、不分大小寫），給下拉選單邊打字邊找。
   *
   * 餘額用一次 `groupBy` 算出全部對象，不逐一查詢。排序依賴算出來的餘額，資料庫排不了，
   * 所以取出全部對象再切頁——一個人的往來對象數量有限，這是刻意的取捨。
   */
  async list(userId: string, query: ListCounterpartiesQuery): Promise<Paginated<Counterparty>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const nameFilter: Prisma.CounterpartyWhereInput =
      query.q === undefined || query.q === ''
        ? {}
        : {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              {
                linkAsLow: {
                  is: { userHigh: { name: { contains: query.q, mode: 'insensitive' } } },
                },
              },
              {
                linkAsHigh: {
                  is: { userLow: { name: { contains: query.q, mode: 'insensitive' } } },
                },
              },
            ],
          };

    const [rows, sums] = await Promise.all([
      this.prisma.counterparty.findMany({
        where: {
          ownerId: userId,
          ...(query.askMerge === true ? { askMerge: true } : {}),
          ...nameFilter,
        },
      }),
      this.prisma.debtEntry.groupBy({
        by: ['counterpartyId'],
        where: { deletedAt: null, counterparty: { ownerId: userId } },
        _sum: { delta: true },
      }),
    ]);
    const balances = new Map(sums.map((sum) => [sum.counterpartyId, sum._sum.delta ?? 0]));

    const links = await linkInfoFor(
      this.prisma,
      rows.map((row) => row.id),
    );
    const sorted = rows
      .map((row) => ({ row, balance: balances.get(row.id) ?? 0 }))
      .sort(
        (a, b) =>
          Number(a.balance === 0) - Number(b.balance === 0) ||
          (a.row.name ?? links.get(a.row.id)?.userName ?? '').localeCompare(
            b.row.name ?? links.get(b.row.id)?.userName ?? '',
            'zh-Hant',
          ),
      );
    const pageRows = sorted.slice((page - 1) * limit, page * limit);

    return {
      items: pageRows.map((item) =>
        toCounterparty(item.row, item.balance, links.get(item.row.id) ?? null),
      ),
      page,
      limit,
      total: sorted.length,
    };
  }

  async get(userId: string, counterpartyId: string): Promise<Counterparty> {
    const row = await loadOwnedCounterparty(this.prisma, userId, counterpartyId);
    return this.present(this.prisma, row);
  }

  /** 改名（決策 44）。連動中也可以改，名字是自己的（決策 72）。撞名回 409。 */
  async rename(userId: string, counterpartyId: string, name: string | null): Promise<Counterparty> {
    return this.prisma.$transaction(async (tx) => {
      const row = await loadOwnedCounterparty(tx, userId, counterpartyId);
      await lockCounterparty(tx, row.id);
      if (name === null && (await findLinkOfCounterparty(tx, row.id)) === null) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_FAILED,
          'Only a linked counterparty can use the account name.',
        );
      }
      try {
        const updated = await tx.counterparty.update({ where: { id: row.id }, data: { name } });
        return this.present(tx, updated);
      } catch (error) {
        throw mapNameTaken(error);
      }
    });
  }

  /**
   * 刪除對象：只有沒有任何未刪除的往來紀錄、而且沒有連動時才可以（決策 44、72）。
   * 有紀錄的對象刪掉，交易就找不到來源；連動中的對象刪掉，對方的連動就指向不存在的人。
   * 已軟刪除的紀錄隨對象一起清掉——它們的交易也早已軟刪除。
   */
  async remove(userId: string, counterpartyId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const row = await loadOwnedCounterparty(tx, userId, counterpartyId);
      if ((await findLinkOfCounterparty(tx, row.id)) !== null) {
        throw counterpartyLinked();
      }
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
   * 往來紀錄，新到舊，每筆附寫入後的累計餘額（SC-L13）與同步狀態（3b-2 §3.4）。累計要從
   * 最舊的一筆算起，所以取出全部未刪除紀錄算完再切頁；一個對象的紀錄數量有限。
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
    const pageRows = rows.slice((page - 1) * limit, page * limit);
    const sync = await syncStatuses(this.prisma, pageRows);

    return {
      items: pageRows.map((entry) =>
        toDebtEntry(entry, { balanceAfter: running.get(entry), sync: sync.get(entry.id) }),
      ),
      page,
      limit,
      total: rows.length,
    };
  }

  /**
   * 免除剩餘（決策 39）：對方欠我時，補一筆 `FORGIVE` 讓往來餘額歸零，不產生交易。
   * 餘額 ≤ 0（對方沒欠我、或是我欠對方）時沒有東西可以免除。連動中會送提議給對方（決策 62）。
   */
  forgive(userId: string, counterpartyId: string): Promise<CreateDebtEntryResponse> {
    return this.prisma.$transaction(async (tx) => {
      const row = await loadOwnedCounterparty(tx, userId, counterpartyId);
      await lockCounterparty(tx, row.id);
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
      await proposeCreate(tx, { fromUserId: userId, entry, amount: balance, settle: false });

      const sync = await syncStatuses(tx, [entry]);
      return {
        counterparty: await this.present(tx, row),
        entries: [toDebtEntry(entry, { sync: sync.get(entry.id) })],
      };
    });
  }

  /**
   * 解除連動（決策 70、71）：同時解除好友關係、清空配對、作廢待確認的提議與邀請。
   * 對象與紀錄保留；空暱稱會補上對方帳號名稱。沒有連動回 404。
   */
  async unlink(userId: string, counterpartyId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const row = await loadOwnedCounterparty(tx, userId, counterpartyId);
      const link = await findLinkOfCounterparty(tx, row.id);
      if (link === null) {
        throw notFound('Link');
      }
      await unlinkUsers(tx, userId, otherSide(link, row.id).userId, new Date());
    });
  }

  /** 合併前先驗兩邊都屬於呼叫者，避免從錯誤碼探測別人的對象。 */
  async merge(userId: string, targetId: string, sourceId: string): Promise<Counterparty> {
    return this.prisma.$transaction(async (tx) => {
      await loadOwnedCounterparty(tx, userId, targetId);
      await loadOwnedCounterparty(tx, userId, sourceId);
      for (const id of [targetId, sourceId].sort()) await lockCounterparty(tx, id);
      const target = await loadOwnedCounterparty(tx, userId, targetId);
      const source = await loadOwnedCounterparty(tx, userId, sourceId);
      const targetLink = await findLinkOfCounterparty(tx, target.id);
      const sourceLink = await findLinkOfCounterparty(tx, source.id);
      if (target.id === source.id || targetLink === null || sourceLink !== null) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.MERGE_NOT_ALLOWED,
          'The target must be linked and the source must be unlinked.',
        );
      }
      const oldEntries = await tx.debtEntry.findMany({
        where: { counterpartyId: source.id },
        select: { id: true },
      });
      // 舊連動的待確認／被拒絕狀態不能跟著搬進新連動；已接受的歷史紀錄保留原狀。
      // 搬入紀錄已清除配對，因此它們在新連動中都顯示為自己的單邊紀錄（sync = NONE）。
      await tx.debtProposal.updateMany({
        where: {
          sourceEntryId: { in: oldEntries.map((entry) => entry.id) },
          status: { in: ['PENDING', 'DECLINED'] },
        },
        data: { status: 'CANCELLED', respondedAt: new Date() },
      });
      await tx.debtEntry.updateMany({
        where: { counterpartyId: source.id },
        data: { counterpartyId: target.id, pairedEntryId: null },
      });
      await tx.counterparty.delete({ where: { id: source.id } });
      const updated = await tx.counterparty.update({
        where: { id: target.id },
        data: { name: target.name ?? source.name, askMerge: false },
      });
      return this.present(tx, updated);
    });
  }

  async dismissMergePrompt(userId: string, counterpartyId: string): Promise<void> {
    await loadOwnedCounterparty(this.prisma, userId, counterpartyId);
    await this.prisma.counterparty.update({
      where: { id: counterpartyId },
      data: { askMerge: false },
    });
  }

  /** 一個對象的完整回應：餘額與連動資訊。 */
  private async present(
    client: Pick<Prisma.TransactionClient, 'counterpartyLink' | 'debtEntry' | 'counterparty'>,
    row: CounterpartyRow,
  ): Promise<Counterparty> {
    const [balance, links] = await Promise.all([
      currentBalance(client, row.id),
      linkInfoFor(client, [row.id]),
    ]);
    return toCounterparty(row, balance, links.get(row.id) ?? null);
  }
}

function mapNameTaken(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.COUNTERPARTY_NAME_TAKEN,
      'You already have a counterparty with this name.',
    );
  }
  return error;
}
