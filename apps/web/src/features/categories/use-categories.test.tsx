import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api-client';
import {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useRenameCategory,
} from './use-categories';

/**
 * 分類 mutations 的兩件大事：**快取一致性**與**錯誤透傳**。
 *
 * 分類的管理 UI 還沒出現，這裡直接用 `renderHook` 釘住資料層的行為；fetch 照
 * `use-transactions.test.tsx` 的做法整個換成 mock。失效用的是前綴 key，所以每條
 * 寫入測試都同時掛「不帶篩選」與「帶 `?type=`」兩份清單，操作成功後兩份都必須
 * 重新請求——少失效任何一份都不會拋錯，只會讓某些畫面停在舊清單，這種問題沒有
 * 專屬案例釘不住。第四條釘住 409（名稱重複）時錯誤以 `ApiError` 原樣透傳：
 * 前端不翻譯後端訊息，呼叫端靠 `errorCode` 分辨失敗的種類。
 */
describe('Category mutations', () => {
  const fetchMock = vi.fn();

  const LEDGER_ID = 'ledger-1';
  const category = {
    id: 'cat-1',
    name: '餐飲',
    type: 'EXPENSE',
    createdAt: '2026-08-01T00:00:00.000Z',
  };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * 路由表照後端的端點形狀：GET 回清單、新增回 201、改名回 200、刪除回 204。
   * `nameTaken` 打開後寫入一律回 409（名稱重複），供錯誤那條測試使用。
   */
  function routeFetch(options: { nameTaken?: boolean } = {}) {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';

      if (options.nameTaken && method !== 'GET') {
        return Promise.resolve(
          jsonResponse(409, {
            statusCode: 409,
            errorCode: 'CATEGORY_NAME_TAKEN',
            message: 'A category with this name and type already exists.',
          }),
        );
      }
      if (method === 'POST') {
        return Promise.resolve(jsonResponse(201, { ...category, id: 'cat-new', name: '交通' }));
      }
      if (method === 'PATCH') {
        return Promise.resolve(jsonResponse(200, { ...category, name: '伙食' }));
      }
      if (method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(jsonResponse(200, [category]));
    });
  }

  /**
   * 每條測試一個全新的 QueryClient：快取是 per-client 的，沿用會讓上一條的資料
   * 流進下一條。重試一律關掉——測試裡的失敗都是確定性的，重試只會拖慢測試、
   * 讓 `error` 晚半天出現。
   */
  function freshClientWrapper() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return { queryClient, wrapper };
  }

  /** 數「對分類清單的 GET」被請求了幾次；`withTypeFilter` 指定數帶不帶 `?type=`。 */
  function listRequestCount(withTypeFilter: boolean): number {
    return fetchMock.mock.calls.filter((call) => {
      const url = String(call[0]);
      const method = (call[1] as RequestInit | undefined)?.method ?? 'GET';
      return (
        url.includes('/categories') && method === 'GET' && url.includes('?type=') === withTypeFilter
      );
    }).length;
  }

  /**
   * 掛上兩份清單（全部／僅支出），等初次載入完成後回傳計數基準。之後的斷言都在
   * 數「同一份清單被請求了第幾次」：次數變多＝快取真的失效並重取了。
   */
  async function mountCategoryLists() {
    const { wrapper } = freshClientWrapper();

    const all = renderHook(() => useCategories(LEDGER_ID), { wrapper });
    const expenses = renderHook(() => useCategories(LEDGER_ID, 'EXPENSE'), { wrapper });

    await waitFor(() => expect(all.result.current.data).toEqual([category]));
    await waitFor(() => expect(expenses.result.current.data).toEqual([category]));

    return { wrapper, before: { all: listRequestCount(false), expenses: listRequestCount(true) } };
  }

  async function expectBothListsRefetched(before: {
    all: number;
    expenses: number;
  }): Promise<void> {
    await waitFor(() => {
      expect(listRequestCount(false)).toBeGreaterThan(before.all);
    });
    await waitFor(() => {
      expect(listRequestCount(true)).toBeGreaterThan(before.expenses);
    });
  }

  it('refetches both category lists after a category is created', async () => {
    routeFetch();
    const { wrapper, before } = await mountCategoryLists();

    const create = renderHook(() => useCreateCategory(LEDGER_ID), { wrapper });
    await act(async () => {
      await create.result.current.mutateAsync({ name: '交通', type: 'EXPENSE' });
    });

    await expectBothListsRefetched(before);
  });

  it('refetches both category lists after a category is renamed', async () => {
    routeFetch();
    const { wrapper, before } = await mountCategoryLists();

    const rename = renderHook(() => useRenameCategory(LEDGER_ID), { wrapper });
    await act(async () => {
      await rename.result.current.mutateAsync({ id: category.id, name: '伙食' });
    });

    await expectBothListsRefetched(before);
  });

  it('refetches both category lists after a category is deleted', async () => {
    routeFetch();
    const { wrapper, before } = await mountCategoryLists();

    const remove = renderHook(() => useDeleteCategory(LEDGER_ID), { wrapper });
    await act(async () => {
      await remove.result.current.mutateAsync(category.id);
    });

    await expectBothListsRefetched(before);
  });

  it('passes a 409 CATEGORY_NAME_TAKEN through as an ApiError', async () => {
    routeFetch({ nameTaken: true });
    const { wrapper } = freshClientWrapper();

    const create = renderHook(() => useCreateCategory(LEDGER_ID), { wrapper });
    await act(async () => {
      // 錯誤由 mutation.error 承接；這裡 catch 只是避免 unhandled rejection。
      await create.result.current
        .mutateAsync({ name: '餐飲', type: 'EXPENSE' })
        .catch(() => undefined);
    });

    // error 是 observer 上的 React 狀態，晚一步才更新，等它就位再讀欄位。
    await waitFor(() => expect(create.result.current.error).toBeInstanceOf(ApiError));
    // toBeInstanceOf 不會收斂型別，手動縮一次再讀欄位。
    const apiError = create.result.current.error as ApiError;
    expect(apiError.statusCode).toBe(409);
    expect(apiError.errorCode).toBe('CATEGORY_NAME_TAKEN');
  });
});
