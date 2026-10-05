import { centsToInput } from '@ledger/shared';
import type {
  LedgerPerson,
  LedgerSplitInput,
  LedgerSplitView,
  SplitMethod,
  SplitPrecision,
} from '@ledger/shared';
import type { SplitParticipantDraft } from './split-form';

/** 共享帳本名單以 LedgerPerson.id 作為暫存 key；此檔只負責表單狀態與 API 輸入轉換。 */
export type LedgerSplitPersonDraft = SplitParticipantDraft;

/** 新交易預設列出所有人，但只勾選現任成員（W101）。 */
export function createDefaultLedgerSplitPeople(
  people: LedgerPerson[],
  mePersonId: string | null,
): LedgerSplitPersonDraft[] {
  return people.map((person) => makeDraft(person, mePersonId, null, null));
}

/** 編輯時用回應名單還原選取與分法；未入分帳的人仍保留為未勾選列。 */
export function restoreLedgerSplitPeople(
  people: LedgerPerson[],
  mePersonId: string | null,
  ledgerSplit: LedgerSplitView,
): LedgerSplitPersonDraft[] {
  const knownIds = new Set(people.map((person) => person.id));
  const allPeople = [
    ...people,
    ...ledgerSplit.shares.map((share) => share.person).filter((person) => !knownIds.has(person.id)),
  ];
  const shares = new Map(ledgerSplit.shares.map((share) => [share.person.id, share]));
  return allPeople.map((person) =>
    makeDraft(person, mePersonId, shares.get(person.id) ?? null, ledgerSplit),
  );
}

/** 分帳關閉時編輯會送 null；打開時把勾選的人與目前方法組成完整名單。 */
export function toLedgerSplitInput(
  people: LedgerSplitPersonDraft[],
  method: SplitMethod,
  precision: SplitPrecision,
): LedgerSplitInput {
  return {
    method,
    ...(method === 'AMOUNT' ? {} : { precision }),
    shares: people
      .filter((person) => person.included)
      .map((person) => ({
        personId: person.key,
        ...(method === 'AMOUNT' ? { amount: person.amountValue } : {}),
        ...(method === 'RATIO' ? { ratio: person.ratioValue } : {}),
      })),
  };
}

function makeDraft(
  person: LedgerPerson,
  mePersonId: string | null,
  savedShare: LedgerSplitView['shares'][number] | null,
  ledgerSplit: LedgerSplitView | null,
): LedgerSplitPersonDraft {
  const isMe = person.id === mePersonId;
  const method = ledgerSplit?.method;
  const amountFixed = method === 'AMOUNT' && savedShare !== null;
  const ratioFixed = method === 'RATIO' && savedShare?.ratio != null;

  return {
    key: person.id,
    counterpartyId: null,
    name: isMe ? '我' : person.name,
    isMe,
    included: savedShare !== null || (ledgerSplit === null && person.status === 'MEMBER'),
    amountFixed,
    amountInput: amountFixed ? centsToInput(savedShare?.share ?? 0) : '',
    amountValue: savedShare?.share ?? 0,
    ratioFixed,
    ratioInput: ratioFixed ? centsToInput(savedShare?.ratio ?? 0) : '',
    ratioValue: savedShare?.ratio ?? 0,
  };
}
