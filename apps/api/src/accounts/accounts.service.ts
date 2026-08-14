import { HttpStatus, Injectable } from '@nestjs/common';
import { Account, ErrorCode } from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
  createdAt: Date;
}

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 列出自己的帳戶，每筆附上即時計算的餘額。 */
  async list(userId: string): Promise<Account[]> {
    const accounts = await this.prisma.account.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });

    const balances = await this.calculateBalances(accounts);
    return accounts.map((account) => this.toAccount(account, balances.get(account.id) ?? 0));
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
   *      + Σ TRANSFER (toAccountId = A)   // 轉入
   * ```
   *
   * 用兩次 `groupBy` 把所有帳戶一起算完，而不是每個帳戶各查一次——後者是典型的
   * N+1，帳戶越多越慢；這裡不論幾個帳戶都固定兩次查詢。
   *
   * 兩個共通的 `where` 條件是正確性的關鍵，缺一不可：
   *   - `deletedAt: null`——軟刪除的交易不該再影響餘額；
   *   - `ledger.tracksBalance: true`——非連動帳本（出遊分帳、社團公款等）的金額
   *     不是你的錢，算進來會讓餘額憑空膨脹或縮水。
   */
  private async calculateBalances(accounts: AccountRow[]): Promise<Map<string, number>> {
    const balances = new Map(accounts.map((account) => [account.id, account.initialBalance]));
    if (accounts.length === 0) {
      return balances;
    }

    const accountIds = accounts.map((account) => account.id);
    const countedTransactions: Prisma.TransactionWhereInput = {
      deletedAt: null,
      ledger: { tracksBalance: true },
    };

    const [outgoing, incoming] = await Promise.all([
      // 這個帳戶作為「交易的帳戶」時的三種加總：收入加、支出減、轉出減。
      this.prisma.transaction.groupBy({
        by: ['accountId', 'type'],
        where: { ...countedTransactions, accountId: { in: accountIds } },
        _sum: { amount: true },
      }),
      // 轉入：只有 TRANSFER 會填 toAccountId，這裡的加總一律是加。
      this.prisma.transaction.groupBy({
        by: ['toAccountId'],
        where: { ...countedTransactions, type: 'TRANSFER', toAccountId: { in: accountIds } },
        _sum: { amount: true },
      }),
    ]);

    for (const group of outgoing) {
      if (group.accountId === null) {
        continue; // where 已排除，這裡只是讓型別收斂
      }
      const sum = group._sum.amount ?? 0;
      const delta = group.type === 'INCOME' ? sum : -sum; // EXPENSE 與 TRANSFER 都是減
      balances.set(group.accountId, (balances.get(group.accountId) ?? 0) + delta);
    }

    for (const group of incoming) {
      if (group.toAccountId === null) {
        continue;
      }
      const sum = group._sum.amount ?? 0;
      balances.set(group.toAccountId, (balances.get(group.toAccountId) ?? 0) + sum);
    }

    return balances;
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
      return this.toAccount(account, account.initialBalance);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw this.nameTaken();
      }
      throw error;
    }
  }

  /** 更新帳戶的名稱與／或初始餘額；只有送出的欄位會被改動。 */
  async update(
    userId: string,
    accountId: string,
    input: { name?: string; initialBalance?: number },
  ): Promise<Account> {
    await this.getOwned(userId, accountId);

    try {
      const account = await this.prisma.account.update({
        where: { id: accountId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.initialBalance !== undefined ? { initialBalance: input.initialBalance } : {}),
        },
      });
      const balances = await this.calculateBalances([account]);
      return this.toAccount(account, balances.get(account.id) ?? 0);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw this.nameTaken();
      }
      throw error;
    }
  }

  /** 刪除帳戶，除非有任何交易引用它（轉出或轉入皆算）。 */
  async remove(userId: string, accountId: string): Promise<void> {
    await this.getOwned(userId, accountId);

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

  private toAccount(account: AccountRow, balance: number): Account {
    return {
      id: account.id,
      name: account.name,
      initialBalance: account.initialBalance,
      balance,
      createdAt: account.createdAt.toISOString(),
    };
  }
}
