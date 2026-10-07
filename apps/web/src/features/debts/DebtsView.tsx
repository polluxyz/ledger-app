import type { LedgerSummary } from '@ledger/shared';
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

/**
 * 借還的總覽與個人分頁共用對象清單。
 *
 * ## 為什麼個人分頁不再放「＋ 新增」（debts-tabs2）
 *
 * 記往來統一由展開明細內的「記一筆」發起，不再從頁首獨立新增對象。
 */
export function DebtsView({
  ledger,
  mode,
  expandedCounterpartyId,
  onExpandedChange,
  openCounterpartyId,
  onOpenRequestHandled,
  onEditSplit,
}: DebtsViewProps) {
  return (
    <div className={styles.view}>
      <CounterpartyList
        ledger={ledger}
        mode={mode}
        expandedCounterpartyId={expandedCounterpartyId}
        onExpandedChange={onExpandedChange}
        openCounterpartyId={openCounterpartyId}
        onOpenRequestHandled={onOpenRequestHandled}
        onEditSplit={onEditSplit}
      />
    </div>
  );
}
