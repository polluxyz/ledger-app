import { useState } from 'react';
import type { Account } from '@ledger/shared';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { AccountDialog } from '../features/accounts/AccountDialog';
import { AccountList } from '../features/accounts/AccountList';
import { useAccounts, useDeleteAccount } from '../features/accounts/use-accounts';
import styles from './AccountsPage.module.css';

/**
 * 帳戶管理頁：列表（含即時餘額）、新增、改名、調整初始餘額、刪除。
 *
 * 兩個彈窗的**資料流留在這一層**：`AccountDialog` 與 `ConfirmDialog` 只負責呈現與
 * 回報操作，實際的 mutation、載入中與錯誤都在這裡。這樣那兩個元件才通用得起來。
 */
export default function AccountsPage() {
  const accounts = useAccounts();
  const deleteAccount = useDeleteAccount();

  // null = 關閉；'new' = 新增；帳戶物件 = 編輯那一筆。
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [removing, setRemoving] = useState<Account | null>(null);

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
    <section>
      <header className={styles.header}>
        {/* 站名是 AppHeader 的 h1，頁面標題往下一級。回首頁的連結也由頁首負責。 */}
        <h2 className={styles.title}>帳戶</h2>
        <Button onClick={() => setEditing('new')}>新增帳戶</Button>
      </header>

      <AccountList
        accounts={accounts.data ?? []}
        isLoading={accounts.isLoading}
        error={accounts.error}
        onEdit={setEditing}
        onRemove={setRemoving}
      />

      <AccountDialog target={editing} onClose={() => setEditing(null)} />

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
