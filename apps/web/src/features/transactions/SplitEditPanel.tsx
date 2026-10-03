import type { LedgerSummary } from '@ledger/shared';
import { FormError } from '../../components/FormError';
import { TransactionForm } from './TransactionForm';
import { useSplit } from './use-splits';

interface SplitEditPanelProps {
  ledger: LedgerSummary;
  splitId: string;
  onClose: () => void;
}

/** 從往來明細開啟時只拿到 splitId，完整資料仍由 GET /splits/{id} 載入。 */
export function SplitEditPanel({ ledger, splitId, onClose }: SplitEditPanelProps) {
  const split = useSplit(splitId);

  if (split.isLoading) return <p>載入中…</p>;
  if (split.error) return <FormError error={split.error} />;
  if (!split.data) return null;

  return (
    <TransactionForm ledger={ledger} split={split.data} onSaved={onClose} onCancel={onClose} />
  );
}
