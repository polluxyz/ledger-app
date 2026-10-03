/** 修改分帳時逐人比較新舊往來組合；同一人同一種類保留紀錄身分。 */
import type { CreateSplitRequest } from '@ledger/shared';
export interface SplitEntryShape {
  counterpartyId: string;
  kind: 'PAID_FOR_THEM' | 'PAID_FOR_ME' | 'RECEIVED_FOR_THEM' | 'RECEIVED_FOR_ME';
  amount: number;
}

export interface ExistingSplitEntry extends SplitEntryShape {
  id: string;
  date: Date;
}

export interface SplitEntryPlan {
  create: SplitEntryShape[];
  amend: Array<{ old: ExistingSplitEntry; next: SplitEntryShape }>;
  remove: ExistingSplitEntry[];
}

/** 付款人、收支方向與名單決定誰會進我的往來帳；其他人的互相欠款只存在整份名單。 */
export function composeSplitEntries(
  input: Pick<CreateSplitRequest, 'type' | 'payer' | 'participants'>,
  shares: number[],
): SplitEntryShape[] {
  if (input.payer) {
    const mine = shares[input.participants.findIndex((person) => person.counterpartyId === null)]!;
    return [
      {
        counterpartyId: input.payer.counterpartyId,
        kind: input.type === 'EXPENSE' ? 'PAID_FOR_ME' : 'RECEIVED_FOR_ME',
        amount: mine,
      },
    ];
  }
  const kind = input.type === 'EXPENSE' ? 'PAID_FOR_THEM' : 'RECEIVED_FOR_THEM';
  return input.participants.flatMap((person, index) =>
    person.counterpartyId === null
      ? []
      : [{ counterpartyId: person.counterpartyId, kind, amount: shares[index]! }],
  );
}

export function planSplitEntries(
  old: ExistingSplitEntry[],
  next: SplitEntryShape[],
  date: Date,
): SplitEntryPlan {
  const key = (row: SplitEntryShape) => `${row.counterpartyId}:${row.kind}`;
  const oldByKey = new Map(old.map((row) => [key(row), row]));
  const nextByKey = new Map(next.map((row) => [key(row), row]));
  return {
    create: next.filter((row) => !oldByKey.has(key(row))),
    amend: next.flatMap((row) => {
      const previous = oldByKey.get(key(row));
      return previous &&
        (previous.amount !== row.amount || previous.date.getTime() !== date.getTime())
        ? [{ old: previous, next: row }]
        : [];
    }),
    remove: old.filter((row) => !nextByKey.has(key(row))),
  };
}
