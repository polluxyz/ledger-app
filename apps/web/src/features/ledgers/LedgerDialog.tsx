import { useState, type FormEvent } from 'react';
import type { LedgerKind } from '@ledger/shared';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { TextField } from '../../components/TextField';
import { ApiError } from '../../lib/api-client';
import { LedgerParticipants } from './LedgerParticipants';
import { newParticipant, type MemberDraft } from './participant-draft';
import { useCreateLedger } from './use-ledgers';
import { useAddMemberTo } from './use-members';
import styles from './LedgerDialog.module.css';

interface LedgerDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 建立帳本的表單彈窗。
 *
 * 由上到下：名稱 → 帳本類型 → （選共享才展開的）參與者 → 是否連動帳戶。
 * 一頁到底，不做兩步精靈——兩組選擇還撐不起一個「下一步」。
 *
 * `kind` 與 `tracksBalance` 都是**建立後不可變更**的，兩組下面各寫明這件事。
 */
export function LedgerDialog({ open, onClose }: LedgerDialogProps) {
  if (!open) {
    return null;
  }
  return <LedgerDialogForm onClose={onClose} />;
}

function LedgerDialogForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LedgerKind>('PERSONAL');
  const [tracksBalance, setTracksBalance] = useState(true);
  const [participants, setParticipants] = useState<MemberDraft[]>([newParticipant()]);

  // 帳本一旦建立就不再重建。使用者修正 email 後按第二次送出時，只補送失敗的成員。
  const [createdLedgerId, setCreatedLedgerId] = useState<string | null>(null);

  const createLedger = useCreateLedger();
  const addMember = useAddMemberTo();
  const isPending = createLedger.isPending || addMember.isPending;

  /**
   * 逐筆加入成員，回傳每一列更新後的狀態（成功的清掉 error，失敗的填上原因）。
   *
   * 一筆一筆送而非並行：後端對同一本帳本的成員有唯一性約束，並行送出遇到重複時
   * 錯誤會落在難以預期的那一筆上。這裡最多幾個人，順序送的成本可以忽略。
   */
  async function addAll(ledgerId: string, targets: MemberDraft[]): Promise<MemberDraft[]> {
    const results: MemberDraft[] = [];
    for (const participant of targets) {
      try {
        await addMember.mutateAsync({
          ledgerId,
          email: participant.email.trim(),
          role: participant.role,
        });
        results.push({ ...participant, error: undefined });
      } catch (error) {
        results.push({
          ...participant,
          error: error instanceof ApiError ? error.message : '無法連線到伺服器，請稍後再試。',
        });
      }
    }
    return results;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // 空白列不算數——使用者按了「再加一位」卻沒填，不該因此送出一個空的請求。
    const filled = participants.filter((participant) => participant.email.trim() !== '');

    let ledgerId = createdLedgerId;
    if (ledgerId === null) {
      const created = await createLedger.mutateAsync({ name, kind, tracksBalance });
      ledgerId = created.id;
      setCreatedLedgerId(ledgerId);
    }

    if (kind === 'PERSONAL' || filled.length === 0) {
      onClose();
      return;
    }

    const results = await addAll(ledgerId, filled);
    const failed = results.filter((result) => result.error !== undefined);

    if (failed.length === 0) {
      onClose();
      return;
    }

    // **帳本照建，彈窗留著。** 前端不做「補償刪除」——那是在前端實作一致性邏輯。
    // 只留下失敗的那幾列讓使用者修正重試；成功的已經加進去了，不重送。
    setParticipants(failed);
  }

  return (
    <Dialog open title="建立帳本" onClose={onClose}>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <FormError error={createLedger.error} />

        {createdLedgerId !== null && (
          <p className={styles.notice} role="status">
            帳本已經建立，只剩下面這幾位還沒加入。修正後再送出一次即可。
          </p>
        )}

        <TextField
          label="名稱"
          value={name}
          required
          maxLength={100}
          disabled={createdLedgerId !== null}
          onChange={(event) => setName(event.target.value)}
        />

        <fieldset className={styles.choice}>
          <legend className={styles.legend}>帳本類型</legend>
          <Radio
            name="kind"
            checked={kind === 'PERSONAL'}
            disabled={createdLedgerId !== null}
            label="私人：只有自己看得到"
            onSelect={() => setKind('PERSONAL')}
          />
          <Radio
            name="kind"
            checked={kind === 'SHARED'}
            disabled={createdLedgerId !== null}
            label="共享：和別人一起記"
            onSelect={() => setKind('SHARED')}
          />
          <p className={styles.hint}>
            建立後不可更改。私人帳本無法加入成員，共享帳本也不會因為其他人退出而變回私人。
          </p>
        </fieldset>

        {kind === 'SHARED' && (
          <LedgerParticipants
            value={participants}
            onChange={setParticipants}
            disabled={isPending}
          />
        )}

        <fieldset className={styles.choice}>
          <legend className={styles.legend}>與我的帳戶餘額</legend>
          <Radio
            name="tracksBalance"
            checked={tracksBalance}
            disabled={createdLedgerId !== null}
            label="連動：記帳時扣減我的帳戶"
            onSelect={() => setTracksBalance(true)}
          />
          <Radio
            name="tracksBalance"
            checked={!tracksBalance}
            disabled={createdLedgerId !== null}
            label="不連動：出遊分帳、社團公款這類「錢不是我的」帳本"
            onSelect={() => setTracksBalance(false)}
          />
          <p className={styles.hint}>建立後不可更改。事後改會讓餘額突然跳動。</p>
        </fieldset>

        <Button type="submit" block disabled={isPending}>
          {isPending ? '建立中…' : createdLedgerId !== null ? '重試' : '建立'}
        </Button>
      </form>
    </Dialog>
  );
}

/** 表單裡的單選鈕。標籤包住 input，點文字也能選。 */
function Radio({
  name,
  checked,
  label,
  disabled,
  onSelect,
}: {
  name: string;
  checked: boolean;
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <label className={styles.radio}>
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onSelect} />
      {label}
    </label>
  );
}
