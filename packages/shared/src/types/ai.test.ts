/**
 * 「草稿完整」的判斷（4a spec §4.1）。
 *
 * 策略：從一筆完整的支出、一筆完整的轉帳出發，每次只拿掉一個欄位，確認結果跟著變。
 * 另外確認選填或用不到的欄位（名稱、轉帳的分類）是 null 也不擋。
 * 4a 補充 W241：支出／收入有提議的新分類名稱也算有分類；轉帳帶提議不改變轉帳的規則。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isDraftComplete, type TransactionDraft } from './ai.ts';

const completeExpense: TransactionDraft = {
  ledgerId: 'ledger-1',
  type: 'EXPENSE',
  amount: 6000,
  date: '2026-10-21',
  title: '早餐',
  categoryId: 'category-1',
  newCategoryName: null,
  accountId: 'account-cash',
  toAccountId: null,
};

const completeTransfer: TransactionDraft = {
  ledgerId: 'ledger-1',
  type: 'TRANSFER',
  amount: 500000,
  date: '2026-10-21',
  title: null,
  categoryId: null,
  newCategoryName: null,
  accountId: 'account-saving',
  toAccountId: 'account-cash',
};

describe('isDraftComplete: expense and income', () => {
  it('accepts a draft with amount, date, category and account', () => {
    assert.equal(isDraftComplete(completeExpense), true);
    assert.equal(isDraftComplete({ ...completeExpense, type: 'INCOME' }), true);
  });

  it('does not require a title', () => {
    assert.equal(isDraftComplete({ ...completeExpense, title: null }), true);
  });

  it('rejects a draft missing any required field', () => {
    for (const field of ['amount', 'date', 'categoryId', 'accountId'] as const) {
      assert.equal(isDraftComplete({ ...completeExpense, [field]: null }), false, field);
    }
  });
});

describe('isDraftComplete: transfer', () => {
  it('accepts two different accounts without a category', () => {
    assert.equal(isDraftComplete(completeTransfer), true);
  });

  it('rejects a draft missing any required field', () => {
    for (const field of ['amount', 'date', 'accountId', 'toAccountId'] as const) {
      assert.equal(isDraftComplete({ ...completeTransfer, [field]: null }), false, field);
    }
  });

  it('rejects the same account on both sides', () => {
    assert.equal(
      isDraftComplete({ ...completeTransfer, toAccountId: completeTransfer.accountId }),
      false,
    );
  });
});

describe('isDraftComplete: proposed new category (W241)', () => {
  const proposed = { ...completeExpense, categoryId: null, newCategoryName: '日用品' };

  it('accepts a proposed category name in place of a category', () => {
    assert.equal(isDraftComplete(proposed), true);
    assert.equal(isDraftComplete({ ...proposed, type: 'INCOME' }), true);
  });

  it('rejects a draft with neither a category nor a proposal', () => {
    assert.equal(isDraftComplete({ ...proposed, newCategoryName: null }), false);
  });

  it('still requires amount, date and account when a proposal is present', () => {
    for (const field of ['amount', 'date', 'accountId'] as const) {
      assert.equal(isDraftComplete({ ...proposed, [field]: null }), false, field);
    }
  });

  it('does not let a proposal change the transfer rules', () => {
    const transferWithProposal = { ...completeTransfer, newCategoryName: '日用品' };
    assert.equal(isDraftComplete(transferWithProposal), true);
    assert.equal(isDraftComplete({ ...transferWithProposal, toAccountId: null }), false);
  });
});
