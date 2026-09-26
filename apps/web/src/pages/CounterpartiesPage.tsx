import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useRightPanel } from '../app/right-panel-context';
import { Button } from '../components/Button';
import { PageContent } from '../components/PageContent';
import { PageHeader } from '../components/PageHeader';
import { AddCounterpartyDialog } from '../features/debts/AddCounterpartyDialog';
import { useActiveLedger } from '../features/ledgers/use-active-ledger';
import { readOpenCounterpartyState } from '../features/linking/navigation';
import { CounterpartyDirectory } from '../features/counterparties/CounterpartyDirectory';
import { InviteDialog } from '../features/counterparties/InviteDialog';
import {
  TransactionWorkbench,
  type PanelTarget,
} from '../features/transactions/TransactionWorkbench';
import styles from './CounterpartiesPage.module.css';

/**
 * 對象頁只負責找人與開啟往來帳；人清單不依賴帳本，因此沒有作用中帳本時也照常顯示。
 * 新增交易與往來帳共用交易頁的右側欄，避免同一種操作在不同頁面長成兩套。
 */
export default function CounterpartiesPage() {
  const { ledger } = useActiveLedger();
  const { open, requestFocus } = useRightPanel();
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [panelTarget, setPanelTarget] = useState<PanelTarget>({ kind: 'new' });
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
   * 從總覽或邀請頁導來時，先在 render 期間換面板目標，右側欄 mount 時就能直接顯示那個人。
   * location key 代表一次導覽；記住它可避免清 state 後的 render 又重播同一個指示。
   */
  if (openCounterpartyId !== null && handledLocationKey !== location.key) {
    setHandledLocationKey(location.key);
    setPanelTarget({ kind: 'counterparty', counterpartyId: openCounterpartyId });
  }

  /*
   * 右側欄由外殼按 location key 管理。打開後用 replace 清掉一次性 state，並帶上保留旗標，
   * 這樣重新整理不會重開往來帳，而 RightPanelProvider 也不會把剛開的欄位收起。
   */
  useEffect(() => {
    if (openCounterpartyId === null || !ledger) {
      return;
    }
    open();
    void navigate(`${location.pathname}${location.search}`, {
      replace: true,
      state: { keepRightPanel: true },
    });
  }, [ledger, location.pathname, location.search, navigate, open, openCounterpartyId]);

  function openCounterparty(counterpartyId: string) {
    setPanelTarget({ kind: 'counterparty', counterpartyId });
    open();
  }

  /** 記往來沿用交易頁表單，只換成預帶對象的新增目標並把焦點交給欄位。 */
  function recordEntry(name: string) {
    setPanelTarget({ kind: 'new', debtCounterparty: name });
    requestFocus();
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

      {ledger && (
        <TransactionWorkbench
          ledger={ledger}
          target={panelTarget}
          onClose={() => setPanelTarget({ kind: 'new' })}
          onRecordEntry={recordEntry}
          onCounterpartyDeleted={() => setPanelTarget({ kind: 'new' })}
        />
      )}
    </>
  );
}
