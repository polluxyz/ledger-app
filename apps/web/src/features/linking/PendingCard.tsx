import { useState, type ReactNode } from 'react';
import type {
  AcceptDebtProposalRequest,
  Counterparty,
  DebtEntryKind,
  DebtProposal,
  FriendRequest,
  LedgerSummary,
  Account,
} from '@ledger/shared';
import { Button } from '../../components/Button';
import { FormError } from '../../components/FormError';
import { Select } from '../../components/Select';
import { MergePromptDialog, MergePromptForm } from '../debts/MergePrompt';
import { useAccounts } from '../accounts/use-accounts';
import { useCounterparty } from '../debts/use-debts';
import { useActiveLedger } from '../ledgers/use-active-ledger';
import { useLedgers } from '../ledgers/use-ledgers';
import {
  useAcceptLinkInvite,
  useAcceptProposal,
  useDeclineLinkInvite,
  useDeclineProposal,
  useIncomingLinkInvites,
  useIncomingProposals,
  useMergePrompts,
} from './use-linking';
import { ApiError } from '../../lib/api-client';
import { formatDate, formatMoney } from '../../lib/format';
import styles from './PendingCard.module.css';

/**
 * 總覽只呈現 API 尚待處理的邀請、合併詢問與提議；查詢尚未完成或失敗時整張卡先隱去，
 * 免得首頁出現看似壞掉的錯誤區塊。卡片只在展開新增提議時預覽往來餘額，
 * 其餘資料與接受、拒絕結果都由既有 hooks 負責。
 */
export function PendingCard() {
  const invitesQuery = useIncomingLinkInvites();
  const mergePromptsQuery = useMergePrompts();
  const proposalsQuery = useIncomingProposals();
  const ledgersQuery = useLedgers();
  const accountsQuery = useAccounts();
  const { ledger: activeLedger } = useActiveLedger();
  const acceptLinkInvite = useAcceptLinkInvite();
  const declineLinkInvite = useDeclineLinkInvite();
  const acceptProposal = useAcceptProposal();
  const declineProposal = useDeclineProposal();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [mergeDialog, setMergeDialog] = useState<{
    counterpartyId: string;
    userName: string;
  } | null>(null);

  // 首次查詢失敗時保持總覽安靜；沒有可用資料也先不猜測目前是否真的沒有待確認。
  if (
    invitesQuery.isLoading ||
    mergePromptsQuery.isLoading ||
    proposalsQuery.isLoading ||
    invitesQuery.error ||
    mergePromptsQuery.error ||
    proposalsQuery.error ||
    invitesQuery.data === undefined ||
    mergePromptsQuery.data === undefined ||
    proposalsQuery.data === undefined
  ) {
    return null;
  }

  const proposals = proposalsQuery.data.items.map((proposal) => ({
    proposal,
    id: 'proposal-' + proposal.id,
  }));
  const rows: Array<{ id: string; node: ReactNode }> = [
    ...invitesQuery.data.map((request) => ({
      id: 'invite-' + request.id,
      node: (
        <InviteRow
          key={'invite-' + request.id}
          request={request}
          onAccept={(requestId) => acceptLinkInvite.mutateAsync(requestId)}
          onDecline={(requestId) => declineLinkInvite.mutateAsync(requestId)}
          onAccepted={(accepted) => {
            setExpandedId(null);
            if (accepted.askMerge) {
              setMergeDialog({
                counterpartyId: accepted.counterpartyId,
                userName: accepted.otherUser.name,
              });
            }
          }}
        />
      ),
    })),
    ...mergePromptsQuery.data.map((counterparty) => {
      const id = 'merge-prompt-' + counterparty.id;
      return {
        id,
        node: (
          <MergePromptRow
            key={id}
            counterparty={counterparty}
            expanded={expandedId === id}
            onToggle={() => setExpandedId((current) => (current === id ? null : id))}
            onDone={() => setExpandedId(null)}
            onLater={() => setExpandedId(null)}
          />
        ),
      };
    }),
    ...proposals.map(({ proposal, id }) => ({
      id,
      node: (
        <ProposalRow
          key={id}
          proposal={proposal}
          expanded={expandedId === id}
          ledgers={ledgersQuery.data ?? []}
          ledgersLoading={ledgersQuery.isLoading}
          ledgersError={ledgersQuery.error}
          activeLedgerId={activeLedger?.id ?? null}
          accounts={accountsQuery.data ?? []}
          accountsLoading={accountsQuery.isLoading}
          accountsError={accountsQuery.error}
          onToggle={() => setExpandedId((current) => (current === id ? null : id))}
          onAccept={(proposalId, input) =>
            acceptProposal.mutateAsync({
              proposalId,
              ...(input === undefined ? {} : { input }),
            })
          }
          onDecline={(proposalId) => declineProposal.mutateAsync(proposalId)}
        />
      ),
    })),
  ];
  const pendingCount =
    invitesQuery.data.length + mergePromptsQuery.data.length + proposalsQuery.data.total;

  if (pendingCount === 0) {
    return null;
  }

  const visibleRows = showAll ? rows : rows.slice(0, 5);

  return (
    <section className={styles.card} aria-labelledby="pending-card-heading">
      <div className={styles.header}>
        <h2 className={styles.heading} id="pending-card-heading">
          待確認
        </h2>
        <span className={styles.count} aria-label={'共 ' + pendingCount + ' 筆待確認'}>
          {pendingCount}
        </span>
      </div>

      <ul className={styles.list}>
        {visibleRows.map((row) => (
          <li className={styles.listItem} key={row.id}>
            {row.node}
          </li>
        ))}
      </ul>

      {rows.length > 5 && (
        <Button
          type="button"
          className={styles.showAll}
          variant="secondary"
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? '收起' : '顯示全部'}
        </Button>
      )}
      {mergeDialog !== null && (
        <MergePromptDialog
          open
          counterpartyId={mergeDialog.counterpartyId}
          userName={mergeDialog.userName}
          onDone={() => setMergeDialog(null)}
          onLater={() => setMergeDialog(null)}
        />
      )}
    </section>
  );
}

