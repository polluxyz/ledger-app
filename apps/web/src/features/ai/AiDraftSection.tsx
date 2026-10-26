import { isDraftComplete } from '@ledger/shared';
import { useRightPanel } from '../../app/right-panel-context';
import { isLedgerWritable, useLedgers } from '../ledgers/use-ledgers';
import { AiDraftList } from './AiDraftList';
import { useAiSession } from './ai-session';

interface AiDraftSectionProps {
  currentLedgerId: string;
  activeDraftKey?: string | null;
  onSelect: (key: string) => void;
}

/** 兩頁共用同一份草稿清單，並以草稿自己的帳本決定能否編輯與寫入。 */
export function AiDraftSection({
  currentLedgerId,
  activeDraftKey = null,
  onSelect,
}: AiDraftSectionProps) {
  const session = useAiSession();
  const ledgers = useLedgers(true);
  const { close, isOpen } = useRightPanel();

  if (session.drafts.length === 0) return null;

  const ledgerById = new Map((ledgers.data ?? []).map((ledger) => [ledger.id, ledger]));
  const blockedReasons = new Map<string, string>();
  for (const item of session.drafts) {
    const ledger = ledgerById.get(item.draft.ledgerId);
    if (ledgers.isLoading) {
      blockedReasons.set(item.key, '載入中…');
    } else if (ledgers.error) {
      blockedReasons.set(item.key, '找不到草稿的帳本，請重新解析。');
    } else if (!ledger) {
      blockedReasons.set(item.key, '我已退出');
    } else if (ledger.archivedAt !== null) {
      blockedReasons.set(item.key, '帳本已封存');
    } else if (!isLedgerWritable(ledger)) {
      blockedReasons.set(item.key, '只能檢視');
    }
  }

  const candidateKeys = session.drafts
    .filter(
      ({ key, draft }) =>
        key !== activeDraftKey && isDraftComplete(draft) && !blockedReasons.has(key),
    )
    .map(({ key }) => key);
  const busyKeys = new Set(session.busyKeys);

  function discardDraft(key: string) {
    session.discardDraft(key);
    if (isOpen && activeDraftKey === key) close();
  }

  return (
    <AiDraftList
      items={session.drafts}
      currentLedgerId={currentLedgerId}
      busyKeys={busyKeys}
      blockedReasons={blockedReasons}
      editingKey={activeDraftKey}
      isConfirmingAll={session.isConfirmingAll}
      onConfirm={(item) => void session.confirmDraft(item.key, activeDraftKey)}
      onDiscard={discardDraft}
      onSelect={(item) => {
        if (!blockedReasons.has(item.key)) onSelect(item.key);
      }}
      onConfirmAll={() => void session.confirmAll(activeDraftKey, candidateKeys)}
    />
  );
}
