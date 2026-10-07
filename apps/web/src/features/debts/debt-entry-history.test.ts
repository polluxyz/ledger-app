import { describe, expect, it } from 'vitest';
import { splitDebtEntriesByBalanceZero } from './debt-entry-history';

/** 驗證按 API 的新到舊順序以最新歸零紀錄分組，不另算往來餘額。 */
describe('splitDebtEntriesByBalanceZero', () => {
  it('把最新歸零紀錄與更舊資料放進歷史', () => {
    const entries = [
      { id: 'newer', balanceAfter: 40 },
      { id: 'zero', balanceAfter: 0 },
      { id: 'older', balanceAfter: -20 },
    ];

    expect(splitDebtEntriesByBalanceZero(entries)).toEqual({
      outstanding: [entries[0]],
      history: [entries[1], entries[2]],
    });
  });

  it('整串沒有歸零紀錄時全部保持未還清', () => {
    const entries = [
      { id: 'newer', balanceAfter: -10 },
      { id: 'older', balanceAfter: -30 },
    ];

    expect(splitDebtEntriesByBalanceZero(entries)).toEqual({
      outstanding: entries,
      history: [],
    });
  });

  it('最新一筆就是歸零時全部列入歷史', () => {
    const entries = [
      { id: 'zero', balanceAfter: 0 },
      { id: 'older', balanceAfter: 50 },
    ];

    expect(splitDebtEntriesByBalanceZero(entries)).toEqual({
      outstanding: [],
      history: entries,
    });
  });
});