function InviteRow({
  request,
  onAccept,
  onDecline,
  onAccepted,
}: {
  request: FriendRequest;
  onAccept: (requestId: string) => Promise<{
    counterpartyId: string;
    askMerge: boolean;
    otherUser: { id: string; name: string };
  }>;
  onDecline: (requestId: string) => Promise<unknown>;
  onAccepted: (accepted: {
    counterpartyId: string;
    askMerge: boolean;
    otherUser: { id: string; name: string };
  }) => void;
}) {
  const inviterName = request.counterpart.name ?? '對方';
  const [error, setError] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function accept() {
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await onAccept(request.id);
      onAccepted(result);
    } catch (acceptError) {
      setError(acceptError);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function decline() {
    setError(null);
    setIsSubmitting(true);
    try {
      await onDecline(request.id);
    } catch (declineError) {
      setError(declineError);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={styles.entry}>
      <div className={styles.entryTop}>
        <p className={styles.message}>
          <strong>{inviterName}</strong> 邀請你連動往來帳
        </p>
        <div className={styles.actions}>
          <Button
            type="button"
            className={styles.smallButton}
            variant="secondary"
            disabled={isSubmitting}
            onClick={() => void decline()}
          >
            拒絕
          </Button>
          <Button
            type="button"
            className={styles.smallButton}
            disabled={isSubmitting}
            onClick={() => void accept()}
          >
            接受
          </Button>
        </div>
      </div>
      <FormError error={error} />
    </div>
  );
}

/** 合併詢問沿用既有表單，讓接受後稍後處理的標記仍能在總覽回答。 */
function MergePromptRow({
  counterparty,
  expanded,
  onToggle,
  onDone,
  onLater,
}: {
  counterparty: Counterparty;
  expanded: boolean;
  onToggle: () => void;
  onDone: () => void;
  onLater: () => void;
}) {
  const userName = counterparty.link?.userName ?? counterparty.displayName;

  return (
    <div className={styles.entry}>
      <div className={styles.entryTop}>
        <p className={styles.message}>
          <strong>{userName}</strong> 已接受連動。之前有用別的名字記過他嗎？
        </p>
        {!expanded && (
          <Button
            type="button"
            className={styles.smallButton}
            aria-expanded={false}
            onClick={onToggle}
          >
            回答
          </Button>
        )}
      </div>
      {expanded && (
        <div className={styles.expansion}>
          <MergePromptForm counterpartyId={counterparty.id} onDone={onDone} onLater={onLater} />
        </div>
      )}
    </div>
  );
}

function ProposalRow({
  proposal,
  expanded,
  ledgers,
  ledgersLoading,
  ledgersError,
  activeLedgerId,
  accounts,
  accountsLoading,
  accountsError,
  onToggle,
  onAccept,
  onDecline,
}: {
  proposal: DebtProposal;
  expanded: boolean;
  ledgers: LedgerSummary[];
  ledgersLoading: boolean;
  ledgersError: unknown;
  activeLedgerId: string | null;
  accounts: Account[];
  accountsLoading: boolean;
  accountsError: unknown;
  onToggle: () => void;
  onAccept: (proposalId: string, input?: AcceptDebtProposalRequest) => Promise<unknown>;
  onDecline: (proposalId: string) => Promise<unknown>;
}) {
  const needsRecord = isRecordProposal(proposal);
  const counterpartyQuery = useCounterparty(
    expanded && needsRecord ? proposal.counterpartyId : null,
  );
  const [ledgerChoice, setLedgerChoice] = useState<string | null>(null);
  const [accountId, setAccountId] = useState('');
  const [doNotRecord, setDoNotRecord] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [conflictCode, setConflictCode] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableLedgers = ledgers.filter(
    (ledger) => (ledger.role === 'OWNER' || ledger.role === 'EDITOR') && ledger.archivedAt === null,
  );
  const selectedLedger =
    availableLedgers.find((ledger) => ledger.id === ledgerChoice) ??
    availableLedgers.find((ledger) => ledger.id === activeLedgerId) ??
    availableLedgers[0] ??
    null;
  const selectedLedgerId = selectedLedger?.id ?? '';
  const requiresAccount = selectedLedger?.tracksBalance === true;
  const acceptDisabled =
    isSubmitting ||
    (!doNotRecord &&
      (selectedLedgerId === '' || (requiresAccount && (accountsLoading || accountId === ''))));
  const conflictMessage =
    conflictCode === 'NOTHING_TO_REPAY'
      ? '你帳上目前兩清'
      : conflictCode === 'REPAYMENT_EXCEEDS_BALANCE'
        ? '超過你帳上的欠款'
        : null;
  const preview = getPreview(proposal, counterpartyQuery.data);

  async function handleAccept(input?: AcceptDebtProposalRequest) {
    setError(null);
    setConflictCode(null);
    setIsSubmitting(true);
    try {
      await onAccept(proposal.id, input);
    } catch (acceptError) {
      if (
        acceptError instanceof ApiError &&
        (acceptError.errorCode === 'NOTHING_TO_REPAY' ||
          acceptError.errorCode === 'REPAYMENT_EXCEEDS_BALANCE')
      ) {
        setConflictCode(acceptError.errorCode);
      } else {
        setError(acceptError);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDecline() {
    setError(null);
    setIsSubmitting(true);
    try {
      await onDecline(proposal.id);
    } catch (declineError) {
      setError(declineError);
    } finally {
      setIsSubmitting(false);
    }
  }

  function acceptRecordProposal() {
    if (doNotRecord) {
      void handleAccept({ record: null });
      return;
    }
    if (selectedLedgerId === '' || (requiresAccount && accountId === '')) {
      return;
    }
    void handleAccept({
      record: {
        ledgerId: selectedLedgerId,
        ...(requiresAccount ? { accountId } : {}),
      },
    });
  }

  return (
    <div className={styles.entry}>
      <div className={styles.entryTop}>
        <p className={styles.message}>{renderProposalSentence(proposal)}</p>
        {!expanded && (
          <div className={styles.actions}>
            <Button
              type="button"
              className={styles.smallButton}
              variant="secondary"
              disabled={isSubmitting}
              onClick={() => void handleDecline()}
            >
              拒絕
            </Button>
            {needsRecord ? (
              <Button
                type="button"
                className={styles.smallButton}
                disabled={isSubmitting}
                aria-expanded={false}
                onClick={onToggle}
              >
                接受
              </Button>
            ) : (
              <Button
                type="button"
                className={styles.smallButton}
                disabled={isSubmitting}
                onClick={() => void handleAccept()}
              >
                接受
              </Button>
            )}
          </div>
        )}
      </div>

      {expanded && needsRecord && (
        <div className={styles.expansion}>
          {preview && <p className={styles.preview}>{preview}</p>}

          <Select
            label="記在哪本帳本"
            value={selectedLedgerId}
            disabled={doNotRecord || ledgersLoading || availableLedgers.length === 0}
            onChange={(event) => {
              setLedgerChoice(event.target.value);
              setAccountId('');
            }}
          >
            {availableLedgers.length === 0 ? (
              <option value="">沒有可記帳的帳本</option>
            ) : (
              availableLedgers.map((ledger) => (
                <option key={ledger.id} value={ledger.id}>
                  {ledger.name}
                </option>
              ))
            )}
          </Select>
          {Boolean(ledgersError) && <FormError error={ledgersError} />}

          {requiresAccount && (
            <Select
              label={accountLabel(proposal.entryKind)}
              value={accountId}
              required
              disabled={doNotRecord || accountsLoading}
              onChange={(event) => setAccountId(event.target.value)}
            >
              <option value="" disabled>
                請選擇帳戶
              </option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          )}
          {requiresAccount && Boolean(accountsError) && <FormError error={accountsError} />}

          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={doNotRecord}
              onChange={(event) => setDoNotRecord(event.target.checked)}
            />
            <span>不記入帳本（只記往來）</span>
          </label>
          {conflictMessage && (
            <div className={styles.conflictError} role="alert">
              {conflictMessage}
            </div>
          )}
          <FormError error={error} />
          <div className={styles.expansionActions}>
            <Button
              type="button"
              className={styles.smallButton}
              variant="secondary"
              disabled={isSubmitting}
              onClick={onToggle}
            >
              取消
            </Button>
            {conflictCode ? (
              <Button
                type="button"
                className={styles.smallButton}
                disabled={isSubmitting}
                onClick={() => void handleDecline()}
              >
                改成拒絕
              </Button>
            ) : (
              <Button
                type="button"
                className={styles.smallButton}
                disabled={acceptDisabled}
                onClick={acceptRecordProposal}
              >
                接受
              </Button>
            )}
          </div>
        </div>
      )}
      {!expanded && <FormError error={error} />}
    </div>
  );
}

function isRecordProposal(proposal: DebtProposal): boolean {
  return (
    proposal.type === 'CREATE' &&
    (proposal.entryKind === 'LEND' ||
      proposal.entryKind === 'BORROW' ||
      proposal.entryKind === 'COLLECT' ||
      proposal.entryKind === 'REPAY')
  );
}

function renderProposalSentence(proposal: DebtProposal): ReactNode {
  const name = proposal.otherUser.name;

  if (proposal.type === 'CREATE' && proposal.entryKind === 'FORGIVEN') {
    return (
      <>
        <strong>{name}</strong> 免除了你欠他的錢
      </>
    );
  }

  if (proposal.type === 'CREATE') {
    const description: Record<string, string> = {
      LEND: '你借給他',
      BORROW: '你向他借入',
      COLLECT: '他還你',
      REPAY: '你還他',
      FORGIVEN: '記下一筆免除',
      SETTLEMENT: '記下一筆結清差額',
      FORGIVE: '免除他欠你的錢',
      PAID_FOR_ME: '替你代墊',
    };
    const settle = proposal.settle ? '，並以此結清' : '';
    return (
      <>
        <strong>{name}</strong> 記了一筆：{description[proposal.entryKind]}{' '}
        {formatMoney(proposal.amount)} · {shortDate(proposal.date)}
        {settle}
      </>
    );
  }

  const kind = entryKindLabel(proposal.entryKind);
  if (proposal.type === 'DELETE') {
    return (
      <>
        <strong>{name}</strong> 刪了 {shortDate(proposal.date)} 的{kind}{' '}
        {formatMoney(proposal.amount)}
      </>
    );
  }

  if (proposal.previous === null) {
    return (
      <>
        <strong>{name}</strong> 把一筆{kind}改成 {formatMoney(proposal.amount)} ·{' '}
        {shortDate(proposal.date)}
      </>
    );
  }

  const previousDate = shortDate(proposal.previous.date);
  const currentDate = shortDate(proposal.date);
  const amountChange =
    proposal.previous.amount === proposal.amount
      ? ''
      : ' ' + formatMoney(proposal.previous.amount) + ' → ' + formatMoney(proposal.amount);
  const dateChange = previousDate === currentDate ? '' : ' · ' + previousDate + ' → ' + currentDate;
  return (
    <>
      <strong>{name}</strong> 把 {previousDate} 的{kind}
      {amountChange}
      {dateChange}
    </>
  );
}

function entryKindLabel(kind: DebtEntryKind): string {
  const labels: Record<DebtEntryKind, string> = {
    LEND: '借出',
    BORROW: '借入',
    COLLECT: '對方還我',
    REPAY: '我還對方',
    FORGIVEN: '被免除',
    SETTLEMENT: '結清差額',
    FORGIVE: '免除',
    PAID_FOR_ME: '代墊',
  };
  return labels[kind];
}

function shortDate(date: string): string {
  const parts = formatDate(date).split('/');
  return parts.length >= 2 ? parts.slice(-2).join('/') : formatDate(date);
}

function accountLabel(kind: DebtEntryKind): string {
  const labels: Partial<Record<DebtEntryKind, string>> = {
    BORROW: '借到的錢進哪個帳戶',
    LEND: '從哪個帳戶借出',
    COLLECT: '收進哪個帳戶',
    REPAY: '從哪個帳戶付出',
  };
  return labels[kind] ?? '選擇帳戶';
}

function getPreview(
  proposal: DebtProposal,
  counterparty: Pick<Counterparty, 'displayName' | 'balance'> | undefined,
): string | null {
  if (!isRecordProposal(proposal) || counterparty === undefined) {
    return null;
  }
  if (proposal.settle) {
    return '記完後：兩清';
  }

  // 這是 spec 明確允許的 W43 畫面預覽；其他畫面上的餘額仍一律取自 API。
  const delta =
    proposal.entryKind === 'LEND' || proposal.entryKind === 'REPAY'
      ? proposal.amount
      : -proposal.amount;
  const resultingBalance = counterparty.balance + delta;
  if (resultingBalance === 0) {
    return '記完後：兩清';
  }
  if (resultingBalance > 0) {
    return '記完後：' + counterparty.displayName + '欠你 ' + formatMoney(resultingBalance);
  }
  return '記完後：你欠' + counterparty.displayName + ' ' + formatMoney(Math.abs(resultingBalance));
}
