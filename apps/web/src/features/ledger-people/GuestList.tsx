import { useState, type FormEvent, type ReactNode } from 'react';
import type { LedgerPerson } from '@ledger/shared';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { TextField } from '../../components/TextField';
import {
  useCreateLedgerPerson,
  useDeleteLedgerPerson,
  useLedgerPeople,
  useRenameLedgerPerson,
} from './use-ledger-people';
import styles from './GuestList.module.css';

export interface GuestListControls {
  virtualMembers: LedgerPerson[];
  openCreate: () => void;
  openRename: (person: LedgerPerson) => void;
  openDelete: (person: LedgerPerson) => void;
}

interface GuestListProps {
  ledgerId: string;
  /** 角色與封存狀態由帳本頁決定；後端仍負責實際授權。 */
  canManage: boolean;
  /** 私人帳本沒有 people 端點，因此只停用查詢，不改變同一個清單的呈現介面。 */
  enabled?: boolean;
  children: (controls: GuestListControls) => ReactNode;
}

/**
 * 管理帳本裡的虛擬成員，並把名單與操作交給帳本頁的單一成員清單呈現。
 * 名字會出現在交易與結清回應；新增、改名、刪除後由 hook 一併刷新相關資料。
 */
export function GuestList({ ledgerId, canManage, enabled = true, children }: GuestListProps) {
  const people = useLedgerPeople(ledgerId, enabled);
  const createPerson = useCreateLedgerPerson(ledgerId);
  const renamePerson = useRenameLedgerPerson(ledgerId);
  const deletePerson = useDeleteLedgerPerson(ledgerId);
  const [formOpen, setFormOpen] = useState(false);
  const [formPerson, setFormPerson] = useState<LedgerPerson | null>(null);
  const [name, setName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<LedgerPerson | null>(null);

  const virtualMembers = people.data?.filter((person) => person.status === 'GUEST') ?? [];
  const formPending = createPerson.isPending || renamePerson.isPending;
  const formError = formPerson ? renamePerson.error : createPerson.error;

  function openCreate() {
    if (!canManage) return;
    createPerson.reset();
    renamePerson.reset();
    setFormPerson(null);
    setName('');
    setFormOpen(true);
  }

  function openRename(person: LedgerPerson) {
    if (!canManage) return;
    createPerson.reset();
    renamePerson.reset();
    setFormPerson(person);
    setName(person.name);
    setFormOpen(true);
  }

  function closeForm() {
    if (formPending) return;
    setFormOpen(false);
  }

  function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || formPending) return;

    if (formPerson) {
      renamePerson.mutate(
        { personId: formPerson.id, input: { name: trimmedName } },
        { onSuccess: () => setFormOpen(false) },
      );
      return;
    }

    createPerson.mutate({ name: trimmedName }, { onSuccess: () => setFormOpen(false) });
  }

  function openDelete(person: LedgerPerson) {
    if (!canManage) return;
    deletePerson.reset();
    setDeleteTarget(person);
  }

  function closeDelete() {
    if (deletePerson.isPending) return;
    setDeleteTarget(null);
    deletePerson.reset();
  }

  function confirmDelete() {
    if (!deleteTarget || deletePerson.isPending) return;
    deletePerson.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
  }

  return (
    <>
      {children({ virtualMembers, openCreate, openRename, openDelete })}
      {people.error && <FormError error={people.error} />}

      <Dialog open={formOpen} title={formPerson ? '改名' : '新增虛擬成員'} onClose={closeForm}>
        <form className={styles.form} onSubmit={submitForm} noValidate>
          <FormError error={formError} />
          <TextField
            label="名字"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={50}
            required
            disabled={formPending}
          />
          <div className={styles.formActions}>
            <Button variant="secondary" onClick={closeForm} disabled={formPending}>
              取消
            </Button>
            <Button type="submit" disabled={formPending || !name.trim()}>
              {formPending ? '儲存中…' : formPerson ? '儲存' : '新增'}
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="刪除虛擬成員"
        message={'確定刪除「' + (deleteTarget?.name ?? '') + '」？'}
        confirmLabel="刪除"
        error={deletePerson.error}
        isPending={deletePerson.isPending}
        onConfirm={confirmDelete}
        onCancel={closeDelete}
      />
    </>
  );
}
