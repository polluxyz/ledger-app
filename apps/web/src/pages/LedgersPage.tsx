import { useState } from 'react';
import { PageToolbarActions } from '../app/PageToolbar';
import { RightPanelContent } from '../app/RightPanel';
import { useRightPanel } from '../app/right-panel-context';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
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
 * 「建立帳本」從右側欄滑出（spec 2i SC-42），與「＋ 新增交易」同一套互動：
 * 表單不再往下擠開清單，使用者一邊填一邊看得到既有的帳本。
 */
export default function LedgersPage() {
  const [includeArchived, setIncludeArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const { isOpen, open, close } = useRightPanel();
  const ledgers = useLedgers(includeArchived);

  /*
   * 「右側欄正開著這張表單」才算展開。頁面自己的 `creating` 不夠用——右側欄也
   * 可能被外殼關掉（例如換頁），那時按鈕的 aria-expanded 必須跟著變回 false。
   */
  const showCreate = creating && isOpen;

  function toggleCreate() {
    if (showCreate) {
      closeCreate();
      return;
    }
    setCreating(true);
    open();
  }

  function closeCreate() {
    setCreating(false);
    close();
  }

  return (
    <section className={styles.page}>
      {/* 頁面層級的主要按鈕放橫條右邊（SC-38.3）；表單從右側欄滑出。 */}
      <PageToolbarActions>
        <Button aria-expanded={showCreate} onClick={toggleCreate}>
          <Icon name="plus" />
          建立帳本
        </Button>
      </PageToolbarActions>

      {/*
        右側欄的內容一直掛著，裡面的表單才由 `showCreate` 決定畫不畫。
        `Dialog` 的 panel 變體收起時整個卸載，下次打開的欄位因此是乾淨的；
        它也負責把焦點送進第一個欄位、關閉時送回觸發的按鈕。
      */}
      <RightPanelContent>
        {showCreate ? <LedgerDialog open variant="panel" onClose={closeCreate} /> : null}
      </RightPanelContent>

      <PageHeader title="帳本" />

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
