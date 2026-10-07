import { useMemo, useState } from 'react';
import type { Counterparty, LedgerMemberInfo } from '@ledger/shared';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { TextField } from '../../components/TextField';
import { useCounterparties } from '../debts/use-debts';
import { useCreateLedgerPerson } from '../ledger-people/use-ledger-people';
import { useLedgerGroups } from '../ledger-people/use-ledger-pointers';
import { useAddMember } from './use-members';
import styles from './AddCounterpartyMemberDialog.module.css';

interface AddCounterpartyMemberDialogProps {
  ledgerId: string;
  ledgerName: string;
  members: LedgerMemberInfo[];
  onClose: () => void;
  onAddByEmail: () => void;
}

/**
 * 從我的對象加入帳本。既有成員與有效指向都由 API 資料比對，搜尋結果不會重複列出。
 */
export function AddCounterpartyMemberDialog({
  ledgerId,
  ledgerName,
  members,
  onClose,
  onAddByEmail,
}: AddCounterpartyMemberDialogProps) {
  const [query, setQuery] = useState('');
  const [inviteTarget, setInviteTarget] = useState<Counterparty | null>(null);
  const counterparties = useCounterparties({ q: query.trim() || undefined, limit: 100 });
  const groups = useLedgerGroups();
  const createPerson = useCreateLedgerPerson(ledgerId);
  const addMember = useAddMember(ledgerId);
  const ledgerGroup = groups.data?.find((group) => group.ledger.id === ledgerId);
  const memberUserIds = useMemo(() => new Set(members.map((member) => member.userId)), [members]);
  const pointedCounterpartyIds = useMemo(
    () =>
      new Set(
        ledgerGroup?.people.flatMap(({ pointer }) =>
          pointer.counterpartyId === null ? [] : [pointer.counterpartyId],
        ) ?? [],
      ),
    [ledgerGroup],
  );
  const candidates = (counterparties.data?.items ?? []).filter(
    (counterparty) =>
      !(counterparty.link !== null && memberUserIds.has(counterparty.link.userId)) &&
      !pointedCounterpartyIds.has(counterparty.id),
  );
  const error = createPerson.error ?? addMember.error;
  const isPending = addMember.isPending || createPerson.isPending;
  const dataReady = groups.data !== undefined && !counterparties.isLoading;

  function selectCounterparty(counterparty: Counterparty) {
    createPerson.reset();
    addMember.reset();
    if (counterparty.link !== null) {
      setInviteTarget(counterparty);
      return;
    }

    createPerson.mutate(
      { name: counterparty.displayName, counterpartyId: counterparty.id },
      { onSuccess: onClose },
    );
  }

  function addNameOnly() {
    if (!inviteTarget || isPending) return;
    createPerson.mutate(
      { name: inviteTarget.displayName, counterpartyId: inviteTarget.id },
      { onSuccess: onClose },
    );
  }

  function invite() {
    if (!inviteTarget || isPending) return;
    addMember.mutate({ counterpartyId: inviteTarget.id, role: 'EDITOR' }, { onSuccess: onClose });
  }

  function close() {
    if (isPending) return;
    onClose();
  }

  function addByEmail() {
    if (isPending) return;
    onClose();
    onAddByEmail();
  }

  return (
    <Dialog open title="新增對象" onClose={close}>
      {inviteTarget ? (
        <div className={styles.invite}>
          <FormError error={error} />
          <p>
            是否將{inviteTarget.displayName}邀請至「{ledgerName}」共享帳本？
          </p>
          <div className={styles.actions}>
            <Button variant="secondary" disabled={isPending} onClick={addNameOnly}>
              只加名字
            </Button>
            <Button disabled={isPending} onClick={invite}>
              {addMember.isPending ? '邀請中…' : '邀請'}
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.body}>
          <FormError error={error ?? counterparties.error ?? groups.error} />
          <TextField
            label="搜尋對象"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
          />

          <ul className={styles.results} aria-label="對象搜尋結果">
            {dataReady &&
              candidates.map((counterparty) => (
                <li className={styles.result} key={counterparty.id}>
                  <button
                    type="button"
                    className={styles.select}
                    disabled={isPending}
                    onClick={() => selectCounterparty(counterparty)}
                  >
                    {counterparty.displayName}
                  </button>
                </li>
              ))}
            <li className={styles.result}>
              <button
                type="button"
                className={styles.select}
                disabled={isPending}
                onClick={addByEmail}
              >
                用 email 新增
              </button>
            </li>
          </ul>
        </div>
      )}
    </Dialog>
  );
}
