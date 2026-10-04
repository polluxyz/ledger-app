export interface PayerAccountInput {
  tracksBalance: boolean;
  payer: { userId: string | null };
  callerUserId: string;
  requestedAccountId: string | undefined;
  mode: 'CREATE' | 'UPDATE';
  payerChanged: boolean;
  currentAccountId: string | null;
}

export type PayerAccountResult =
  | { ok: true; accountId: string | null; needsOwnershipCheck: boolean }
  | { ok: false; error: 'ACCOUNT_REQUIRED' | 'ACCOUNT_NOT_ALLOWED' | 'ACCOUNT_NOT_PAYERS' };

export function resolvePayerAccount(input: PayerAccountInput): PayerAccountResult {
  const {
    tracksBalance,
    payer,
    callerUserId,
    requestedAccountId,
    mode,
    payerChanged,
    currentAccountId,
  } = input;
  if (!tracksBalance) {
    if (requestedAccountId !== undefined) return { ok: false, error: 'ACCOUNT_NOT_ALLOWED' };
    return { ok: true, accountId: null, needsOwnershipCheck: false };
  }
  if (payer.userId === callerUserId) {
    if (requestedAccountId !== undefined) {
      return { ok: true, accountId: requestedAccountId, needsOwnershipCheck: true };
    }
    if (mode === 'CREATE' || payerChanged) return { ok: false, error: 'ACCOUNT_REQUIRED' };
    return { ok: true, accountId: currentAccountId, needsOwnershipCheck: false };
  }
  if (requestedAccountId !== undefined) return { ok: false, error: 'ACCOUNT_NOT_PAYERS' };
  return {
    ok: true,
    accountId: payer.userId === null || payerChanged ? null : currentAccountId,
    needsOwnershipCheck: false,
  };
}

export function isAccountPending(args: {
  tracksBalance: boolean;
  payerUserId: string | null;
  accountId: string | null;
  viewerUserId: string;
}): boolean {
  return (
    args.tracksBalance &&
    args.payerUserId !== null &&
    args.accountId === null &&
    args.payerUserId === args.viewerUserId
  );
}
