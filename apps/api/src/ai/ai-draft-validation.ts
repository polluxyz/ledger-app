import {
  AI_MAX_DRAFTS,
  MAX_AMOUNT_CENTS,
  parseMoneyInput,
  type ParseTransactionResponse,
  type TransactionDraft,
} from '@ledger/shared';
import type { AiCatalog } from './ai-catalog';

/** 純函式建立可信任的草稿；模型多出的欄位不會穿過此投影邊界。 */
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 直接檢查日曆日，避免 Date 自動把不存在的日期進位。 */
export function isRealDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!;
}

export function validateAiDrafts(
  content: unknown,
  catalog: AiCatalog,
  defaults: ReadonlyMap<string, string | null>,
  today: string,
): ParseTransactionResponse {
  if (!record(content) || !Array.isArray(content.drafts)) return { drafts: [] };
  const drafts: TransactionDraft[] = [];
  for (const item of content.drafts.slice(0, AI_MAX_DRAFTS)) {
    if (
      !record(item) ||
      (item.type !== 'EXPENSE' && item.type !== 'INCOME' && item.type !== 'TRANSFER')
    )
      continue;
    const ledgerId =
      (typeof item.ledger === 'string' && catalog.ledgers.get(item.ledger)?.id) ||
      catalog.currentLedgerId;
    const category =
      typeof item.category === 'string' ? catalog.categories.get(item.category) : undefined;
    const account =
      typeof item.account === 'string' ? catalog.accounts.get(item.account)?.id : null;
    const defaultAccount = defaults.get(ledgerId) ?? null;
    // 預設帳戶也必須仍在本次清單中，不能藉預設值繞過非臨時帳戶邊界。
    const validDefault = [...catalog.accounts.values()].some((row) => row.id === defaultAccount)
      ? defaultAccount
      : null;
    const amount =
      typeof item.amountYuan === 'string' && /^\d+(\.\d{1,2})?$/.test(item.amountYuan)
        ? parseMoneyInput(item.amountYuan)
        : null;
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    drafts.push({
      ledgerId,
      type: item.type,
      amount: amount !== null && amount > 0 && amount <= MAX_AMOUNT_CENTS ? amount : null,
      date: item.date === null ? today : isRealDate(item.date) ? item.date : null,
      title: title.length > 0 && Array.from(title).length <= 100 ? title : null,
      categoryId:
        item.type !== 'TRANSFER' && category?.ledgerId === ledgerId && category.type === item.type
          ? category.id
          : null,
      accountId: item.account === null ? validDefault : (account ?? null),
      toAccountId:
        item.type === 'TRANSFER' && typeof item.toAccount === 'string'
          ? (catalog.accounts.get(item.toAccount)?.id ?? null)
          : null,
    });
  }
  return { drafts };
}
