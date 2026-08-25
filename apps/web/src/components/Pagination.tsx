import styles from './Pagination.module.css';

interface PaginationProps {
  /** 以 1 為起始。 */
  page: number;
  /** 每頁筆數，由後端回應決定。 */
  limit: number;
  /** 符合目前條件的總筆數（不是當頁筆數）。 */
  total: number;
  onChange: (page: number) => void;
}

/**
 * 上一頁 / 下一頁的翻頁列。
 *
 * 總頁數由 `total / limit` 算出來——這是呈現用的除法，不是業務邏輯：分頁本身
 * 由後端執行（`?page=&limit=`），前端只是把它拿到的數字換句話說。
 *
 * 只有一頁時整個不渲染。那時翻頁鈕兩顆都是停用的，放著只會讓人以為壞了。
 */
export function Pagination({ page, limit, total, onChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  if (totalPages <= 1) {
    return null;
  }

  return (
    <nav className={styles.bar} aria-label="分頁">
      <button
        type="button"
        className={styles.button}
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        上一頁
      </button>
      <span className={styles.status}>
        第 {page} / {totalPages} 頁
      </span>
      <button
        type="button"
        className={styles.button}
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        下一頁
      </button>
    </nav>
  );
}
