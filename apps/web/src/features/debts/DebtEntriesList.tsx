import { useEffect, useRef, useState } from 'react';
import type { DebtEntry, DebtEntryKind } from '@ledger/shared';
import { Check, MoreHorizontal } from 'lucide-react';
import { Button } from '../../components/Button';
import confirmStyles from '../../components/ConfirmDialog.module.css';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { formatDate, formatMoney } from '../../lib/format';
import { useDeleteSplit } from '../transactions/use-splits';
import rowStyles from './DebtRow.module.css';
import { DebtEntryEditDialog } from './DebtEntryEditDialog';
import { getDebtEntryFlow } from './entry-flow';
import { MiniOweArrow } from './MiniOweArrow';
import { useDeleteDebtEntry } from './use-debts';
import styles from './DebtEntriesList.module.css';

interface DebtEntriesListProps {
  entries: readonly DebtEntry[];
  displayName: string;
  balance: number;
  editable?: boolean;
  onEditSplit?: (splitId: string) => void;
  avatarLabels?: ReadonlyMap<string, string>;
}

/**
 * 往來紀錄清單。
 *
 * ## 為什麼把清單與撤銷／修改對話框抽成獨立元件
 *
 * 個人分頁展開明細與歷史分頁的「個人往來」都要呈現往來紀錄，並提供修改、撤銷
 * 與分帳入口。統一用方向符號、金額和同步狀態，讓使用者不用再解讀動詞與正負號。
 * 列右邊的操作收進「⋯」選單（2026-10-08）：一列只剩一顆按鈕，分帳紀錄的修改、
 * 撤銷也從這裡走分帳的編輯面板與撤銷流程。
 */
