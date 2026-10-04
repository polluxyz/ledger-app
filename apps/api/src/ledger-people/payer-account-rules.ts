/**
 * 「帳戶屬於付款人」的規則（3e 決策 123～126、129），寫成純函式讓交易與結清共用同一份。
 *
 * 帳戶屬於使用者且彼此看不到，所以只有付款人本人能選帳戶：別人付時留空（帳戶待補），
 * 非成員付時永遠空。改付款人時舊帳戶一律清掉，否則會扣到舊付款人的錢（決策 125）。
 * 帳戶是否真的屬於呼叫者由呼叫端查（`needsOwnershipCheck`），這裡不碰資料庫。
 */
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
