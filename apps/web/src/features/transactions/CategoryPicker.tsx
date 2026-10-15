import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Category } from '@ledger/shared';
import { ChevronDown } from 'lucide-react';
import { CategoryIcon } from '../../components/CategoryIcon';
import fieldStyles from '../../components/TextField.module.css';
import styles from './CategoryPicker.module.css';

interface CategoryPickerProps {
  categories: Category[];
  value: string;
  onChange: (categoryId: string) => void;
  allowClear?: boolean;
}

/** 分類選單用按鈕列出圖示與名稱，讓一般交易與借還共用同一套選擇方式。 */
export function CategoryPicker({
  categories,
  value,
  onChange,
  allowClear = false,
}: CategoryPickerProps) {
  const pickerId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedCategory = categories.find((category) => category.id === value);

  function handleOptionsKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      setIsOpen(false);
      triggerRef.current?.focus();
    }
  }

  function selectCategory(categoryId: string) {
    onChange(categoryId);
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className={`${fieldStyles.field} ${styles.categoryField}`}>
      <span className={fieldStyles.label}>分類</span>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        className={`${fieldStyles.input} ${styles.categoryTrigger}`}
        aria-label="分類"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={pickerId}
        aria-valuetext={selectedCategory?.name ?? '請選擇分類'}
        onClick={() => setIsOpen((current) => !current)}
      >
        <CategoryIcon icon={selectedCategory?.icon} size={16} />
        <span className={styles.categoryValue}>{selectedCategory?.name ?? '請選擇分類'}</span>
        <ChevronDown aria-hidden="true" className={styles.categoryChevron} size={16} />
      </button>
      {isOpen && (
        <div
          id={pickerId}
          role="listbox"
          aria-label="分類"
          className={styles.categoryOptions}
          onKeyDown={handleOptionsKeyDown}
        >
          {allowClear && (
            <button
              type="button"
              role="option"
              aria-selected={value === ''}
              className={styles.categoryOption}
              onClick={() => selectCategory('')}
            >
              <span className={styles.categoryValue}>不選</span>
            </button>
          )}
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              role="option"
              aria-selected={category.id === value}
              className={styles.categoryOption}
              onClick={() => selectCategory(category.id)}
            >
              <CategoryIcon icon={category.icon} size={16} />
              <span className={styles.categoryValue}>{category.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
