import { FakeLlmProvider } from './fake-llm.provider';

/** 劇本獨立解讀名稱清單，缺名稱時失敗而不是自行編造代號。 */
describe('FakeLlmProvider', () => {
  const provider = new FakeLlmProvider();
  const data = {
    ledgers: [
      { code: 'L9', name: '日常' },
      { code: 'L8', name: '旅行基金' },
    ],
    categories: [
      { code: 'C7', name: '早餐', ledger: 'L9', type: 'EXPENSE' },
      { code: 'C6', name: '午餐', ledger: 'L9', type: 'EXPENSE' },
      { code: 'C5', name: '交通', ledger: 'L9', type: 'EXPENSE' },
    ],
    accounts: [
      { code: 'A8', name: '現金' },
      { code: 'A7', name: '信用卡' },
      { code: 'A6', name: '儲蓄' },
    ],
    currentLedger: 'L9',
    today: '2040-03-01',
  };
  const send = (user: string, catalog = data) =>
    provider.complete({
      system: `<ai-data>${JSON.stringify(catalog)}</ai-data>`,
      user,
      schema: {},
    });
  it('uses actual codes from names rather than hardcoded positions', async () => {
    expect((await send('早餐 60 現金、午餐 120 刷卡')).content).toMatchObject({
      drafts: [
        { category: 'C7', account: 'A8' },
        { category: 'C6', account: 'A7' },
      ],
    });
    expect((await send('昨天計程車 250')).content).toMatchObject({
      drafts: [{ date: '2040-02-29', category: 'C5' }],
    });
    expect((await send('從儲蓄轉 5000 到現金')).content).toMatchObject({
      drafts: [{ type: 'TRANSFER', account: 'A6', toAccount: 'A8', newCategory: null }],
    });
    expect((await send('旅行基金 機票 8000 刷卡')).content).toMatchObject({
      drafts: [{ ledger: 'L8', category: null, newCategory: '交通', account: 'A7' }],
    });
    expect((await send('旅行基金 機票 8000')).content).toMatchObject({
      drafts: [{ ledger: 'L8', category: null, newCategory: null }],
    });
    expect((await send('衛生紙 189')).content).toMatchObject({
      drafts: [
        {
          type: 'EXPENSE',
          amountYuan: '189',
          title: '衛生紙',
          category: null,
          newCategory: '日用品',
        },
      ],
    });
    expect((await send('洗碗精 99、垃圾袋 60')).content).toMatchObject({
      drafts: [
        {
          type: 'EXPENSE',
          amountYuan: '99',
          title: '洗碗精',
          category: null,
          newCategory: '日用品',
        },
        {
          type: 'EXPENSE',
          amountYuan: '60',
          title: '垃圾袋',
          category: null,
          newCategory: '日用品',
        },
      ],
    });
  });
  it('returns empty for unknown and out of scope sentences', async () => {
    for (const text of [
      '今天天氣很好',
      '借小華 500',
      '小明付晚餐 900，三人平分',
      '這個月吃飯花多少',
    ])
      expect((await send(text)).content).toEqual({ drafts: [] });
  });
  it('fails if script names or data are missing', () => {
    expect(() => send('早餐 60 現金、午餐 120 刷卡', { ...data, accounts: [] })).toThrow(
      'does not match',
    );
    expect(() => provider.complete({ system: '', user: '今天天氣很好', schema: {} })).toThrow(
      'missing',
    );
  });
});
