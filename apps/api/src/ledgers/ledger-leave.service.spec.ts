import { LedgerLeaveService } from './ledger-leave.service';
import { DebtEntriesService } from '../debts/debt-entries.service';
import { SplitsService } from '../splits/splits.service';
import { computeLedgerSummary } from '../settlements/ledger-summary';
import type { LeaveRequest } from '@ledger/shared';
import type { Prisma } from '../generated/prisma/client';

jest.mock('../settlements/ledger-summary', () => ({ computeLedgerSummary: jest.fn() }));
const request: LeaveRequest = { targetLedgerId: 'target', excludedItemIds: [] };
function membership(role = 'EDITOR', archivedAt: Date | null = null, ledgerId = 'source') {
  return {
    ledgerId,
    userId: 'me',
    role,
    ledger: { id: ledgerId, name: '花蓮三日', kind: 'SHARED', archivedAt },
  };
}
function build() {
  let source: ReturnType<typeof membership> | null = membership();
  let target: ReturnType<typeof membership> | null = membership('OWNER', null, 'target');
  const tx = {
    ledgerMember: {
      findUnique: jest.fn(({ where }: { where: { ledgerId_userId: { ledgerId: string } } }) =>
        Promise.resolve(where.ledgerId_userId.ledgerId === 'source' ? source : target),
      ),
      count: jest.fn().mockResolvedValue(1),
      delete: jest.fn(),
    },
    transaction: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    split: { findMany: jest.fn().mockResolvedValue([]) },
    account: { findMany: jest.fn().mockResolvedValue([]) },
    counterparty: { findMany: jest.fn().mockResolvedValue([]) },
    debtEntry: { groupBy: jest.fn().mockResolvedValue([]) },
    counterpartyLink: { findMany: jest.fn().mockResolvedValue([]) },
    ledgerPersonPointer: { deleteMany: jest.fn() },
    category: { findMany: jest.fn().mockResolvedValue([]) },
    ledgerMerge: { create: jest.fn().mockResolvedValue({ id: 'merge' }) },
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'locked' }]),
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: unknown) => unknown, options?: unknown) => {
      void options;
      return callback(tx);
    }),
  };
  const accounts = {
    calculateBalances: jest.fn().mockResolvedValue({ balances: new Map(), used: new Set() }),
  };
  const ledgers = { deleteLedgerRows: jest.fn() };
  const service = new LedgerLeaveService(
    prisma as never,
    accounts as never,
    {} as never,
    {} as never,
    {} as never,
    ledgers as never,
  );
  return {
    service,
    tx,
    prisma,
    accounts,
    ledgers,
    source: (value: typeof source) => {
      source = value;
    },
    target: (value: typeof target) => {
      target = value;
    },
  };
}

