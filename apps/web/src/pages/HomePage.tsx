import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { LedgerSummary, Transaction } from '@ledger/shared';
import { PageToolbarActions, PageToolbarStart } from '../app/PageToolbar';
import { useRightPanel } from '../app/right-panel-context';
import { Button } from '../components/Button';
import { FormError } from '../components/FormError';
import { Icon } from '../components/Icon';
import { PageContent } from '../components/PageContent';
import { PageHeader } from '../components/PageHeader';
import { AccountBalances } from '../features/accounts/AccountBalances';
import { AuthDialog, type AuthDialogMode } from '../features/auth/AuthDialog';
import { useAuth } from '../features/auth/use-auth';
import { LedgerSwitcher } from '../features/ledgers/LedgerSwitcher';
import { useActiveLedger } from '../features/ledgers/use-active-ledger';
import {
  TransactionWorkbench,
  type PanelTarget,
} from '../features/transactions/TransactionWorkbench';
import { TransactionList } from '../features/transactions/TransactionList';
import { useTransactions } from '../features/transactions/use-transactions';
import { PendingCard } from '../features/linking/PendingCard';
import styles from './HomePage.module.css';

/** dashboard 的「最近交易」要幾筆（spec 2i §4.7）。排序與截斷都由後端負責。 */
const RECENT_LIMIT = 5;

/**
 * 首頁，有兩種狀態：
 *
 * - **未登入**：顯示介面預覽——統計卡片是純粹的空狀態（固定 0，不做任何計算），
 *   讓人先看懂這個 app 長什麼樣，再引導去登入 / 註冊。不保存任何訪客資料，
 *   因此前端毋須實作任何業務邏輯。
 * - **已登入**：dashboard（spec 2i SC-34.1）——統計卡、最近 5 筆交易、帳戶餘額。
 *   完整的交易表格（篩選、分頁、刪除）搬到 `/transactions`。
 *
 * 統計卡片在登入後標示為「即將推出」：正確的數字必須由後端彙總端點提供，
 * 拿前端當頁的交易自行加總會是錯的（只算得到那一頁），也違反單一後端原則。
 */
export default function HomePage() {
  const { isAuthenticated } = useAuth();
  // null = 彈窗關閉；登入 / 註冊共用同一個彈窗，只是預設顯示哪張表單不同。
  const [authDialog, setAuthDialog] = useState<AuthDialogMode | null>(null);

  if (isAuthenticated) {
    return <LedgerView />;
  }

  return (
    <>
      <StatsRow authenticated={false} />

      <section className={`${styles.card} ${styles.guest}`}>
        <p className={styles.note}>登入後即可開始記帳，並在這裡看到你的收支。</p>
        <div className={styles.actions}>
          <Button onClick={() => setAuthDialog('login')}>登入</Button>
          <Button variant="secondary" onClick={() => setAuthDialog('register')}>
            註冊
          </Button>
        </div>
      </section>

      {/* 登入成功後彈窗關閉，本頁就地換成已登入狀態——使用者不會被跳走。 */}
      <AuthDialog mode={authDialog} onClose={() => setAuthDialog(null)} />
    </>
  );
}

/**
 * 已登入者的 dashboard。這一層只負責找出「記進哪一本帳本」
 * （由 `ActiveLedgerProvider` 決定），其餘交給 `Dashboard`。
 *
 * `key={ledger.id}` 是刻意的：換一本帳本就換一組「編輯中的那一筆」。用 key 讓
 * React 整個重建那棵子樹，比自己在 effect 裡把每個 state 歸零可靠。
 *
 * 帳本還沒好的三種狀態（載入中 / 失敗 / 一本都沒有）走下面那條路。它們仍然看得到
 * **帳戶餘額**，因為餘額不受帳本狀態影響：帳戶屬於使用者、跨帳本共用，就算一本
 * 帳本都沒有，「我現在有多少錢」仍然該看得到。那時不渲染 `TransactionWorkbench`，
 * 右側欄沒有頁面登記，寬度自然是 0——沒有帳本就沒有地方可以記帳。
 */
function LedgerView() {
  const { ledger, isLoading: ledgerLoading, error: ledgerError } = useActiveLedger();

  if (ledger) {
    return <Dashboard key={ledger.id} ledger={ledger} />;
  }

  return (
    <PageContent>
      <PageHeader title="總覽" />
      <PendingCard />
      <StatsRow authenticated />
      {ledgerLoading && <p className={styles.note}>載入中…</p>}
      {ledgerError && <FormError error={ledgerError} />}
      {!ledgerLoading && !ledgerError && (
        <section className={styles.card}>
          <p className={styles.note}>找不到任何帳本。</p>
        </section>
      )}
      <div className={styles.cards}>
        <AccountBalances />
      </div>
    </PageContent>
  );
}

/**
 * dashboard 本體（spec 2i §4.7）：頁首、三張統計卡、兩張並排的卡片。
 *
 * 版面用 grid 排成一列一列，2j 要加圖表時只是多一列卡片，不必動既有的區塊
 * （假設 9：這一輪不放圖表佔位）。
 *
 * `editing` 放在這一層的理由與交易頁相同（D25）：最近交易在頁面裡、編輯面板在
 * 右側欄（portal 過去），兩者只有這個共同的父層。
 */
