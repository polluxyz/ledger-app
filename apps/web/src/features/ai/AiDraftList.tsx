import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import {
  isDraftComplete,
  type Category,
  type CategoryType,
  type TransactionDraft,
} from '@ledger/shared';
import { Button } from '../../components/Button';
import { formatMoney, TRANSACTION_TYPE_LABELS } from '../../lib/format';
import { apiRequest } from '../../lib/api-client';
import { useAccounts } from '../accounts/use-accounts';
import { categoriesKey } from '../categories/use-categories';
import { useLedgers } from '../ledgers/use-ledgers';
import styles from './AiDraftList.module.css';

export interface AiDraftItem {
  key: string;
  draft: TransactionDraft;
  error?: string;
}

interface AiDraftListProps {
  items: AiDraftItem[];
  currentLedgerId: string;
  busyKeys?: ReadonlySet<string>;
  isConfirmingAll?: boolean;
  onConfirm: (item: AiDraftItem) => void;
  onDiscard: (key: string) => void;
  onSelect: (item: AiDraftItem) => void;
  onConfirmAll: () => void;
}

/** 草稿列只呈現後端提供的欄位；可直接寫入的條件統一交給 shared 判斷。 */
export function AiDraftList({
  items,
  currentLedgerId,
  busyKeys = new Set<string>(),
  isConfirmingAll = false,
  onConfirm,
  onDiscard,
  onSelect,
  onConfirmAll,
}: AiDraftListProps) {
  const accounts = useAccounts();
  const ledgers = useLedgers(true);
  const categoryLookups = useMemo(
    () =>
      Array.from(
        new Map(
          items
            .filter(({ draft }) => draft.type !== 'TRANSFER' && draft.categoryId !== null)
            .map(({ draft }) => {
              const type: CategoryType = draft.type === 'INCOME' ? 'INCOME' : 'EXPENSE';
              return [`${draft.ledgerId}:${type}`, { ledgerId: draft.ledgerId, type }];
            }),
        ).values(),
      ),
    [items],
  );
  const categoryQueries = useQueries({
    queries: categoryLookups.map(({ ledgerId, type }) => ({
      queryKey: [...categoriesKey(ledgerId), type],
      queryFn: () => apiRequest<Category[]>(`/ledgers/${ledgerId}/categories?type=${type}`),
    })),
  });
  const categoriesByLedger = new Map(
    categoryLookups.map(({ ledgerId, type }, index) => [
      `${ledgerId}:${type}`,
      categoryQueries[index]?.data ?? [],
    ]),
  );
  const completeItems = items.filter(({ draft }) => isDraftComplete(draft));

  return (
    <section className={styles.section} aria-labelledby="ai-draft-list-title">
      <div className={styles.heading}>
        <h2 id="ai-draft-list-title">草稿</h2>
        {completeItems.length > 0 && (
          <Button
            type="button"
            variant="secondary"
            disabled={isConfirmingAll || busyKeys.size > 0}
            onClick={onConfirmAll}
          >
            {isConfirmingAll ? '確認中…' : '全部確認'}
          </Button>
        )}
      </div>
      <ul className={styles.list}>
        {items.map((item) => {
          const { draft, key } = item;
          const complete = isDraftComplete(draft);
          const busy = busyKeys.has(key) || isConfirmingAll;
          const type = draft.type === 'INCOME' ? 'INCOME' : 'EXPENSE';
          const categoryName =
            draft.categoryId === null
              ? draft.newCategoryName === null
                ? null
                : `＋${draft.newCategoryName}`
              : (categoriesByLedger
                  .get(`${draft.ledgerId}:${type}`)
                  ?.find((category) => category.id === draft.categoryId)?.name ?? null);
          const hasProposedCategory = draft.categoryId === null && draft.newCategoryName !== null;
          const accountName =
            draft.accountId === null
              ? null
              : (accounts.data?.find((account) => account.id === draft.accountId)?.name ?? null);
          const toAccountName =
            draft.toAccountId === null
              ? null
              : (accounts.data?.find((account) => account.id === draft.toAccountId)?.name ?? null);
          const ledgerName = ledgers.data?.find((ledger) => ledger.id === draft.ledgerId)?.name;
          const title = draft.title ?? '名稱未提供';

          return (
            <li className={styles.item} key={key}>
              <button
                className={styles.draft}
                type="button"
                disabled={busy}
                onClick={() => onSelect(item)}
                aria-label={`編輯草稿：${title}`}
              >
                <span className={styles.firstLine}>
                  <span className={styles.type}>{TRANSACTION_TYPE_LABELS[draft.type]}</span>
                  <strong className={styles.title}>{title}</strong>
                  {draft.amount === null ? (
                    <span className={styles.missing}>金額未提供</span>
                  ) : (
                    <span className={styles.amount}>{formatMoney(draft.amount)}</span>
                  )}
                </span>
                <span className={styles.metadata}>
                  {draft.date === null ? (
                    <span className={styles.missing}>日期未提供</span>
                  ) : (
                    <span className={styles.chip}>{draft.date}</span>
                  )}
                  {draft.type !== 'TRANSFER' &&
                    (categoryName === null ? (
                      <span className={styles.missing}>分類未提供</span>
                    ) : (
                      <span
                        className={`${styles.chip}${hasProposedCategory ? ` ${styles.proposedCategory}` : ''}`}
                        role={hasProposedCategory ? 'note' : undefined}
                        aria-label={
                          hasProposedCategory
                            ? `變更分類：${draft.newCategoryName}，確認時新增`
                            : undefined
                        }
                      >
                        {categoryName}
                      </span>
                    ))}
                  {draft.type === 'TRANSFER' ? (
                    <span
                      className={
                        accountName === null || toAccountName === null
                          ? styles.missing
                          : styles.chip
                      }
                    >
                      {accountName ?? '轉出帳戶未提供'} → {toAccountName ?? '轉入帳戶未提供'}
                    </span>
                  ) : accountName === null ? (
                    <span className={styles.missing}>帳戶未提供</span>
                  ) : (
                    <span className={styles.chip}>{accountName}</span>
                  )}
                  {draft.title === null && <span className={styles.missing}>名稱未提供</span>}
                  {draft.type === 'TRANSFER' &&
                    draft.accountId !== null &&
                    draft.accountId === draft.toAccountId && (
                      <span className={styles.missing}>帳戶需不同</span>
                    )}
                  {draft.ledgerId !== currentLedgerId && (
                    <span className={styles.ledger}>{ledgerName ?? '其他帳本'}</span>
                  )}
                </span>
              </button>
              <div className={styles.actions}>
                <button
                  className={styles.iconButton}
                  type="button"
                  aria-label={`確認草稿：${title}`}
                  disabled={!complete || busy}
                  onClick={() => onConfirm(item)}
                >
                  ✓
                </button>
                <button
                  className={styles.iconButton}
                  type="button"
                  aria-label={`移除草稿：${title}`}
                  disabled={busy}
                  onClick={() => onDiscard(key)}
                >
                  ×
                </button>
              </div>
              {item.error && (
                <p className={styles.error} role="alert">
                  {item.error}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
