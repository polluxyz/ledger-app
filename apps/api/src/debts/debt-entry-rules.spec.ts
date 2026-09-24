import {
  balanceOf,
  deltaFor,
  isAdjustment,
  loadOwnedCounterparty,
  loadOwnedEntry,
  runningBalances,
} from './debt-entry-rules';

/**
 * 往來帳的共用規則（spec 3b §3.2、SC-L13）：`delta` 的正負號、往來餘額與累計餘額怎麼算，
 * 以及「讀出我的對象／紀錄」一律把別人的、已刪除的、不存在的回成同一個 404。
 *
 * 全部是純函式或單一查詢，直接呼叫、不連資料庫。
 */
describe('debt-entry-rules', () => {
  describe('deltaFor', () => {
    // 正數＝對方多欠我。錢從我這邊出去（借出、我還對方）是正；對方的錢到我這邊是負。
    it.each([
      ['LEND', 120, 120],
      ['REPAY', 50, 50],
      ['BORROW', 111, -111],
      ['COLLECT', 20, -20],
      ['PAID_FOR_ME', 400, -400],
    ] as const)('%s %d → delta %d', (kind, amount, expected) => {
      expect(deltaFor(kind, amount)).toBe(expected);
    });
  });

  it('treats only SETTLEMENT and FORGIVE as adjustments', () => {
    expect(isAdjustment('SETTLEMENT')).toBe(true);
    expect(isAdjustment('FORGIVE')).toBe(true);
    expect(isAdjustment('LEND')).toBe(false);
    expect(isAdjustment('PAID_FOR_ME')).toBe(false);
  });

  it('balanceOf skips soft-deleted entries', () => {
    expect(
      balanceOf([
        { delta: 120, deletedAt: null },
        { delta: -111, deletedAt: null },
        { delta: -9, deletedAt: new Date() },
      ]),
    ).toBe(9);
  });

  describe('runningBalances', () => {
    const at = (iso: string) => new Date(iso);

    it('accumulates oldest first by date, then by creation time', () => {
      const lend = { delta: 120, date: at('2026-09-01'), createdAt: at('2026-09-01T10:00:00Z') };
      const borrow = { delta: -111, date: at('2026-09-02'), createdAt: at('2026-09-02T09:00:00Z') };
      const collect = { delta: -5, date: at('2026-09-02'), createdAt: at('2026-09-02T12:00:00Z') };
      const settle = { delta: -4, date: at('2026-09-02'), createdAt: at('2026-09-02T12:00:01Z') };

      // 故意用新到舊的順序傳入：累計與輸入順序無關。
      const running = runningBalances([settle, collect, borrow, lend]);

      expect(running.get(lend)).toBe(120);
      expect(running.get(borrow)).toBe(9);
      expect(running.get(collect)).toBe(4);
      expect(running.get(settle)).toBe(0);
    });
  });

  describe('owned lookups', () => {
    it("filters a counterparty by owner so another user's is 404", async () => {
      const client = { counterparty: { findFirst: jest.fn().mockResolvedValue(null) } };

      await expect(loadOwnedCounterparty(client as never, 'user-1', 'cp-1')).rejects.toMatchObject({
        errorCode: 'NOT_FOUND',
      });
      expect(client.counterparty.findFirst).toHaveBeenCalledWith({
        where: { id: 'cp-1', ownerId: 'user-1' },
      });
    });

    it('filters an entry by owner and deletedAt so a deleted or foreign entry is 404', async () => {
      const client = { debtEntry: { findFirst: jest.fn().mockResolvedValue(null) } };

      await expect(loadOwnedEntry(client as never, 'user-1', 'e-1')).rejects.toMatchObject({
        errorCode: 'NOT_FOUND',
      });
      expect(client.debtEntry.findFirst).toHaveBeenCalledWith({
        where: { id: 'e-1', deletedAt: null, counterparty: { ownerId: 'user-1' } },
      });
    });
  });
});
