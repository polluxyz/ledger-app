import { useState } from 'react';
import type { CounterpartyLedgerPart, LedgerGroup } from '@ledger/shared';
import { DebtArrow } from '../../components/DebtArrow';
import { FormError } from '../../components/FormError';
import { Pagination } from '../../components/Pagination';
import { formatMoney } from '../../lib/format';
import { useLedgerGroups } from '../ledger-people/use-ledger-pointers';
import { LedgerSourceList, SmallDebtDirection } from './LedgerSourceList';
import { UnpointedLedgerGroups } from './UnpointedLedgerGroups';
import { useCounterparties } from './use-debts';
import styles from './CounterpartyList.module.css';

interface CounterpartyListProps {
  /** 每列都用按鈕，滑鼠、鍵盤與螢幕閱讀器走同一個開啟入口。 */
  onSelectCounterparty: (counterpartyId: string) => void;
  onOpenLedgerSource: (source: CounterpartyLedgerPart) => void;
}

/** 借還清單直接使用 API 的總額、兩清過濾、排序與分頁，展開內容只呈現來源。 */
export function CounterpartyList({
  onSelectCounterparty,
  onOpenLedgerSource,
}: CounterpartyListProps) {
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const counterparties = useCounterparties({ page, limit: 20, nonZero: true });
  const unpointedGroups = useLedgerGroups({ unpointed: true });

  if (counterparties.isLoading && unpointedGroups.isLoading) {
    return <p className={styles.status}>載入中…</p>;
  }
  const items = counterparties.data?.items ?? [];
  const groups = Array.isArray(unpointedGroups.data)
    ? unpointedGroups.data.filter(isLedgerGroup)
    : [];
  const showEmptyPrompt =
    !counterparties.isLoading &&
    !counterparties.error &&
    !unpointedGroups.isLoading &&
    !unpointedGroups.error &&
    items.length === 0 &&
    groups.length === 0;

  return (
    <>
      {counterparties.error && <FormError error={counterparties.error} />}
      {unpointedGroups.error && <FormError error={unpointedGroups.error} />}
      {showEmptyPrompt && (
        <p className={styles.empty}>還沒有借還紀錄，從『新增交易 → 借還』開始記第一筆</p>
      )}
      {items.length > 0 && (
        <>
          <ul className={styles.list}>
            {items.map((counterparty) => {
              const expanded = expandedId === counterparty.id;
              const sourcesId = `counterparty-sources-${counterparty.id}`;
              const ledgerParts = counterparty.ledgerParts ?? [];
              const totalBalance = counterparty.totalBalance ?? counterparty.balance;

              return (
                <li key={counterparty.id} className={styles.item}>
                  <div className={styles.rowGroup}>
                    <button
                      type="button"
                      className={styles.row}
                      aria-label={`開啟${counterparty.displayName}的往來帳`}
                      onClick={() => onSelectCounterparty(counterparty.id)}
                    >
                      <span className={styles.nameGroup}>
                        <span className={styles.name}>{counterparty.displayName}</span>
                        {counterparty.link !== null && (
                          <span className={styles.linkBadge}>連動</span>
                        )}
                      </span>
                      <span className={styles.balance}>
                        {formatCounterpartyBalance(counterparty.displayName, totalBalance)}
                      </span>
                    </button>
                    {ledgerParts.length > 0 && (
                      <button
                        type="button"
                        className={styles.expandButton}
                        aria-label={`${expanded ? '收合' : '展開'}${counterparty.displayName}的帳本來源`}
                        aria-expanded={expanded}
                        aria-controls={sourcesId}
                        onClick={() => setExpandedId(expanded ? null : counterparty.id)}
                      >
                        <span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
                      </button>
                    )}
                  </div>
                  {ledgerParts.length > 0 && (
                    <div id={sourcesId} className={styles.details} hidden={!expanded}>
                      {counterparty.balance !== 0 && (
                        <button
                          type="button"
                          className={styles.personalRow}
                          aria-label={`開啟${counterparty.displayName}的個人往來`}
                          onClick={() => onSelectCounterparty(counterparty.id)}
                        >
                          <span>個人往來</span>
                          <SmallDebtDirection
                            personName={counterparty.displayName}
                            amount={counterparty.balance}
                          />
                        </button>
                      )}
                      <LedgerSourceList sources={ledgerParts} onOpenSource={onOpenLedgerSource} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {counterparties.data && (
            <Pagination
              page={counterparties.data.page}
              limit={counterparties.data.limit}
              total={counterparties.data.total}
              onChange={setPage}
            />
          )}
        </>
      )}
      <UnpointedLedgerGroups groups={groups} onOpenSource={onOpenLedgerSource} />
    </>
  );
}

/** 清單用 API 回傳的 totalBalance 決定總額箭頭；nonZero 由 API 負責過濾。 */
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

/** 只顯示符合群組契約的回應，避免其他 API 回應被誤當成帳本來源。 */
function isLedgerGroup(value: unknown): value is LedgerGroup {
  if (typeof value !== 'object' || value === null || !('ledger' in value)) {
    return false;
  }
  const { ledger, people } = value as { ledger: unknown; people?: unknown };
  if (typeof ledger !== 'object' || ledger === null || !('id' in ledger) || !('name' in ledger)) {
    return false;
  }
  return Array.isArray(people);
}
