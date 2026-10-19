import {
  isAccountPending,
  resolvePayerAccount,
  type PayerAccountInput,
} from './payer-account-rules';

const base: PayerAccountInput = {
  payer: { userId: 'me', status: 'MEMBER' as const },
  callerUserId: 'me',
  requestedAccountId: undefined,
  mode: 'CREATE',
  payerChanged: false,
  currentAccountId: null,
};

/** 純規則逐一涵蓋新增、付款人改變與退出後修改；不需資料庫。 */
describe('resolvePayerAccount', () => {
  it.each([
    ['CREATE', false],
    ['UPDATE', false],
    ['UPDATE', true],
  ] as const)('clears a former member account on %s with payerChanged=%s', (mode, payerChanged) => {
    for (const userId of ['other', 'me']) {
      const input = {
        ...base,
        payer: { userId, status: 'LEFT' as const },
        mode,
        payerChanged,
        currentAccountId: 'old-account',
      };
      expect(resolvePayerAccount(input)).toEqual({
        ok: true,
        accountId: null,
        needsOwnershipCheck: false,
        needsTemporaryAccount: false,
      });
      expect(resolvePayerAccount({ ...input, requestedAccountId: 'new-account' })).toEqual({
        ok: false,
        error: 'ACCOUNT_NOT_PAYERS',
      });
    }
  });

  it('uses the new member rules when changing from a former payer', () => {
    expect(resolvePayerAccount({ ...base, mode: 'UPDATE', payerChanged: true })).toEqual({
      ok: false,
      error: 'ACCOUNT_REQUIRED',
    });
    expect(
      resolvePayerAccount({
        ...base,
        mode: 'UPDATE',
        payerChanged: true,
        requestedAccountId: 'mine',
      }),
    ).toMatchObject({ ok: true, accountId: 'mine', needsOwnershipCheck: true });
    expect(
      resolvePayerAccount({
        ...base,
        mode: 'UPDATE',
        payerChanged: true,
        payer: { userId: 'other', status: 'MEMBER' },
      }),
    ).toMatchObject({ ok: true, accountId: null, needsTemporaryAccount: true });
  });
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
    const other = { ...base, payer: { userId: 'other', status: 'MEMBER' as const } };
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
    const guest = { ...base, payer: { userId: null, status: 'GUEST' as const } };
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