/** 驗證 §4.2 擋下順序及交易隔離等級；真正回滾由 e2e 用 PostgreSQL 失敗注入驗證。 */
describe('LedgerLeaveService', () => {
  beforeEach(() =>
    jest.mocked(computeLedgerSummary).mockResolvedValue({ people: [], suggestions: [] }),
  );
  const personal = (role = 'OWNER', archivedAt: Date | null = null) => ({
    ...membership(role, archivedAt),
    ledger: { ...membership(role, archivedAt).ledger, kind: 'PERSONAL' },
  });
  it.each([
    {},
    { deleteLedger: true },
    { deleteLedger: false, moves: [] },
    { deleteLedger: true, moves: null },
    { deleteLedger: true, moves: [], targetLedgerId: null },
    { deleteLedger: true, moves: [], excludedItemIds: null },
  ])('私人帳本 request 必須使用專用欄位：%j', async (request) => {
    const b = build();
    b.source(personal());
    for (const action of ['preview', 'leave'] as const)
      await expect(b.service[action]('source', 'me', request as never)).rejects.toMatchObject({
        status: 400,
      });
    expect(b.ledgers.deleteLedgerRows).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { targetLedgerId: null },
    { excludedItemIds: [] },
    { ...request, moves: [] },
    { ...request, moves: null },
  ])('共享帳本必要欄位與禁止 moves 由 service 檢查：%j', async (request) => {
    const b = build();
    await expect(b.service.preview('source', 'me', request as never)).rejects.toMatchObject({
      status: 400,
    });
    expect(b.tx.ledgerMerge.create).not.toHaveBeenCalled();
  });
  it('私人帳本：擁有者、封存預覽仍驗目標；執行封存 409 與 confirm 400', async () => {
    const b = build();
    const request = { deleteLedger: true, moves: [] };
    b.source(personal('EDITOR'));
    await expect(b.service.preview('source', 'me', request)).rejects.toMatchObject({ status: 403 });
    b.source(personal('OWNER', new Date()));
    expect((await b.service.preview('source', 'me', request)).leave).toEqual({
      allowed: false,
      blockedBy: 'LEDGER_ARCHIVED',
    });
    await expect(b.service.leave('source', 'me', request)).rejects.toMatchObject({ status: 409 });
    b.source(personal());
    await expect(b.service.leave('source', 'me', request)).rejects.toMatchObject({ status: 400 });
  });
  it('私人帳本：來源與全部目標一起排序鎖 Ledger、LedgerMember；不建立合併或清帳戶引用', async () => {
    const b = build();
    b.source(personal());
    // 無項目時仍可觀察鎖順序，未知 item 在計畫階段才拒絕。
    await expect(
      b.service.leave('source', 'me', {
        deleteLedger: true,
        confirm: '花蓮三日',
        moves: [
          { targetLedgerId: 'target', itemIds: ['unknown'] },
          { targetLedgerId: 'aaa', itemIds: ['another'] },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });
    const calls = b.tx.$queryRaw.mock.calls as unknown as [TemplateStringsArray, string, string][];
    expect(calls.map((call) => call[1])).toEqual(['aaa', 'source', 'target']);
    for (const [strings] of calls) expect(strings.join('')).toContain('FOR UPDATE OF l, m');
    b.tx.$queryRaw.mockClear();
    await b.service.leave('source', 'me', { deleteLedger: true, moves: [], confirm: '花蓮三日' });
    expect(b.ledgers.deleteLedgerRows).toHaveBeenCalledWith(b.tx, 'source');
    expect(b.tx.ledgerMerge.create).not.toHaveBeenCalled();
    expect(b.tx.transaction.updateMany).not.toHaveBeenCalled();
    expect(b.tx.ledgerPersonPointer.deleteMany).not.toHaveBeenCalled();
    expect(b.prisma.$transaction.mock.calls.at(-1)![1]).toEqual({
      isolationLevel: 'Serializable',
      timeout: 30000,
    });
  });
  it('非成員 404 優先於封存與所有輸入檢查', async () => {
    const b = build();
    b.source(null);
    await expect(
      b.service.leave('source', 'me', { ...request, deleteLedger: true }),
    ).rejects.toMatchObject({ status: 404 });
    expect(b.tx.transaction.findMany).not.toHaveBeenCalled();
    expect(b.tx.ledgerMerge.create).not.toHaveBeenCalled();
  });
  it('封存 409 優先於 deleteLedger 的 owner 檢查', async () => {
    const b = build();
    b.source(membership('VIEWER', new Date()));
    await expect(
      b.service.leave('source', 'me', { ...request, deleteLedger: true }),
    ).rejects.toMatchObject({ status: 409, errorCode: 'LEDGER_ARCHIVED' });
  });
  it('deleteLedger：非 owner 403 優先於其他成員與 confirm', async () => {
    const b = build();
    await expect(
      b.service.leave('source', 'me', { ...request, deleteLedger: true }),
    ).rejects.toMatchObject({ status: 403 });
    expect(b.tx.ledgerMember.count).not.toHaveBeenCalled();
  });
  it('deleteLedger：其他成員 409 優先於 confirm 400', async () => {
    const b = build();
    b.source(membership('OWNER'));
    await expect(
      b.service.leave('source', 'me', { ...request, deleteLedger: true }),
    ).rejects.toMatchObject({ status: 409, errorCode: 'LEDGER_HAS_OTHER_MEMBERS' });
    expect(b.tx.transaction.count).not.toHaveBeenCalled();
  });
  it('deleteLedger：confirm 400 優先於他人帳戶 409', async () => {
    const b = build();
    b.source(membership('OWNER'));
    b.tx.ledgerMember.count.mockResolvedValue(0);
    b.tx.transaction.count.mockResolvedValue(1);
    await expect(
      b.service.leave('source', 'me', { ...request, deleteLedger: true, confirm: 'wrong' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(b.tx.transaction.count).not.toHaveBeenCalled();
  });
  it('deleteLedger：他人帳戶 409 優先於目標與 excluded ids', async () => {
    const b = build();
    b.source(membership('OWNER'));
    b.tx.ledgerMember.count.mockResolvedValue(0);
    b.tx.transaction.count.mockResolvedValue(1);
    await expect(
      b.service.leave('source', 'me', {
        ...request,
        deleteLedger: true,
        confirm: '花蓮三日',
        excludedItemIds: ['bad'],
      }),
    ).rejects.toMatchObject({ status: 409, errorCode: 'LEDGER_HAS_OTHERS_TRANSACTIONS' });
    expect(b.tx.transaction.findMany).not.toHaveBeenCalled();
  });
  it('最後一位 owner 409 優先於目標檢查；預覽回 LAST_OWNER', async () => {
    const b = build();
    b.source(membership('OWNER'));
    b.target(null);
    await expect(b.service.leave('source', 'me', request)).rejects.toMatchObject({
      status: 409,
      errorCode: 'LAST_OWNER_CANNOT_LEAVE',
    });
    const p = await b.service.preview('source', 'me', {
      targetLedgerId: null,
      excludedItemIds: [],
    });
    expect(p.leave).toEqual({ allowed: false, blockedBy: 'LAST_OWNER' });
  });
  it.each([
    { target: null, status: 404 },
    { target: membership('VIEWER', new Date(), 'target'), status: 403 },
    { target: membership('EDITOR', new Date(), 'target'), status: 409 },
  ])('目標檢查 $status 優先於未知 excluded ids', async ({ target, status }) => {
    const b = build();
    b.target(target);
    await expect(
      b.service.leave('source', 'me', { ...request, excludedItemIds: ['unknown'] }),
    ).rejects.toMatchObject({ status });
    expect(b.tx.ledgerMerge.create).not.toHaveBeenCalled();
  });
  it('有勾選項目卻無目標 400；未知 excluded id 最後檢查', async () => {
    const b = build();
    b.tx.transaction.findMany.mockResolvedValue([
      {
        id: 'item',
        creatorId: 'me',
        creator: { name: '我' },
        payerPerson: null,
        ledgerSplit: null,
        settlement: null,
        debtEntry: null,
        splitId: null,
        differenceOfId: null,
        category: null,
        type: 'EXPENSE',
        amount: 100,
        date: new Date(),
        title: null,
        note: null,
        accountId: null,
        toAccountId: null,
        deletedAt: null,
      },
    ] as never);
    await expect(
      b.service.leave('source', 'me', { targetLedgerId: null, excludedItemIds: ['unknown'] }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'A target ledger is required for selected items.',
    });
    await expect(
      b.service.leave('source', 'me', { ...request, excludedItemIds: ['unknown'] }),
    ).rejects.toMatchObject({ status: 400, message: 'excludedItemIds contains an unknown item.' });
  });
  it('預覽封存回 200 allowed false；刪除預覽依序回其他成員與他人交易 blocker', async () => {
    const b = build();
    b.source(membership('EDITOR', new Date()));
    expect((await b.service.preview('source', 'me', request)).leave).toEqual({
      allowed: false,
      blockedBy: 'LEDGER_ARCHIVED',
    });
    b.source(membership('OWNER'));
    expect(
      (await b.service.preview('source', 'me', { ...request, deleteLedger: true })).leave.blockedBy,
    ).toBe('HAS_OTHER_MEMBERS');
    b.tx.ledgerMember.count.mockResolvedValue(0);
    b.tx.transaction.count.mockResolvedValue(1);
    expect(
      (await b.service.preview('source', 'me', { ...request, deleteLedger: true })).leave.blockedBy,
    ).toBe('HAS_OTHERS_TRANSACTIONS');
  });
  it('有項目且來源已封存：null 目標仍可預覽 blocker，但非 null 目標與未知 excluded 仍驗證', async () => {
    const b = build();
    b.source(membership('EDITOR', new Date()));
    b.tx.transaction.findMany.mockResolvedValue([
      {
        id: 'item',
        creatorId: 'me',
        creator: { name: '我' },
        payerPerson: null,
        ledgerSplit: null,
        settlement: null,
        debtEntry: null,
        splitId: null,
        differenceOfId: null,
        category: null,
        type: 'EXPENSE',
        amount: 100,
        date: new Date(),
        title: null,
        note: null,
        accountId: null,
        toAccountId: null,
        deletedAt: null,
      },
    ] as never);
    const noTarget = { targetLedgerId: null, excludedItemIds: [] };
    expect((await b.service.preview('source', 'me', noTarget)).leave).toEqual({
      allowed: false,
      blockedBy: 'LEDGER_ARCHIVED',
    });
    await expect(
      b.service.preview('source', 'me', { ...noTarget, excludedItemIds: ['unknown'] }),
    ).rejects.toMatchObject({ status: 400 });
    b.target(null);
    await expect(b.service.preview('source', 'me', request)).rejects.toMatchObject({ status: 404 });
  });
  it('預覽 RepeatableRead，執行 Serializable；目標同時鎖 Ledger 與 LedgerMember，清帳戶不篩 deletedAt', async () => {
    const b = build();
    await b.service.preview('source', 'me', request);
    expect(b.prisma.$transaction.mock.calls[0]![1]).toMatchObject({
      isolationLevel: 'RepeatableRead',
    });
    await b.service.leave('source', 'me', request);
    expect(b.prisma.$transaction.mock.calls[1]![1]).toMatchObject({
      isolationLevel: 'Serializable',
    });
    expect(b.tx.$queryRaw).toHaveBeenCalledTimes(2);
    const [strings] = b.tx.$queryRaw.mock.calls[1] as [TemplateStringsArray, ...unknown[]];
    const sql = strings.join('');
    expect(sql).toContain('FOR UPDATE OF l, m');
    expect(b.tx.transaction.updateMany.mock.calls).toEqual([
      [{ where: { ledgerId: 'source', account: { userId: 'me' } }, data: { accountId: null } }],
      [{ where: { ledgerId: 'source', toAccount: { userId: 'me' } }, data: { toAccountId: null } }],
    ]);
    expect(b.tx.ledgerMerge.create).toHaveBeenCalledWith({
      data: {
        userId: 'me',
        sourceLedgerId: 'source',
        sourceLedgerName: '花蓮三日',
        targetLedgerId: null,
      },
    });
  });
});

/** 只允許退出的內部選項放寬寫入角色，預設、本人隔離與封存檢查皆保持。 */
describe('removeInTransaction ledger-leave option', () => {
  function setup(kind: 'debt' | 'split', archived = false, missingOwner = false) {
    const tx = {
      ledgerMember: {
        findUnique: jest.fn().mockResolvedValue({
          role: 'VIEWER',
          ledger: { archivedAt: archived ? new Date() : null },
        }),
      },
      debtEntry: {
        findFirst: jest.fn().mockResolvedValue(
          missingOwner
            ? null
            : {
                id: 'entry',
                kind: 'LEND',
                transactionId: 't',
                transaction: { ledgerId: 'source' },
                splitId: null,
                settlesEntryId: null,
                pairedEntryId: null,
              },
        ),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      split: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            missingOwner ? null : { id: 'split', ledgerId: 'source', entries: [] },
          ),
        update: jest.fn(),
      },
      transaction: { updateMany: jest.fn() },
      debtProposal: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $queryRaw: jest.fn(),
    };
    const service =
      kind === 'debt'
        ? new DebtEntriesService(
            {} as never,
            { softDeleteDebtTransactions: jest.fn() } as never,
            {} as never,
          )
        : new SplitsService({} as never, {} as never);
    return {
      tx,
      remove: (options?: { purpose: 'ledger-leave' }) =>
        service.removeInTransaction(tx as unknown as Prisma.TransactionClient, 'me', 'id', options),
    };
  }
  it.each(['debt', 'split'] as const)('%s：預設 VIEWER 403，退出時可以撤銷', async (kind) => {
    const b = setup(kind);
    await expect(b.remove()).rejects.toMatchObject({ status: 403 });
    await expect(b.remove({ purpose: 'ledger-leave' })).resolves.toBeUndefined();
    if (kind === 'debt')
      expect(b.tx.debtEntry.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'id', deletedAt: null, counterparty: { ownerId: 'me' } },
        }),
      );
    else
      expect(b.tx.split.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'id', deletedAt: null, ownerId: 'me' } }),
      );
  });
  it.each(['debt', 'split'] as const)('%s：退出選項仍擋封存與別人的紀錄', async (kind) => {
    await expect(setup(kind, true).remove({ purpose: 'ledger-leave' })).rejects.toMatchObject({
      status: 409,
      errorCode: 'LEDGER_ARCHIVED',
    });
    await expect(
      setup(kind, false, true).remove({ purpose: 'ledger-leave' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
