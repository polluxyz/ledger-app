import type { Category } from '@ledger/shared';
import { FormError } from '../../components/FormError';
import styles from './CategoryList.module.css';

interface CategoryListProps {
  /** 同一型別的一組分類（支出或收入）——由呼叫端每個型別各渲染一次。 */
  categories: Category[];
  isLoading: boolean;
  error: unknown;
  /** 帳本角色為 viewer 時為 false。此時**完全不畫**操作按鈕，而不是停用：
   *  停用的按鈕會讓人以為「現在不行的話，總有一天會行」，唯讀成員永遠不行。 */
  canEdit: boolean;
  onEdit: (category: Category) => void;
  onRemove: (category: Category) => void;
}

/**
 * 單一型別的分類列表（支出與收入各一份，由呼叫端渲染兩次）。
 *
 * 形狀比照 `AccountList`——同樣是一列一筆、右側動作，讓幾個管理頁看起來
 * 屬於同一個 app。列表的 key **一律用 id**：預設分類裡支出與收入各有一個
 * 「其他」，用 name 當 key 會在同一份清單之外又撞一次（React 只要求 key
 * 在同一個 list 內唯一，但元件一被複用，這個假設就碎了）。
 *
 * 這裡只負責呈現與轉發：新增／改名／刪除的流程都在彈窗與呼叫端手裡。
 */
export function CategoryList({
  categories,
  isLoading,
  error,
  canEdit,
  onEdit,
  onRemove,
}: CategoryListProps) {
  if (isLoading) {
    return <p className={styles.status}>載入中…</p>;
  }
  if (error) {
    return <FormError error={error} />;
  }
  if (categories.length === 0) {
    return <p className={styles.empty}>還沒有任何分類。</p>;
  }

  return (
    <ul className={styles.list}>
      {categories.map((category) => (
        <li className={styles.item} key={category.id}>
          <span className={styles.name}>{category.name}</span>
          {canEdit && (
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.action}
                onClick={() => onEdit(category)}
                aria-label={`改名${category.name}`}
              >
                改名
              </button>
              <button
                type="button"
                className={`${styles.action} ${styles.remove}`}
                onClick={() => onRemove(category)}
                aria-label={`刪除${category.name}`}
              >
                刪除
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
