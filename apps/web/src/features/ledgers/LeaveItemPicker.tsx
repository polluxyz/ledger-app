import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { LedgerLeaveItem, LedgerLeavePreview } from '@ledger/shared';
import { Button } from '../../components/Button';
import { CategoryIcon } from '../../components/CategoryIcon';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { getAvatarLabels } from '../../lib/avatar-labels';
import { formatDate, formatMoney } from '../../lib/format';
import { MiniOweArrow } from '../debts/MiniOweArrow';
import styles from './LeaveItemPicker.module.css';

interface LeaveItemPickerProps {
  items: readonly LedgerLeaveItem[];
  preview: LedgerLeavePreview | undefined;
  previewError: unknown;
  isPreviewLoading: boolean;
  excludedItemIds: readonly string[];
  selectedCount: number;
  onExcludedItemIdsChange: (ids: string[]) => void;
  /** 私人帳本搬移時改以「已選項目」表示勾選狀態；3k 維持 excluded 模式。 */
  selectionMode?: 'exclude' | 'include';
  selectedItemIds?: readonly string[];
  onSelectedItemIdsChange?: (ids: string[]) => void;
  submitLabel?: string;
  allowEmptySelection?: boolean;
  onCancel?: () => void;
  onComplete: () => void;
}

/** 逐筆選擇要帶走的交易；勾選結果與預覽請求由外層共用，返回時不會重設。 */
export function LeaveItemPicker({
  items,
  preview,
  previewError,
  isPreviewLoading,
  excludedItemIds,
  selectedCount,
  onExcludedItemIdsChange,
  selectionMode = 'exclude',
  selectedItemIds = [],
  onSelectedItemIdsChange,
  submitLabel = '完成',
  allowEmptySelection = false,
  onCancel,
  onComplete,
}: LeaveItemPickerProps) {
  const excluded = useMemo(() => new Set(excludedItemIds), [excludedItemIds]);
  const selected = useMemo(() => new Set(selectedItemIds), [selectedItemIds]);
  const allSelected = items.length > 0 && selectedCount === items.length;
  const [changedAccountIds, setChangedAccountIds] = useState<ReadonlySet<string>>(() => new Set());
  const previousPreview = useRef<LedgerLeavePreview | undefined>(undefined);

  useEffect(() => {
    if (!preview) return;
    const previous = previousPreview.current;
    if (previous) {
      const before = new Map(previous.accounts.map((account) => [account.accountId, account]));
      const changed = preview.accounts
        .filter((account) => {
          const prior = before.get(account.accountId);
          return (
            prior !== undefined &&
            (prior.balance !== account.balance || prior.balanceAfter !== account.balanceAfter)
          );
        })
        .map((account) => account.accountId);
      setChangedAccountIds(new Set(changed));
      const timeout = window.setTimeout(() => setChangedAccountIds(new Set()), 700);
      previousPreview.current = preview;
      return () => window.clearTimeout(timeout);
    }
    previousPreview.current = preview;
  }, [preview]);

  function toggleAll() {
    if (selectionMode === 'include') {
      onSelectedItemIdsChange?.(allSelected ? [] : items.map((item) => item.id));
    } else {
      onExcludedItemIdsChange(allSelected ? items.map((item) => item.id) : []);
    }
  }

  function toggleItem(itemId: string) {
    if (selectionMode === 'include') {
      const next = new Set(selected);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      onSelectedItemIdsChange?.([...next].sort());
      return;
    }

    const next = new Set(excluded);
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    onExcludedItemIdsChange([...next].sort());
  }

  return (
    <Dialog open title="選擇交易" onClose={onCancel ?? onComplete} className={styles.pickerDialog}>
      <div className={styles.content}>
        <label className={styles.selectAll}>
          <input
            type="checkbox"
            checked={allSelected}
            disabled={items.length === 0}
            onChange={toggleAll}
          />
          全選
          <span className={styles.count}>
            （{selectedCount}／{items.length}）
          </span>
        </label>

        <ul className={styles.items} aria-label="可選交易">
          {items.map((item) => (
            <LeaveItemRow
              key={item.id}
              item={item}
              checked={selectionMode === 'include' ? selected.has(item.id) : !excluded.has(item.id)}
              onChange={() => toggleItem(item.id)}
            />
          ))}
        </ul>

        {selectionMode === 'exclude' && (
          <div className={styles.preview} aria-live="polite">
            {isPreviewLoading && <p className={styles.status}>載入中…</p>}
            {preview && (
              <LeavePreviewSections
                preview={preview}
                showUnchanged
                changedAccountIds={changedAccountIds}
              />
            )}
            <FormError error={previewError} />
          </div>
        )}

        <div className={styles.actions}>
          <Button
            type="button"
            onClick={onComplete}
            disabled={
              isPreviewLoading ||
              (selectionMode === 'include' && !allowEmptySelection && selectedCount === 0)
            }
          >
            {submitLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function LeaveItemRow({
  item,
  checked,
  onChange,
}: {
  item: LedgerLeaveItem;
  checked: boolean;
  onChange: () => void;
}) {
  const accountText = item.paidByName
    ? `${item.paidByName}付`
    : item.accountEffects.map((effect) => `${effect.name} ${formatMoney(effect.delta)}`).join('、');

  return (
    <li className={styles.item}>
      <label className={styles.itemLabel}>
        <input type="checkbox" checked={checked} onChange={onChange} />
        <time className={styles.date} dateTime={item.date}>
          {formatDate(item.date)}
        </time>
        <span className={styles.category}>
          <CategoryIcon icon={item.categoryIcon} size={16} />
          <span className={styles.itemTitle}>{item.title?.trim() || '—'}</span>
        </span>
        <span className={styles.account}>{accountText || '—'}</span>
        <span className={styles.share}>
          我的份額 {item.share === null ? '—' : formatMoney(item.share)}
        </span>
      </label>
    </li>
  );
}

/** 退出畫面與選擇畫面共用同一份後端計算結果；此處只排版、不重算金額。 */
export function LeavePreviewSections({
  preview,
  showUnchanged = false,
  changedAccountIds,
  columnHint,
}: {
  preview: LedgerLeavePreview;
  showUnchanged?: boolean;
  changedAccountIds?: ReadonlySet<string>;
  columnHint?: string;
}) {
  const names = [
    ...preview.carryOvers.map((item) => item.displayName),
    ...preview.withdrawals.map((item) => item.displayName),
  ];
  const avatarLabels = getAvatarLabels(['我', ...names]);
  // 退出對話框與選擇畫面會同時掛著這一段，標題 id 不能寫死。
  const headingId = useId();
  const hasAccounts = showUnchanged || preview.accounts.length > 0;
  const hasRelations = preview.carryOvers.length > 0 || preview.withdrawals.length > 0;

  return (
    <div className={styles.sections}>
      {hasAccounts && (
        <section className={styles.section} aria-labelledby={`${headingId}-accounts`}>
          <div className={styles.sectionHeading}>
            <h3 id={`${headingId}-accounts`} className={styles.sectionTitle}>
              帳戶
            </h3>
            {columnHint && <span className={styles.columnHint}>{columnHint}</span>}
          </div>
          {preview.accounts.length === 0 ? (
            <p className={styles.unchanged}>不變</p>
          ) : (
            <ul className={styles.summaryList}>
              {preview.accounts.map((account) => (
                <li
                  key={account.accountId}
                  className={`${styles.summaryRow} ${
                    changedAccountIds?.has(account.accountId) ? styles.changed : ''
                  }`}
                >
                  <span>{account.name}</span>
                  <span className={styles.amount}>
                    <span className={styles.balanceBefore}>{formatMoney(account.balance)}</span>
                    <span aria-hidden="true">→</span>
                    <span className={balanceAfterClass(account.balance, account.balanceAfter)}>
                      {formatMoney(account.balanceAfter)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {hasRelations && (
        <section className={styles.section} aria-labelledby={`${headingId}-relations`}>
          <div className={styles.sectionHeading}>
            <h3 id={`${headingId}-relations`} className={styles.sectionTitle}>
              往來
            </h3>
            {columnHint && <span className={styles.columnHint}>{columnHint}</span>}
          </div>
          <ul className={styles.summaryList}>
            {preview.carryOvers.map((carryOver) => {
              const from = carryOver.amount > 0 ? carryOver.displayName : '我';
              const to = carryOver.amount > 0 ? '我' : carryOver.displayName;
              return (
                <li key={carryOver.ledgerPersonId} className={styles.summaryRow}>
                  <span>{carryOver.displayName}</span>
                  <span className={styles.arrowAmount} aria-label={`${from} → ${to}`}>
                    <MiniOweArrow
                      from={from}
                      fromLabel={avatarLabels.get(from)}
                      to={to}
                      toLabel={avatarLabels.get(to)}
                      compact
                    />
                    {formatMoney(Math.abs(carryOver.amount))}
                  </span>
                </li>
              );
            })}
            {preview.withdrawals.map((withdrawal) => (
              <li key={withdrawal.counterpartyId} className={styles.summaryRow}>
                <span>{withdrawal.displayName}</span>
                <span className={styles.arrowAmount}>
                  <CounterpartyBalance
                    name={withdrawal.displayName}
                    amount={withdrawal.balance}
                    avatarLabels={avatarLabels}
                    valueClassName={styles.balanceBefore}
                  />
                  <span aria-hidden="true">→</span>
                  <CounterpartyBalance
                    name={withdrawal.displayName}
                    amount={withdrawal.balanceAfter}
                    avatarLabels={avatarLabels}
                    valueClassName={balanceAfterClass(withdrawal.balance, withdrawal.balanceAfter)}
                  />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CounterpartyBalance({
  name,
  amount,
  avatarLabels,
  valueClassName,
}: {
  name: string;
  amount: number;
  avatarLabels: ReadonlyMap<string, string>;
  valueClassName?: string;
}) {
  if (amount === 0) return <span className={valueClassName}>兩清</span>;
  const from = amount > 0 ? name : '我';
  const to = amount > 0 ? '我' : name;
  return (
    <>
      <MiniOweArrow
        from={from}
        fromLabel={avatarLabels.get(from)}
        to={to}
        toLabel={avatarLabels.get(to)}
        compact
      />
      <span className={valueClassName}>{formatMoney(Math.abs(amount))}</span>
    </>
  );
}

/** 後端提供的前後餘額只用來呈現方向，不在前端重算餘額。 */
function balanceAfterClass(balance: number, balanceAfter: number) {
  if (balanceAfter === 0 || balanceAfter === balance) return styles.balanceAfter;
  return balanceAfter > balance
    ? `${styles.balanceAfter} ${styles.balanceAfterIncome}`
    : `${styles.balanceAfter} ${styles.balanceAfterExpense}`;
}
