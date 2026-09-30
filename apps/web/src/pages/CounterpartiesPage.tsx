import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { RightPanelContent } from '../app/RightPanel';
import { useRightPanel } from '../app/right-panel-context';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { PageContent } from '../components/PageContent';
import { PageHeader } from '../components/PageHeader';
import { AddCounterpartyDialog } from '../features/debts/AddCounterpartyDialog';
import { readOpenCounterpartyState } from '../features/linking/navigation';
import { CounterpartyDirectory } from '../features/counterparties/CounterpartyDirectory';
import { CounterpartyProfile } from '../features/counterparties/CounterpartyProfile';
import { InviteDialog } from '../features/counterparties/InviteDialog';
import styles from './CounterpartiesPage.module.css';

/**
 * 對象頁只管「有哪些人」（W46、W52）：清單不依賴帳本，右側欄放人的資料與管理
 * 按鈕。修訂 2 起不再掛新增交易的右側欄（W54）——沒選人時右側欄收起，按叉叉或
 * Esc 直接收起，不會跳出「新增一筆交易」。
 */
export default function CounterpartiesPage() {
  const { open, close } = useRightPanel();
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [handledLocationKey, setHandledLocationKey] = useState<string | null>(null);

  /*
   * 搜尋停頓 300 毫秒才送到清單，讓使用者打一個名字時只查一次完整文字，
   * 而不是每個按鍵都重新載入同一份資料。
   */
  useEffect(() => {
    const timeout = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const openCounterpartyId = readOpenCounterpartyState(location.state);

  /*
   * 從總覽或邀請頁導來時，先在 render 期間換掉選的人，右側欄 mount 時就能直接
   * 顯示那個人（W56）。location key 代表一次導覽；記住它可避免清 state 後的
   * render 又重播同一個指示。
   */
  if (openCounterpartyId !== null && handledLocationKey !== location.key) {
    setHandledLocationKey(location.key);
    setSelectedId(openCounterpartyId);
  }

  /*
   * 右側欄由外殼按 location key 管理。打開後用 replace 清掉一次性 state，並帶上保留旗標，
   * 這樣重新整理不會重開那個人，而 RightPanelProvider 也不會把剛開的欄位收起。
   */
  useEffect(() => {
    if (openCounterpartyId === null) {
      return;
    }
    open();
    void navigate(`${location.pathname}${location.search}`, {
      replace: true,
      state: { keepRightPanel: true },
    });
  }, [location.pathname, location.search, navigate, open, openCounterpartyId]);

  function openCounterparty(counterpartyId: string) {
    setSelectedId(counterpartyId);
    open();
  }

  /*
   * 叉叉與 Esc（W54）：只收起右側欄，留著那個人，讓滑出動畫裡還是他的資料，
   * 而不是先變空白。沒有別的預設內容，所以收起後不會出現任何表單。
   */
  function closePanel() {
    close();
  }

  /** 刪除成功後那個人已經不存在，留著只會在動畫裡閃出錯誤，所以一併清掉。 */
  function handleDeleted() {
    setSelectedId(null);
    close();
  }

  return (
    <>
      <PageContent>
        <PageHeader title="對象" />

        <div className={styles.controls}>
          <input
            className={styles.search}
            type="search"
            aria-label="搜尋"
            placeholder="搜尋名字"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => setAddOpen(true)}>
              ＋ 新增
            </Button>
            <Button onClick={() => setInviteOpen(true)}>邀請連動</Button>
          </div>
        </div>

        <CounterpartyDirectory q={query} onSelectCounterparty={openCounterparty} />
      </PageContent>

      <AddCounterpartyDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(counterparty) => openCounterparty(counterparty.id)}
      />
      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />

      {selectedId !== null && (
        <RightPanelContent>
          <Dialog open={true} title="對象" variant="panel" onClose={closePanel}>
            <CounterpartyProfile
              key={selectedId}
              counterpartyId={selectedId}
              onDeleted={handleDeleted}
            />
          </Dialog>
        </RightPanelContent>
      )}
    </>
  );
}
