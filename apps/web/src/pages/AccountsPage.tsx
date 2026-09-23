import { useState } from 'react';
import type { Account } from '@ledger/shared';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { SlideDown } from '../components/SlideDown';
import { AccountDialog } from '../features/accounts/AccountDialog';
import { AccountList } from '../features/accounts/AccountList';
import { useAccounts, useDeleteAccount } from '../features/accounts/use-accounts';
import styles from './AccountsPage.module.css';

/**
 * 帳戶管理頁：列表（含即時餘額）、新增、改名、調整初始餘額、刪除。
 *
 * ## 新增往下展開、編輯維持小視窗（phase-2h §4.7）
 *
 * 新增是「在清單上多加一項」，所以表單展開在清單**上方**，建立完就看得到它出現
 * 在下面；編輯針對某一列，小視窗蓋上去比較直覺。兩者共用同一個 `AccountDialog`，
 * 只差 `variant`——表單內容不複製第二份，否則兩邊會慢慢長歪。
 *
 * 展開的那一份放在 `SlideDown` 裡，`open` 恆為 true：開關由 `SlideDown` 決定，
 * 它負責動畫與「收起後卸載」，`Dialog` 只管外殼與焦點。
 *
 * ## 兩個彈窗的資料流留在這一層
 *
 * `AccountDialog` 與 `ConfirmDialog` 只負責呈現與回報操作，實際的 mutation、
 * 載入中與錯誤都在這裡。這樣那兩個元件才通用得起來。
 */
export default function AccountsPage() {
  const accounts = useAccounts();
  const deleteAccount = useDeleteAccount();

  // null = 關閉；'new' = 新增；帳戶物件 = 編輯那一筆。
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [removing, setRemoving] = useState<Account | null>(null);

  const isCreating = editing === 'new';

  function closeRemove() {
    setRemoving(null);
    // 清掉上一次的失敗，下次開啟才不會殘留紅字。
    deleteAccount.reset();
  }

  function confirmRemove() {
    if (removing) {
      // 失敗時**不關彈窗**——409 是按下確認之後才發生的，關掉的話使用者只會
      // 看到「什麼都沒發生」。錯誤由 ConfirmDialog 就地顯示。
      deleteAccount.mutate(removing.id, { onSuccess: closeRemove });
    }
  }

  return (
    <section className={styles.page}>
      <PageHeader
        title="帳戶"
        description="餘額由伺服器依交易即時計算"
        actions={
          <Button
            // 按第二次收起：按鈕與展開的表單是同一個開關，狀態靠 aria-expanded 說出來。
            aria-expanded={isCreating}
            onClick={() => setEditing(isCreating ? null : 'new')}
          >
            <Icon name="plus" />
            新增帳戶
          </Button>
        }
      />

      <SlideDown open={isCreating}>
        {/* 面板本身沒有外框（Dialog 的 panel 變體刻意不畫），這張卡片就是它的外框。 */}
        <div className={styles.panel}>
          <AccountDialog target="new" variant="panel" onClose={() => setEditing(null)} />
        </div>
      </SlideDown>

      <AccountList
        accounts={accounts.data ?? []}
        isLoading={accounts.isLoading}
        error={accounts.error}
        onEdit={setEditing}
        onRemove={setRemoving}
      />

      {/* 編輯用的小視窗。`editing` 是帳戶物件時才有目標，'new' 歸上面那份展開的面板。 */}
      <AccountDialog
        target={typeof editing === 'object' ? editing : null}
        onClose={() => setEditing(null)}
      />

      <ConfirmDialog
        open={removing !== null}
        title="刪除帳戶"
        message={`確定要刪除「${removing?.name ?? ''}」嗎？此操作無法復原。`}
        confirmLabel="刪除"
        error={deleteAccount.error}
        isPending={deleteAccount.isPending}
        onConfirm={confirmRemove}
        onCancel={closeRemove}
      />
    </section>
  );
}
