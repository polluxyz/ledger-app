import { useState } from 'react';
import type { Counterparty } from '@ledger/shared';
import { Button } from '../../components/Button';
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

  function handleCounterpartyCreated(counterparty: Counterparty) {
    onSelectCounterparty(counterparty.id);
  }

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <p className={styles.note}>借還紀錄不分帳本</p>
        <Button variant="secondary" onClick={() => setAddDialogOpen(true)}>
          ＋ 新增
        </Button>
      </div>
      <CounterpartyList onSelectCounterparty={onSelectCounterparty} />
      <AddCounterpartyDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        onCreated={handleCounterpartyCreated}
      />
    </div>
  );
}