function Dashboard({ ledger }: { ledger: LedgerSummary }) {
  const { close, isOpen, open, requestFocus } = useRightPanel();
  const [panelTarget, setPanelTarget] = useState<PanelTarget>({ kind: 'new' });

  // 排序與「只要 5 筆」都交給後端，前端不做任何排序、截斷或加總。
  const recent = useTransactions(ledger.id, { page: 1, limit: RECENT_LIMIT });

  function startEditing(transaction: Transaction) {
    setPanelTarget(
      transaction.settlement
        ? { kind: 'settlement', settlement: transaction }
        : transaction.debt
          ? { kind: 'debtTransaction', transaction }
          : { kind: 'transaction', transaction },
    );
    // 使用者收起過右側欄時，點了一筆卻沒反應是最糟的情況。
    open();
  }

  function fillAccount(transaction: Transaction) {
    setPanelTarget({ kind: 'fillAccount', transaction });
    open();
  }

  /*
   * 關閉只收起右側欄，不清掉正在編輯的那一筆（W57）：收起有滑出動畫，這時換成新增表單，
   * 動畫裡滑出去的就會是「新增一筆交易」。打開右側欄的入口都會先設好要顯示的內容。
   */
  function closeWorkbench() {
    close();
  }

  /** 「＋ 新增交易」：回到新增表單，打開右側欄並把焦點送到金額欄（SC-35.3）。 */
  function startAdding() {
    setPanelTarget({ kind: 'new' });
    requestFocus();
  }

  const selectedId = !isOpen
    ? null
    : panelTarget.kind === 'transaction' ||
        panelTarget.kind === 'debtTransaction' ||
        panelTarget.kind === 'fillAccount'
      ? panelTarget.transaction.id
      : panelTarget.kind === 'settlement'
        ? (panelTarget.settlement?.id ?? null)
        : null;

  return (
    <>
      {/* 橫條左邊是作用中帳本（SC-38.2），右邊是這一頁的主要按鈕（SC-38.3）。 */}
      <PageToolbarStart>
        <LedgerSwitcher />
      </PageToolbarStart>
      <PageToolbarActions>
        <Button onClick={startAdding}>
          <Icon name="plus" />
          新增交易
        </Button>
      </PageToolbarActions>

      <PageContent>
        <PageHeader title="總覽" />
        <PendingCard />

        <StatsRow authenticated />

        <div className={styles.cards}>
          <RecentTransactions
            transactions={recent.data?.items ?? []}
            isLoading={recent.isLoading}
            error={recent.error}
            selectedId={selectedId}
            onSelect={startEditing}
            onFillAccount={fillAccount}
          />
          <AccountBalances />
        </div>
      </PageContent>

      <TransactionWorkbench ledger={ledger} target={panelTarget} onClose={closeWorkbench} />
    </>
  );
}

interface RecentTransactionsProps {
  transactions: Transaction[];
  isLoading: boolean;
  error: unknown;
  /** 右側欄正在編輯的那一筆，該列標成選取中。 */
  selectedId: string | null;
  onSelect: (transaction: Transaction) => void;
  onFillAccount: (transaction: Transaction) => void;
}

/**
 * 「最近交易」卡（SC-34.1、假設 8）。
 *
 * 最近交易沿用交易頁的單列元件，版面與名稱規則只有一份；這裡只保留摘要卡的
 * 載入、錯誤與空狀態，並由呼叫端提供五筆資料。
 */
function RecentTransactions({
  transactions,
  isLoading,
  error,
  selectedId,
  onSelect,
  onFillAccount,
}: RecentTransactionsProps) {
  return (
    <section className={styles.dataCard} aria-labelledby="recent-transactions">
      <div className={styles.cardHead}>
        <h2 className={styles.cardHeading} id="recent-transactions">
          最近交易
        </h2>
        {/* 四種狀態下都留著這個入口：交易載不出來時，使用者至少走得到交易頁。 */}
        <Link className={styles.cardLink} to="/transactions">
          查看全部
        </Link>
      </div>

      <RecentBody
        transactions={transactions}
        isLoading={isLoading}
        error={error}
        selectedId={selectedId}
        onSelect={onSelect}
        onFillAccount={onFillAccount}
      />
    </section>
  );
}

/** 載入中 / 失敗 / 沒有交易 / 有資料，四種呈現。 */
function RecentBody({
  transactions,
  isLoading,
  error,
  selectedId,
  onSelect,
  onFillAccount,
}: RecentTransactionsProps) {
  if (isLoading) {
    return <p className={styles.status}>載入中…</p>;
  }
  // 失敗時不用紅框：這是 dashboard 的一張卡，記帳表單並沒有壞掉，
  // 一塊紅框會讓人以為整頁掛了。
  if (error) {
    return <p className={styles.status}>交易暫時無法載入</p>;
  }
  if (transactions.length === 0) {
    return <p className={styles.status}>還沒有任何交易，從右邊記下第一筆吧。</p>;
  }

  return (
    <TransactionList
      transactions={transactions.slice(0, RECENT_LIMIT)}
      isLoading={false}
      error={null}
      variant="recent"
      selectedId={selectedId}
      onEdit={onSelect}
      onEditDebtTransaction={onSelect}
      onFillAccount={onFillAccount}
    />
  );
}

/** 三張「即將推出」的統計卡（phase-2h · D5：原樣保留，只換樣式）。 */
function StatsRow({ authenticated }: { authenticated: boolean }) {
  return (
    <div className={styles.stats}>
      <Stat label="本月支出" authenticated={authenticated} />
      <Stat label="本月收入" authenticated={authenticated} />
      <Stat label="結餘" authenticated={authenticated} />
    </div>
  );
}

/**
 * 單張統計卡片。未登入時顯示 0（空狀態示意）；已登入時顯示「即將推出」，
 * 等後端彙總端點完成後再點亮。
 */
function Stat({ label, authenticated }: { label: string; authenticated: boolean }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{authenticated ? '即將推出' : '$0'}</span>
    </div>
  );
}
