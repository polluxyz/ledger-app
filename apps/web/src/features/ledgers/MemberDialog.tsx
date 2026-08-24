import { useState, type FormEvent } from 'react';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { MemberFields } from './MemberFields';
import { newParticipant } from './participant-draft';
import { useAddMember } from './use-members';
import styles from './MemberDialog.module.css';

interface MemberDialogProps {
  open: boolean;
  ledgerId: string;
  onClose: () => void;
}

/**
 * 加入一位成員。
 *
 * 欄位重用 Step 3 的 `MemberFields`——那正是當時把它從建立表單拆出來的理由
 * （見 `tasks/phase-2b-slice-2-plan.md` D10）。這裡只需要一列，所以不用
 * `LedgerParticipants` 那層清單。
 *
 * 送出失敗時彈窗不關：`USER_NOT_FOUND` 與 `ALREADY_MEMBER` 都是按下按鈕之後才發生的，
 * 關掉的話使用者只會看到「什麼都沒發生」。錯誤訊息由後端提供，前端不改寫。
 */
export function MemberDialog({ open, ledgerId, onClose }: MemberDialogProps) {
  if (!open) {
    return null;
  }
  return <MemberDialogForm ledgerId={ledgerId} onClose={onClose} />;
}

function MemberDialogForm({ ledgerId, onClose }: { ledgerId: string; onClose: () => void }) {
  const [draft, setDraft] = useState(() => newParticipant());
  const addMember = useAddMember(ledgerId);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    addMember.mutate({ email: draft.email.trim(), role: draft.role }, { onSuccess: onClose });
  }

  return (
    <Dialog open title="加入成員" onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate>
        <FormError error={addMember.error} />

        {/* 只有一列，所以不帶序號。角色一樣只給可編輯 / 唯讀——要給擁有者請在
            清單上明確變更角色（S6-D1），那才是移交擁有權該有的儀式。 */}
        <MemberFields value={draft} onChange={setDraft} disabled={addMember.isPending} />

        <p className={styles.hint}>對方需要已經註冊。還沒註冊的話，可以之後再加。</p>

        <Button type="submit" block disabled={addMember.isPending}>
          {addMember.isPending ? '加入中…' : '加入'}
        </Button>
      </form>
    </Dialog>
  );
}
