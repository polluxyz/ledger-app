import { useState, type FormEvent } from 'react';
import type { Category, CategoryType } from '@ledger/shared';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { TextField } from '../../components/TextField';
import { useCreateCategory, useRenameCategory } from './use-categories';

interface CategoryDialogProps {
  /** 彈窗作用中的帳本。分類巢狀在帳本之下，寫入時要帶進端點。 */
  ledgerId: string;
  /** null 代表關閉；`{ type }` 為新增那個型別；給分類則是改名那一筆。 */
  target: Category | { type: CategoryType } | null;
  onClose: () => void;
}

/**
 * 新增／改名分類的表單彈窗。兩種用途共用同一份表單，比照 `AccountDialog`：
 * 外層判斷開關、內層才是掛了 hooks 的表單元件，並用 key 讓「換一筆編輯」時
 * 整個重建，輸入狀態不會殘留上一筆。
 *
 * 表單上**只有名稱**一個欄位：新增的型別由 target 帶進來（按哪一組的「新增」
 * 就是建那個型別），改名時型別不可變——它牽動既有交易的型別一致性，後端的
 * `UpdateCategoryRequest` 也只收 name。
 *
 * 送出失敗時**彈窗不關**（例如名稱重複的 409）：關掉的話使用者剛打的字全沒了，
 * 而且多半根本沒看到錯誤訊息。錯誤沿用 `FormError`，直接呈現後端的文字。
 */
export function CategoryDialog({ ledgerId, target, onClose }: CategoryDialogProps) {
  if (!target) {
    return null;
  }
  // 新增用型別、改名用分類 id 當 key——兩種目標各自重建，不會互踩。
  const key = 'id' in target ? target.id : `new-${target.type}`;
  return <CategoryDialogForm key={key} ledgerId={ledgerId} target={target} onClose={onClose} />;
}

function CategoryDialogForm({
  ledgerId,
  target,
  onClose,
}: {
  ledgerId: string;
  target: Category | { type: CategoryType };
  onClose: () => void;
}) {
  const isNew = !('id' in target);
  const [name, setName] = useState(isNew ? '' : target.name);

  const createCategory = useCreateCategory(ledgerId);
  const renameCategory = useRenameCategory(ledgerId);
  const mutation = isNew ? createCategory : renameCategory;

  // 標題把型別講出來——使用者按的是「支出」還是「收入」那組的新增，開了彈窗
  // 之後就看不到了，只剩標題還記得這件事。
  const title = isNew ? (target.type === 'EXPENSE' ? '新增支出分類' : '新增收入分類') : '編輯分類';

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if ('id' in target) {
      // 改名只送名稱。型別不可變（見檔頭說明），多送也會被後端退回 400。
      renameCategory.mutate({ id: target.id, name }, { onSuccess: onClose });
    } else {
      createCategory.mutate({ name, type: target.type }, { onSuccess: onClose });
    }
  }

  return (
    <Dialog open title={title} onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate>
        <FormError error={mutation.error} />

        <TextField
          label="名稱"
          value={name}
          required
          maxLength={50}
          onChange={(event) => setName(event.target.value)}
        />

        <Button type="submit" block disabled={mutation.isPending}>
          {mutation.isPending ? '儲存中…' : isNew ? '新增' : '儲存'}
        </Button>
      </form>
    </Dialog>
  );
}
