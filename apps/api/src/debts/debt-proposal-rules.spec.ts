import {
  deriveSync,
  mirrorKind,
  proposeAmend,
  proposeCreate,
  proposeDelete,
  toDebtProposal,
} from './debt-proposal-rules';

/**
 * 提議的共用規則（spec 3b-2 §3.2～§3.4，決策 62、67、68）。
 *
 * 分三塊驗：
 * 1. 純函式：種類換角度、同步狀態的推導、回應依方向隱藏欄位。
 * 2. 送提議的三個函式在「沒連動 / 還在等對方 / 已配對」三種情況下各做了什麼寫入。
 *    Prisma 用 mock，只斷言寫入的形狀；真正的並發與資料庫約束由 e2e 驗。
 * 3. 不送的情況（代付、沒有連動）一律不碰 `debtProposal.create`。
 */
describe('debt proposal rules', () => {
  describe('mirrorKind (§3.2)', () => {
    it.each([
      ['LEND', 'BORROW'],
      ['BORROW', 'LEND'],
      ['COLLECT', 'REPAY'],
      ['REPAY', 'COLLECT'],
      ['FORGIVE', 'FORGIVEN'],
      ['FORGIVEN', 'FORGIVE'],
      ['SETTLEMENT', 'SETTLEMENT'],
    ] as const)('%s ↔ %s', (kind, mirrored) => {
      expect(mirrorKind(kind)).toBe(mirrored);
    });
  });

  describe('deriveSync (§3.4)', () => {
    it.each([
      [false, undefined, 'NONE'],
      [true, undefined, 'SYNCED'],
      [true, 'ACCEPTED', 'SYNCED'],
      [false, 'PENDING', 'PENDING'],
      [true, 'PENDING', 'PENDING'],
      [false, 'DECLINED', 'DECLINED'],
      // 已配對但改金額被拒：兩邊已經不一樣了，要讓使用者看到。
      [true, 'DECLINED', 'DECLINED'],
      [false, 'ACCEPTED', 'NONE'],
    ] as const)('paired=%s, latest=%s → %s', (paired, latest, expected) => {
      expect(deriveSync(paired, latest)).toBe(expected);
    });
  });

  describe('toDebtProposal (§3.5, §5.3)', () => {
    const row = {
      id: 'proposal-1',
      fromUserId: 'alice',
      toUserId: 'bob',
      type: 'CREATE' as const,
      sourceEntryId: 'alice-entry',
      targetEntryId: null,
      entryKind: 'LEND' as const,
      amount: 120,
      date: new Date('2026-09-25T00:00:00.000Z'),
      settle: false,
      status: 'PENDING' as const,
      respondedAt: null,
      createdAt: new Date('2026-09-25T00:00:00.000Z'),
      updatedAt: new Date('2026-09-25T00:00:00.000Z'),
      fromUser: { id: 'alice', name: 'Alice' },
      toUser: { id: 'bob', name: 'Bob' },
    };

    it('shows the recipient their own perspective and hides the source entry', () => {
      const view = toDebtProposal(row, 'bob', 'bob-side');
      expect(view).toMatchObject({
        direction: 'incoming',
        entryKind: 'BORROW',
        otherUser: { id: 'alice', name: 'Alice' },
        counterpartyId: 'bob-side',
      });
      expect(view).not.toHaveProperty('sourceEntryId');
    });

    it('shows the proposer their own kind and entry', () => {
      const view = toDebtProposal(row, 'alice', 'alice-side');
      expect(view).toMatchObject({
        direction: 'outgoing',
        entryKind: 'LEND',
        otherUser: { id: 'bob', name: 'Bob' },
        sourceEntryId: 'alice-entry',
      });
    });
  });

  function entry(overrides: Record<string, unknown> = {}) {
    return {
      id: 'entry-1',
      counterpartyId: 'cp-alice',
      kind: 'LEND' as const,
      delta: 150,
      date: new Date('2026-09-25T00:00:00.000Z'),
      note: null,
      transactionId: null,
      pairedEntryId: null as string | null,
      deletedAt: null,
      createdAt: new Date('2026-09-25T00:00:00.000Z'),
      updatedAt: new Date('2026-09-25T00:00:00.000Z'),
      ...overrides,
    };
  }

  const LINK = {
    id: 'link-1',
    userLowId: 'alice',
    userHighId: 'bob',
    counterpartyLowId: 'cp-alice',
    counterpartyHighId: 'cp-bob',
    createdAt: new Date(),
  };

  function buildTx(options: { linked?: boolean; pendingCreate?: boolean } = {}) {
    return {
      counterpartyLink: {
        findFirst: jest.fn().mockResolvedValue(options.linked === false ? null : LINK),
      },
      debtProposal: {
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn((args: { where: { type?: string } }) =>
          Promise.resolve({
            count: args.where.type === 'CREATE' && options.pendingCreate === true ? 1 : 0,
          }),
        ),
      },
      debtEntry: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
  }
  const NOW = new Date('2026-09-25T01:00:00.000Z');

  describe('proposeCreate (decision 62)', () => {
    it('sends a CREATE to the linked user', async () => {
      const tx = buildTx();
      await proposeCreate(tx as never, {
        fromUserId: 'alice',
        entry: entry(),
        amount: 150,
        settle: false,
      });
      expect(tx.debtProposal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          fromUserId: 'alice',
          toUserId: 'bob',
          type: 'CREATE',
          sourceEntryId: 'entry-1',
          entryKind: 'LEND',
          amount: 150,
        }) as unknown,
      });
    });

    it('sends nothing for paid-for-me or when not linked', async () => {
      const paidForMe = buildTx();
      await proposeCreate(paidForMe as never, {
        fromUserId: 'alice',
        entry: entry({ kind: 'PAID_FOR_ME', delta: -150 }),
        amount: 150,
        settle: false,
      });
      expect(paidForMe.debtProposal.create).not.toHaveBeenCalled();

      const unlinked = buildTx({ linked: false });
      await proposeCreate(unlinked as never, {
        fromUserId: 'alice',
        entry: entry(),
        amount: 150,
        settle: false,
      });
      expect(unlinked.debtProposal.create).not.toHaveBeenCalled();
    });
  });

  describe('proposeAmend (decisions 67, 68)', () => {
    it('updates a pending CREATE in place instead of sending another', async () => {
      const tx = buildTx({ pendingCreate: true });
      await proposeAmend(tx as never, { fromUserId: 'alice', entry: entry(), now: NOW });
      expect(tx.debtProposal.updateMany).toHaveBeenCalledWith({
        where: { sourceEntryId: 'entry-1', status: 'PENDING', type: 'CREATE' },
        data: { amount: 150, date: entry().date },
      });
      expect(tx.debtProposal.create).not.toHaveBeenCalled();
    });

    it('cancels the pending change and sends an AMEND for a paired entry', async () => {
      const tx = buildTx();
      await proposeAmend(tx as never, {
        fromUserId: 'alice',
        entry: entry({ pairedEntryId: 'bob-entry' }),
        now: NOW,
      });
      expect(tx.debtProposal.updateMany).toHaveBeenLastCalledWith({
        where: { sourceEntryId: 'entry-1', status: 'PENDING' },
        data: { status: 'CANCELLED', respondedAt: NOW },
      });
      expect(tx.debtProposal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'AMEND',
          toUserId: 'bob',
          targetEntryId: 'bob-entry',
          amount: 150,
        }) as unknown,
      });
    });

    it('sends nothing for an entry that was never synced', async () => {
      const tx = buildTx();
      await proposeAmend(tx as never, { fromUserId: 'alice', entry: entry(), now: NOW });
      expect(tx.debtProposal.create).not.toHaveBeenCalled();
    });
  });

  describe('proposeDelete (decision 67)', () => {
    it('only withdraws a pending CREATE', async () => {
      const tx = buildTx({ pendingCreate: true });
      await proposeDelete(tx as never, { fromUserId: 'alice', entry: entry(), now: NOW });
      expect(tx.debtProposal.create).not.toHaveBeenCalled();
      expect(tx.debtEntry.updateMany).not.toHaveBeenCalled();
    });

    it('clears both pairings and sends a DELETE for a paired entry', async () => {
      const tx = buildTx();
      await proposeDelete(tx as never, {
        fromUserId: 'alice',
        entry: entry({ pairedEntryId: 'bob-entry' }),
        now: NOW,
      });
      expect(tx.debtEntry.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['entry-1', 'bob-entry'] } },
        data: { pairedEntryId: null },
      });
      expect(tx.debtProposal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'DELETE',
          targetEntryId: 'bob-entry',
          amount: 150,
        }) as unknown,
      });
    });
  });
});
