import { useState } from 'react';
import { Link } from 'react-router-dom';
import { isDebtTransactionType, type LedgerSummary, type Transaction } from '@ledger/shared';
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
import { TransactionWorkbench } from '../features/transactions/TransactionWorkbench';
import { useTransactions } from '../features/transactions/use-transactions';
import { formatDate, formatTransactionAmount, TRANSACTION_TYPE_LABELS } from '../lib/format';
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
  const { open, requestFocus } = useRightPanel();
  const [editing, setEditing] = useState<Transaction | null>(null);

  // 排序與「只要 5 筆」都交給後端，前端不做任何排序、截斷或加總。
  const recent = useTransactions(ledger.id, { page: 1, limit: RECENT_LIMIT });

  function startEditing(transaction: Transaction) {
    setEditing(transaction);
    // 使用者收起過右側欄時，點了一筆卻沒反應是最糟的情況。
    open();
  }

  /** 「＋ 新增交易」：回到新增表單，打開右側欄並把焦點送到金額欄（SC-35.3）。 */
  function startAdding() {
    setEditing(null);
    requestFocus();
  }

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

        <StatsRow authenticated />

        <div className={styles.cards}>
          <RecentTransactions
            transactions={recent.data?.items ?? []}
            isLoading={recent.isLoading}
            error={recent.error}
            selectedId={editing?.id ?? null}
            onSelect={startEditing}
          />
          <AccountBalances />
        </div>
      </PageContent>

      <TransactionWorkbench
        ledger={ledger}
        target={editing ? { kind: 'transaction', transaction: editing } : { kind: 'new' }}
        onClose={() => setEditing(null)}
      />
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
}

/**
 * 「最近交易」卡（SC-34.1、假設 8）。
 *
 * 與交易頁的 `TransactionList` 刻意不共用元件：這裡是一張**摘要**卡——不分組、
 * 不分頁、沒有鉛筆與垃圾桶（刪除要到交易頁），每一列本身就是「編輯這一筆」。
 * 把兩種需求塞進同一個元件，只會得到一串互相牴觸的開關。
 *
 * 每一筆用一個 `<li>` 包一顆 `<button>`：滑鼠與鍵盤都能操作，而且不必自己補
 * `tabIndex` 與 Enter／Space 的處理。`<li>` 的數量因此剛好等於交易筆數。
 *
 * **一列的文字與交易頁的列相同**：分類（轉帳顯示「轉帳」）、備註、帳戶
 * （轉帳是「現金 → 國泰世華」）、金額。e2e 有好幾個情境是拿「-$120 那一列」
 * 去找交易再讀它的備註，兩頁的列讀起來不一樣的話，同一段選取器只有一頁對得到。
 * 正負號與顏色的規則也照抄 `TransactionList`（那兩張對照表是它的模組私有變數，
 * 拿不到，只能各留一份——改動時兩邊要一起改）。
 */
function RecentTransactions({
  transactions,
  isLoading,
  error,
  selectedId,
  onSelect,
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
      />
    </section>
  );
}

/** 金額的語意色，同樣每種型別各自對一個 class；借還的 4 種沿用轉帳的中性色。 */
const AMOUNT_COLOR: Record<Transaction['type'], string> = {
  EXPENSE: styles.expense ?? '',
  INCOME: styles.income ?? '',
  TRANSFER: styles.transfer ?? '',
  LEND: styles.transfer ?? '',
  BORROW: styles.transfer ?? '',
  COLLECT: styles.transfer ?? '',
  REPAY: styles.transfer ?? '',
};

/** 載入中 / 失敗 / 沒有交易 / 有資料，四種呈現。 */
function RecentBody({
  transactions,
  isLoading,
  error,
  selectedId,
  onSelect,
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
    <ul className={styles.recent}>
      {/*
        排序與「最近」的定義都在後端（請求帶的是 `limit=5`）。這裡再截一次只是
        守住標題的承諾：卡片寫著「最近交易」而後端多給了幾筆時，這張摘要卡不該
        默默長高、把下面的內容推走。不做任何排序、篩選或加總。
      */}
      {transactions.slice(0, RECENT_LIMIT).map((transaction) => {
        const rowClass = `${styles.recentRow} ${transaction.id === selectedId ? styles.selected : ''}`;
        /*
          兩行：上行「分類 備註」、下行「日期・帳戶」。dashboard 的卡片只有交易頁
          表格一半寬，擠成一行的話備註第一個被截掉。
        */
        const content = (
          <>
            <span className={styles.recentText}>
              <span className={styles.recentMain}>
                {/* 分類為 null＝轉帳或借還交易，這兩種都沒有分類，改寫型別的中文名。 */}
                <span className={styles.recentCategory}>
                  {transaction.category ? (
                    transaction.category.name
                  ) : (
                    <>
                      <Icon name="transfer" />
                      {TRANSACTION_TYPE_LABELS[transaction.type]}
                    </>
                  )}
                </span>
                {transaction.note && <span className={styles.recentNote}>{transaction.note}</span>}
              </span>
              {/* 帳戶為 null＝別人的帳戶（已遮蔽），或這本帳本不與餘額連動。 */}
              <span className={styles.recentMeta}>
                {formatDate(transaction.date)}
                {transaction.account && `・${transaction.account.name}`}
                {transaction.toAccount && ` → ${transaction.toAccount.name}`}
              </span>
            </span>
            <span className={`${styles.recentAmount} ${AMOUNT_COLOR[transaction.type]}`}>
              {formatTransactionAmount(transaction.type, transaction.amount)}
            </span>
          </>
        );

        /*
          往來產生的交易要到交易頁開啟對象往來帳；首頁摘要沒有那個入口，
          所以借還交易與代付支出都維持純展示，避免放一顆沒有正確目的地的按鈕。
        */
        return (
          <li key={transaction.id}>
            {isDebtTransactionType(transaction.type) || transaction.debt ? (
              <div className={rowClass}>{content}</div>
            ) : (
              <button type="button" className={rowClass} onClick={() => onSelect(transaction)}>
                {content}
              </button>
            )}
          </li>
        );
      })}
    </ul>
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
