import { AccountsService } from './accounts.service';
import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * AccountsService 的單元測試（Prisma 全程 mock）。
 *
 * 分成兩組：
 *   1. CRUD 與授權——重複名稱、跨使用者存取、引用中不可刪；
 *   2. **餘額計算**——這是整個功能存在的理由，也是最容易安靜出錯的地方，因此
 *      五個加減項（初始／收入／支出／轉出／轉入）與軟刪除排除各寫成獨立的案例。合成一個大測試雖然比較短，但失敗時只會說
 *      「餘額不對」，說不出是哪一項算錯。
 */
describe('AccountsService', () => {
  let service: AccountsService;
  let prisma: {
    account: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    transaction: { groupBy: jest.Mock; count: jest.Mock };
    $transaction: jest.Mock;
  };

  const userId = 'user-1';
  const accountId = 'account-1';
  const createdAt = new Date('2026-08-13T00:00:00.000Z');
  const row = {
    id: accountId,
    userId,
    name: '現金',
    initialBalance: 0,
    isTemporary: false,
    createdAt,
  };
  const p2002 = new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'test',
  });

  /**
   * 讓 `list()` 只回傳一個帳戶，並餵給它指定的加總結果，然後回傳算出的餘額。
   * `outgoing` 是「以 accountId 分組」的結果，`incoming` 是「以 toAccountId 分組」的。
   */
  async function balanceOf(
    initialBalance: number,
    outgoing: Array<{ type: string; amount: number }> = [],
    incoming: number[] = [],
  ): Promise<number> {
    prisma.account.findMany.mockResolvedValue([{ ...row, initialBalance }]);
    prisma.transaction.groupBy
      .mockResolvedValueOnce(
        outgoing.map((group) => ({
          accountId,
          type: group.type,
          _sum: { amount: group.amount },
        })),
      )
      .mockResolvedValueOnce(
        incoming.map((amount) => ({ toAccountId: accountId, _sum: { amount } })),
      );

    const accounts = await service.list(userId);
    return accounts[0]!.balance;
  }

  beforeEach(() => {
    prisma = {
      account: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      transaction: { groupBy: jest.fn(), count: jest.fn() },
      $transaction: jest.fn(),
    };
    service = new AccountsService(prisma as unknown as PrismaService);
  });

  // ── CRUD 與授權 ──────────────────────────────────────────────────────────

  it('creates an account and reports its initial balance', async () => {
    prisma.account.create.mockResolvedValue({ ...row, name: '國泰世華', initialBalance: 5000 });

    await expect(service.create(userId, '國泰世華', 5000)).resolves.toEqual({
      id: accountId,
      name: '國泰世華',
      initialBalance: 5000,
      balance: 5000,
      isTemporary: false,
      hasTransactions: false,
      createdAt: createdAt.toISOString(),
    });
  });

  it('accepts a negative initial balance (a credit card can start in debt)', async () => {
    prisma.account.create.mockResolvedValue({ ...row, name: '信用卡', initialBalance: -12000 });

    const account = await service.create(userId, '信用卡', -12000);
    expect(account.balance).toBe(-12000);
  });

  it('maps a duplicate name to 409 ACCOUNT_NAME_TAKEN', async () => {
    prisma.account.create.mockRejectedValue(p2002);

    await expect(service.create(userId, '現金')).rejects.toMatchObject({
      status: 409,
      errorCode: 'ACCOUNT_NAME_TAKEN',
    });
  });

  it('only ever writes the name when renaming', async () => {
    prisma.account.findUnique.mockResolvedValue(row);
    prisma.account.update.mockResolvedValue({ ...row, name: '國泰' });
    prisma.transaction.groupBy.mockResolvedValue([]);

    await service.update(userId, accountId, { name: '國泰' });

    // 初始餘額是歷史事實，改名這條路徑不該碰到它。DTO 已經擋掉外部送進來的值，
    // 這條測試釘住的是「service 自己也不寫」——用 toEqual 而非 objectContaining，
    // 多帶任何一個欄位都會讓它變紅。
    expect(prisma.account.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: '國泰' } }),
    );
  });

  it.each(['update', 'remove'] as const)('locks temporary accounts against %s', async (action) => {
    prisma.account.findUnique.mockResolvedValue({ ...row, isTemporary: true });

    const operation =
      action === 'update'
        ? service.update(userId, accountId, { name: '新名字' })
        : service.remove(userId, accountId);
    await expect(operation).rejects.toMatchObject({
      status: 409,
      errorCode: 'TEMPORARY_ACCOUNT_LOCKED',
    });
    expect(prisma.account.update).not.toHaveBeenCalled();
    expect(prisma.account.delete).not.toHaveBeenCalled();
  });

  it("returns 404 for another user's account instead of 403", async () => {
    // 存在，但屬於別人——回 403 等於承認它存在，因此一律當作找不到。
    prisma.account.findUnique.mockResolvedValue({ ...row, userId: 'someone-else' });

    await expect(service.update(userId, accountId, { name: '新名字' })).rejects.toMatchObject({
      status: 404,
      errorCode: 'NOT_FOUND',
    });
    expect(prisma.account.update).not.toHaveBeenCalled();
  });

  it('returns 404 for an account that does not exist', async () => {
    prisma.account.findUnique.mockResolvedValue(null);

    await expect(service.remove(userId, accountId)).rejects.toBeInstanceOf(AppException);
  });

  it('refuses to delete an account that transactions reference', async () => {
    prisma.account.findUnique.mockResolvedValue(row);
    prisma.transaction.count.mockResolvedValue(1);

    await expect(service.remove(userId, accountId)).rejects.toMatchObject({
      status: 409,
      errorCode: 'ACCOUNT_IN_USE',
    });
    expect(prisma.account.delete).not.toHaveBeenCalled();
  });

  it('counts incoming transfers as references too', async () => {
    prisma.account.findUnique.mockResolvedValue(row);
    prisma.transaction.count.mockResolvedValue(0);

    await service.remove(userId, accountId);

    // 只看 accountId 會漏掉「轉入方」，刪掉後那筆轉帳就只剩半邊。
    expect(prisma.transaction.count).toHaveBeenCalledWith({
      where: { OR: [{ accountId }, { toAccountId: accountId }] },
    });
  });

  it('deletes an account with no references', async () => {
    prisma.account.findUnique.mockResolvedValue(row);
    prisma.transaction.count.mockResolvedValue(0);

    await service.remove(userId, accountId);

    expect(prisma.account.delete).toHaveBeenCalledWith({ where: { id: accountId } });
  });

  // ── 餘額計算 ─────────────────────────────────────────────────────────────

  it('balance starts at the initial balance when there are no transactions', async () => {
    await expect(balanceOf(1000)).resolves.toBe(1000);
  });

  it('balance adds income', async () => {
    await expect(balanceOf(1000, [{ type: 'INCOME', amount: 500 }])).resolves.toBe(1500);
  });

  it('balance subtracts expenses', async () => {
    await expect(balanceOf(1000, [{ type: 'EXPENSE', amount: 300 }])).resolves.toBe(700);
  });

  it('balance subtracts outgoing transfers', async () => {
    await expect(balanceOf(1000, [{ type: 'TRANSFER', amount: 200 }])).resolves.toBe(800);
  });

  it('balance adds incoming transfers', async () => {
    await expect(balanceOf(1000, [], [250])).resolves.toBe(1250);
  });

  // 借還帳（3b，spec §4.1）：資金方向只看型別。原本的寫法是「INCOME 加、其他一律減」，
  // 借入與收回會被默默算成減少——這一組測試就是為了抓那個錯。
  it.each([
    ['LEND', 1000 - 400], // 借出：錢出去
    ['BORROW', 1000 + 400], // 借入：錢進來
    ['COLLECT', 1000 + 400], // 收回：錢進來
    ['REPAY', 1000 - 400], // 償還：錢出去
  ])('balance moves the right way for a %s transaction', async (type, expected) => {
    await expect(balanceOf(1000, [{ type, amount: 400 }])).resolves.toBe(expected);
  });

  it('balance combines every term at once', async () => {
    const balance = await balanceOf(
      1000,
      [
        { type: 'INCOME', amount: 500 },
        { type: 'EXPENSE', amount: 300 },
        { type: 'TRANSFER', amount: 200 },
      ],
      [250],
    );
    expect(balance).toBe(1250); // 1000 + 500 − 300 − 200 + 250
  });

  it('rejects an unsafe intermediate balance even if a later subtraction would restore it', async () => {
    await expect(
      balanceOf(Number.MAX_SAFE_INTEGER, [
        { type: 'INCOME', amount: 1 },
        { type: 'EXPENSE', amount: 1 },
      ]),
    ).rejects.toMatchObject({ status: 500, errorCode: 'INTERNAL_ERROR' });
  });

  it('rejects an unsafe intermediate negative balance before a later addition', async () => {
    await expect(
      balanceOf(-Number.MAX_SAFE_INTEGER, [
        { type: 'EXPENSE', amount: 1 },
        { type: 'INCOME', amount: 1 },
      ]),
    ).rejects.toMatchObject({ status: 500, errorCode: 'INTERNAL_ERROR' });
  });

  it('rejects unsafe outgoing and incoming aggregate operands', async () => {
    await expect(
      balanceOf(-1, [{ type: 'INCOME', amount: Number.MAX_SAFE_INTEGER + 1 }]),
    ).rejects.toBeInstanceOf(AppException);
    await expect(balanceOf(-1, [], [Number.MAX_SAFE_INTEGER + 1])).rejects.toBeInstanceOf(
      AppException,
    );
  });

  it('rejects overflow from an incoming transfer or an unsafe initial balance', async () => {
    await expect(balanceOf(Number.MAX_SAFE_INTEGER, [], [1])).rejects.toBeInstanceOf(AppException);
    await expect(
      service.calculateBalances([{ ...row, initialBalance: Number.MAX_SAFE_INTEGER + 1 }]),
    ).rejects.toBeInstanceOf(AppException);
  });

  it('keeps both safe integer boundaries exact', async () => {
    await expect(
      balanceOf(Number.MAX_SAFE_INTEGER - 1, [{ type: 'INCOME', amount: 1 }]),
    ).resolves.toBe(Number.MAX_SAFE_INTEGER);
    await expect(
      balanceOf(-Number.MAX_SAFE_INTEGER + 1, [{ type: 'EXPENSE', amount: 1 }]),
    ).resolves.toBe(-Number.MAX_SAFE_INTEGER);
  });

  // 趨勢使用獨立的交易 client，驗證帳戶與每個月的聚合沒有漏出 RepeatableRead 快照。
  it('reads owned accounts and monthly balances through the same repeatable-read client', async () => {
    const tx = {
      account: {
        findMany: jest
          .fn()
          .mockResolvedValue([row, { ...row, id: 'temporary', isTemporary: true }]),
      },
      transaction: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    prisma.$transaction.mockImplementation((read: (client: typeof tx) => Promise<unknown>) =>
      read(tx),
    );
    const calculate = jest.spyOn(service, 'calculateBalances');

    await expect(service.balanceTrend(userId, '2026-10', 2)).resolves.toEqual({
      months: [
        { month: '2026-09', total: 0 },
        { month: '2026-10', total: 0 },
      ],
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(tx.account.findMany).toHaveBeenCalledWith({ where: { userId }, orderBy: { id: 'asc' } });
    expect(prisma.account.findMany).not.toHaveBeenCalled();
    expect(prisma.transaction.groupBy).not.toHaveBeenCalled();
    expect(calculate).toHaveBeenNthCalledWith(1, expect.any(Array), tx, {
      date: { lt: new Date('2026-09-30T16:00:00Z') },
    });
    expect(calculate).toHaveBeenNthCalledWith(2, expect.any(Array), tx, {
      date: { lt: new Date('2026-10-31T16:00:00Z') },
    });
    expect(tx.transaction.groupBy).toHaveBeenCalledTimes(4);
  });

  it('rejects intermediate overflow across accounts before an offsetting account', async () => {
    prisma.account.findMany.mockResolvedValue([
      { ...row, initialBalance: Number.MAX_SAFE_INTEGER },
      { ...row, id: 'second', initialBalance: 1 },
      { ...row, id: 'third', initialBalance: -1 },
    ]);
    prisma.transaction.groupBy.mockResolvedValue([]);
    prisma.$transaction.mockImplementation((read: (client: typeof prisma) => Promise<unknown>) =>
      read(prisma),
    );
    await expect(service.balanceTrend(userId, '2026-10', 1)).rejects.toBeInstanceOf(AppException);
  });

  it.each([
    ['2026-13', 12],
    ['0001-01', 12],
    ['2026-10', 0],
    ['2026-10', 25],
    ['2026-10', 1.5],
  ])('maps invalid periods to 400 before querying (%s, %s)', async (month, count) => {
    await expect(service.balanceTrend(userId, month, count)).rejects.toMatchObject({ status: 400 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('excludes soft-deleted transactions from the sums', async () => {
    // 已刪的交易不應繼續影響餘額；3h 起所有帳本都計入餘額。
    prisma.account.findMany.mockResolvedValue([row]);
    prisma.transaction.groupBy.mockResolvedValue([]);

    await service.list(userId);

    const calls = prisma.transaction.groupBy.mock.calls as Array<[{ where: unknown }]>;
    expect(calls).toHaveLength(2);
    for (const [args] of calls) {
      expect(args.where).toMatchObject({ deletedAt: null });
    }
  });

  it('reports hasTransactions for active outgoing and incoming references', async () => {
    prisma.account.findMany.mockResolvedValue([row, { ...row, id: 'account-2' }]);
    prisma.transaction.groupBy
      .mockResolvedValueOnce([{ accountId, type: 'EXPENSE', _sum: { amount: 100 } }])
      .mockResolvedValueOnce([{ toAccountId: 'account-2', _sum: { amount: 100 } }]);

    const accounts = await service.list(userId);
    expect(accounts.map((account) => account.hasTransactions)).toEqual([true, true]);
  });

  it('reports no transactions when only soft-deleted rows exist', async () => {
    prisma.account.findMany.mockResolvedValue([row]);
    prisma.transaction.groupBy.mockResolvedValue([]);

    const accounts = await service.list(userId);
    expect(accounts[0]!.hasTransactions).toBe(false);
    const calls = prisma.transaction.groupBy.mock.calls as Array<
      [{ where: { deletedAt: Date | null } }]
    >;
    expect(calls).toHaveLength(2);
    for (const [args] of calls) {
      expect(args.where.deletedAt).toBeNull();
    }
  });

  it('reports no transactions for an unused account', async () => {
    prisma.account.findMany.mockResolvedValue([row]);
    prisma.transaction.groupBy.mockResolvedValue([]);

    const accounts = await service.list(userId);
    expect(accounts[0]!.hasTransactions).toBe(false);
  });

  it('only ever issues two aggregate queries, however many accounts there are', async () => {
    // 每個帳戶各查一次是典型的 N+1；這裡固定兩次查詢。
    prisma.account.findMany.mockResolvedValue([
      row,
      { ...row, id: 'account-2' },
      { ...row, id: 'account-3' },
    ]);
    prisma.transaction.groupBy.mockResolvedValue([]);

    await service.list(userId);

    expect(prisma.transaction.groupBy).toHaveBeenCalledTimes(2);
  });

  it('skips the aggregate queries entirely when the user has no accounts', async () => {
    prisma.account.findMany.mockResolvedValue([]);

    await expect(service.list(userId)).resolves.toEqual([]);
    expect(prisma.transaction.groupBy).not.toHaveBeenCalled();
  });
});
