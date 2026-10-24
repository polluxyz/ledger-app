import type { LLMProvider, LlmProviderDescriptor, LlmRequest, LlmResponse } from './llm-provider';
import type { AiWireDraft } from './ai-wire-format';

interface FakeData {
  ledgers: { code: string; name: string }[];
  categories: { code: string; name: string; type: string; ledger: string }[];
  accounts: { code: string; name: string }[];
  currentLedger: string;
  today: string;
}

/**
 * 固定劇本只用名稱描述情境，再獨立讀取 system 資料查代號。
 * 不重用伺服器對照表與檢查函式，清單漏送或名稱不符就讓測試直接失敗。
 */
export class FakeLlmProvider implements LLMProvider {
  readonly descriptor: LlmProviderDescriptor = { configured: true, provider: 'fake', model: null };

  complete(request: LlmRequest): Promise<LlmResponse> {
    const match = /^<ai-data>(.*)<\/ai-data>$/m.exec(request.system);
    if (!match) throw new Error('Fake provider catalog is missing.');
    const data = JSON.parse(match[1]!) as FakeData;
    const find = <T extends { code: string }>(
      rows: T[],
      predicate: (row: T) => boolean,
    ): string => {
      const row = rows.find(predicate);
      if (!row) throw new Error('Fake provider script does not match the catalog.');
      return row.code;
    };
    const account = (name: string) => find(data.accounts, (row) => row.name === name);
    const category = (name: string, type = 'EXPENSE') =>
      find(
        data.categories,
        (row) => row.name === name && row.type === type && row.ledger === data.currentLedger,
      );
    const draft = (overrides: Partial<AiWireDraft>): AiWireDraft => ({
      type: 'EXPENSE',
      ledger: null,
      amountYuan: null,
      date: null,
      title: null,
      category: null,
      newCategory: null,
      account: null,
      toAccount: null,
      ...overrides,
    });
    let drafts: AiWireDraft[] = [];
    switch (request.user) {
      case '早餐 60 現金、午餐 120 刷卡':
        drafts = [
          draft({
            amountYuan: '60',
            title: '早餐',
            category: category('早餐'),
            account: account('現金'),
          }),
          draft({
            amountYuan: '120',
            title: '午餐',
            category: category('午餐'),
            account: account('信用卡'),
          }),
        ];
        break;
      case '昨天計程車 250': {
        const yesterday = new Date(`${data.today}T00:00:00.000Z`);
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        drafts = [
          draft({
            amountYuan: '250',
            date: yesterday.toISOString().slice(0, 10),
            title: '計程車',
            category: category('交通'),
          }),
        ];
        break;
      }
      case '從儲蓄轉 5000 到現金':
        drafts = [
          draft({
            type: 'TRANSFER',
            amountYuan: '5000',
            title: '轉帳',
            account: account('儲蓄'),
            toAccount: account('現金'),
          }),
        ];
        break;
      case '旅行基金 機票 8000 刷卡':
        drafts = [
          draft({
            ledger: find(data.ledgers, (row) => row.name === '旅行基金'),
            amountYuan: '8000',
            title: '機票',
            newCategory: '交通',
            account: account('信用卡'),
          }),
        ];
        break;
      case '旅行基金 機票 8000':
        drafts = [
          draft({
            ledger: find(data.ledgers, (row) => row.name === '旅行基金'),
            amountYuan: '8000',
            title: '機票',
          }),
        ];
        break;
      case '衛生紙 189':
        drafts = [draft({ amountYuan: '189', title: '衛生紙', newCategory: '日用品' })];
        break;
      case '洗碗精 99、垃圾袋 60':
        drafts = [
          draft({ amountYuan: '99', title: '洗碗精', newCategory: '日用品' }),
          draft({ amountYuan: '60', title: '垃圾袋', newCategory: '日用品' }),
        ];
        break;
      case '早餐 60':
        drafts = [draft({ amountYuan: '60', title: '早餐', category: category('早餐') })];
        break;
      case '薪水 30000':
        drafts = [
          draft({
            type: 'INCOME',
            amountYuan: '30000',
            title: '薪水',
            category: category('薪資', 'INCOME'),
          }),
        ];
        break;
      // 這些劇本明確代表不可寫入的帳本；故意不查不存在的代號，照指示留在目前帳本。
      case '公司聚餐 早餐 60':
      case '去年墾丁 早餐 60':
      case '舊室友 早餐 60':
        drafts = [draft({ amountYuan: '60', title: '早餐', category: category('早餐') })];
        break;
    }
    return Promise.resolve({ content: { drafts }, truncated: false });
  }
}
