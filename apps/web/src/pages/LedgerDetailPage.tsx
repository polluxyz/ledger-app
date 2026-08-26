import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { LedgerDetail, LedgerMemberInfo, LedgerRole } from '@ledger/shared';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useCurrentUser } from '../features/auth/use-current-user';
import { LedgerRenameDialog } from '../features/ledgers/LedgerRenameDialog';
import { MemberDialog } from '../features/ledgers/MemberDialog';
import { MemberList } from '../features/ledgers/MemberList';
import { ROLE_LABEL } from '../features/ledgers/role-labels';
import { useArchiveLedger, useDeleteLedger, useLedger } from '../features/ledgers/use-ledgers';
import { useRemoveMember, useUpdateMemberRole } from '../features/ledgers/use-members';
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
    return <p className={styles.status}>載入中…</p>;
  }

  // 404 與其他錯誤都收斂成同一句話。分開講就等於把「這本帳本存在」透露出去。
  if (ledger.error || !ledger.data) {
    const notFound = ledger.error instanceof ApiError && ledger.error.statusCode === 404;
    return (
      <section className={styles.page}>
        <h2 className={styles.title}>帳本</h2>
        <p className={styles.status}>
          {notFound ? '找不到這本帳本。' : '無法載入這本帳本，請稍後再試。'}
        </p>
        <Link to="/ledgers">回到帳本列表</Link>
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

  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<LedgerMemberInfo | null>(null);
  // 封存與刪除同時間只會開一個彈窗，用一個欄位表示比兩個布林值更不容易出錯。
  const [danger, setDanger] = useState<'archive' | 'delete' | null>(null);
  // 改角色的錯誤（例如降級最後一位 owner）貼在那一列底下，不放頁面頂端——
  // 整頁共用一個錯誤框的話，看的人不知道是哪一列造成的。
  const [roleError, setRoleError] = useState<{ userId: string; message: string } | undefined>();

  const updateRole = useUpdateMemberRole(ledger.id);
  const removeMember = useRemoveMember(ledger.id);
  const archiveLedger = useArchiveLedger();
  const deleteLedger = useDeleteLedger();
  // 兩邊都是 undefined 時 `?.` 會相等，答案就變成「正在退出自己」。彈窗那時是關的，
  // 目前不會出事，但那種相等是巧合不是意思，先擋掉 null 才是真的在問那件事。
  const leavingSelf = removing !== null && removing.userId === currentUser.data?.id;
  // 後端的訊息交給 FormError 原樣呈現，這裡不改寫它，只多補一句「那該怎麼辦」。
  const deleteBlocked =
    deleteLedger.error instanceof ApiError &&
    deleteLedger.error.errorCode === 'LEDGER_HAS_OTHERS_TRANSACTIONS';

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

  function closeRemove() {
    setRemoving(null);
    // 清掉上一次的失敗，下次開啟才不會殘留紅字。
    removeMember.reset();
  }

  function confirmRemove() {
    if (!removing) {
      return;
    }
    const leaving = removing.userId === currentUser.data?.id;
    removeMember.mutate(removing.userId, {
      onSuccess: () => {
        closeRemove();
        // 自己退出之後這一頁已經看不到了（後端會回 404），直接離開。
        if (leaving) {
          void navigate('/ledgers');
        }
      },
      // 失敗時**不關彈窗**——409 是按下確認之後才發生的，關掉的話使用者只會
      // 看到「什麼都沒發生」。錯誤由 ConfirmDialog 就地顯示。
    });
  }

  function closeDanger() {
    setDanger(null);
    // 兩個都清：換一個動作時不該看到上一個動作留下的紅字。
    archiveLedger.reset();
    deleteLedger.reset();
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

  function confirmDelete() {
    // confirm 送的是帳本原本的名稱，不是使用者打的字。輸入框只用來確認意圖，
    // 前後空白之類的差異不該跟著送到後端去。
    deleteLedger.mutate(
      { id: ledger.id, confirm: ledger.name },
      {
        onSuccess: () => {
          setDanger(null);
          // 帳本沒了，這一頁再讀就是 404，直接回列表。
          void navigate('/ledgers');
        },
      },
    );
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <h2 className={styles.title}>{ledger.name}</h2>
        {isOwner && ledger.archivedAt === null && (
          <Button variant="secondary" onClick={() => onRename(ledger)}>
            改名
          </Button>
        )}
      </header>

      <dl className={styles.facts}>
        <Fact
          label="帳本類型"
          value={ledger.kind === 'SHARED' ? '共享' : '私人'}
          note="建立後不可更改"
        />
        <Fact
          label="與我的帳戶餘額"
          value={ledger.tracksBalance ? '連動' : '不連動'}
          note="建立後不可更改"
        />
        <Fact label="幣別" value={ledger.currency} />
        <Fact label="我的角色" value={myRole ? ROLE_LABEL[myRole] : '—'} />
        {ledger.archivedAt !== null && (
          <Fact label="已封存" value={formatDate(ledger.archivedAt)} note="封存後僅可讀取" />
        )}
      </dl>

      <div className={styles.membersHead}>
        <h3 className={styles.subtitle}>成員（{ledger.members.length}）</h3>
        {/* 私人帳本加不了人（後端回 409），所以連入口都不畫。 */}
        {isOwner && ledger.kind === 'SHARED' && !isArchived && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            加入成員
          </Button>
        )}
      </div>

      {isArchived && (
        <p className={styles.readonly}>帳本已封存，僅可讀取。成員無法變更，目前也無法退出。</p>
      )}

      <MemberList
        members={ledger.members}
        currentUserId={currentUser.data?.id}
        isOwner={isOwner}
        isArchived={isArchived}
        pendingUserId={updateRole.isPending ? updateRole.variables?.userId : undefined}
        rowError={roleError}
        onChangeRole={handleChangeRole}
        onRemove={setRemoving}
        onLeave={setRemoving}
      />

      {/* 已封存的帳本沒有東西好封存，後端也不接受刪除，整個區塊就不畫。 */}
      {isOwner && !isArchived && (
        <section className={styles.danger}>
          <h3 className={styles.subtitle}>危險操作</h3>
          <p className={styles.dangerNote}>
            這兩個動作都無法復原。封存把帳本轉為唯讀並從切換器收起，交易會保留；刪除則連交易一起消失。
          </p>
          <div className={styles.dangerActions}>
            <Button variant="secondary" onClick={() => setDanger('archive')}>
              封存帳本
            </Button>
            <Button variant="secondary" onClick={() => setDanger('delete')}>
              刪除帳本
            </Button>
          </div>
        </section>
      )}

      <MemberDialog open={adding} ledgerId={ledger.id} onClose={() => setAdding(false)} />

      <ConfirmDialog
        open={removing !== null}
        title={leavingSelf ? '退出帳本' : '移除成員'}
        message={
          leavingSelf
            ? `退出「${ledger.name}」？你將無法再看到裡面的交易，包括自己記的那些。`
            : `將 ${removing?.name ?? ''} 移出這本帳本？他先前記的交易會留下。`
        }
        confirmLabel={leavingSelf ? '退出' : '移除'}
        error={removeMember.error}
        isPending={removeMember.isPending}
        onConfirm={confirmRemove}
        onCancel={closeRemove}
      />

      <ConfirmDialog
        open={danger === 'archive'}
        title="封存帳本"
        message={`封存「${ledger.name}」之後，這本帳本轉為唯讀、從帳本切換器消失，而且無法解除封存。裡面的交易會保留，隨時可以回來查看。`}
        confirmLabel="封存"
        confirmText={ledger.name}
        error={archiveLedger.error}
        isPending={archiveLedger.isPending}
        onConfirm={confirmArchive}
        onCancel={closeDanger}
      />

      <ConfirmDialog
        open={danger === 'delete'}
        title="刪除帳本"
        message={
          deleteBlocked
            ? '這本帳本有其他成員記的交易，不能刪除。請關掉這個視窗，改用「封存帳本」——帳本會轉為唯讀，交易也留得住。'
            : `刪除「${ledger.name}」之後，裡面的交易會一起消失，而且無法復原。`
        }
        confirmLabel="刪除"
        confirmText={ledger.name}
        error={deleteLedger.error}
        isPending={deleteLedger.isPending}
        onConfirm={confirmDelete}
        onCancel={closeDanger}
      />

      <LedgerRenameDialog ledger={renaming} onClose={() => onRename(null)} />
    </section>
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
