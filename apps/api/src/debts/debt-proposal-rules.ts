import type {
  DebtEntryKind,
  DebtEntrySyncStatus,
  DebtProposal,
  DebtProposalStatus,
} from '@ledger/shared';
import type { Prisma } from '../generated/prisma/client';
import { findLinkOfCounterparty, otherSide } from './counterparty-links';

/**
 * 提議（spec 3b-2 §3.2～§3.4）的共用規則：種類怎麼換角度、同步狀態怎麼推、以及
 * 「記、改、刪一筆之後要送什麼提議給對方」。
 *
 * 送提議的三個函式都在**發起者自己的資料庫交易裡**執行：發起者那筆與提議一起寫入、一起
 * 回滾，不會出現「我改了、對方卻沒收到」或反過來的狀態。對象沒有連動時它們什麼都不做，
 * 所以呼叫端不必先判斷。
 */

type ProposalClient = Pick<
  Prisma.TransactionClient,
  'counterpartyLink' | 'debtProposal' | 'debtEntry'
>;
type DebtEntryRow = Prisma.DebtEntryGetPayload<object>;

/** 連動後會送 `CREATE` 提議的種類（決策 62）。`PAID_FOR_ME` 與結清差額不送。 */
export const SYNCED_ENTRY_KINDS: ReadonlySet<DebtEntryKind> = new Set([
  'LEND',
  'BORROW',
  'COLLECT',
  'REPAY',
  'FORGIVE',
]);

/**
 * 換成另一方的角度（§3.2）：我借出＝他借入；對方還我＝他還我；我免除＝他被免除。
 * 結清差額與代付不會出現在提議裡，照原樣回傳只是為了讓函式是全域的。
 */
export function mirrorKind(kind: DebtEntryKind): DebtEntryKind {
  switch (kind) {
    case 'LEND':
      return 'BORROW';
    case 'BORROW':
      return 'LEND';
    case 'COLLECT':
      return 'REPAY';
    case 'REPAY':
      return 'COLLECT';
    case 'FORGIVE':
      return 'FORGIVEN';
    case 'FORGIVEN':
      return 'FORGIVE';
    default:
      return kind;
  }
}

/**
 * 一筆紀錄的同步狀態（§3.4）。`latest` 是這筆紀錄**自己送出的**最新一筆提議的狀態。
 *
 * 順序有意義：還在等 → `PENDING`；最近一次被拒 → `DECLINED`（即使仍配對著，例如改金額被拒，
 * 兩邊已經不一樣了）；否則看有沒有配對。被作廢的提議不影響判斷。
 */
export function deriveSync(
  paired: boolean,
  latest: DebtProposalStatus | undefined,
): DebtEntrySyncStatus {
  if (latest === 'PENDING') {
    return 'PENDING';
  }
  if (latest === 'DECLINED') {
    return 'DECLINED';
  }
  return paired ? 'SYNCED' : 'NONE';
}

/** 一批紀錄的同步狀態：一次查出它們送出的提議，每筆取最新一筆（不含已作廢的）。 */
export async function syncStatuses(
  client: Pick<Prisma.TransactionClient, 'debtProposal'>,
  rows: ReadonlyArray<DebtEntryRow>,
): Promise<Map<string, DebtEntrySyncStatus>> {
  const latest = new Map<string, DebtProposalStatus>();
  if (rows.length > 0) {
    const proposals = await client.debtProposal.findMany({
      where: { sourceEntryId: { in: rows.map((row) => row.id) }, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'desc' },
      select: { sourceEntryId: true, status: true },
    });
    for (const proposal of proposals) {
      if (!latest.has(proposal.sourceEntryId)) {
        latest.set(proposal.sourceEntryId, proposal.status);
      }
    }
  }
  return new Map(
    rows.map((row) => [row.id, deriveSync(row.pairedEntryId !== null, latest.get(row.id))]),
  );
}

type ProposalRow = Prisma.DebtProposalGetPayload<{
  include: {
    fromUser: { select: { id: true; name: true } };
    toUser: { select: { id: true; name: true } };
    targetEntry: { select: { delta: true; date: true; deletedAt: true } };
  };
}>;

export const PROPOSAL_INCLUDE = {
  fromUser: { select: { id: true, name: true } },
  toUser: { select: { id: true, name: true } },
  // F26：收到的 AMEND 要帶「我那筆被改之前」的值。targetEntry 是接受者自己的紀錄。
  targetEntry: { select: { delta: true, date: true, deletedAt: true } },
} as const;

/**
 * 把提議轉成呼叫者看得到的樣子（§3.5、§5.3）。
 *
 * 收到的提議：種類換成我的角度，只給發起者的 id 與顯示名稱。回應裡刻意沒有發起者的
 * 那筆紀錄 id、備註、帳本、帳戶與他那邊的對象——這些都是他自己的帳。
 * `counterpartyId` 是**呼叫者自己**那邊連動的對象，由呼叫端傳入。
 *
 * `previous`（F26）只給收到的 `AMEND`：值取自 `targetEntry`——那是**接受者自己**那筆，
 * 所以不會洩漏發起者的帳。發起者看自己送出的提議時一律 null：targetEntry 是對方的紀錄。
 */
