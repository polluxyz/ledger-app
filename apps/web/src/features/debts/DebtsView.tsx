import { useState } from 'react';
import type { DebtStatus } from '@ledger/shared';
import { DebtList } from './DebtList';
import { DebtSummaryCards } from './DebtSummaryCards';
import styles from './DebtsView.module.css';

interface DebtsViewProps {
  /** 點一列債務時回報（由交易頁接去右側欄，B4 會接上債務詳情）。 */
  onSelectDebt: (debtId: string) => void;
}

/** 狀態分頁：順序與預設（OPEN）依 spec 4.2。標籤文字與 DebtList 的狀態文字同字。 */
const STATUS_TABS: { value: DebtStatus; label: string }[] = [
  { value: 'OPEN', label: '未結清' },
  { value: 'SETTLED', label: '已結清' },
  { value: 'FORGIVEN', label: '已免除' },
];

/**
 * 交易頁的「借還」檢視（spec 4.2）：每人淨額卡片＋狀態分頁＋債務列表。
 *
 * 這一層只管兩個 UI 狀態——現在選哪個狀態分頁、列表停在第幾頁；淨額卡片與列表
 * 自己取資料（各自的 hooks），金額與狀態一律照 API 回的畫（spec W9）。
 *
 * 借還紀錄屬於使用者、不屬於帳本（`phase-3b-debts.md` 決策 17），所以這個檢視
 * 不吃帳本參數，上方註明「不分帳本」，免得使用者拿它跟某一本帳本對帳。
 */
export function DebtsView({ onSelectDebt }: DebtsViewProps) {
  const [status, setStatus] = useState<DebtStatus>('OPEN');
  const [page, setPage] = useState(1);

  function handleStatusChange(next: DebtStatus) {
    setStatus(next);
    // 換狀態分頁就回第 1 頁：每個狀態的總頁數不同，停在第 5 頁只會看到空白，
    // 而且畫面上沒有任何線索說明原因。
    setPage(1);
  }

  return (
    <div className={styles.view}>
      <p className={styles.note}>借還紀錄不分帳本</p>

      <DebtSummaryCards />

      {/* 狀態分頁。用 aria-pressed 而非 role="tab"：內容區不是逐一對應的 tabpanel，
          按鈕的「按下／沒按下」就是它的全部語意。 */}
      <div className={styles.tabs}>
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            className={styles.tab}
            aria-pressed={status === tab.value}
            onClick={() => handleStatusChange(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <DebtList status={status} page={page} onPageChange={setPage} onSelectDebt={onSelectDebt} />
    </div>
  );
}
