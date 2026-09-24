import type { Debt, DebtStatus } from '@ledger/shared';
import { FormError } from '../../components/FormError';
import { Pagination } from '../../components/Pagination';
import { formatDate, formatMoney } from '../../lib/format';
import { useDebts } from './use-debts';
import styles from './DebtList.module.css';

/**
 * 債務狀態的中文名稱（列上的狀態文字與空清單訊息用）。DebtsView 的分頁標籤
 * 另有一份同字的定義——react-refresh 規定元件檔只能 export 元件，共用的常數
 * 得抽新檔（不在本任務範圍），而兩處各自內聯比多一個檔案單純。
 */
const DEBT_STATUS_LABELS: Record<DebtStatus, string> = {
  OPEN: '未結清',
  SETTLED: '已結清',
  FORGIVEN: '已免除',
};

/** 一頁幾筆。與交易列表相同（spec 4.2「每頁 20 筆」）。 */
const DEBTS_PER_PAGE = 20;

interface DebtListProps {
  /** 要看哪個狀態的債務。篩選由後端執行（`?status=`），前端不自行過濾。 */
  status: DebtStatus;
  /** 以 1 為起始。由 DebtsView 持有——切換狀態分頁時要把它歸回 1。 */
  page: number;
  onPageChange: (page: number) => void;
  onSelectDebt: (debtId: string) => void;
}

/**
 * 借還檢視的債務列表（spec 4.2）：方向與對方、日期、本金、未清餘額或狀態文字，
 * 加上「舊債」標籤與分頁。
 *
 * 資料自己在內部取（`useDebts`）：查詢條件（status＋page）就是這個列表的全部
 * 輸入，收回來可以讓 DebtsView 只管「現在選哪個狀態、停在第幾頁」。
 *
 * 每列的未清餘額、狀態全部照 API 回的畫（spec W9）——唯一在這裡做的判斷是
 * 「OPEN 顯示餘額、其他顯示狀態文字」，那是呈現規則，不是計算。
 */
export function DebtList({ status, page, onPageChange, onSelectDebt }: DebtListProps) {
  const debts = useDebts({ status, page, limit: DEBTS_PER_PAGE });

  if (debts.isLoading) {
    return (
      <section className={styles.card}>
        <p className={styles.status}>載入中…</p>
      </section>
    );
  }
  if (debts.error) {
    return (
      <section className={styles.card}>
        <FormError error={debts.error} />
      </section>
    );
  }

  const items = debts.data?.items ?? [];
  if (items.length === 0) {
    return (
      <section className={styles.card}>
        {/* 空清單要說明「哪個狀態沒有」——三個分頁共用一個列表，只寫「沒有資料」
            會讓人以為整個借還功能是空的。 */}
        <p className={styles.status}>沒有{DEBT_STATUS_LABELS[status]}的借還。</p>
      </section>
    );
  }

  return (
    <section className={styles.card}>
      {/* 欄位標題純粹是視覺對位（比照 TransactionList），螢幕閱讀器聽列上的文字就夠。 */}
      <div className={styles.header} aria-hidden="true">
        <span>對方</span>
        <span className={styles.numberHead}>日期</span>
        <span className={styles.numberHead}>本金</span>
        <span className={styles.numberHead}>餘額／狀態</span>
      </div>

      <ul className={styles.rows}>
        {items.map((debt) => (
          <li key={debt.id}>
            {/*
              整列是一顆按鈕：點了在右側欄打開這筆債務的詳情（spec 4.2）。用 button
              而不是在 li 上掛 onClick——鍵盤聚焦與 Enter 觸發是免費拿到的。
            */}
            <button type="button" className={styles.row} onClick={() => onSelectDebt(debt.id)}>
              <span className={styles.party}>
                {directionLabel(debt)}
                {/* 本金沒有交易（`transactionId === null`）＝系統上線前就存在的舊債。 */}
                {debt.transactionId === null && <span className={styles.legacy}>舊債</span>}
              </span>
              <span className={styles.date}>{formatDate(debt.date)}</span>
              <span className={styles.principal}>{formatMoney(debt.principal)}</span>
              <span
                className={
                  debt.status === 'OPEN' ? styles.balance : `${styles.balance} ${styles.closed}`
                }
              >
                {debt.status === 'OPEN'
                  ? `剩 ${formatMoney(debt.outstanding)}`
                  : DEBT_STATUS_LABELS[debt.status]}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <Pagination
        page={debts.data?.page ?? page}
        limit={debts.data?.limit ?? DEBTS_PER_PAGE}
        total={debts.data?.total ?? 0}
        onChange={onPageChange}
      />
    </section>
  );
}

/** 方向與對方合成一句話：「借給小明」「向阿華借」。方向由 API 給，這裡只選句型。 */
function directionLabel(debt: Pick<Debt, 'direction' | 'counterpartyName'>): string {
  return debt.direction === 'LENT'
    ? `借給${debt.counterpartyName}`
    : `向${debt.counterpartyName}借`;
}
