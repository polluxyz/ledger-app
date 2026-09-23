import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  Category,
  CategoryType,
  CreateCategoryRequest,
  UpdateCategoryRequest,
} from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';

/**
 * 某帳本分類快取的**前綴** key。`useCategories` 依型別篩選會在後面接出多份快取
 * （帶 `?type=` 與不帶），因此失效一律用這個前綴——react-query 是前綴比對，
 * 一次涵蓋所有篩選組合。做法與 `transactionsKey` 同一套。
 */
export function categoriesKey(ledgerId: string | null) {
  return ['categories', ledgerId] as const;
}

/**
 * 某帳本的分類，可依交易型別篩選——記一筆支出時只該看到支出分類。
 * 篩選交給後端做（`?type=`），前端不自行過濾。
 *
 * `type` 省略時拿全部分類，交易列表的分類篩選需要它（那時還不知道使用者要篩
 * 哪一種型別）。後端的 `?type=` 本來就是選填。
 *
 * 型別參數用 `CategoryType`（僅收入／支出）而非 `TransactionType`：轉帳沒有分類，
 * 用寬的那組會讓人以為可以傳 `TRANSFER` 進來查。
 */
export function useCategories(ledgerId: string | null, type?: CategoryType) {
  return useQuery({
    queryKey: [...categoriesKey(ledgerId), type],
    queryFn: () =>
      apiRequest<Category[]>(
        `/ledgers/${ledgerId!}/categories${type === undefined ? '' : `?type=${type}`}`,
      ),
    // 沒有帳本 id 就不發請求。
    enabled: ledgerId !== null,
  });
}

/**
 * 任何會改變分類的操作，成功後都要跑這一段。
 *
 * 用**前綴**失效而不是完整 key：清單快取依型別篩選有多份，改動一次就該全部重取，
 * 不然「新增支出分類後，不帶篩選的那份快取少了它」這種不一致不會拋錯，只會在
 * 某些畫面悄悄出現舊清單——`use-categories.test.tsx` 為此把兩份清單都釘住。
 */
function invalidateCategories(queryClient: QueryClient, ledgerId: string | null): void {
  void queryClient.invalidateQueries({ queryKey: categoriesKey(ledgerId) });
}

/**
 * 以下三個 mutation 都不攔截錯誤——`apiRequest` 已把後端的統一錯誤格式轉成
 * `ApiError`，呼叫端交給 `FormError` 呈現即可。前端不自行改寫錯誤訊息：
 * 那是後端的職責，重寫只會讓兩邊講法不一致。
 */

/**
 * 新增分類。同帳本內**名稱＋型別**重複時後端回 409 `CATEGORY_NAME_TAKEN`。
 */
export function useCreateCategory(ledgerId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateCategoryRequest) =>
      apiRequest<Category>(`/ledgers/${ledgerId!}/categories`, { method: 'POST', body: input }),
    onSuccess: () => invalidateCategories(queryClient, ledgerId),
  });
}

/**
 * 分類改名。**只有名稱可改**——型別牽動既有交易的型別一致性，要「換型別」
 * 等於刪除後重建（見 `UpdateCategoryRequest` 的說明），所以 body 只送 `{ name }`。
 */
export function useRenameCategory(ledgerId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...input }: UpdateCategoryRequest & { id: string }) =>
      apiRequest<Category>(`/ledgers/${ledgerId!}/categories/${id}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => invalidateCategories(queryClient, ledgerId),
  });
}

/**
 * 刪除分類。仍被交易引用時後端回 409 `CATEGORY_IN_USE`（含已軟刪除的交易——
 * 歷史紀錄必須保持可追溯），此時該讓使用者知道而不是靜默失敗。
 */
export function useDeleteCategory(ledgerId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    // 成功時後端回 204 無 body，`apiRequest` 會回 undefined。
    mutationFn: (categoryId: string) =>
      apiRequest<void>(`/ledgers/${ledgerId!}/categories/${categoryId}`, { method: 'DELETE' }),
    onSuccess: () => invalidateCategories(queryClient, ledgerId),
  });
}
