import { useState, type FormEvent } from 'react';
import {
  CATEGORY_ICONS,
  type Category,
  type CategoryIcon,
  type CategoryType,
} from '@ledger/shared';
import { Button } from '../../components/Button';
import { CategoryIcon as CategoryIconView } from '../../components/CategoryIcon';
import { Dialog, type DialogVariant } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { TextField } from '../../components/TextField';
import { useCreateCategory, useUpdateCategory } from './use-categories';
import styles from './CategoryDialog.module.css';

interface CategoryDialogProps {
  /** 彈窗作用中的帳本。分類巢狀在帳本之下，寫入時要帶進端點。 */
  ledgerId: string;
  /** null 代表關閉；`{ type }` 為新增那個型別；給分類則是編輯那一筆。 */
  target: Category | { type: CategoryType } | null;
  onClose: () => void;
  /**
   * `modal`（預設）＝改名用的小視窗；`panel`＝嵌在區塊裡、往下展開的新增面板
   * （phase-2h §4.7：新增往下展開、改名維持小視窗）。表單內容完全共用，
   * 差別只有外殼，所以只是把 prop 透傳給 Dialog。
   */
  variant?: DialogVariant;
}

/**
 * 新增／編輯分類的表單。兩種用途共用同一份內容，比照 `AccountDialog`：
 * 外層判斷開關、內層才是掛了 hooks 的表單元件，並用 key 讓「換一筆編輯」時
 * 整個重建，輸入狀態不會殘留上一筆。
 *
 * 分類型別在建立後固定，圖示代號只從 shared 清單選；新增預設通用圖示，更新時
 * 將名稱與圖示一起送出。
 *
 * 送出失敗時**表單不關**（例如名稱重複的 409）：關掉的話使用者剛打的字全沒了，
 * 而且多半根本沒看到錯誤訊息。錯誤沿用 `FormError`，直接呈現後端的文字。
 */
export function CategoryDialog({
  ledgerId,
  target,
  onClose,
  variant = 'modal',
}: CategoryDialogProps) {
  if (!target) {
    return null;
  }
  // 新增用型別、改名用分類 id 當 key——兩種目標各自重建，不會互踩。
  const key = 'id' in target ? target.id : `new-${target.type}`;
  return (
    <CategoryDialogForm
      key={key}
      ledgerId={ledgerId}
      target={target}
      onClose={onClose}
      variant={variant}
    />
  );
}

function CategoryDialogForm({
  ledgerId,
  target,
  onClose,
  variant,
}: {
  ledgerId: string;
  target: Category | { type: CategoryType };
  onClose: () => void;
  variant: DialogVariant;
}) {
  const isNew = !('id' in target);
  const [name, setName] = useState(isNew ? '' : target.name);
  const [icon, setIcon] = useState<CategoryIcon | null>(isNew ? null : target.icon);

  const createCategory = useCreateCategory(ledgerId);
  const updateCategory = useUpdateCategory(ledgerId);
  const mutation = isNew ? createCategory : updateCategory;

  // 標題把型別講出來——使用者按的是「支出」還是「收入」那組的新增，展開之後
  // 視線就離開按鈕了，只剩標題還記得這件事。
  const title = isNew ? (target.type === 'EXPENSE' ? '新增支出分類' : '新增收入分類') : '編輯分類';

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if ('id' in target) {
      updateCategory.mutate({ id: target.id, name, icon }, { onSuccess: onClose });
    } else {
      createCategory.mutate({ name, type: target.type, icon }, { onSuccess: onClose });
    }
  }

  return (
    <Dialog open title={title} onClose={onClose} variant={variant}>
      <form onSubmit={handleSubmit} noValidate>
        <FormError error={mutation.error} />

        <TextField
          label="名稱"
          value={name}
          required
          maxLength={50}
          onChange={(event) => setName(event.target.value)}
        />

        <div className={styles.iconField}>
          <span className={styles.label}>圖示</span>
          <div className={styles.iconGrid} role="group" aria-label="圖示">
            <button
              type="button"
              className={`${styles.iconOption} ${icon === null ? styles.selected : ''}`}
              aria-label="通用"
              aria-pressed={icon === null}
              onClick={() => setIcon(null)}
            >
              <CategoryIconView icon={null} />
            </button>
            {CATEGORY_ICONS.map((categoryIcon) => (
              <button
                key={categoryIcon}
                type="button"
                className={`${styles.iconOption} ${icon === categoryIcon ? styles.selected : ''}`}
                aria-label={categoryIcon}
                aria-pressed={icon === categoryIcon}
                onClick={() => setIcon(categoryIcon)}
              >
                <CategoryIconView icon={categoryIcon} />
              </button>
            ))}
          </div>
        </div>

        <Button type="submit" block disabled={mutation.isPending}>
          {mutation.isPending ? '儲存中…' : isNew ? '新增' : '儲存'}
        </Button>
      </form>
    </Dialog>
  );
}
