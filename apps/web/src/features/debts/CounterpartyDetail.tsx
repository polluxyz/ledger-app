import { useState } from 'react';
import type { DebtEntry, DebtEntryKind } from '@ledger/shared';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { Pagination } from '../../components/Pagination';
import { TextField } from '../../components/TextField';
import { formatDate, formatMoney } from '../../lib/format';
import {
  useCounterparty,
  useCounterpartyEntries,
  useDeleteCounterparty,
  useDeleteDebtEntry,
  useForgiveCounterparty,
  useRenameCounterparty,
} from './use-debts';
import { DebtEntryEditDialog } from './DebtEntryEditDialog';
import styles from './CounterpartyDetail.module.css';

interface CounterpartyDetailProps {
  counterpartyId: string;
  /** 記往來仍由新增表單負責；這裡只提供對象名字給交易頁。 */
  onRecordEntry: (name: string) => void;
  /** 對象刪除成功後由交易頁把側欄切回新增表單。 */
  onDeleted: () => void;
}

/** 對象往來帳顯示 API 回傳的餘額與逐筆紀錄，所有寫入都交給資料層 hooks。 */
export function CounterpartyDetail({
  counterpartyId,
  onRecordEntry,
  onDeleted,
}: CounterpartyDetailProps) {
  const [page, setPage] = useState(1);
  const counterparty = useCounterparty(counterpartyId);
  const entries = useCounterpartyEntries(counterpartyId, { page, limit: 20 });
  const rename = useRenameCounterparty();
  const removeCounterparty = useDeleteCounterparty();
  const forgive = useForgiveCounterparty();
  const removeEntry = useDeleteDebtEntry();

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState('');
  const [forgiveOpen, setForgiveOpen] = useState(false);
  const [deleteCounterpartyOpen, setDeleteCounterpartyOpen] = useState(false);
  const [entryToDelete, setEntryToDelete] = useState<DebtEntry | null>(null);
  const [entryToEdit, setEntryToEdit] = useState<DebtEntry | null>(null);

  function closeRename() {
    setRenameOpen(false);
    rename.reset();
  }

  function submitRename() {
    rename.mutate({ counterpartyId, name: renameName.trim() }, { onSuccess: closeRename });
  }

  function closeForgive() {
    setForgiveOpen(false);
    forgive.reset();
  }

  function confirmForgive() {
    forgive.mutate(counterpartyId, { onSuccess: closeForgive });
  }

  function closeCounterpartyDelete() {
    setDeleteCounterpartyOpen(false);
    removeCounterparty.reset();
  }

  function confirmCounterpartyDelete() {
    removeCounterparty.mutate(counterpartyId, {
      onSuccess: () => {
        closeCounterpartyDelete();
        onDeleted();
      },
    });
  }

  function closeEntryDelete() {
    setEntryToDelete(null);
    removeEntry.reset();
  }

  function confirmEntryDelete() {
    if (!entryToDelete) {
      return;
    }
    removeEntry.mutate(entryToDelete.id, { onSuccess: closeEntryDelete });
  }

  if (counterparty.isLoading) {
    return <p className={styles.status}>載入中…</p>;
  }
  if (counterparty.error) {
    return <FormError error={counterparty.error} />;
  }
  if (!counterparty.data) {
    return null;
  }

  const person = counterparty.data;
  const recordTotal = entries.data?.total;

  return (
    <div className={styles.detail}>
      <header className={styles.heading}>
        <h3>{person.name}</h3>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setRenameName(person.name);
            setRenameOpen(true);
          }}
        >
          改名
        </Button>
      </header>

      <p className={styles.balance}>{formatCounterpartyBalance(person.name, person.balance)}</p>

      <div className={styles.actions}>
        <Button type="button" onClick={() => onRecordEntry(person.name)}>
          記一筆
        </Button>
        {person.balance > 0 && (
          <Button type="button" variant="secondary" onClick={() => setForgiveOpen(true)}>
            免除剩餘
          </Button>
        )}
        {recordTotal === 0 && (
          <Button type="button" variant="secondary" onClick={() => setDeleteCounterpartyOpen(true)}>
            刪除對象
          </Button>
        )}
      </div>

      <section className={styles.entries} aria-labelledby="counterparty-entries-heading">
        <h4 id="counterparty-entries-heading">往來紀錄</h4>
        {entries.isLoading ? (
          <p className={styles.status}>載入中…</p>
        ) : entries.error ? (
          <FormError error={entries.error} />
        ) : entries.data?.items.length === 0 ? (
          <p className={styles.empty}>還沒有往來紀錄。</p>
        ) : (
          <>
            <ul className={styles.entryList}>
              {entries.data?.items.map((entry) => {
                const isAdjustment = ADJUSTMENT_KINDS.has(entry.kind);
                const canEdit = !isAdjustment;
                const isUnrecorded = entry.transactionId === null && !isAdjustment;
                return (
                  <li key={entry.id} className={styles.entry}>
                    <div className={styles.entryInfo}>
                      <div className={styles.entryLine}>
                        <time dateTime={entry.date}>{formatDate(entry.date)}</time>
                        <span className={styles.kind}>{ENTRY_KIND_LABELS[entry.kind]}</span>
                        <span className={styles.delta}>{formatDelta(entry.delta)}</span>
                      </div>
                      <div className={styles.entryLine}>
                        {entry.balanceAfter !== undefined && (
                          <span className={styles.balanceAfter}>
                            {formatBalanceAfter(entry.balanceAfter)}
                          </span>
                        )}
                        {isUnrecorded && <span className={styles.unrecorded}>未記帳</span>}
                      </div>
                      {entry.note && <p className={styles.note}>{entry.note}</p>}
                    </div>
                    <div className={styles.entryActions}>
                      {canEdit && (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setEntryToEdit(entry)}
                        >
                          修改
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setEntryToDelete(entry)}
                      >
                        刪除
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            {entries.data && (
              <Pagination
                page={entries.data.page}
                limit={entries.data.limit}
                total={entries.data.total}
                onChange={setPage}
              />
            )}
          </>
        )}
      </section>

      <Dialog open={renameOpen} title="改名" onClose={closeRename}>
        <form
          className={styles.dialogForm}
          onSubmit={(event) => {
            event.preventDefault();
            submitRename();
          }}
        >
          <FormError error={rename.error} />
          <TextField
            label="對象名字"
            value={renameName}
            required
            maxLength={100}
            disabled={rename.isPending}
            onChange={(event) => setRenameName(event.target.value)}
          />
          <div className={styles.dialogActions}>
            <Button
              type="button"
              variant="secondary"
              disabled={rename.isPending}
              onClick={closeRename}
            >
              取消
            </Button>
            <Button type="submit" disabled={rename.isPending || renameName.trim() === ''}>
              {rename.isPending ? '儲存中…' : '儲存'}
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={forgiveOpen}
        title="免除剩餘"
        message={`${person.name}欠你的 ${formatMoney(person.balance)} 將歸零，不產生交易；之後可以刪除這筆免除來還原。`}
        confirmLabel="免除"
        error={forgive.error}
        isPending={forgive.isPending}
        onConfirm={confirmForgive}
        onCancel={closeForgive}
      />
      <ConfirmDialog
        open={deleteCounterpartyOpen}
        title="刪除對象"
        message={`確定要刪除「${person.name}」這個對象？`}
        confirmLabel="刪除"
        error={removeCounterparty.error}
        isPending={removeCounterparty.isPending}
        onConfirm={confirmCounterpartyDelete}
        onCancel={closeCounterpartyDelete}
      />
      <ConfirmDialog
        open={entryToDelete !== null}
        title="刪除往來紀錄"
        message="刪除這筆往來？對應的交易會一起刪除，帳戶餘額與往來餘額會回到記這筆之前。"
        confirmLabel="刪除"
        error={removeEntry.error}
        isPending={removeEntry.isPending}
        onConfirm={confirmEntryDelete}
        onCancel={closeEntryDelete}
      />
      <DebtEntryEditDialog entry={entryToEdit} onClose={() => setEntryToEdit(null)} />
    </div>
  );
}

/** 系統算出的調整紀錄：不產生交易、不能改金額（API 會回 409 `DEBT_ENTRY_NOT_EDITABLE`）。 */
const ADJUSTMENT_KINDS: ReadonlySet<DebtEntryKind> = new Set(['SETTLEMENT', 'FORGIVE', 'FORGIVEN']);

const ENTRY_KIND_LABELS: Record<DebtEntryKind, string> = {
  LEND: '借出',
  BORROW: '借入',
  COLLECT: '對方還我',
  REPAY: '我還對方',
  PAID_FOR_ME: '幫我付',
  SETTLEMENT: '結清差額',
  FORGIVE: '免除',
  // 3b-2：接受對方的免除時寫入。畫面在 3b-2 的畫面步驟才會出現這種紀錄。
  FORGIVEN: '被免除',
};

/** 往來餘額語句只讀 API 的數字，正負號代表誰欠誰。 */
function formatCounterpartyBalance(name: string, balance: number): string {
  if (balance > 0) {
    return `${name}欠你 ${formatMoney(balance)}`;
  }
  if (balance < 0) {
    return `你欠${name} ${formatMoney(Math.abs(balance))}`;
  }
  return '兩清';
}

/** 往來紀錄的正負號直接呈現 delta，不把它換算成另一種帳務意義。 */
function formatDelta(delta: number): string {
  return delta > 0 ? `+${formatMoney(delta)}` : `−${formatMoney(Math.abs(delta))}`;
}

/** 累計餘額來自 API 的 balanceAfter，負數用清楚可見的數學負號。 */
function formatBalanceAfter(balanceAfter: number): string {
  if (balanceAfter < 0) {
    return `餘額 −${formatMoney(Math.abs(balanceAfter))}`;
  }
  return `餘額 ${formatMoney(balanceAfter)}`;
}
