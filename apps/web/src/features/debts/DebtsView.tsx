import { CounterpartyList } from './CounterpartyList';
import styles from './DebtsView.module.css';

interface DebtsViewProps {
  /** 點選對象後由交易頁開啟右側往來帳，這一層不持有面板狀態。 */
  onSelectCounterparty: (counterpartyId: string) => void;
}

/** 借還檢視只列往來對象；餘額與排序都由 API 提供，避免前端重做帳務計算。 */
export function DebtsView({ onSelectCounterparty }: DebtsViewProps) {
  return (
    <div className={styles.view}>
      <p className={styles.note}>借還紀錄不分帳本</p>
      <CounterpartyList onSelectCounterparty={onSelectCounterparty} />
    </div>
  );
}
