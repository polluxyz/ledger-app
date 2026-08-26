import { useState } from 'react';
import { Button } from '../components/Button';
import { LedgerDialog } from '../features/ledgers/LedgerDialog';
import { LedgerList } from '../features/ledgers/LedgerList';
import { useLedgers } from '../features/ledgers/use-ledgers';
import styles from './LedgersPage.module.css';

/**
 * 帳本管理頁：列表與建立。
 *
 * 「顯示已封存」交給後端處理（`includeArchived`），前端不自行過濾。query key 帶著
 * 這個值，所以兩份清單各有各的快取，切換時不會互相覆蓋。
 */
export default function LedgersPage() {
  const [includeArchived, setIncludeArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const ledgers = useLedgers(includeArchived);

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        {/* 站名是 AppTopBar 的 h1，頁面標題往下一級。 */}
        <h2 className={styles.title}>帳本</h2>
        <Button onClick={() => setCreating(true)}>建立帳本</Button>
      </header>

      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={includeArchived}
          onChange={(event) => setIncludeArchived(event.target.checked)}
        />
        顯示已封存的帳本
      </label>

      <LedgerList
        ledgers={ledgers.data ?? []}
        isLoading={ledgers.isLoading}
        error={ledgers.error}
      />

      <LedgerDialog open={creating} onClose={() => setCreating(false)} />
    </section>
  );
}
