import { useMemo, useState } from 'react';
import type { Counterparty, LedgerSummary, Transaction } from '@ledger/shared';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { FormError } from '../../components/FormError';
import { getAvatarLabels } from '../../lib/avatar-labels';
import { formatDate, formatMoney } from '../../lib/format';
import { useCurrentUser } from '../auth/use-current-user';
import { useLedgerGroups } from '../ledger-people/use-ledger-pointers';
import { isLedgerWritable, useLedgers } from '../ledgers/use-ledgers';
import { SettlementForm } from '../settlements/SettlementForm';
import { useDeleteSettlement, useLedgerSettlementPages } from '../settlements/use-settlements';
import { AnimatedDisclosure } from './AnimatedDisclosure';
import { DebtEntriesList } from './DebtEntriesList';
import rowStyles from './DebtRow.module.css';
import { MiniOweArrow } from './MiniOweArrow';
import { useCounterparties, useCounterpartyEntryPages } from './use-debts';
import styles from './DebtHistoryView.module.css';

interface DebtHistoryViewProps {
  ledger: LedgerSummary;
  onEditSplit: (splitId: string) => void;
}

/** 借還歷史分成個人往來與共享結清兩段，分組和紀錄範圍都由 API 回應決定。 */
export function DebtHistoryView({ onEditSplit }: DebtHistoryViewProps) {
  const counterparties = useCounterparties({ hasHistory: true });
  const ledgerGroups = useLedgerGroups({ hasSettlements: true });
  const ledgers = useLedgers(true);
  const [expandedPersonId, setExpandedPersonId] = useState<string | null>(null);
  const [expandedLedgerId, setExpandedLedgerId] = useState<string | null>(null);

  const counterpartyItems = useMemo(
    () => counterparties.data?.items ?? [],
    [counterparties.data?.items],
  );
  const historyGroups = ledgerGroups.data ?? [];
  const avatarLabels = useMemo(
    () => getAvatarLabels(['我', ...counterpartyItems.map((person) => person.displayName)]),
    [counterpartyItems],
  );
  const ledgersById = useMemo(
    () => new Map((ledgers.data ?? []).map((item) => [item.id, item])),
    [ledgers.data],
  );
  const writableLedgerIds = useMemo(
    () => new Set((ledgers.data ?? []).filter(isLedgerWritable).map((item) => item.id)),
    [ledgers.data],
  );

  if (counterparties.isLoading || ledgerGroups.isLoading || ledgers.isLoading) {
    return <p className={styles.status}>載入中…</p>;
  }

  const hasPersonal = counterpartyItems.length > 0;
  const hasShared = historyGroups.length > 0;

  if (!hasPersonal && !hasShared) {
    return (
      <>
        {counterparties.error && <FormError error={counterparties.error} />}
        {ledgerGroups.error && <FormError error={ledgerGroups.error} />}
        {ledgers.error && <FormError error={ledgers.error} />}
        <p className={styles.empty}>沒有歷史紀錄</p>
      </>
    );
  }

  return (
    <div className={styles.view}>
      {counterparties.error && <FormError error={counterparties.error} />}
      {ledgerGroups.error && <FormError error={ledgerGroups.error} />}
      {ledgers.error && <FormError error={ledgers.error} />}

      {hasPersonal && (
        <section className={styles.section} aria-labelledby="debt-history-personal-heading">
          <h3 id="debt-history-personal-heading" className={styles.heading}>
            個人往來
          </h3>
          <ul className={styles.list}>
            {counterpartyItems.map((person) => {
              const expanded = expandedPersonId === person.id;
              const detailsId = 'history-person-' + person.id;

              return (
                <li key={person.id} className={styles.item}>
                  <button
                    type="button"
                    className={styles.row}
                    aria-expanded={expanded}
                    aria-controls={detailsId}
                    onClick={() => setExpandedPersonId(expanded ? null : person.id)}
                  >
                    <span className={styles.name}>{person.displayName}</span>
                  </button>
                  <AnimatedDisclosure id={detailsId} open={expanded}>
                    <PersonHistoryDetail
                      person={person}
                      avatarLabels={avatarLabels}
                      writableLedgerIds={writableLedgerIds}
                      onEditSplit={onEditSplit}
                    />
                  </AnimatedDisclosure>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {hasShared && (
        <section className={styles.section} aria-labelledby="debt-history-shared-heading">
          <h3 id="debt-history-shared-heading" className={styles.heading}>
            共享帳本
          </h3>
          <ul className={styles.list}>
            {historyGroups.map((group) => {
              const expanded = expandedLedgerId === group.ledger.id;
              const detailsId = 'history-ledger-' + group.ledger.id;

              return (
                <li key={group.ledger.id} className={styles.item}>
                  <button
                    type="button"
                    className={styles.row}
                    aria-expanded={expanded}
                    aria-controls={detailsId}
                    onClick={() => setExpandedLedgerId(expanded ? null : group.ledger.id)}
                  >
                    <span className={styles.name}>{group.ledger.name}</span>
                  </button>
                  <AnimatedDisclosure id={detailsId} open={expanded}>
                    <LedgerHistoryDetail
                      ledgerId={group.ledger.id}
                      ledger={ledgersById.get(group.ledger.id)}
                    />
                  </AnimatedDisclosure>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function PersonHistoryDetail({
  person,
  avatarLabels,
  writableLedgerIds,
  onEditSplit,
}: {
  person: Counterparty;
  avatarLabels: ReadonlyMap<string, string>;
  writableLedgerIds: ReadonlySet<string>;
  onEditSplit: (splitId: string) => void;
}) {
  const entriesQuery = useCounterpartyEntryPages(person.id, 'history');

  if (entriesQuery.isLoading) {
    return <p className={styles.status}>載入中…</p>;
  }
  if (entriesQuery.error) {
    return <FormError error={entriesQuery.error} />;
  }

  const entries = entriesQuery.data?.pages.flatMap((page) => page.items) ?? [];
  if (entries.length === 0) {
    return <p className={styles.empty}>沒有歷史紀錄</p>;
  }

  return (
    <div className={styles.personHistoryDetail}>
      <DebtEntriesList
        entries={entries}
        balance={person.balance}
        displayName={person.displayName}
        avatarLabels={avatarLabels}
        editable
        writableLedgerIds={writableLedgerIds}
        onEditSplit={onEditSplit}
      />
      {entriesQuery.hasNextPage && (
        <div className={styles.loadMore}>
          <Button
            type="button"
            variant="secondary"
            disabled={entriesQuery.isFetchingNextPage}
            onClick={() => void entriesQuery.fetchNextPage()}
          >
            {entriesQuery.isFetchingNextPage ? '載入中…' : '載入更多'}
          </Button>
        </div>
      )}
    </div>
  );
}

function LedgerHistoryDetail({
  ledgerId,
  ledger,
}: {
  ledgerId: string;
  ledger: LedgerSummary | undefined;
}) {
  const settlementsQuery = useLedgerSettlementPages(ledgerId);
  const deleteSettlement = useDeleteSettlement(ledgerId);
  const currentUser = useCurrentUser();
  const [editingSettlementId, setEditingSettlementId] = useState<string | null>(null);
  const [revokeSettlementId, setRevokeSettlementId] = useState<string | null>(null);
  const settlements = useMemo(
    () => settlementsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [settlementsQuery.data?.pages],
  );
  const currentUserId = currentUser.data?.id;
  const avatarLabels = useMemo(
    () =>
      getAvatarLabels([
        '我',
        ...settlements.flatMap((transaction) => {
          const settlement = transaction.settlement!;
          return [
            settlement.from.userId === currentUserId ? '我' : settlement.from.name,
            settlement.to.userId === currentUserId ? '我' : settlement.to.name,
          ];
        }),
      ]),
    [currentUserId, settlements],
  );
  const canWrite = isLedgerWritable(ledger);

  if (settlementsQuery.isLoading) {
    return <p className={styles.status}>載入中…</p>;
  }
  if (settlementsQuery.error) {
    return <FormError error={settlementsQuery.error} />;
  }

  function confirmRevoke() {
    if (revokeSettlementId === null) {
      return;
    }
    deleteSettlement.mutate(revokeSettlementId, {
      onSuccess: () => setRevokeSettlementId(null),
    });
  }

  return (
    <>
      <div className={styles.ledgerHistoryList}>
        {settlements.length === 0 ? (
          <p className={styles.empty}>沒有歷史紀錄</p>
        ) : (
          <ul className={styles.settlementList}>
            {settlements.map((transaction) => {
              const settlement = transaction.settlement!;
              const from = settlement.from.userId === currentUserId ? '我' : settlement.from.name;
              const to = settlement.to.userId === currentUserId ? '我' : settlement.to.name;
              const isEditing = editingSettlementId === settlement.id;

              return (
                <SettlementHistoryRow
                  key={transaction.id}
                  transaction={transaction}
                  ledger={ledger}
                  from={from}
                  to={to}
                  avatarLabels={avatarLabels}
                  canWrite={canWrite}
                  isEditing={isEditing}
                  onEdit={() => setEditingSettlementId(settlement.id)}
                  onCancelEdit={() => setEditingSettlementId(null)}
                  onRevoke={() => {
                    setEditingSettlementId(null);
                    deleteSettlement.reset();
                    setRevokeSettlementId(settlement.id);
                  }}
                />
              );
            })}
          </ul>
        )}
        {settlementsQuery.hasNextPage && (
          <div className={styles.loadMore}>
            <Button
              type="button"
              variant="secondary"
              disabled={settlementsQuery.isFetchingNextPage}
              onClick={() => void settlementsQuery.fetchNextPage()}
            >
              {settlementsQuery.isFetchingNextPage ? '載入中…' : '載入更多'}
            </Button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={revokeSettlementId !== null}
        title="撤銷這筆？"
        message=""
        confirmLabel="撤銷"
        error={deleteSettlement.error}
        isPending={deleteSettlement.isPending}
        onConfirm={confirmRevoke}
        onCancel={() => {
          setRevokeSettlementId(null);
          deleteSettlement.reset();
        }}
      />
    </>
  );
}

function SettlementHistoryRow({
  transaction,
  ledger,
  from,
  to,
  avatarLabels,
  canWrite,
  isEditing,
  onEdit,
  onCancelEdit,
  onRevoke,
}: {
  transaction: Transaction;
  ledger: LedgerSummary | undefined;
  from: string;
  to: string;
  avatarLabels: ReadonlyMap<string, string>;
  canWrite: boolean;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onRevoke: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const settlement = transaction.settlement!;

  return (
    <li className={rowStyles.item}>
      <div className={rowStyles.row + ' ' + styles.settlementRow}>
        <time className={rowStyles.date} dateTime={transaction.date}>
          {formatDate(transaction.date).slice(5)}
        </time>
        <span className={rowStyles.arrow}>
          <MiniOweArrow
            from={from}
            fromLabel={avatarLabels.get(from)}
            to={to}
            toLabel={avatarLabels.get(to)}
          />
        </span>
        <span className={rowStyles.spacer} />
        <span className={rowStyles.amount}>
          <span className={rowStyles.amountText}>{formatMoney(transaction.amount)}</span>
        </span>
        {canWrite && (
          <span className={rowStyles.actions + ' ' + styles.menuWrap}>
            <button
              type="button"
              className={styles.menuButton}
              aria-label="更多操作"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <MoreHorizontal size={18} strokeWidth={2} />
            </button>
            {menuOpen && (
              <div className={styles.menu} role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={() => {
                    setMenuOpen(false);
                    onEdit();
                  }}
                >
                  修改
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={() => {
                    setMenuOpen(false);
                    onRevoke();
                  }}
                >
                  撤銷
                </button>
              </div>
            )}
          </span>
        )}
      </div>
      <AnimatedDisclosure id={'settlement-edit-' + settlement.id} open={isEditing}>
        {isEditing && ledger && (
          <div className={styles.settlementForm}>
            <SettlementForm
              ledger={ledger}
              transaction={transaction}
              showDeleteButton={false}
              onSaved={onCancelEdit}
              onDeleted={onCancelEdit}
            />
            <div className={styles.formActions}>
              <Button type="button" variant="secondary" onClick={onCancelEdit}>
                取消
              </Button>
            </div>
          </div>
        )}
      </AnimatedDisclosure>
    </li>
  );
}
