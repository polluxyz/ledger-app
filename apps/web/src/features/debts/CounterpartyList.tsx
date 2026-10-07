import { useEffect, useMemo, useState } from 'react';
import type { LedgerSummary } from '@ledger/shared';
import { DebtArrow } from '../../components/DebtArrow';
import { FormError } from '../../components/FormError';
import { Pagination } from '../../components/Pagination';
import { formatMoney } from '../../lib/format';
import { useLedgerGroups } from '../ledger-people/use-ledger-pointers';
import { AnimatedDisclosure } from './AnimatedDisclosure';
import { CounterpartyDetail } from './CounterpartyDetail';
import { UnpointedLedgerGroups } from './UnpointedLedgerGroups';
import { useCounterparties } from './use-debts';
import styles from './CounterpartyList.module.css';

interface CounterpartyListProps {
  ledger: LedgerSummary;
  mode: 'overview' | 'personal';
  expandedCounterpartyId: string | null;
  onExpandedChange: (counterpartyId: string | null) => void;
  openCounterpartyId?: string | null;
  onOpenRequestHandled?: (counterpartyId: string, foundInCurrentPage: boolean) => void;
  onEditSplit: (splitId: string) => void;
}

/** 列表只持有單一展開目標；排序與餘額直接採用 API 回應。 */
export function CounterpartyList({
  ledger,
  mode,
  expandedCounterpartyId,
  onExpandedChange,
  openCounterpartyId,
  onOpenRequestHandled,
  onEditSplit,
}: CounterpartyListProps) {
  const [page, setPage] = useState(1);
  const counterparties = useCounterparties(
    mode === 'overview' ? { page, limit: 20, nonZero: true } : { page, limit: 20 },
  );
  const unpointedGroups = useLedgerGroups({ unpointed: true });
  const items = useMemo(() => {
    const items = counterparties.data?.items ?? [];
    return mode === 'personal' ? items.filter((item) => item.balance !== 0) : items;
  }, [counterparties.data?.items, mode]);

  useEffect(() => {
    if (openCounterpartyId == null || counterparties.isLoading) {
      return;
    }

    // 外部導覽只展開本頁已列出的對象；找不到時不另抓頁面或改動清單分頁。
    const foundInCurrentPage = items.some((item) => item.id === openCounterpartyId);
    onOpenRequestHandled?.(openCounterpartyId, foundInCurrentPage);
  }, [counterparties.isLoading, items, onOpenRequestHandled, openCounterpartyId]);

  function changePage(nextPage: number) {
    setPage(nextPage);
    onExpandedChange(null);
  }

  if (counterparties.isLoading && (mode === 'personal' || unpointedGroups.isLoading)) {
    return <p className={styles.status}>載入中…</p>;
  }
  const groups = unpointedGroups.data ?? [];
  const showEmptyPrompt =
    !counterparties.isLoading &&
    !counterparties.error &&
    (mode === 'personal' || (!unpointedGroups.isLoading && !unpointedGroups.error)) &&
    items.length === 0 &&
    (mode === 'personal' || groups.length === 0);

  return (
    <>
      {counterparties.error && <FormError error={counterparties.error} />}
      {mode === 'overview' && unpointedGroups.error && <FormError error={unpointedGroups.error} />}
      {showEmptyPrompt && (
        <p className={styles.empty}>
          {mode === 'personal' ? '目前沒有個人往來。' : '目前沒有借還。'}
        </p>
      )}
      {items.length > 0 && (
        <>
          <ul className={styles.list}>
            {items.map((counterparty) => {
              const expanded = expandedCounterpartyId === counterparty.id;
              const detailsId = `counterparty-details-${counterparty.id}`;
              const balance =
                mode === 'overview' ? counterparty.totalBalance : counterparty.balance;

              return (
                <li key={counterparty.id} className={styles.item}>
                  <button
                    type="button"
                    className={styles.row}
                    aria-expanded={expanded}
                    aria-controls={detailsId}
                    onClick={() => onExpandedChange(expanded ? null : counterparty.id)}
                  >
                    <span className={styles.nameGroup}>
                      <span className={styles.name}>{counterparty.displayName}</span>
                      {counterparty.link !== null && <span className={styles.linkBadge}>連動</span>}
                    </span>
                    <span className={styles.balance}>
                      {formatCounterpartyBalance(counterparty.displayName, balance)}
                    </span>
                  </button>
                  <AnimatedDisclosure id={detailsId} open={expanded}>
                    <CounterpartyDetail
                      ledger={ledger}
                      counterpartyId={counterparty.id}
                      mode={mode}
                      onEditSplit={onEditSplit}
                    />
                  </AnimatedDisclosure>
                </li>
              );
            })}
          </ul>
          {counterparties.data && (
            <Pagination
              page={counterparties.data.page}
              limit={counterparties.data.limit}
              total={counterparties.data.total}
              onChange={changePage}
            />
          )}
        </>
      )}
      {mode === 'overview' && <UnpointedLedgerGroups groups={groups} />}
    </>
  );
}

/** 總覽採 API 的 totalBalance；個人分頁採 API 的 balance 並在頁面端過濾零值。 */
function formatCounterpartyBalance(displayName: string, balance: number) {
  if (balance > 0) {
    return (
      <DebtArrow
        from={displayName}
        to="我"
        amount={balance}
        label="需要支付"
        srText={`${displayName}欠你 ${formatMoney(balance)}`}
      />
    );
  }
  if (balance < 0) {
    return (
      <DebtArrow
        from="我"
        to={displayName}
        amount={Math.abs(balance)}
        label="需要支付"
        srText={`你欠${displayName} ${formatMoney(Math.abs(balance))}`}
      />
    );
  }
  return '兩清';
}
