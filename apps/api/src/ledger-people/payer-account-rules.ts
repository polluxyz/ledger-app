/**
 * 付款人帳戶的純規則：本人選帳戶，別的成員由後端代填臨時帳戶，非成員沒有帳戶。
 * 改付款人時不能沿用舊付款人的帳戶；實際查詢與帳戶驗證由呼叫端執行。
 */
export interface PayerAccountInput {
  payer: { userId: string | null; status: 'MEMBER' | 'LEFT' | 'GUEST' };
  callerUserId: string;
  requestedAccountId: string | undefined;
  mode: 'CREATE' | 'UPDATE';
  payerChanged: boolean;
  currentAccountId: string | null;
}

export type PayerAccountResult =
  | {
      ok: true;
      accountId: string | null;
      needsOwnershipCheck: boolean;
      needsTemporaryAccount: boolean;
    }
  | { ok: false; error: 'ACCOUNT_REQUIRED' | 'ACCOUNT_NOT_PAYERS' };

export function resolvePayerAccount(input: PayerAccountInput): PayerAccountResult {
  const { payer, callerUserId, requestedAccountId, mode, payerChanged, currentAccountId } = input;
  // 3k 決策 191：退出後不能再動到他的帳戶，修改時也必須清掉舊帳戶引用。
  if (payer.userId === null || payer.status !== 'MEMBER') {
    if (requestedAccountId !== undefined) return { ok: false, error: 'ACCOUNT_NOT_PAYERS' };
    return { ok: true, accountId: null, needsOwnershipCheck: false, needsTemporaryAccount: false };
  }
  if (payer.userId === callerUserId) {
    if (requestedAccountId !== undefined) {
      return {
        ok: true,
        accountId: requestedAccountId,
        needsOwnershipCheck: true,
        needsTemporaryAccount: false,
      };
    }
    if (mode === 'CREATE' || payerChanged) return { ok: false, error: 'ACCOUNT_REQUIRED' };
    return {
      ok: true,
      accountId: currentAccountId,
      needsOwnershipCheck: false,
      needsTemporaryAccount: false,
    };
  }
  if (requestedAccountId !== undefined) return { ok: false, error: 'ACCOUNT_NOT_PAYERS' };
  return {
    ok: true,
    accountId: payerChanged || mode === 'CREATE' ? null : currentAccountId,
    needsOwnershipCheck: false,
    needsTemporaryAccount: mode === 'CREATE' || payerChanged,
  };
}

export function isAccountPending(args: {
  payerUserId: string | null;
  accountId: string | null;
  viewerUserId: string;
  viewerTemporaryAccountId: string | null;
}): boolean {
  return (
    args.payerUserId === args.viewerUserId &&
    args.viewerTemporaryAccountId !== null &&
    args.accountId === args.viewerTemporaryAccountId
  );
}
