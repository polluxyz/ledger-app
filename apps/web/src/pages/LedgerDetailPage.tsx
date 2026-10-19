import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { LedgerDetail, LedgerMemberInfo, LedgerRole } from '@ledger/shared';
import { RightPanelContent } from '../app/RightPanel';
import { useRightPanel } from '../app/right-panel-context';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Dialog } from '../components/Dialog';
import { FormError } from '../components/FormError';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { useCurrentUser } from '../features/auth/use-current-user';
import { useCounterparties } from '../features/debts/use-debts';
import { AddCounterpartyMemberDialog } from '../features/ledgers/AddCounterpartyMemberDialog';
import { AddMemberMenu } from '../features/ledgers/AddMemberMenu';
import { DeleteLedgerDialog } from '../features/ledgers/DeleteLedgerDialog';
import { LeaveLedgerDialog } from '../features/ledgers/LeaveLedgerDialog';
import { LedgerRenameDialog } from '../features/ledgers/LedgerRenameDialog';
import { MemberDialog } from '../features/ledgers/MemberDialog';
import { MemberList } from '../features/ledgers/MemberList';
import { ROLE_LABEL } from '../features/ledgers/role-labels';
import { useArchiveLedger, useLedger, useUnarchiveLedger } from '../features/ledgers/use-ledgers';
import { useRemoveMember, useUpdateMemberRole } from '../features/ledgers/use-members';
import { GuestList } from '../features/ledger-people/GuestList';
import { useLedgerGroups } from '../features/ledger-people/use-ledger-pointers';
import { ApiError } from '../lib/api-client';
import { formatDate } from '../lib/format';
import styles from './LedgerDetailPage.module.css';

/**
 * 帳本明細：基本資訊、成員清單、以及 owner 才有的管理操作。
 *
 * **無權存取的帳本，後端回 404 而不是 403**，這裡也一律顯示「找不到」。回 403 或說
 * 「你沒有權限看這本帳本」等於承認它存在——光是這件事就已經是洩漏。
 */
export default function LedgerDetailPage() {
  const { ledgerId } = useParams<{ ledgerId: string }>();
  const ledger = useLedger(ledgerId ?? null);
  const [renaming, setRenaming] = useState<LedgerDetail | null>(null);

  if (ledger.isLoading) {
    return (
      <section className={styles.page}>
        <BackToLedgers />
        <p className={styles.status}>載入中…</p>
      </section>
    );
  }

  // 404 與其他錯誤都收斂成同一句話。分開講就等於把「這本帳本存在」透露出去。
  if (ledger.error || !ledger.data) {
    const notFound = ledger.error instanceof ApiError && ledger.error.statusCode === 404;
    return (
      <section className={styles.page}>
        {/* 回列表的路只留標題上方這一條。內容裡再放一次，同一個無障礙名稱
            就會在頁面上出現兩遍，螢幕閱讀器與 e2e 都分不出該用哪一個。 */}
        <BackToLedgers />
        <PageHeader title="帳本" />
        <p className={styles.status}>
          {notFound ? '找不到這本帳本。' : '無法載入這本帳本，請稍後再試。'}
        </p>
      </section>
    );
  }

  return <LedgerDetailView ledger={ledger.data} onRename={setRenaming} renaming={renaming} />;
}

