import { useState, type FormEvent } from 'react';
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

interface GuestListProps {
  ledgerId: string;
  /** 角色與封存狀態由帳本頁決定；後端仍負責實際授權。 */
  canManage: boolean;
}

/** 共享帳本的非成員名單；只顯示名字，管理操作共用新增／改名彈窗。 */
export function GuestList({ ledgerId, canManage }: GuestListProps) {
  const people = useLedgerPeople(ledgerId);
  const createPerson = useCreateLedgerPerson(ledgerId);
  const renamePerson = useRenameLedgerPerson(ledgerId);
  const deletePerson = useDeleteLedgerPerson(ledgerId);
  const [formOpen, setFormOpen] = useState(false);
  const [formPerson, setFormPerson] = useState<LedgerPerson | null>(null);
  const [name, setName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<LedgerPerson | null>(null);

  const guests = people.data?.filter((person) => person.status === 'GUEST') ?? [];
  const formPending = createPerson.isPending || renamePerson.isPending;
  const formError = formPerson ? renamePerson.error : createPerson.error;

  function openCreate() {
    createPerson.reset();
    renamePerson.reset();
    setFormPerson(null);
    setName('');
    setFormOpen(true);
  }

  function openRename(person: LedgerPerson) {
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
    <section className={styles.section} aria-labelledby="guest-list-heading">
      <div className={styles.heading}>
        <h3 id="guest-list-heading" className={styles.title}>
          非成員
        </h3>
        {canManage && (
          <Button variant="secondary" onClick={openCreate}>
            新增
          </Button>
        )}
      </div>

      {guests.length > 0 && (
        <ul className={styles.list}>
          {guests.map((person) => (
            <li key={person.id} className={styles.item}>
              <div className={styles.row}>
                <span className={styles.name}>{person.name}</span>
                {canManage && (
                  <div className={styles.actions}>
                    <Button
                      variant="secondary"
                      aria-label={`改名${person.name}`}
                      onClick={() => openRename(person)}
                    >
                      改名
                    </Button>
                    <Button
                      variant="secondary"
                      className={styles.deleteButton}
                      aria-label={`刪除${person.name}`}
                      onClick={() => openDelete(person)}
                    >
                      刪除
                    </Button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {people.error && <FormError error={people.error} />}

      <Dialog open={formOpen} title={formPerson ? '改名' : '新增非成員'} onClose={closeForm}>
        <form className={styles.form} onSubmit={submitForm}>
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
        title="刪除非成員"
        message={`確定刪除「${deleteTarget?.name ?? ''}」？`}
        confirmLabel="刪除"
        error={deletePerson.error}
        isPending={deletePerson.isPending}
        onConfirm={confirmDelete}
        onCancel={closeDelete}
      />
    </section>
  );
}
