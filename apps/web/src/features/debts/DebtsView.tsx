import { useCallback, useState } from 'react';
import type { Counterparty, LedgerSummary } from '@ledger/shared';
import { Button } from '../../components/Button';
import { AddCounterpartyDialog } from './AddCounterpartyDialog';
import { CounterpartyList } from './CounterpartyList';
import styles from './DebtsView.module.css';

interface DebtsViewProps {
  ledger: LedgerSummary;
  mode: 'overview' | 'personal';
  expandedCounterpartyId: string | null;
  onExpandedChange: (counterpartyId: string | null) => void;
  openCounterpartyId?: string | null;
  onOpenRequestHandled?: (counterpartyId: string, foundInCurrentPage: boolean) => void;
  onEditSplit: (splitId: string) => void;
}

/** 借還的總覽與個人分頁共用對象清單，寫入入口只在個人分頁顯示。 */
export function DebtsView({
  ledger,
  mode,
  expandedCounterpartyId,
  onExpandedChange,
  openCounterpartyId,
  onOpenRequestHandled,
  onEditSplit,
}: DebtsViewProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [createdCounterpartyId, setCreatedCounterpartyId] = useState<string | null>(null);

  function handleCounterpartyCreated(counterparty: Counterparty) {
    setCreatedCounterpartyId(counterparty.id);
  }

  const handleOpenRequestHandled = useCallback(
    (counterpartyId: string, foundInCurrentPage: boolean) => {
      if (createdCounterpartyId === counterpartyId && foundInCurrentPage) {
        onExpandedChange(counterpartyId);
      }
      setCreatedCounterpartyId((current) => (current === counterpartyId ? null : current));
      onOpenRequestHandled?.(counterpartyId, foundInCurrentPage);
    },
    [createdCounterpartyId, onExpandedChange, onOpenRequestHandled],
  );

  return (
    <div className={styles.view}>
      {mode === 'personal' && (
        <div className={styles.header}>
          <Button variant="secondary" onClick={() => setAddDialogOpen(true)}>
            ＋ 新增
          </Button>
        </div>
      )}
      <CounterpartyList
        ledger={ledger}
        mode={mode}
        expandedCounterpartyId={expandedCounterpartyId}
        onExpandedChange={onExpandedChange}
        openCounterpartyId={openCounterpartyId ?? createdCounterpartyId}
        onOpenRequestHandled={handleOpenRequestHandled}
        onEditSplit={onEditSplit}
      />
      <AddCounterpartyDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        onCreated={handleCounterpartyCreated}
      />
    </div>
  );
}
