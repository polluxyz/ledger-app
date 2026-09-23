import { useState } from 'react';
import { PageToolbarActions } from '../app/PageToolbar';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import { SlideDown } from '../components/SlideDown';
import { LedgerDialog } from '../features/ledgers/LedgerDialog';
import { LedgerList } from '../features/ledgers/LedgerList';
import { useLedgers } from '../features/ledgers/use-ledgers';
import styles from './LedgersPage.module.css';

/**
 * 帳本管理頁：列表與建立。
 *
 * 「顯示已封存」交給後端處理（`includeArchived`），前端不自行過濾。query key 帶著
 * 這個值，所以兩份清單各有各的快取，切換時不會互相覆蓋。
 *
 * 「建立帳本」不是彈窗，而是頁首下方往下展開的表單（2h §4.7）：建立是在清單上
 * 多加一項，展開在清單上方，送出後直接看到新帳本出現在哪裡。
 */
export default function LedgersPage() {
  const [includeArchived, setIncludeArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const ledgers = useLedgers(includeArchived);

  return (
    <section className={styles.page}>
      {/* 頁面層級的主要按鈕放橫條右邊（SC-38.3）；展開的表單仍然在標題下方。 */}
      <PageToolbarActions>
        <Button aria-expanded={creating} onClick={() => setCreating((open) => !open)}>
          建立帳本
        </Button>
      </PageToolbarActions>

      <PageHeader title="帳本" />

      {/*
        開關交給 SlideDown：裡面的 LedgerDialog 恆為開啟，收起動畫播完才整個卸載，
        下次展開的表單因此是乾淨的。Dialog 的 panel 變體沒有外框，外框由這張卡片提供。
      */}
      <SlideDown open={creating}>
        <div className={styles.createCard}>
          <LedgerDialog open variant="panel" onClose={() => setCreating(false)} />
        </div>
      </SlideDown>

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
    </section>
  );
}
