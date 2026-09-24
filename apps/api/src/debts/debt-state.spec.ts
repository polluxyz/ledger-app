import {
  computeDebtState,
  hasActiveSettlement,
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
  const alive = (amount: number) => ({ amount, deletedAt: null, settles: false });
  const deleted = (amount: number) => ({ amount, deletedAt: new Date(), settles: false });
  const settling = (amount: number) => ({ amount, deletedAt: null, settles: true });
  const lent = { direction: 'LENT' as const, forgivenAt: null };

  describe('computeDebtState', () => {
    it('is OPEN while something is still owed', () => {
      expect(computeDebtState({ ...lent, principal: 5000, payments: [alive(2000)] })).toEqual({
        outstanding: 3000,
        status: 'OPEN',
        settlementDifference: null,
      });
    });

    it('is SETTLED once the payments add up to the principal', () => {
      expect(
        computeDebtState({ ...lent, principal: 5000, payments: [alive(2000), alive(3000)] }),
      ).toEqual({ outstanding: 0, status: 'SETTLED', settlementDifference: null });
    });

    it('ignores soft-deleted payments, so deleting one reopens the debt', () => {
      expect(
        computeDebtState({ ...lent, principal: 5000, payments: [alive(2000), deleted(3000)] }),
      ).toEqual({ outstanding: 3000, status: 'OPEN', settlementDifference: null });
    });

    it('is FORGIVEN regardless of the outstanding amount', () => {
      expect(
        computeDebtState({
          direction: 'LENT',
          principal: 5000,
          forgivenAt: new Date(),
          payments: [alive(1000)],
        }),
      ).toEqual({ outstanding: 4000, status: 'FORGIVEN', settlementDifference: null });
    });

    /*
     * 以此結清（決策 30）：差額的正負號從擁有者的角度看——對我有利是正數。
     * 同樣是「少了 3 元」，借出時是少收（不利），借入時是少付（有利）。
     */
    describe('with a settling payment', () => {
      it('settles a LENT debt short of the principal with a negative difference', () => {
        expect(computeDebtState({ ...lent, principal: 93, payments: [settling(90)] })).toEqual({
          outstanding: 0,
          status: 'SETTLED',
          settlementDifference: -3,
        });
      });

      it('settles a LENT debt above the principal with a positive difference', () => {
        expect(computeDebtState({ ...lent, principal: 93, payments: [settling(95)] })).toEqual({
          outstanding: 0,
          status: 'SETTLED',
          settlementDifference: 2,
        });
      });

      it('flips the sign for a BORROWED debt: paying less is in my favour', () => {
        expect(
          computeDebtState({
            direction: 'BORROWED',
            forgivenAt: null,
            principal: 93,
            payments: [settling(90)],
          }),
        ).toEqual({ outstanding: 0, status: 'SETTLED', settlementDifference: 3 });
      });

      it('counts earlier partial payments towards the difference', () => {
        expect(
          computeDebtState({ ...lent, principal: 5000, payments: [alive(2000), settling(2990)] }),
        ).toEqual({ outstanding: 0, status: 'SETTLED', settlementDifference: -10 });
      });

      it('reports a zero difference when the settling payment matches exactly', () => {
        expect(computeDebtState({ ...lent, principal: 93, payments: [settling(93)] })).toEqual({
          outstanding: 0,
          status: 'SETTLED',
          settlementDifference: 0,
        });
      });

      it('reopens the debt once the settling payment is soft-deleted', () => {
        const removed = { ...settling(90), deletedAt: new Date() };
        expect(computeDebtState({ ...lent, principal: 93, payments: [removed] })).toEqual({
          outstanding: 93,
          status: 'OPEN',
          settlementDifference: null,
        });
      });
    });
  });

  it('hasActiveSettlement ignores soft-deleted settling payments', () => {
    expect(hasActiveSettlement([alive(10), settling(5)])).toBe(true);
    expect(hasActiveSettlement([alive(10), { ...settling(5), deletedAt: new Date() }])).toBe(false);
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
