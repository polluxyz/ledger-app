import { useState } from 'react';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { TextField } from '../../components/TextField';
import { MergeDialog } from '../debts/MergeDialog';
import { NicknameDialog } from '../debts/NicknameDialog';
import {
  useCounterparty,
  useCounterpartyEntries,
  useDeleteCounterparty,
  useRenameCounterparty,
  useUnlinkCounterparty,
} from '../debts/use-debts';
import styles from './CounterpartyProfile.module.css';

interface CounterpartyProfileProps {
  counterpartyId: string;
  /** 刪除對象成功後由頁面收起右側欄。 */
  onDeleted: () => void;
}

/**
 * 對象頁右側欄的「對象」面板（spec 修訂 2 W52～W53）：只放人的資料與管理按鈕。
 * 餘額、記一筆與往來紀錄屬於交易頁的往來帳（W55），這裡刻意不出現；往來紀錄總數
 * 只拿來決定「刪除對象」能不能出現（規則沿用 3b-1：還有紀錄就不能刪）。
 *
 * 五個對話框（改名、設定暱稱、合併之前的紀錄、解除連動、刪除對象）與 mutation
 * 從 `CounterpartyDetail` 原樣搬來，文字不動（§10.2、SC-W65）。
 */
export function CounterpartyProfile({ counterpartyId, onDeleted }: CounterpartyProfileProps) {
  const counterparty = useCounterparty(counterpartyId);
  // 只為了 total（刪除對象的出現條件），limit 壓到 API 允許的最小值省流量。
  const entries = useCounterpartyEntries(counterpartyId, { limit: 1 });
  const rename = useRenameCounterparty();
  const removeCounterparty = useDeleteCounterparty();
  const unlink = useUnlinkCounterparty();

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState('');
  const [nicknameOpen, setNicknameOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [deleteCounterpartyOpen, setDeleteCounterpartyOpen] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);

  function closeRename() {
    setRenameOpen(false);
    rename.reset();
  }

  function submitRename() {
    rename.mutate({ counterpartyId, name: renameName.trim() }, { onSuccess: closeRename });
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

  function closeUnlink() {
    setUnlinkOpen(false);
    unlink.reset();
  }

  function confirmUnlink() {
    unlink.mutate(counterpartyId, { onSuccess: closeUnlink });
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
    <div className={styles.profile}>
      <header className={styles.heading}>
        <div className={styles.titleRow}>
          <h3>{person.displayName}</h3>
          {person.link && <span className={styles.linkBadge}>連動</span>}
        </div>
      </header>

      {person.link && (
        <dl className={styles.facts}>
          <div className={styles.factRow}>
            <dt>帳號名稱</dt>
            <dd>{person.link.userName}</dd>
          </div>
          {person.name !== null && (
            <div className={styles.factRow}>
              <dt>暱稱</dt>
              <dd>{person.name}</dd>
            </div>
          )}
        </dl>
      )}

      <div className={styles.actions}>
        {person.link ? (
          <>
            <Button type="button" variant="secondary" onClick={() => setNicknameOpen(true)}>
              設定暱稱
            </Button>
            <Button type="button" variant="secondary" onClick={() => setMergeOpen(true)}>
              合併之前的紀錄
            </Button>
            <Button type="button" variant="secondary" onClick={() => setUnlinkOpen(true)}>
              解除連動
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setRenameName(person.name ?? '');
                setRenameOpen(true);
              }}
            >
              改名
            </Button>
            {recordTotal === 0 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setDeleteCounterpartyOpen(true)}
              >
                刪除對象
              </Button>
            )}
          </>
        )}
      </div>

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
        open={deleteCounterpartyOpen}
        title="刪除對象"
        message={`刪除「${person.displayName}」？`}
        confirmLabel="刪除"
        error={removeCounterparty.error}
        isPending={removeCounterparty.isPending}
        onConfirm={confirmCounterpartyDelete}
        onCancel={closeCounterpartyDelete}
      />
      <Dialog open={unlinkOpen} title={`解除和${person.displayName}的連動`} onClose={closeUnlink}>
        <div className={styles.confirmContent}>
          <p>名字和紀錄都會保留</p>
          <FormError error={unlink.error} />
          <div className={styles.dialogActions}>
            <Button
              type="button"
              variant="secondary"
              disabled={unlink.isPending}
              onClick={closeUnlink}
            >
              取消
            </Button>
            <Button type="button" disabled={unlink.isPending} onClick={confirmUnlink}>
              解除連動
            </Button>
          </div>
        </div>
      </Dialog>
      <NicknameDialog
        open={nicknameOpen}
        counterpartyId={counterpartyId}
        name={person.name}
        onClose={() => setNicknameOpen(false)}
      />
      <MergeDialog
        open={mergeOpen}
        counterpartyId={counterpartyId}
        onClose={() => setMergeOpen(false)}
      />
    </div>
  );
}
