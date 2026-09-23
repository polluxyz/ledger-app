import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { LedgerDetail, LedgerMemberInfo, LedgerRole } from '@ledger/shared';
import { PageToolbarActions, PageToolbarStart } from '../app/PageToolbar';
import { RightPanelContent } from '../app/RightPanel';
import { useRightPanel } from '../app/right-panel-context';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
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
    return (
      <>
        <BackToLedgers />
        <p className={styles.status}>載入中…</p>
      </>
    );
  }

  // 404 與其他錯誤都收斂成同一句話。分開講就等於把「這本帳本存在」透露出去。
  if (ledger.error || !ledger.data) {
    const notFound = ledger.error instanceof ApiError && ledger.error.statusCode === 404;
    return (
      <section className={styles.page}>
        {/* 回列表的路只留橫條那一條（SC-38.2）。內容裡再放一次，同一個無障礙名稱
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

  const [adding, setAdding] = useState(false);
  const { isOpen, open, close } = useRightPanel();
  // 「右側欄正開著這張表單」才算展開：右側欄也可能被外殼關掉（例如換頁）。
  const showAdd = adding && isOpen;
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

  function toggleAdd() {
    if (showAdd) {
      closeAdd();
      return;
    }
    setAdding(true);
    open();
  }

  function closeAdd() {
    setAdding(false);
    close();
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
      {/* 橫條左邊是返回連結、右邊是頁面層級的按鈕（SC-38.2、SC-38.3）。
          「改名」的出現條件照舊：owner 而且未封存。 */}
      <BackToLedgers />
      {isOwner && !isArchived && (
        <PageToolbarActions>
          <Button variant="secondary" onClick={() => onRename(ledger)}>
            改名
          </Button>
        </PageToolbarActions>
      )}

      <PageHeader title={ledger.name} />

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

      <div className={styles.membersHead}>
        <h3 className={styles.subtitle}>成員（{ledger.members.length}）</h3>
        {canAddMembers && (
          <Button variant="secondary" aria-expanded={showAdd} onClick={toggleAdd}>
            加入成員
          </Button>
        )}
      </div>

      {/*
        「加入成員」與帳本頁的「建立帳本」同一套互動（spec 2i SC-42）：從右側欄
        滑出，不往下擠開成員清單。`Dialog` 的 panel 變體收起時整個卸載，下次打開的
        欄位因此是空的；它也負責把焦點送進第一個欄位、關閉時送回「加入成員」。
      */}
      <RightPanelContent>
        {showAdd ? (
          <MemberDialog open ledgerId={ledger.id} variant="panel" onClose={closeAdd} />
        ) : null}
      </RightPanelContent>

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
            {/* 刪除是不可逆且連資料一起消失，用危險樣式與封存明顯區隔。 */}
            <Button
              variant="secondary"
              className={styles.deleteButton}
              onClick={() => setDanger('delete')}
            >
              刪除帳本
            </Button>
          </div>
        </section>
      )}

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

/**
 * 橫條左邊的返回連結（SC-38.2）。
 *
 * 看得到的是「← 帳本」，但無障礙名稱是「回到帳本列表」——一個箭頭加兩個字，
 * 螢幕閱讀器讀出來不知道會去哪裡。這一頁的三種狀態（載入中、載不出來、正常）
 * 都放同一份，使用者不會因為帳本讀不到就卡在這裡。
 */
function BackToLedgers() {
  return (
    <PageToolbarStart>
      <Link className={styles.back} to="/ledgers" aria-label="回到帳本列表">
        <Icon name="chevronLeft" size={16} />
        帳本
      </Link>
    </PageToolbarStart>
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
