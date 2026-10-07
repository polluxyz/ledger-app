import { useCallback, useState } from 'react';
import type { Counterparty, CounterpartyLedgerPart, LedgerSummary } from '@ledger/shared';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button';
import { useOpenSettleIntent } from '../settlements/settle-intent';
import { AddCounterpartyDialog } from './AddCounterpartyDialog';
import { CounterpartyList } from './CounterpartyList';
import styles from './DebtsView.module.css';

interface DebtsViewProps {
  ledger: LedgerSummary;
  expandedCounterpartyId: string | null;
  onExpandedChange: (counterpartyId: string | null) => void;
  openCounterpartyId?: string | null;
  onOpenRequestHandled?: (counterpartyId: string, foundInCurrentPage: boolean) => void;
  onEditSplit: (splitId: string) => void;
}

/** 借還檢視只列往來對象；餘額與排序都由 API 提供，避免前端重做帳務計算。 */
export function DebtsView({
  ledger,
  expandedCounterpartyId,
  onExpandedChange,
  openCounterpartyId,
  onOpenRequestHandled,
  onEditSplit,
}: DebtsViewProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [createdCounterpartyId, setCreatedCounterpartyId] = useState<string | null>(null);
  const openSettleIntent = useOpenSettleIntent();
  const navigate = useNavigate();

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

  function handleOpenLedgerSource(source: CounterpartyLedgerPart) {
    if (source.left) {
      void navigate(`/ledgers/${source.ledgerId}/history`);
      return;
    }
    openSettleIntent({
      ledgerId: source.ledgerId,
      personId: source.personId,
      amount: source.amount,
    });
  }

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <p className={styles.note}>借還紀錄不分帳本</p>
        <Button variant="secondary" onClick={() => setAddDialogOpen(true)}>
          ＋ 新增
        </Button>
      </div>
      <CounterpartyList
        ledger={ledger}
        expandedCounterpartyId={expandedCounterpartyId}
        onExpandedChange={onExpandedChange}
        openCounterpartyId={openCounterpartyId ?? createdCounterpartyId}
        onOpenRequestHandled={handleOpenRequestHandled}
        onOpenLedgerSource={handleOpenLedgerSource}
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
