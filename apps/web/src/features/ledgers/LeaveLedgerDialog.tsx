import { useEffect, useMemo, useState } from 'react';
import type { LedgerLeaveItem, LeaveRequest } from '@ledger/shared';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { Select } from '../../components/Select';
import { TextField } from '../../components/TextField';
import confirmStyles from '../../components/ConfirmDialog.module.css';
import { useArchiveLedger, useLeaveLedger, useLeavePreview, useLedgers } from './use-ledgers';
import { LeaveItemPicker, LeavePreviewSections } from './LeaveItemPicker';
import styles from './LeaveLedgerDialog.module.css';

type LeaveLedgerDialogProps = {
  ledgerId: string;
  ledgerName: string;
  onCancel: () => void;
  onCompleted: () => void;
  /** 共享帳本刪除沿用相同預覽，成功時先合併再刪除。 */
  mode?: 'leave' | 'delete';
  onArchived?: () => void;
};

const BLOCKED_REASON = {
  LEDGER_ARCHIVED: '帳本已封存',
  LAST_OWNER: '你是最後一位擁有者，不能退出',
  HAS_OTHER_MEMBERS: '還有其他成員，只能封存',
  HAS_OTHERS_TRANSACTIONS: '有其他成員的交易，只能封存',
} as const;

/** 退出前讓使用者預覽並選擇合併內容；所有金額與可否操作由伺服器回應。 */
export function LeaveLedgerDialog({
  ledgerId,
  ledgerName,
  onCancel,
  onCompleted,
  mode = 'leave',
  onArchived,
}: LeaveLedgerDialogProps) {
  const ledgers = useLedgers();
  const eligibleLedgers = useMemo(
    () =>
      (ledgers.data ?? []).filter(
        (ledger) =>
          ledger.id !== ledgerId && ledger.role !== 'VIEWER' && ledger.archivedAt === null,
      ),
    [ledgerId, ledgers.data],
  );
  const firstPersonalLedger = eligibleLedgers.find((ledger) => ledger.kind === 'PERSONAL');
  const defaultTargetLedger = firstPersonalLedger ?? eligibleLedgers[0];
  const [selectedTargetLedgerId, setSelectedTargetLedgerId] = useState<string>();
  const targetLedgerId = selectedTargetLedgerId ?? defaultTargetLedger?.id ?? null;
  const [excludedItemIds, setExcludedItemIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [typedName, setTypedName] = useState('');
  const leave = useLeaveLedger();
  const archive = useArchiveLedger();
  const [items, setItems] = useState<LedgerLeaveItem[]>([]);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const selectedCount = items.reduce(
    (count, item) => count + (excludedItemIds.includes(item.id) ? 0 : 1),
    0,
  );
  // 先取得可勾選清單；知道全部取消或沒有項目後，才把 null 傳給預覽。
  const previewTarget = itemsLoaded && selectedCount === 0 ? null : targetLedgerId;
  const preview = useLeavePreview(
    ledgerId,
    {
      targetLedgerId: previewTarget,
      excludedItemIds,
      ...(mode === 'delete' ? { deleteLedger: true } : {}),
    },
    !ledgers.isLoading,
  );

  useEffect(() => {
    if (preview.data) {
      // 預覽的參數要靠清單決定「是否全部取消」，清單又來自預覽，所以存一份在 state。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItems(preview.data.items);
      setItemsLoaded(true);
    }
  }, [preview.data]);

  const isPending = leave.isPending || archive.isPending;
  const allowed = preview.data?.leave.allowed === true;
  const canSubmit = selectedCount === 0 || targetLedgerId !== null;
  const error = leave.error ?? archive.error ?? preview.error;

  function requestBody(): LeaveRequest {
    return {
      targetLedgerId: selectedCount === 0 ? null : targetLedgerId,
      excludedItemIds: [...excludedItemIds].sort(),
      ...(mode === 'delete' ? { deleteLedger: true } : {}),
    };
  }

  function confirm() {
    if (!allowed || preview.isFetching || !canSubmit || isPending) return;
    leave.mutate(
      {
        id: ledgerId,
        ...requestBody(),
        ...(mode === 'delete' ? { confirm: ledgerName } : {}),
      },
      { onSuccess: onCompleted },
    );
  }

  function confirmArchive() {
    archive.mutate(ledgerId, { onSuccess: onArchived ?? onCancel });
  }

  return (
    <>
      <Dialog
        open
        title={`${mode === 'delete' ? '刪除' : '退出'}「${ledgerName}」`}
        onClose={onCancel}
      >
        <div className={styles.content}>
          {ledgers.error && <FormError error={ledgers.error} />}
          {preview.isLoading && <p className={styles.status}>載入中…</p>}
          {preview.data?.leave.allowed && (
            <>
              {selectedCount > 0 && (
                <Select
                  label="合併到"
                  value={targetLedgerId ?? ''}
                  disabled={isPending || eligibleLedgers.length === 0}
                  onChange={(event) => setSelectedTargetLedgerId(event.target.value)}
                >
                  {eligibleLedgers.map((targetLedger) => (
                    <option key={targetLedger.id} value={targetLedger.id}>
                      {targetLedger.name}
                    </option>
                  ))}
                </Select>
              )}
              {items.length > 0 && (
                <button
                  type="button"
                  className={styles.pickerLink}
                  disabled={isPending}
                  onClick={() => setPickerOpen(true)}
                >
                  選擇交易（已勾 {selectedCount}／{items.length}）›
                </button>
              )}
              {(preview.data.accounts.length > 0 ||
                preview.data.carryOvers.length > 0 ||
                preview.data.withdrawals.length > 0) && (
                <LeavePreviewSections preview={preview.data} />
              )}
              {mode === 'delete' && (
                <TextField
                  label="輸入帳本名稱"
                  value={typedName}
                  onChange={(event) => setTypedName(event.target.value)}
                  disabled={isPending}
                />
              )}
            </>
          )}
          {preview.data && !preview.data.leave.allowed && (
            <p className={styles.reason}>
              {preview.data.leave.blockedBy
                ? BLOCKED_REASON[preview.data.leave.blockedBy]
                : '目前不能退出'}
            </p>
          )}
          <FormError error={error} />
          <div className={styles.actions}>
            <Button type="button" variant="secondary" disabled={isPending} onClick={onCancel}>
              取消
            </Button>
            {mode === 'delete' && (
              <Button
                type="button"
                variant="secondary"
                disabled={isPending}
                onClick={confirmArchive}
              >
                {archive.isPending ? '處理中…' : '封存'}
              </Button>
            )}
            {allowed && (
              <Button
                type="button"
                className={confirmStyles.danger}
                disabled={
                  isPending ||
                  preview.isFetching ||
                  !canSubmit ||
                  (mode === 'delete' && typedName.trim() !== ledgerName)
                }
                onClick={confirm}
              >
                {leave.isPending ? '處理中…' : mode === 'delete' ? '刪除' : '退出'}
              </Button>
            )}
          </div>
        </div>
      </Dialog>
      {pickerOpen && (
        <LeaveItemPicker
          items={items}
          preview={preview.data}
          previewError={preview.error}
          isPreviewLoading={preview.isFetching}
          excludedItemIds={excludedItemIds}
          selectedCount={selectedCount}
          onExcludedItemIdsChange={setExcludedItemIds}
          onComplete={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}
