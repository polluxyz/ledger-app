import {
  computeDebtState,
  loadOwnedDebt,
  paidTotal,
  paymentTransactionType,
  principalTransactionType,
} from './debt-state';

/**
 * 債務共用規則的單元測試：未清餘額與狀態怎麼算（spec §3.2）、方向與交易型別的對應
 * （決策 3），以及「讀出我的債務」一律把別人的、已刪除的、不存在的回成同一個 404。
 */
describe('debt-state', () => {
  const alive = (amount: number) => ({ amount, deletedAt: null });
  const deleted = (amount: number) => ({ amount, deletedAt: new Date() });

  describe('computeDebtState', () => {
    it('is OPEN while something is still owed', () => {
      expect(
        computeDebtState({ principal: 5000, forgivenAt: null, payments: [alive(2000)] }),
      ).toEqual({ outstanding: 3000, status: 'OPEN' });
    });

    it('is SETTLED once the payments add up to the principal', () => {
      expect(
        computeDebtState({
          principal: 5000,
          forgivenAt: null,
          payments: [alive(2000), alive(3000)],
        }),
      ).toEqual({ outstanding: 0, status: 'SETTLED' });
    });

    it('ignores soft-deleted payments, so deleting one reopens the debt', () => {
      expect(
        computeDebtState({
          principal: 5000,
          forgivenAt: null,
          payments: [alive(2000), deleted(3000)],
        }),
      ).toEqual({ outstanding: 3000, status: 'OPEN' });
    });

    it('is FORGIVEN regardless of the outstanding amount', () => {
      expect(
        computeDebtState({ principal: 5000, forgivenAt: new Date(), payments: [alive(1000)] }),
      ).toEqual({ outstanding: 4000, status: 'FORGIVEN' });
    });
  });

  it('paidTotal skips soft-deleted payments', () => {
    expect(paidTotal([alive(100), deleted(900), alive(50)])).toBe(150);
  });

  it('maps a direction to its principal and payment transaction types', () => {
    expect(principalTransactionType('LENT')).toBe('LEND');
    expect(principalTransactionType('BORROWED')).toBe('BORROW');
    // 債權人收到還款是錢進來；債務人還錢是錢出去。
    expect(paymentTransactionType('LENT')).toBe('COLLECT');
    expect(paymentTransactionType('BORROWED')).toBe('REPAY');
  });

  describe('loadOwnedDebt', () => {
    it("filters by owner and deletedAt so another user's or a deleted debt is 404", async () => {
      const client = { debt: { findFirst: jest.fn().mockResolvedValue(null) } };

      await expect(loadOwnedDebt(client as never, 'user-1', 'debt-1')).rejects.toMatchObject({
        errorCode: 'NOT_FOUND',
      });
      expect(client.debt.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'debt-1', ownerId: 'user-1', deletedAt: null },
        }),
      );
    });
  });
});
