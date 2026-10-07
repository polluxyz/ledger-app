import type { Cents } from './money';
import type { SettlementSuggestion } from './types/ledger-split';
import type { LedgerPointer } from './types/ledger-pointer';

/**
 * 共享帳本的欠款併進借還的純函式（3f 決策 142、143、148）。後端用它們算 `/counterparties`
 * 與 `/ledger-groups`；放在 shared 是為了用 Node 內建 test runner 直接測，不是給前端算錢。
 *
 * 只能 `import type`（見根目錄 `CLAUDE.md` §3）。
 */

/**
 * 從一本帳本的結清轉帳（`suggestSettlements` 的結果）取出跟我有關的金額（決策 142）。
 *
 * 回傳以「對方的 personId」為 key：我收＝對方欠我（正數），我付＝我欠對方（負數）。
 * 跟我無關的轉帳不算；同一個人出現多筆時相加；加總為 0 的人不放進結果。
 */
export function myLedgerAmounts(
  suggestions: readonly SettlementSuggestion[],
  myPersonId: string,
): Map<string, Cents> {
  void suggestions;
  void myPersonId;
  throw new Error('myLedgerAmounts: not implemented');
}

/** `resolvePointer` 的輸入。 */
export interface ResolvePointerInput {
  /**
   * 我對這個人的明確設定；`undefined`＝沒有設定（套用自動指向）。
   * 設定值 `null`＝明確「不指向」。
   */
  explicit: string | null | undefined;
  /** 這個人的帳號；虛擬成員為 `null`。 */
  personUserId: string | null;
  /** 我的已連動對象：key＝對方帳號的 userId，value＝我的 counterpartyId。 */
  linkedCounterpartyByUserId: ReadonlyMap<string, string>;
}

/**
 * 決策 148：有明確設定就用設定（含「不指向」）；沒有時，帳號符合我某個連動對象就自動指向它，
 * 否則不指向。呼叫端負責排除「我自己那一筆」。
 */
export function resolvePointer(input: ResolvePointerInput): LedgerPointer {
  if (input.explicit !== undefined) {
    return { counterpartyId: input.explicit, auto: false };
  }
  const linked =
    input.personUserId === null
      ? undefined
      : input.linkedCounterpartyByUserId.get(input.personUserId);
  return { counterpartyId: linked ?? null, auto: true };
}

/** 決策 143：總額＝個人往來餘額＋各帳本來源金額。 */
export function mergeTotals(balance: Cents, parts: readonly { amount: Cents }[]): Cents {
  void balance;
  void parts;
  throw new Error('mergeTotals: not implemented');
}
