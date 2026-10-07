import { useState } from 'react';
import type { Counterparty, CounterpartyLedgerPart } from '@ledger/shared';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button';
import { useOpenSettleIntent } from '../settlements/settle-intent';
import { AddCounterpartyDialog } from './AddCounterpartyDialog';
import { CounterpartyList } from './CounterpartyList';
import styles from './DebtsView.module.css';

interface DebtsViewProps {
  /** 點選對象後由交易頁開啟右側往來帳，這一層不持有面板狀態。 */
  onSelectCounterparty: (counterpartyId: string) => void;
}

/** 借還檢視只列往來對象；餘額與排序都由 API 提供，避免前端重做帳務計算。 */
export function DebtsView({ onSelectCounterparty }: DebtsViewProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const openSettleIntent = useOpenSettleIntent();
  const navigate = useNavigate();

  function handleCounterpartyCreated(counterparty: Counterparty) {
    onSelectCounterparty(counterparty.id);
  }

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
        onSelectCounterparty={onSelectCounterparty}
        onOpenLedgerSource={handleOpenLedgerSource}
      />
      <AddCounterpartyDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        onCreated={handleCounterpartyCreated}
      />
    </div>
  );
}
