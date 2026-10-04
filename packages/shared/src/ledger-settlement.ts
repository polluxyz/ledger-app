/**
 * 共享帳本的淨額與結清建議（階段三 3e，spec `phase-3e-shared-split.md` §3.2～§3.3）。
 *
 * 淨額一律以分做整數累加；結清建議依欠款與應收金額由大到小配對，同額時保留輸入順序，
 * 讓相同帳本資料每次都得到相同結果。此檔只匯入型別，shared 測試會由 Node 直接執行 `.ts`。
 */
import type { Cents } from './money';
import type { SettlementSuggestion } from './types/ledger-split';

export type LedgerNetEntry =
  | {
      kind: 'EXPENSE';
      payerId: string;
      total: Cents;
      shares: { personId: string; share: Cents }[];
    }
  | {
      kind: 'INCOME';
      payerId: string;
      total: Cents;
      shares: { personId: string; share: Cents }[];
    }
  | { kind: 'SETTLEMENT'; fromId: string; toId: string; amount: Cents };

export interface ComputeLedgerNetsInput {
  /** 建立順序；淨額 Map 會先依此順序放入所有人。 */
  personIds: string[];
  entries: LedgerNetEntry[];
}

/** 將增量加到淨額，第一次遇到的交易對象會依出現順序放到 Map 後段。 */
function addNet(nets: Map<string, Cents>, personId: string, delta: Cents): void {
  const current = nets.get(personId);
  nets.set(personId, (current ?? 0) + delta);
}

/**
 * 計算帳本中每人的淨額（§3.2）：正數代表應收，負數代表應付。
 * 先放入完整人員清單，確保沒有參與交易的人也會以 0 出現在結果中。
 */
export function computeLedgerNets(input: ComputeLedgerNetsInput): Map<string, Cents> {
  const nets = new Map<string, Cents>();
  for (const personId of input.personIds) nets.set(personId, 0);

  for (const entry of input.entries) {
    switch (entry.kind) {
      case 'EXPENSE':
        addNet(nets, entry.payerId, entry.total);
        for (const { personId, share } of entry.shares) addNet(nets, personId, -share);
        break;
      case 'INCOME':
        addNet(nets, entry.payerId, -entry.total);
        for (const { personId, share } of entry.shares) addNet(nets, personId, share);
        break;
      case 'SETTLEMENT':
        addNet(nets, entry.fromId, entry.amount);
        addNet(nets, entry.toId, -entry.amount);
        break;
    }
  }

  return nets;
}

interface Remainder {
  personId: string;
  remaining: Cents;
  order: number;
}

/** 金額較大者優先；金額相同時依輸入（建立）順序。 */
function compareRemainders(a: Remainder, b: Remainder): number {
  if (a.remaining !== b.remaining) return a.remaining > b.remaining ? -1 : 1;
  return a.order - b.order;
}

/**
 * 依 §3.3 產生固定的結清建議；`nets` 順序視為帳本裡的人建立順序。
 * 淨額總和非 0 代表呼叫端資料不一致，屬於程式錯誤，因此直接丟出 Error。
 */
export function suggestSettlements(
  nets: { personId: string; net: Cents }[],
): SettlementSuggestion[] {
  const sum = nets.reduce((total, { net }) => total + net, 0);
  if (sum !== 0) throw new Error('Ledger net amounts must sum to zero');

  const debtors: Remainder[] = [];
  const creditors: Remainder[] = [];
  nets.forEach(({ personId, net }, order) => {
    if (net < 0) debtors.push({ personId, remaining: -net, order });
    if (net > 0) creditors.push({ personId, remaining: net, order });
  });
  debtors.sort(compareRemainders);
  creditors.sort(compareRemainders);

  const suggestions: SettlementSuggestion[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex]!;
    const creditor = creditors[creditorIndex]!;
    const amount = Math.min(debtor.remaining, creditor.remaining);
    suggestions.push({
      fromPersonId: debtor.personId,
      toPersonId: creditor.personId,
      amount,
    });

    debtor.remaining -= amount;
    creditor.remaining -= amount;
    if (debtor.remaining === 0) debtorIndex += 1;
    if (creditor.remaining === 0) creditorIndex += 1;
  }

  return suggestions;
}