export function toDebtProposal(
  row: ProposalRow,
  viewerId: string,
  counterpartyId: string | null,
  displayName?: string,
): DebtProposal {
  const incoming = row.toUserId === viewerId;
  const other = incoming ? row.fromUser : row.toUser;
  return {
    id: row.id,
    direction: incoming ? 'incoming' : 'outgoing',
    type: row.type,
    status: row.status,
    otherUser: { id: other.id, name: displayName ?? other.name },
    counterpartyId,
    entryKind: incoming ? mirrorKind(row.entryKind) : row.entryKind,
    amount: row.amount,
    date: row.date.toISOString(),
    settle: row.settle,
    ...(incoming ? {} : { sourceEntryId: row.sourceEntryId }),
    previous: previousOf(row, incoming),
    createdAt: row.createdAt.toISOString(),
    respondedAt: row.respondedAt === null ? null : row.respondedAt.toISOString(),
  };
}

/** 收到的 AMEND 且我那筆還在時，回我那筆目前的金額與日期；其餘一律 null。 */
function previousOf(row: ProposalRow, incoming: boolean): DebtProposal['previous'] {
  const target = row.targetEntry;
  if (!incoming || row.type !== 'AMEND' || target === null || target.deletedAt !== null) {
    return null;
  }
  return { amount: Math.abs(target.delta), date: target.date.toISOString() };
}

/** 對象連動中時，提議要送給誰；沒有連動回 `null`。 */
async function recipientOf(client: ProposalClient, counterpartyId: string): Promise<string | null> {
  const link = await findLinkOfCounterparty(client, counterpartyId);
  return link === null ? null : otherSide(link, counterpartyId).userId;
}

/**
 * 連動後記了一筆（決策 62、63）：送 `CREATE` 給對方。種類不在同步範圍、或沒有連動就不送。
 * 發起者那筆已經寫入並計入餘額；對方要接受才會寫。
 */
export async function proposeCreate(
  tx: ProposalClient,
  input: { fromUserId: string; entry: DebtEntryRow; amount: number; settle: boolean },
): Promise<void> {
  if (!SYNCED_ENTRY_KINDS.has(input.entry.kind)) {
    return;
  }
  const toUserId = await recipientOf(tx, input.entry.counterpartyId);
  if (toUserId === null) {
    return;
  }
  await tx.debtProposal.create({
    data: {
      fromUserId: input.fromUserId,
      toUserId,
      type: 'CREATE',
      sourceEntryId: input.entry.id,
      entryKind: input.entry.kind,
      amount: input.amount,
      date: input.entry.date,
      settle: input.settle,
    },
  });
}

/**
 * 改了一筆的金額或日期之後（決策 67、68）。`entry` 是改完的樣子。
 *
 * - 還有待確認的 `CREATE`：對方還沒寫，直接把提議改成新的值，不另送。
 * - 已配對：作廢這筆待確認的舊變更，送新的 `AMEND`，目標是對方配對的那筆。
 * - 其餘（沒連動、連動前記的、被拒絕過）：不送。
 */
export async function proposeAmend(
  tx: ProposalClient,
  input: { fromUserId: string; entry: DebtEntryRow; now: Date },
): Promise<void> {
  const { entry } = input;
  const amount = Math.abs(entry.delta);

  const pendingCreate = await tx.debtProposal.updateMany({
    where: { sourceEntryId: entry.id, status: 'PENDING', type: 'CREATE' },
    data: { amount, date: entry.date },
  });
  if (pendingCreate.count > 0 || entry.pairedEntryId === null) {
    return;
  }
  const toUserId = await recipientOf(tx, entry.counterpartyId);
  if (toUserId === null) {
    return;
  }

  await cancelPending(tx, entry.id, input.now);
  await tx.debtProposal.create({
    data: {
      fromUserId: input.fromUserId,
      toUserId,
      type: 'AMEND',
      sourceEntryId: entry.id,
      targetEntryId: entry.pairedEntryId,
      entryKind: entry.kind,
      amount,
      date: entry.date,
    },
  });
}

/**
 * 刪了一筆之後（決策 67）。`entry` 是刪除前的樣子。
 *
 * - 還有待確認的 `CREATE`：對方還沒寫，作廢就好。
 * - 已配對：作廢其他待確認的變更、清空雙方的配對、送 `DELETE`（帶刪除當下的金額與日期，
 *   讓對方看得出是哪一筆）。配對在這裡就清空，不等對方回應：我這筆已經刪了，不再有東西
 *   可以跟他那筆對應。
 */
export async function proposeDelete(
  tx: ProposalClient,
  input: { fromUserId: string; entry: DebtEntryRow; now: Date },
): Promise<void> {
  const { entry } = input;

  const pendingCreate = await tx.debtProposal.updateMany({
    where: { sourceEntryId: entry.id, status: 'PENDING', type: 'CREATE' },
    data: { status: 'CANCELLED', respondedAt: input.now },
  });
  if (pendingCreate.count > 0 || entry.pairedEntryId === null) {
    return;
  }
  const toUserId = await recipientOf(tx, entry.counterpartyId);

  await cancelPending(tx, entry.id, input.now);
  await tx.debtEntry.updateMany({
    where: { id: { in: [entry.id, entry.pairedEntryId] } },
    data: { pairedEntryId: null },
  });
  if (toUserId === null) {
    return;
  }
  await tx.debtProposal.create({
    data: {
      fromUserId: input.fromUserId,
      toUserId,
      type: 'DELETE',
      sourceEntryId: entry.id,
      targetEntryId: entry.pairedEntryId,
      entryKind: entry.kind,
      amount: Math.abs(entry.delta),
      date: entry.date,
    },
  });
}

/** 作廢一筆紀錄所有待確認的提議（決策 68：同一筆同時最多一個，新的取代舊的）。 */
async function cancelPending(tx: ProposalClient, sourceEntryId: string, now: Date): Promise<void> {
  await tx.debtProposal.updateMany({
    where: { sourceEntryId, status: 'PENDING' },
    data: { status: 'CANCELLED', respondedAt: now },
  });
}
