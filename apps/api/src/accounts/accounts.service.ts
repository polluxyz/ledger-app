import { BadRequestException, HttpStatus, Injectable } from '@nestjs/common';
import { Account, BalanceTrend, ErrorCode } from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { taipeiMonthPeriod, taipeiMonths } from '../statistics/taipei-period';

/**
 * 帳戶的業務邏輯：錢實際放在哪裡、還剩多少。
 *
 * 與分類／帳本不同，帳戶隸屬**使用者**而非帳本，所以這裡完全不涉及帳本角色，
 * 授權只有一條規則且貫穿全檔：**每個查詢都以 `userId` 過濾**，不屬於呼叫者的
 * 帳戶一律當作不存在（404，而非 403）——連「它存在」都不該讓人知道。
 */

/** 從資料庫選出的帳戶資料列（尚未附上餘額）。 */
interface AccountRow {
  id: string;
  userId: string;
  name: string;
  initialBalance: number;
  isTemporary: boolean;
  createdAt: Date;
}

/**
 * 一筆交易對它的 `accountId` 是加（+1）還是減（−1）。轉帳的「轉入」另外算，不經過這裡。
 *
 * 刻意逐一列舉每個型別，而不是「INCOME 加、其他一律減」：後者在借還帳加入 `BORROW`、
 * `COLLECT` 時會默默把錢進來算成錢出去。`default` 分支的 `never` 讓新增型別卻忘了處理時，
 * typecheck 直接失敗（spec 3b §4.1、SC-D2）。
 */
function directionOf(type: Prisma.TransactionGroupByOutputType['type']): 1 | -1 {
  switch (type) {
    case 'INCOME':
    case 'BORROW': // 借入：錢進到帳戶
    case 'COLLECT': // 收回：錢進到帳戶
      return 1;
    case 'EXPENSE':
    case 'TRANSFER': // 轉出
    case 'LEND': // 借出：錢從帳戶出去
    case 'REPAY': // 償還：錢從帳戶出去
      return -1;
    default: {
      const unhandled: never = type;
      throw new Error(`Unhandled transaction type: ${String(unhandled)}`);
    }
  }
}

