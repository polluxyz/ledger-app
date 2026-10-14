import {
  isAccountPending,
  resolvePayerAccount,
  type PayerAccountInput,
} from './payer-account-rules';

const base: PayerAccountInput = {
  payer: { userId: 'me' },
  callerUserId: 'me',
  requestedAccountId: undefined,
  mode: 'CREATE',
  payerChanged: false,
  currentAccountId: null,
};

describe('resolvePayerAccount', () => {
  it('requires my account on create and when changing the payer to me', () => {
    expect(resolvePayerAccount(base)).toEqual({ ok: false, error: 'ACCOUNT_REQUIRED' });
    expect(resolvePayerAccount({ ...base, mode: 'UPDATE', payerChanged: true })).toEqual({
      ok: false,
      error: 'ACCOUNT_REQUIRED',
    });
    for (const mode of ['CREATE', 'UPDATE'] as const) {
      expect(resolvePayerAccount({ ...base, mode, requestedAccountId: 'mine' })).toEqual({
        ok: true,
        accountId: 'mine',
        needsOwnershipCheck: true,
        needsTemporaryAccount: false,
      });
    }
  });

  it('preserves my account on an unrelated update', () => {
    expect(resolvePayerAccount({ ...base, mode: 'UPDATE', currentAccountId: 'mine' })).toEqual({
      ok: true,
      accountId: 'mine',
      needsOwnershipCheck: false,
      needsTemporaryAccount: false,
    });
  });

  it('rejects an account for another member and requests their temporary account', () => {
    const other = { ...base, payer: { userId: 'other' } };
    expect(resolvePayerAccount({ ...other, requestedAccountId: 'mine' })).toEqual({
      ok: false,
      error: 'ACCOUNT_NOT_PAYERS',
    });
    expect(resolvePayerAccount(other)).toEqual({
      ok: true,
      accountId: null,
      needsOwnershipCheck: false,
      needsTemporaryAccount: true,
    });
    expect(
      resolvePayerAccount({
        ...other,
        mode: 'UPDATE',
        payerChanged: true,
        currentAccountId: 'mine',
      }),
    ).toEqual({
      ok: true,
      accountId: null,
      needsOwnershipCheck: false,
      needsTemporaryAccount: true,
    });
    expect(resolvePayerAccount({ ...other, mode: 'UPDATE', currentAccountId: 'theirs' })).toEqual({
      ok: true,
      accountId: 'theirs',
      needsOwnershipCheck: false,
      needsTemporaryAccount: false,
    });
  });

  it('keeps a nonmember payer without an account, including a payer change', () => {
    const guest = { ...base, payer: { userId: null } };
    expect(resolvePayerAccount({ ...guest, requestedAccountId: 'mine' })).toEqual({
      ok: false,
      error: 'ACCOUNT_NOT_PAYERS',
    });
    for (const mode of ['CREATE', 'UPDATE'] as const) {
      expect(
        resolvePayerAccount({ ...guest, mode, payerChanged: true, currentAccountId: 'mine' }),
      ).toEqual({
        ok: true,
        accountId: null,
        needsOwnershipCheck: false,
        needsTemporaryAccount: false,
      });
    }
  });
});

describe('isAccountPending', () => {
  it('only marks my side while it uses my temporary account', () => {
    const args = {
      payerUserId: 'me',
      accountId: 'temporary',
      viewerUserId: 'me',
      viewerTemporaryAccountId: 'temporary',
    };
    expect(isAccountPending(args)).toBe(true);
    expect(isAccountPending({ ...args, viewerUserId: 'other' })).toBe(false);
    expect(isAccountPending({ ...args, payerUserId: null })).toBe(false);
    expect(isAccountPending({ ...args, accountId: 'cash' })).toBe(false);
    expect(isAccountPending({ ...args, viewerTemporaryAccountId: null })).toBe(false);
  });
});
