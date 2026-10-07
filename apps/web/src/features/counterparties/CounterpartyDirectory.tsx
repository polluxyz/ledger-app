import { useQueries } from '@tanstack/react-query';
import { useState } from 'react';
import type { Counterparty, Paginated } from '@ledger/shared';
import { Button } from '../../components/Button';
import { FormError } from '../../components/FormError';
import { apiRequest } from '../../lib/api-client';
import { COUNTERPARTIES_KEY, useCounterparties } from '../debts/use-debts';
import { useLedgerGroups } from '../ledger-people/use-ledger-pointers';
import { useCancelLinkInvite, useOutgoingInvites } from '../linking/use-linking';
import { LedgerGroupSection } from './LedgerGroupSection';
import { PointerDialog, type PointerDialogTarget } from './PointerDialog';
import styles from './CounterpartyDirectory.module.css';

const COUNTERPARTY_PAGE_SIZE = 100;

interface CounterpartyDirectoryProps {
  q: string;
  /** 清單列只負責回報身分，右側欄的開啟由頁面控制。 */
  onSelectCounterparty: (counterpartyId: string) => void;
}

/**
 * 對象與送出的連動邀請分開呈現；已連動、未連動只是清單分組，不在這裡判斷任何帳務狀態。
 * 列上只放名字，餘額留在往來帳，避免人名清單被金額干擾。
 */
export function CounterpartyDirectory({ q, onSelectCounterparty }: CounterpartyDirectoryProps) {
  const counterparties = useCounterparties({ q, limit: 100 });
  const allCounterparties = useCounterparties({ limit: COUNTERPARTY_PAGE_SIZE });
  const additionalCounterpartyPages = useQueries({
    queries: Array.from(
      {
        length: Math.max(
          0,
          Math.ceil((allCounterparties.data?.total ?? 0) / COUNTERPARTY_PAGE_SIZE) - 1,
        ),
      },
      (_, index) => {
        const page = index + 2;
        return {
          queryKey: [...COUNTERPARTIES_KEY, 'list', { page, limit: COUNTERPARTY_PAGE_SIZE }],
          queryFn: () =>
            apiRequest<Paginated<Counterparty>>(
              `/counterparties?page=${page}&limit=${COUNTERPARTY_PAGE_SIZE}`,
            ),
        };
      },
    ),
  });
  const ledgerGroups = useLedgerGroups();
  const outgoingInvites = useOutgoingInvites();
  const cancelInvite = useCancelLinkInvite();
  const [pointerTarget, setPointerTarget] = useState<PointerDialogTarget | null>(null);
  const items = counterparties.data?.items ?? [];
  const pointerCounterparties = [
    ...(allCounterparties.data?.items ?? []),
    ...additionalCounterpartyPages.flatMap((page) => page.data?.items ?? []),
  ];
  const pointerCounterpartyError =
    allCounterparties.error ?? additionalCounterpartyPages.find((page) => page.error)?.error;
  const linked = items.filter((counterparty) => counterparty.link !== null);
  const unlinked = items.filter((counterparty) => counterparty.link === null);

  return (
    <div className={styles.directory}>
      <FormError
        error={
          counterparties.error ??
          pointerCounterpartyError ??
          ledgerGroups.error ??
          outgoingInvites.error ??
          cancelInvite.error
        }
      />

      {items.length > 0 && (
        <div className={styles.groups}>
          <CounterpartyGroup
            title={`已連動（${linked.length}）`}
            items={linked}
            linked
            onSelectCounterparty={onSelectCounterparty}
          />
          <CounterpartyGroup
            title={`未連動（${unlinked.length}）`}
            items={unlinked}
            linked={false}
            onSelectCounterparty={onSelectCounterparty}
          />
        </div>
      )}

      {(ledgerGroups.data?.length ?? 0) > 0 && (
        <div className={styles.ledgerGroups}>
          {ledgerGroups.data?.map((group) => (
            <LedgerGroupSection
              key={group.ledger.id}
              group={group}
              counterparties={pointerCounterparties}
              onSetPointer={(person) =>
                setPointerTarget({
                  ledgerId: group.ledger.id,
                  personId: person.person.id,
                  personName: person.person.name,
                  counterpartyId: person.pointer.counterpartyId,
                })
              }
            />
          ))}
        </div>
      )}

      {!counterparties.isLoading &&
        !counterparties.error &&
        items.length === 0 &&
        !ledgerGroups.isLoading &&
        (ledgerGroups.data?.length ?? 0) === 0 && <p className={styles.empty}>還沒有對象</p>}

      {(outgoingInvites.data?.length ?? 0) > 0 && (
        <section className={styles.invites} aria-labelledby="outgoing-invites-title">
          <h3 className={styles.heading} id="outgoing-invites-title">
            邀請中
          </h3>
          <ul className={styles.inviteList}>
            {outgoingInvites.data?.map((invite) => (
              <li className={styles.inviteRow} key={invite.id}>
                <span className={styles.inviteName}>
                  {invite.counterpart.email ?? invite.counterpart.name ?? ''}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  className={styles.cancelButton}
                  disabled={cancelInvite.isPending && cancelInvite.variables === invite.id}
                  onClick={() => cancelInvite.mutate(invite.id)}
                >
                  取消邀請
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(counterparties.data?.total ?? 0) > 100 && (
        <p className={styles.limitNote}>用搜尋縮小範圍</p>
      )}

      <PointerDialog
        target={pointerTarget}
        counterparties={pointerCounterparties}
        onClose={() => setPointerTarget(null)}
      />
    </div>
  );
}

function CounterpartyGroup({
  title,
  items,
  linked,
  onSelectCounterparty,
}: {
  title: string;
  items: Counterparty[];
  linked: boolean;
  onSelectCounterparty: (counterpartyId: string) => void;
}) {
  return (
    <section
      className={styles.group}
      aria-labelledby={`counterparty-group-${linked ? 'linked' : 'unlinked'}`}
    >
      <h3 className={styles.heading} id={`counterparty-group-${linked ? 'linked' : 'unlinked'}`}>
        {title}
      </h3>
      <ul className={styles.list}>
        {items.map((counterparty) => (
          <li className={styles.item} key={counterparty.id}>
            <button
              className={styles.row}
              type="button"
              onClick={() => onSelectCounterparty(counterparty.id)}
            >
              <span className={styles.nameGroup}>
                <span className={styles.name}>
                  {linked
                    ? (counterparty.link?.userName ?? counterparty.displayName)
                    : (counterparty.name ?? counterparty.displayName)}
                </span>
                {linked && counterparty.name !== null && (
                  <span className={styles.nickname}>（{counterparty.name}）</span>
                )}
                {linked && <span className={styles.linkBadge}>連動</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