/** 每個運算元與中間結果都必須精確，避免溢位後減回安全範圍而掩蓋誤差。 */
function safeBalance(value: number): number {
  if (!Number.isSafeInteger(value)) {
    throw new AppException(
      HttpStatus.INTERNAL_SERVER_ERROR,
      ErrorCode.INTERNAL_ERROR,
      'Unable to calculate account balances.',
    );
  }
  return value;
}

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 列出自己的帳戶，每筆附上即時計算的餘額。臨時帳戶永遠排最後（3h W174）：它不能手動選，
   * 排在前面會讓「預設選第一個」的畫面選到它。
   */
  async list(userId: string): Promise<Account[]> {
    const accounts = await this.prisma.account.findMany({
      where: { userId },
      orderBy: [{ isTemporary: 'asc' }, { createdAt: 'asc' }],
    });

    const { balances, used } = await this.calculateBalances(accounts);
    return accounts.map((account) =>
      this.toAccount(account, balances.get(account.id) ?? 0, used.has(account.id)),
    );
  }

  /** 依目前全部帳戶回算月底資產；帳戶清單與各月餘額共用同一份資料庫快照。 */
  async balanceTrend(userId: string, endMonth: string, months = 12): Promise<BalanceTrend> {
    let periods: Array<{ month: string; end: Date }>;
    try {
      periods = taipeiMonths(endMonth, months).map((month) => ({
        month,
        end: taipeiMonthPeriod(month).end,
      }));
    } catch (error) {
      if (error instanceof RangeError) {
        throw new BadRequestException('Invalid balance trend period.');
      }
      throw error;
    }

    return this.prisma.$transaction(
      async (tx) => {
        const accounts = await tx.account.findMany({
          where: { userId },
          orderBy: { id: 'asc' },
        });
        const result: BalanceTrend = { months: [] };
        for (const { month, end } of periods) {
          const { balances } = await this.calculateBalances(accounts, tx, { date: { lt: end } });
          let total = 0;
          for (const balance of balances.values()) {
            total = safeBalance(total + safeBalance(balance));
          }
          result.months.push({ month, total });
        }
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /**
   * 一次算出多個帳戶的餘額。
   *
   * 公式：
   * ```
   * 餘額 = initialBalance
   *      + Σ INCOME   (accountId   = A)
   *      − Σ EXPENSE  (accountId   = A)
   *      − Σ TRANSFER (accountId   = A)   // 轉出
   *      + Σ BORROW、COLLECT (accountId = A)   // 借入、收回（3b）
   *      − Σ LEND、REPAY     (accountId = A)   // 借出、償還（3b）
   *      + Σ TRANSFER (toAccountId = A)   // 轉入
   * ```
   *
   * 用兩次 `groupBy` 把所有帳戶一起算完，而不是每個帳戶各查一次——後者是典型的
   * N+1，帳戶越多越慢；這裡不論幾個帳戶都固定兩次查詢。
   *
   * 共通的 `where` 條件 `deletedAt: null` 是正確性的關鍵：軟刪除的交易不該再影響餘額。
   * 3h 起沒有「不計入餘額」的帳本（決策 165），所有帳本的交易都算進來。
   * `client` 讓刪除預覽在同一個快照讀取餘額；`scope` 可計算指定帳本的影響，
   * 呼叫端給 initialBalance = 0 即取得交易淨變動，正負號仍只有這裡的公式。
   */
  async calculateBalances(
    accounts: AccountRow[],
    client: Prisma.TransactionClient = this.prisma,
    scope: Prisma.TransactionWhereInput = {},
  ): Promise<{ balances: Map<string, number>; used: Set<string> }> {
    const balances = new Map(
      accounts.map((account) => [account.id, safeBalance(account.initialBalance)]),
    );
    const used = new Set<string>();
    if (accounts.length === 0) {
      return { balances, used };
    }

    const accountIds = accounts.map((account) => account.id);
    const countedTransactions: Prisma.TransactionWhereInput = {
      ...scope,
      deletedAt: null,
    };

    const [outgoing, incoming] = await Promise.all([
      // 這個帳戶作為「交易的帳戶」時的加總，方向由 directionOf 依型別決定。
      client.transaction.groupBy({
        by: ['accountId', 'type'],
        where: { ...countedTransactions, accountId: { in: accountIds } },
        _sum: { amount: true },
      }),
      // 轉入：只有 TRANSFER 會填 toAccountId，這裡的加總一律是加。
      client.transaction.groupBy({
        by: ['toAccountId'],
        where: { ...countedTransactions, type: 'TRANSFER', toAccountId: { in: accountIds } },
        _sum: { amount: true },
      }),
    ]);

    for (const group of outgoing) {
      if (group.accountId === null) {
        continue; // where 已排除，這裡只是讓型別收斂
      }
      used.add(group.accountId);
      const sum = safeBalance(group._sum.amount ?? 0);
      const delta = directionOf(group.type) * sum;
      balances.set(group.accountId, safeBalance((balances.get(group.accountId) ?? 0) + delta));
    }

    for (const group of incoming) {
      if (group.toAccountId === null) {
        continue;
      }
      used.add(group.toAccountId);
      const sum = safeBalance(group._sum.amount ?? 0);
      balances.set(group.toAccountId, safeBalance((balances.get(group.toAccountId) ?? 0) + sum));
    }

    return { balances, used };
  }

  /**
   * 新增帳戶。名稱在同一使用者下必須唯一（靠 DB 唯一索引擋重複）。
   * 初始餘額可為負——信用卡在導入本系統前就已經有欠款是很正常的事。
   */
  async create(userId: string, name: string, initialBalance = 0): Promise<Account> {
    try {
      const account = await this.prisma.account.create({
        data: { userId, name, initialBalance },
      });
      // 全新的帳戶不可能有交易，餘額必等於初始餘額，毋須再查一次。
      return this.toAccount(account, account.initialBalance, false);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw this.nameTaken();
      }
      throw error;
    }
  }

  /**
   * 改帳戶名稱。
   *
   * **初始餘額不可更改**：它是建立當下記錄的歷史事實，改了會讓所有歷史餘額一起平移。
   * 帶著 `initialBalance` 的請求在 `ValidationPipe` 那一層就被退回 400（DTO 未宣告
   * 該欄位，且全域開了 `forbidNonWhitelisted`），到不了這裡。
   */
  async update(userId: string, accountId: string, input: { name?: string }): Promise<Account> {
    const owned = await this.getOwned(userId, accountId);
    this.assertNotTemporary(owned);

    try {
      const account = await this.prisma.account.update({
        where: { id: accountId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
        },
      });
      const { balances, used } = await this.calculateBalances([account]);
      return this.toAccount(account, balances.get(account.id) ?? 0, used.has(account.id));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw this.nameTaken();
      }
      throw error;
    }
  }

  /** 刪除帳戶，除非有任何交易引用它（轉出或轉入皆算）。 */
  async remove(userId: string, accountId: string): Promise<void> {
    const owned = await this.getOwned(userId, accountId);
    this.assertNotTemporary(owned);

    // 計數包含已軟刪除的交易：歷史紀錄必須保持可追溯，帳戶名不能憑空消失。
    // 轉入方也要算——否則刪掉轉入帳戶會讓一筆轉帳只剩半邊。
    const referencing = await this.prisma.transaction.count({
      where: { OR: [{ accountId }, { toAccountId: accountId }] },
    });
    if (referencing > 0) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.ACCOUNT_IN_USE,
        'Cannot delete an account that transactions reference.',
      );
    }

    await this.prisma.account.delete({ where: { id: accountId } });
  }

  /**
   * 載入帳戶並確認它屬於呼叫者。不屬於自己或根本不存在，一律回同樣的 404——
   * 兩者若給出不同回應，就等於提供了一個探測他人帳戶 id 的管道。
   */
  private async getOwned(userId: string, accountId: string): Promise<AccountRow> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
    });
    if (!account || account.userId !== userId) {
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Account not found.');
    }
    return account;
  }

  private nameTaken(): AppException {
    return new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.ACCOUNT_NAME_TAKEN,
      'An account with this name already exists.',
    );
  }

  /** 臨時帳戶承接待認領的歷史交易；改名或刪除會失去辨識與承接的依據。 */
  private assertNotTemporary(account: AccountRow): void {
    if (account.isTemporary) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.TEMPORARY_ACCOUNT_LOCKED,
        'Temporary accounts cannot be renamed or deleted.',
      );
    }
  }

  private toAccount(account: AccountRow, balance: number, hasTransactions: boolean): Account {
    return {
      id: account.id,
      name: account.name,
      initialBalance: account.initialBalance,
      balance,
      isTemporary: account.isTemporary,
      hasTransactions,
      createdAt: account.createdAt.toISOString(),
    };
  }
}
