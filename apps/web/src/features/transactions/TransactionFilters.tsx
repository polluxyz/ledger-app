import type { TransactionType } from '@ledger/shared';
import { Select } from '../../components/Select';
import { TextField } from '../../components/TextField';
import { useCategories } from '../categories/use-categories';
import { EMPTY_FILTERS, hasAnyFilter, type TransactionFilters } from './transaction-query';
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
  // 不帶型別＝拿全部分類。使用者可能還沒選型別，就想直接挑一個分類。
  const categories = useCategories(ledgerId);

  function update(patch: Partial<TransactionFilters>) {
    onChange({ ...filters, ...patch });
  }

  const isTransfer = filters.type === 'TRANSFER';

  return (
    <section className={styles.bar} aria-label="篩選交易">
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

      {hasAnyFilter(filters) && (
        <button type="button" className={styles.clear} onClick={() => onChange(EMPTY_FILTERS)}>
          清除篩選
        </button>
      )}
    </section>
  );
}