export function DebtEntriesList({
  entries,
  displayName,
  balance,
  editable = true,
  onEditSplit,
  avatarLabels,
}: DebtEntriesListProps) {
  const removeEntry = useDeleteDebtEntry();
  const removeSplit = useDeleteSplit();
  const [entryToUndo, setEntryToUndo] = useState<DebtEntry | null>(null);
  const [entryToEdit, setEntryToEdit] = useState<DebtEntry | null>(null);
  const [splitToUndo, setSplitToUndo] = useState<DebtEntry | null>(null);

  function closeEntryUndo() {
    setEntryToUndo(null);
    removeEntry.reset();
  }

  function confirmEntryUndo() {
    if (!entryToUndo) {
      return;
    }
    removeEntry.mutate(entryToUndo.id, { onSuccess: closeEntryUndo });
  }

  function closeSplitUndo() {
    setSplitToUndo(null);
    removeSplit.reset();
  }

  function confirmSplitUndo() {
    if (!splitToUndo?.splitId) {
      return;
    }
    removeSplit.mutate(splitToUndo.splitId, { onSuccess: closeSplitUndo });
  }

  return (
    <>
      <ul className={styles.entryList}>
        {entries.map((entry) => {
          const isAdjustment = ADJUSTMENT_KINDS.has(entry.kind);
          const isUnrecorded = entry.transactionId === null && !isAdjustment;
          const flow = getDebtEntryFlow(entry, displayName);
          const from = flow.direction === 'iOweThem' ? '我' : displayName;
          const to = flow.direction === 'iOweThem' ? displayName : '我';

          return (
            <li
              key={entry.id}
              className={rowStyles.item}
              aria-label={flow.description}
              title={flow.description}
            >
              <div className={rowStyles.row}>
                {/* 同一頁都是同年往來，日期只留 MM/DD，年份沒有資訊量。 */}
                <time className={rowStyles.date} dateTime={entry.date}>
                  {formatDate(entry.date).slice(5)}
                </time>
                <span className={rowStyles.arrow}>
                  {flow.marker === 'check' ? (
                    <span className={styles.adjustmentIcon} aria-hidden="true">
                      <Check size={14} strokeWidth={2.5} />
                    </span>
                  ) : (
                    flow.direction !== null && (
                      <MiniOweArrow
                        from={from}
                        fromLabel={avatarLabels?.get(from)}
                        to={to}
                        toLabel={avatarLabels?.get(to)}
                        repay={flow.marker === 'repay'}
                      />
                    )
                  )}
                </span>
                <span className={rowStyles.spacer} />
                <span className={rowStyles.label}>
                  {entry.splitId !== null && <span className={styles.splitBadge}>分帳</span>}
                  {isUnrecorded && <span className={styles.unrecorded}>未記帳</span>}
                  {SYNC_STATUS_LABELS[entry.sync] && (
                    <span className={`${styles.syncLabel} ${styles[entry.sync.toLowerCase()]}`}>
                      {SYNC_STATUS_LABELS[entry.sync]}
                    </span>
                  )}
                  {entry.note && <span className={styles.note}>{entry.note}</span>}
                </span>
                <span className={rowStyles.amount}>
                  <span className={rowStyles.amountText}>{formatMoney(Math.abs(entry.delta))}</span>
                </span>
                {editable && entry.settlesEntryId === null && (
                  <span className={rowStyles.actions}>
                    <EntryMenu
                      hasEdit={!isAdjustment}
                      onEdit={() => {
                        if (entry.splitId !== null) {
                          onEditSplit?.(entry.splitId);
                        } else {
                          setEntryToEdit(entry);
                        }
                      }}
                      onUndo={() => {
                        if (entry.splitId !== null) {
                          setSplitToUndo(entry);
                        } else {
                          setEntryToUndo(entry);
                        }
                      }}
                    />
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <UndoConfirmation
        entry={entryToUndo}
        undoDelta={entryToUndo === null ? 0 : undoDeltaOf(entryToUndo, entries)}
        balance={balance}
        displayName={displayName}
        avatarLabels={avatarLabels}
        error={removeEntry.error}
        isPending={removeEntry.isPending}
        onConfirm={confirmEntryUndo}
        onCancel={closeEntryUndo}
      />
      <UndoConfirmation
        entry={splitToUndo}
        undoDelta={splitToUndo?.delta ?? 0}
        balance={balance}
        displayName={displayName}
        avatarLabels={avatarLabels}
        error={removeSplit.error}
        isPending={removeSplit.isPending}
        onConfirm={confirmSplitUndo}
        onCancel={closeSplitUndo}
      />
      <DebtEntryEditDialog
        entry={entryToEdit}
        displayName={displayName}
        onClose={() => setEntryToEdit(null)}
      />
    </>
  );
}

/**
 * 撤銷這筆會讓往來餘額少掉多少（畫面試算用）。還款綁定了結清差額時，後端會一起撤銷差額
 * （3g 決策 156），所以要連差額一起扣，否則試算會少算差額那一段。差額緊接在還款之後寫入、
 * 日期相同，清單新到舊排在還款前面，看得到還款時差額一定已經載入。
 */
function undoDeltaOf(entry: DebtEntry, entries: readonly DebtEntry[]): number {
  const bound = entries.find((candidate) => candidate.settlesEntryId === entry.id);
  return entry.delta + (bound?.delta ?? 0);
}

/**
 * 把撤銷前後的個人往來餘額並排，讓使用者直接看見這筆紀錄會怎麼改變結果。
 * 這只是畫面試算；送出後的個人往來餘額仍以伺服器回應為準。
 */
function UndoConfirmation({
  entry,
  undoDelta,
  balance,
  displayName,
  avatarLabels,
  error,
  isPending,
  onConfirm,
  onCancel,
}: {
  entry: DebtEntry | null;
  /** 撤銷後往來餘額減少的量：這筆的 `delta`，綁定差額的還款再加上差額。 */
  undoDelta: number;
  balance: number;
  displayName: string;
  avatarLabels?: ReadonlyMap<string, string>;
  error: unknown;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const after = entry === null ? balance : balance - undoDelta;
  const description = entry === null ? '' : describeUndo(balance, after, displayName);

  return (
    <Dialog open={entry !== null} title="撤銷這筆？" onClose={onCancel}>
      {entry && (
        <div className={styles.confirmContent}>
          <FormError error={error} />
          <div className={styles.undoPreview} role="group" aria-label={description}>
            <div className={styles.previewRow} aria-hidden="true">
              <BalancePreview
                balance={balance}
                displayName={displayName}
                avatarLabels={avatarLabels}
              />
              <span className={styles.previewArrow}>→</span>
              <BalancePreview
                balance={after}
                displayName={displayName}
                avatarLabels={avatarLabels}
              />
            </div>
          </div>
          {entry.sync === 'SYNCED' && <p className={styles.syncNotice}>對方會收到通知</p>}
          <div className={styles.dialogActions}>
            <Button type="button" variant="secondary" disabled={isPending} onClick={onCancel}>
              取消
            </Button>
            <Button
              type="button"
              className={confirmStyles.danger}
              disabled={isPending}
              onClick={onConfirm}
            >
              {isPending ? '處理中…' : '撤銷'}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function BalancePreview({
  balance,
  displayName,
  avatarLabels,
}: {
  balance: number;
  displayName: string;
  avatarLabels?: ReadonlyMap<string, string>;
}) {
  if (balance === 0) {
    return <span className={styles.previewBalance}>兩清</span>;
  }

  const from = balance > 0 ? displayName : '我';
  const to = balance > 0 ? '我' : displayName;

  return (
    <span className={styles.previewBalance}>
      <MiniOweArrow
        from={from}
        fromLabel={avatarLabels?.get(from)}
        to={to}
        toLabel={avatarLabels?.get(to)}
        compact
      />
      {formatMoney(Math.abs(balance))}
    </span>
  );
}

function describeUndo(before: number, after: number, displayName: string): string {
  return `撤銷後，往來從「${describeBalance(before, displayName)}」變成「${describeBalance(after, displayName)}」。`;
}

function describeBalance(balance: number, displayName: string): string {
  if (balance === 0) {
    return '兩清';
  }
  if (balance > 0) {
    return `${displayName}欠你的金額 ${formatMoney(balance)}`;
  }
  return `你欠${displayName}的金額 ${formatMoney(Math.abs(balance))}`;
}

/**
 * 每列的「⋯」選單：開著時才掛全域監聽，選單外按下或按 Esc 就收起，焦點回到
 * 「⋯」讓鍵盤使用者接得上。項目只有修改與撤銷，由呼叫端決定各自做什麼。
 */
function EntryMenu({
  hasEdit,
  onEdit,
  onUndo,
}: {
  hasEdit: boolean;
  onEdit: () => void;
  onUndo: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function choose(action: () => void) {
    setOpen(false);
    buttonRef.current?.focus();
    action();
  }

  return (
    <div className={styles.menuWrap} ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.menuButton}
        aria-label="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={18} strokeWidth={2} />
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          {hasEdit && (
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => choose(onEdit)}
            >
              修改
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => choose(onUndo)}
          >
            撤銷
          </button>
        </div>
      )}
    </div>
  );
}

const ADJUSTMENT_KINDS: ReadonlySet<DebtEntryKind> = new Set(['SETTLEMENT', 'FORGIVE', 'FORGIVEN']);

const SYNC_STATUS_LABELS = {
  NONE: '',
  PENDING: '等對方確認',
  SYNCED: '已同步',
  DECLINED: '對方未接受',
} as const;
