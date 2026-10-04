import {
  isAccountPending,
  resolvePayerAccount,
  type PayerAccountInput,
} from './payer-account-rules';

const base: PayerAccountInput = {
  tracksBalance: true,
  payer: { userId: 'me' },
  callerUserId: 'me',
  requestedAccountId: undefined,
  mode: 'CREATE',
  payerChanged: false,
  currentAccountId: null,
};

describe('resolvePayerAccount', () => {
  it('rejects accounts on unlinked ledgers and otherwise clears them', () => {
    expect(resolvePayerAccount({ ...base, tracksBalance: false, requestedAccountId: 'a' })).toEqual(
      {
        ok: false,
        error: 'ACCOUNT_NOT_ALLOWED',
      },
    );
    expect(resolvePayerAccount({ ...base, tracksBalance: false, currentAccountId: 'a' })).toEqual({
      ok: true,
      accountId: null,
      needsOwnershipCheck: false,
    });
  });

  it('requires my account on create or when changing the payer to me', () => {
    expect(resolvePayerAccount(base)).toEqual({ ok: false, error: 'ACCOUNT_REQUIRED' });
    expect(resolvePayerAccount({ ...base, mode: 'UPDATE', payerChanged: true })).toEqual({
      ok: false,
      error: 'ACCOUNT_REQUIRED',
    });
    expect(resolvePayerAccount({ ...base, requestedAccountId: 'mine' })).toEqual({
      ok: true,
      accountId: 'mine',
      needsOwnershipCheck: true,
    });
    expect(
      resolvePayerAccount({
        ...base,
        mode: 'UPDATE',
        payerChanged: true,
        requestedAccountId: 'mine',
      }),
    ).toEqual({ ok: true, accountId: 'mine', needsOwnershipCheck: true });
  });

  it('keeps my account when payer is unchanged and no account was sent', () => {
    expect(resolvePayerAccount({ ...base, mode: 'UPDATE', currentAccountId: 'mine' })).toEqual({
      ok: true,
      accountId: 'mine',
      needsOwnershipCheck: false,
    });
  });

  it('forbids choosing someone else’s account and preserves or clears their account', () => {
    const other = { ...base, payer: { userId: 'other' }, mode: 'UPDATE' as const };
    expect(resolvePayerAccount({ ...other, requestedAccountId: 'mine' })).toEqual({
      ok: false,
      error: 'ACCOUNT_NOT_PAYERS',
    });
    expect(resolvePayerAccount({ ...other, currentAccountId: 'theirs' })).toEqual({
      ok: true,
      accountId: 'theirs',
      needsOwnershipCheck: false,
    });
    expect(resolvePayerAccount({ ...other, payerChanged: true, currentAccountId: 'mine' })).toEqual(
      { ok: true, accountId: null, needsOwnershipCheck: false },
    );
  });

  it('clears an account when changing the payer from another member to a guest', () => {
    const guest = { ...base, payer: { userId: null }, mode: 'UPDATE' as const };
    expect(resolvePayerAccount({ ...guest, requestedAccountId: 'mine' })).toEqual({
      ok: false,
      error: 'ACCOUNT_NOT_PAYERS',
    });
    expect(
      resolvePayerAccount({ ...guest, currentAccountId: 'theirs', payerChanged: true }),
    ).toEqual({
      ok: true,
      accountId: null,
      needsOwnershipCheck: false,
    });
  });
});

describe('isAccountPending', () => {
  it('is visible only to the payer with an account still missing on a linked ledger', () => {
    const args = { tracksBalance: true, payerUserId: 'me', accountId: null, viewerUserId: 'me' };
    expect(isAccountPending(args)).toBe(true);
    expect(isAccountPending({ ...args, viewerUserId: 'other' })).toBe(false);
    expect(isAccountPending({ ...args, payerUserId: null })).toBe(false);
    expect(isAccountPending({ ...args, accountId: 'a' })).toBe(false);
    expect(isAccountPending({ ...args, tracksBalance: false })).toBe(false);
  });
});
