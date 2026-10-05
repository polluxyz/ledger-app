import { describe, expect, it } from 'vitest';
import { ApiError } from './api-client';
import { ERROR_MESSAGES, toUserMessage } from './error-messages';

/**
 * `toUserMessage` 三條規則的單元測試：查得到代碼給中文、查不到退回後端原文、
 * 非 ApiError 給連線失敗句。呈現層的整合（FormError 怎麼渲染）另由
 * `components/FormError.test.tsx` 蓋住，這裡只驗純函式本身。
 */
describe('toUserMessage', () => {
  it('localizes every phase 3e error code with the specified wording', () => {
    const messages = {
      LEDGER_SPLIT_NOT_ALLOWED: '這筆交易不能分帳。',
      LEDGER_PERSON_NOT_SELECTABLE: '這個人已經刪除，請重新選擇。',
      LEDGER_PERSON_NAME_TAKEN: '這個名字已經有人用了。',
      LEDGER_PERSON_IN_USE: '還有交易或結清用到這個人。',
      ACCOUNT_NOT_PAYERS: '只能選自己的帳戶。',
      SETTLEMENT_SAME_PERSON: '付錢和收錢的人要不同。',
      SETTLEMENT_TRANSACTION_READ_ONLY: '請從結清修改或刪除。',
    } as const;

    expect(ERROR_MESSAGES).toMatchObject(messages);
  });

  it('returns the localized message for a code the table covers', () => {
    const error = new ApiError(
      409,
      'CATEGORY_IN_USE',
      'Cannot delete a category that transactions reference.',
    );

    expect(toUserMessage(error)).toBe(ERROR_MESSAGES.CATEGORY_IN_USE);
  });

  it('falls back to the backend message for a code the table does not cover', () => {
    // TRACKS_BALANCE_IMMUTABLE 刻意不收錄：目前的 UI 根本送不出那個欄位，
    // 拿它當「對照表沒有的代碼」正好。
    const error = new ApiError(
      400,
      'TRACKS_BALANCE_IMMUTABLE',
      'The tracksBalance flag cannot be changed after creation.',
    );

    // 後端原文原樣回傳——空字串或佔位文字都比英文更糟。
    expect(toUserMessage(error)).toBe('The tracksBalance flag cannot be changed after creation.');
  });

  it('returns the network-failure message for a non-ApiError', () => {
    // fetch 直接失敗（斷網、DNS）會拋 TypeError，不是 ApiError。
    expect(toUserMessage(new TypeError('Failed to fetch'))).toBe(
      '無法連線到伺服器，請確認網路後再試一次。',
    );
  });
});
