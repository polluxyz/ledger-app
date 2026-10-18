import { useMemo, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { TextField } from '../../components/TextField';
import { getAvatarLabels } from '../../lib/avatar-labels';
import { formatMoney } from '../../lib/format';
import { MiniOweArrow } from '../debts/MiniOweArrow';
import { useArchiveLedger, useDeleteLedger, useRemovalPreview } from './use-ledgers';
import confirmStyles from '../../components/ConfirmDialog.module.css';
import { Button } from '../../components/Button';
import styles from './DeleteLedgerDialog.module.css';

interface DeleteLedgerDialogProps {
  ledgerId: string;
  ledgerName: string;
  onCancel: () => void;
  onDeleted: () => void;
  onArchived: () => void;
}

const BLOCKED_REASON = {
  HAS_OTHER_MEMBERS: '還有其他成員，只能封存',
  HAS_OTHERS_TRANSACTIONS: '有其他成員的交易，只能封存',
  SHARED_HAS_DEBTS: '有借還或分帳，只能封存',
  LEDGER_ARCHIVED: '帳本已封存',
} as const;

/** 刪除帳本前的伺服器預覽與確認。金額、方向與可刪條件全由 API 提供。 */
export function DeleteLedgerDialog({
  ledgerId,
  ledgerName,
  onCancel,
  onDeleted,
  onArchived,
}: DeleteLedgerDialogProps) {
  const preview = useRemovalPreview(ledgerId);
  const archive = useArchiveLedger();
  const remove = useDeleteLedger();
  const [typedName, setTypedName] = useState('');
  const counterparties = preview.data?.counterparties;
  const avatarLabels = useMemo(
    () => getAvatarLabels(['我', ...(counterparties ?? []).map((item) => item.displayName)]),
    [counterparties],
  );
  const isPending = archive.isPending || remove.isPending;
  const canDelete = preview.data?.delete.allowed === true && typedName.trim() === ledgerName;

  function confirmDelete() {
    if (!preview.data?.delete.allowed || !canDelete) {
      return;
    }
    remove.mutate(
      {
        id: ledgerId,
        confirm: ledgerName,
        withdrawDebts: preview.data.withdrawsDebts ? true : undefined,
      },
      { onSuccess: onDeleted },
    );
  }

  function confirmArchive() {
    archive.mutate(ledgerId, { onSuccess: onArchived });
  }

  const previewError = preview.data?.delete.allowed ? undefined : preview.error;
  const error = remove.error ?? archive.error ?? previewError;

  return (
    <Dialog open title={`刪除「${ledgerName}」`} onClose={onCancel}>
      <div className={styles.content}>
        {preview.isLoading && <p className={styles.status}>載入中…</p>}
        {preview.data?.delete.allowed && (
          <>
            {preview.data.accounts.length > 0 && (
              <section className={styles.section} aria-labelledby="delete-ledger-accounts-heading">
                <h3 id="delete-ledger-accounts-heading" className={styles.sectionTitle}>
                  帳戶
                </h3>
                <ul className={styles.list}>
                  {preview.data.accounts.map((account) => (
                    <li key={account.accountId} className={styles.accountRow}>
                      <span>{account.name}</span>
                      <span className={styles.balanceChange}>
                        {formatMoney(account.balance)} → {formatMoney(account.balanceAfter)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {counterparties && counterparties.length > 0 && (
              <section
                className={styles.section}
                aria-labelledby="delete-ledger-counterparties-heading"
              >
                <h3 id="delete-ledger-counterparties-heading" className={styles.sectionTitle}>
                  往來
                </h3>
                <ul className={styles.list}>
                  {counterparties.map((counterparty) => (
                    <li key={counterparty.counterpartyId} className={styles.counterpartyRow}>
                      <span className={styles.counterpartyName}>
                        <span>{counterparty.displayName}</span>
                        {counterparty.linked && <span className={styles.linked}>連動</span>}
                      </span>
                      <span className={styles.balanceChange}>
                        <CounterpartyBalance
                          name={counterparty.displayName}
                          amount={counterparty.balance}
                          avatarLabels={avatarLabels}
                        />
                        <span aria-hidden="true">→</span>
                        <CounterpartyBalance
                          name={counterparty.displayName}
                          amount={counterparty.balanceAfter}
                          avatarLabels={avatarLabels}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <TextField
              label="輸入帳本名稱"
              value={typedName}
              onChange={(event) => setTypedName(event.target.value)}
              disabled={isPending}
            />
          </>
        )}
        {preview.data && !preview.data.delete.allowed && (
          <p className={styles.reason}>
            {preview.data.delete.blockedBy
              ? BLOCKED_REASON[preview.data.delete.blockedBy]
              : '只能封存'}
          </p>
        )}
        <FormError error={error} />
        <div className={styles.actions}>
          <Button type="button" variant="secondary" disabled={isPending} onClick={onCancel}>
            取消
          </Button>
          <Button type="button" variant="secondary" disabled={isPending} onClick={confirmArchive}>
            {archive.isPending ? '處理中…' : '封存'}
          </Button>
          {preview.data?.delete.allowed && (
            <Button
              type="button"
              className={confirmStyles.danger}
              disabled={isPending || !canDelete}
              onClick={confirmDelete}
            >
              {remove.isPending ? '處理中…' : '刪除'}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function CounterpartyBalance({
  name,
  amount,
  avatarLabels,
}: {
  name: string;
  amount: number;
  avatarLabels: ReadonlyMap<string, string>;
}) {
  if (amount === 0) {
    return <span>兩清</span>;
  }

  const from = amount > 0 ? name : '我';
  const to = amount > 0 ? '我' : name;

  return (
    <span className={styles.counterpartyBalance}>
      <MiniOweArrow
        from={from}
        fromLabel={avatarLabels.get(from)}
        to={to}
        toLabel={avatarLabels.get(to)}
        compact
      />
      {formatMoney(Math.abs(amount))}
    </span>
  );
}