function LedgerDetailView({
  ledger,
  renaming,
  onRename,
}: {
  ledger: LedgerDetail;
  renaming: LedgerDetail | null;
  onRename: (ledger: LedgerDetail | null) => void;
}) {
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const myRole = ledger.members.find((member) => member.userId === currentUser.data?.id)?.role;
  // 隱藏做不到的按鈕是體驗，不是授權。真正的防線是後端的 @RequireLedgerRole；
  // 這裡從不用角色決定「資料能不能拿」，只決定「按鈕畫不畫」。
  const isOwner = myRole === 'OWNER';
  const isArchived = ledger.archivedAt !== null;
  // 私人帳本加不了人（後端回 409），所以連入口都不畫；已封存則整頁唯讀。
  const canAddMembers = isOwner && ledger.kind === 'SHARED' && !isArchived;

  const [addingByEmail, setAddingByEmail] = useState(false);
  const [addingCounterparty, setAddingCounterparty] = useState(false);
  const { isOpen, open, close } = useRightPanel();
  // 「右側欄正開著這張表單」才算展開：右側欄也可能被外殼關掉（例如換頁）。
  const showAddByEmail = addingByEmail && isOpen;
  const groups = useLedgerGroups();
  const counterparties = useCounterparties({ limit: 100 });
  const currentLedgerGroup = groups.data?.find((group) => group.ledger.id === ledger.id);
  const counterpartyNames = new Map(
    (counterparties.data?.items ?? []).map((counterparty) => [
      counterparty.id,
      counterparty.displayName,
    ]),
  );
  const pointerNames: Record<string, string> = {};
  for (const { person, pointer } of currentLedgerGroup?.people ?? []) {
    if (pointer.counterpartyId === null) continue;
    const displayName = counterpartyNames.get(pointer.counterpartyId);
    if (!displayName) continue;
    pointerNames[person.id] = displayName;
    if (person.userId !== null) pointerNames[person.userId] = displayName;
  }
  const [removing, setRemoving] = useState<LedgerMemberInfo | null>(null);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  // 危險操作同時間只會開一個彈窗，用一個欄位表示比多個布林值更不容易出錯。
  const [danger, setDanger] = useState<'archive' | 'delete' | 'unarchive' | null>(null);
  // 改角色的錯誤（例如降級最後一位 owner）貼在那一列底下，不放頁面頂端——
  // 整頁共用一個錯誤框的話，看的人不知道是哪一列造成的。
  const [roleError, setRoleError] = useState<{ userId: string; message: string } | undefined>();

  const updateRole = useUpdateMemberRole(ledger.id);
  const removeMember = useRemoveMember(ledger.id);
  const archiveLedger = useArchiveLedger();
  const unarchiveLedger = useUnarchiveLedger();
  const memberHasTransactions =
    removeMember.error instanceof ApiError &&
    removeMember.error.errorCode === 'MEMBER_HAS_TRANSACTIONS';
  function handleChangeRole(member: LedgerMemberInfo, role: LedgerRole) {
    setRoleError(undefined);
    updateRole.mutate(
      { userId: member.userId, role },
      {
        onError: (error) => {
          setRoleError({
            userId: member.userId,
            message: error instanceof ApiError ? error.message : '無法連線到伺服器，請稍後再試。',
          });
        },
      },
    );
    // 失敗時下拉會退回原值：清單重新渲染時讀的是伺服器上的 member.role，
    // 而那一筆並沒有被改動。不必自己保存「原本選什麼」。
  }

  function openEmailAdd() {
    setAddingByEmail(true);
    open();
  }

  function closeEmailAdd() {
    setAddingByEmail(false);
    close();
  }

  function closeRemove() {
    setRemoving(null);
    // 清掉上一次的失敗，下次開啟才不會殘留紅字。
    removeMember.reset();
    updateRole.reset();
  }

  function confirmRemove() {
    if (!removing) {
      return;
    }
    removeMember.mutate(removing.userId, {
      onSuccess: () => {
        closeRemove();
      },
      // 失敗時**不關彈窗**——409 是按下確認之後才發生的，關掉的話使用者只會
      // 看到「什麼都沒發生」。錯誤由 ConfirmDialog 就地顯示。
    });
  }

  function confirmChangeToViewer() {
    if (!removing) return;
    setRoleError(undefined);
    updateRole.mutate(
      { userId: removing.userId, role: 'VIEWER' },
      {
        onSuccess: closeRemove,
        onError: (error) => {
          setRoleError({
            userId: removing.userId,
            message: error instanceof ApiError ? error.message : '無法連線到伺服器，請稍後再試。',
          });
        },
      },
    );
  }

  function closeDanger() {
    setDanger(null);
    // 清掉上一個動作留下的錯誤，下次開啟時是乾淨的。
    archiveLedger.reset();
    unarchiveLedger.reset();
  }

  function confirmArchive() {
    archiveLedger.mutate(ledger.id, {
      onSuccess: () => {
        setDanger(null);
        // 不必導頁。已封存的帳本這一頁仍看得到，重新取回的明細會自己換成唯讀樣貌；
        // 作用中帳本則由 ActiveLedgerProvider 自動退回第一本未封存的。
      },
    });
  }

  function confirmUnarchive() {
    unarchiveLedger.mutate(ledger.id, {
      onSuccess: () => setDanger(null),
    });
  }

  return (
    <section className={styles.page}>
      {/* 返回連結在標題左上，「改名」在標題同一排右邊（開發者 2026-10-07：最上排
          橫條清空留給 AI 功能）。「改名」的出現條件照舊：owner 而且未封存。 */}
      <BackToLedgers />
      <PageHeader
        title={ledger.name}
        actions={
          isOwner && !isArchived ? (
            <Button variant="secondary" onClick={() => onRename(ledger)}>
              改名
            </Button>
          ) : undefined
        }
      />

      <dl className={styles.facts}>
        <Fact
          label="帳本類型"
          value={ledger.kind === 'SHARED' ? '共享' : '私人'}
          note="建立後不可更改"
        />
        <Fact label="幣別" value={ledger.currency} />
        <Fact label="我的角色" value={myRole ? ROLE_LABEL[myRole] : '—'} />
        {ledger.archivedAt !== null && (
          <Fact label="已封存" value={formatDate(ledger.archivedAt)} note="封存後僅可讀取" />
        )}
      </dl>

      {/*
        分類頁的帳本由 `?ledgerId=` 指定，所以這個連結只是「帶著這一本過去」，
        **不會改動作用中帳本**——使用者為了看一眼分類，不該連記帳寫進哪一本都被改掉。
        已封存的帳本不畫這個連結：分類頁的清單不含封存帳本，連過去也只會被退回。
      */}
      {!isArchived && (
        <p className={styles.categoriesLink}>
          <Link className={styles.categoriesAnchor} to={`/categories?ledgerId=${ledger.id}`}>
            <Icon name="tag" size={16} />
            管理這本帳本的分類
          </Link>
        </p>
      )}

      <GuestList
        ledgerId={ledger.id}
        enabled={ledger.kind === 'SHARED'}
        canManage={(myRole === 'OWNER' || myRole === 'EDITOR') && !isArchived}
      >
        {({ virtualMembers, openCreate, openRename, openDelete }) => (
          <>
            <div className={styles.membersHead}>
              <h3 className={styles.subtitle}>
                成員（{ledger.members.length + virtualMembers.length}）
              </h3>
              {canAddMembers && (
                <AddMemberMenu
                  onAddCounterparty={() => setAddingCounterparty(true)}
                  onAddVirtualMember={openCreate}
                />
              )}
            </div>

            <RightPanelContent>
              {showAddByEmail ? (
                <MemberDialog open ledgerId={ledger.id} variant="panel" onClose={closeEmailAdd} />
              ) : null}
            </RightPanelContent>

            {isArchived && (
              <p className={styles.readonly}>
                帳本已封存，僅可讀取。成員無法變更，目前也無法退出。
              </p>
            )}

            <MemberList
              members={ledger.members}
              virtualMembers={virtualMembers}
              currentUserId={currentUser.data?.id}
              isOwner={isOwner}
              isArchived={isArchived}
              canLeave={ledger.kind === 'SHARED'}
              canManageVirtualMembers={(myRole === 'OWNER' || myRole === 'EDITOR') && !isArchived}
              pendingUserId={updateRole.isPending ? updateRole.variables?.userId : undefined}
              rowError={roleError}
              pointerNames={pointerNames}
              onChangeRole={handleChangeRole}
              onRemove={(member) => {
                removeMember.reset();
                updateRole.reset();
                setRemoving(member);
              }}
              onLeave={() => setLeaveDialogOpen(true)}
              onRenameVirtualMember={openRename}
              onDeleteVirtualMember={openDelete}
            />

            {addingCounterparty && canAddMembers && (
              <AddCounterpartyMemberDialog
                ledgerId={ledger.id}
                ledgerName={ledger.name}
                members={ledger.members}
                onClose={() => setAddingCounterparty(false)}
                onAddByEmail={openEmailAdd}
              />
            )}
          </>
        )}
      </GuestList>

      {isOwner && (
        <section className={styles.danger}>
          <h3 className={styles.subtitle}>危險操作</h3>
          <div className={styles.dangerActions}>
            {isArchived ? (
              <Button variant="secondary" onClick={() => setDanger('unarchive')}>
                取消封存
              </Button>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setDanger('archive')}>
                  封存帳本
                </Button>
                <Button
                  variant="secondary"
                  className={styles.deleteButton}
                  onClick={() => setDanger('delete')}
                >
                  刪除帳本
                </Button>
              </>
            )}
          </div>
        </section>
      )}

      <ConfirmDialog
        open={removing !== null}
        title="移除成員"
        message={
          memberHasTransactions
            ? `${removing?.name ?? ''}在這本帳本有帳，只能改成檢視者`
            : `將 ${removing?.name ?? ''} 移出這本帳本？他先前記的交易會留下。`
        }
        confirmLabel={memberHasTransactions ? '改成檢視者' : '移除'}
        error={memberHasTransactions ? updateRole.error : removeMember.error}
        isPending={removeMember.isPending || updateRole.isPending}
        onConfirm={memberHasTransactions ? confirmChangeToViewer : confirmRemove}
        onCancel={closeRemove}
      />

      {leaveDialogOpen && (
        <LeaveLedgerDialog
          ledgerId={ledger.id}
          ledgerName={ledger.name}
          onCancel={() => setLeaveDialogOpen(false)}
          onCompleted={() => {
            setLeaveDialogOpen(false);
            void navigate('/ledgers');
          }}
        />
      )}

      <Dialog
        open={danger === 'archive' || danger === 'unarchive'}
        title={danger === 'unarchive' ? `取消封存「${ledger.name}」` : `封存「${ledger.name}」`}
        onClose={closeDanger}
      >
        <div className={styles.confirmActions}>
          <FormError error={danger === 'unarchive' ? unarchiveLedger.error : archiveLedger.error} />
          <div className={styles.dangerActions}>
            <Button
              type="button"
              variant="secondary"
              disabled={archiveLedger.isPending || unarchiveLedger.isPending}
              onClick={closeDanger}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={archiveLedger.isPending || unarchiveLedger.isPending}
              onClick={danger === 'unarchive' ? confirmUnarchive : confirmArchive}
            >
              {archiveLedger.isPending || unarchiveLedger.isPending
                ? '處理中…'
                : danger === 'unarchive'
                  ? '取消封存'
                  : '封存'}
            </Button>
          </div>
        </div>
      </Dialog>

      {danger === 'delete' && (
        <DeleteLedgerDialog
          ledgerId={ledger.id}
          ledgerName={ledger.name}
          ledgerKind={ledger.kind}
          onCancel={closeDanger}
          onDeleted={() => {
            setDanger(null);
            void navigate('/ledgers');
          }}
          onArchived={closeDanger}
        />
      )}

      <LedgerRenameDialog ledger={renaming} onClose={() => onRename(null)} />
    </section>
  );
}

/**
 * 標題左上方的返回連結。
 *
 * 看得到的是「← 帳本」，但無障礙名稱是「回到帳本列表」——一個箭頭加兩個字，
 * 螢幕閱讀器讀出來不知道會去哪裡。這一頁的三種狀態（載入中、載不出來、正常）
 * 都放同一份，使用者不會因為帳本讀不到就卡在這裡。
 */
function BackToLedgers() {
  return (
    <Link className={styles.back} to="/ledgers" aria-label="回到帳本列表">
      <Icon name="chevronLeft" size={16} />
      帳本
    </Link>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={styles.factValue}>
        {value}
        {note && <span className={styles.factNote}>{note}</span>}
      </dd>
    </div>
  );
}
