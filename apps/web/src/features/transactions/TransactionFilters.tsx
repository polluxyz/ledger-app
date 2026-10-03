import { useId, useState } from 'react';
import type { TransactionType } from '@ledger/shared';
import { Filter } from 'lucide-react';
import { Select } from '../../components/Select';
import { TextField } from '../../components/TextField';
import { useCategories } from '../categories/use-categories';
import { EMPTY_FILTERS, type TransactionFilters } from './transaction-query';
import styles from './TransactionFilters.module.css';

interface TransactionFiltersProps {
  ledgerId: string;
  filters: TransactionFilters;
  onChange: (filters: TransactionFilters) => void;
}

/**
 * 交易列表的篩選列：型別、分類、日期區間。
 *
 * 篩選本身完全交給後端（`?type=&categoryId=&from=&to=`）——前端不自行過濾拿到的
 * 那一頁，那樣算出來的結果只涵蓋當頁，是錯的。
 *
 * 條件不寫進網址（D4），所以重整會回到預設。代價是篩選結果無法用網址分享，
 * 等真的有這個需求再改。
 */
export function TransactionFilterBar({ ledgerId, filters, onChange }: TransactionFiltersProps) {
  const filterFieldsId = useId();
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className={styles.bar}>
      <div className={styles.toolbar}>
        <TransactionFilterToggle
          filters={filters}
          expanded={isExpanded}
          controlsId={filterFieldsId}
          onToggle={() => setIsExpanded((current) => !current)}
        />
      </div>
      {isExpanded && (
        <TransactionFilterPanel
          id={filterFieldsId}
          ledgerId={ledgerId}
          filters={filters}
          onChange={onChange}
        />
      )}
    </div>
  );
}

interface TransactionFilterToggleProps {
  filters: TransactionFilters;
  expanded: boolean;
  controlsId: string;
  onToggle: () => void;
}

/**
 * 漏斗按鈕（3d T6）。與欄位面板拆開，讓交易頁把它放在「明細／借還」那一列的右邊，
 * 不必為了一顆按鈕在列表卡片上多佔一整列。有條件時右上角顯示條件數量。
 */
export function TransactionFilterToggle({
  filters,
  expanded,
  controlsId,
  onToggle,
}: TransactionFilterToggleProps) {
  const filterCount = countFilters(filters);
  return (
    <button
      type="button"
      className={styles.toggle}
      aria-label="篩選"
      aria-expanded={expanded}
      aria-controls={controlsId}
      onClick={onToggle}
    >
      <Filter aria-hidden="true" size={18} />
      {filterCount > 0 && <span className={styles.count}>{filterCount}</span>}
    </button>
  );
}

interface TransactionFilterPanelProps extends TransactionFiltersProps {
  id: string;
}

/** 展開後的四個欄位與「清除」。 */
export function TransactionFilterPanel({
  id,
  ledgerId,
  filters,
  onChange,
}: TransactionFilterPanelProps) {
  // 不帶型別＝拿全部分類。使用者可能還沒選型別，就想直接挑一個分類。
  const categories = useCategories(ledgerId);

  function update(patch: Partial<TransactionFilters>) {
    onChange({ ...filters, ...patch });
  }

  const isTransfer = filters.type === 'TRANSFER';
  const filterCount = countFilters(filters);

  return (
    <section id={id} className={styles.panel} aria-label="篩選交易">
      {/* 欄位另外包一層，才抵銷得掉它們自帶的下邊距（見 module.css 的說明）。 */}
      <div className={styles.fields}>
        <Select
          label="型別"
          value={filters.type}
          onChange={(event) => {
            const type = event.target.value as TransactionType | '';
            // 轉帳沒有分類，選了之後把分類條件一起清掉，免得篩出空結果卻看不出原因。
            update({ type, ...(type === 'TRANSFER' ? { categoryId: '' } : {}) });
          }}
        >
          <option value="">全部</option>
          <option value="EXPENSE">支出</option>
          <option value="INCOME">收入</option>
          <option value="TRANSFER">轉帳</option>
        </Select>

        {/* 這裡用「停用」是對的：切回支出或收入就恢復，確實只是暫時不能選。 */}
        <Select
          label="分類"
          value={filters.categoryId}
          disabled={isTransfer}
          onChange={(event) => update({ categoryId: event.target.value })}
        >
          <option value="">{isTransfer ? '轉帳沒有分類' : '全部'}</option>
          {categories.data?.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>

        <TextField
          label="起日"
          type="date"
          value={filters.from}
          onChange={(event) => update({ from: event.target.value })}
        />
        <TextField
          label="迄日"
          type="date"
          value={filters.to}
          onChange={(event) => update({ to: event.target.value })}
        />

        {filterCount > 0 && (
          <button type="button" className={styles.clear} onClick={() => onChange(EMPTY_FILTERS)}>
            清除
          </button>
        )}
      </div>
    </section>
  );
}

function countFilters(filters: TransactionFilters): number {
  return Object.values(filters).filter((value) => value !== '').length;
}
