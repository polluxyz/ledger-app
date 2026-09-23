import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Category, CategoryType, LedgerSummary } from '@ledger/shared';
import { RightPanel } from '../app/RightPanel';
import { RightPanelProvider } from '../app/RightPanelProvider';
import { AuthProvider } from '../features/auth/AuthProvider';
import { ActiveLedgerProvider } from '../features/ledgers/ActiveLedgerProvider';
import CategoriesPage from './CategoriesPage';

/**
 * 分類管理頁的行為：兩組清單、新增／改名／刪除的資料流、帳本選擇與網址的同步、
 * 以及「管理中帳本 ≠ 作用中帳本」的提示條。
 *
 * 策略：不經過 App 的路由（這一頁還沒掛進去），自己組 Provider 鏈
 * （QueryClient → Auth → ActiveLedger → MemoryRouter → RightPanel）直接渲染頁面；
 * 新增分類的表單住在右側欄（spec 2i SC-42），所以這裡要連外殼的 `RightPanel`
 * 一起掛上，portal 才有地方去。fetch 照
 * `LedgerDetailPage.test.tsx` 的做法整個換成 mock。mock 這邊維護一個「每本帳本
 * 的分類存放區」，寫入操作（POST／PATCH／DELETE）會真的改到它，快取失效重取之後
 * 畫面自然看得到變化——與其斷言 invalidation 被呼叫，不如斷言使用者看到的結果。
 *
 * 刪除與名稱重複的 409 各有一條「彈窗不關」：那種錯誤是按下按鈕**之後**才發生的，
 * 關掉的話使用者只會看到「什麼都沒發生」。
 */

/** 把記憶體路由的查詢字串印到畫面上——MemoryRouter 不動 window.location，網址只能在這裡斷言。 */
function SearchProbe() {
  const [searchParams] = useSearchParams();
  return <p data-testid="search">{searchParams.toString()}</p>;
}

describe('Categories page', () => {
  const fetchMock = vi.fn();

  const personal: LedgerSummary = {
    id: 'led-1',
    name: '個人帳本',
    currency: 'TWD',
    kind: 'PERSONAL',
    tracksBalance: true,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    role: 'OWNER',
  };
  const travel: LedgerSummary = {
    ...personal,
    id: 'led-2',
    name: '旅遊帳本',
    kind: 'SHARED',
    role: 'EDITOR',
  };
  // Bob 在家庭帳本只是 VIEWER——給「檢視者什麼都不能按」那條測試用。
  const family: LedgerSummary = {
    ...personal,
    id: 'led-3',
    name: '家庭帳本',
    kind: 'SHARED',
    role: 'VIEWER',
  };

  const ledgers = [personal, travel, family];

  /** sortOrder 依呼叫順序給值——這一頁不拿它排序（後端排好了），但型別要求它存在。 */
  let nextSortOrder = 0;
  function category(id: string, name: string, type: CategoryType): Category {
    return { id, name, type, sortOrder: nextSortOrder++, createdAt: '2026-08-01T00:00:00.000Z' };
  }

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    // 作用中帳本固定是個人帳本；要測「不一致提示條」時用網址把選到的帳本岔開。
    localStorage.setItem('ledger.activeLedgerId', 'led-1');
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

  /** RequestInit.body 可能是 Blob 等非字串形狀；這裡的表單送出的都是 JSON 字串。 */
  function readBody(init?: RequestInit): string {
    const body = init?.body;
    return typeof body === 'string' ? body : '{}';
  }

  /**
   * 每本帳本一份「支出／收入」存放區，寫入會真的改到它，重取就看得到變化。
   * `nameTaken` 讓寫入一律回 409（名稱重複）、`inUse` 讓刪除回 409（仍有交易引用）。
   */
  function routeFetch(options: { nameTaken?: boolean; inUse?: boolean } = {}) {
    const store: Record<string, Record<CategoryType, Category[]>> = {
      'led-1': {
        EXPENSE: [
          category('cat-food', '餐飲', 'EXPENSE'),
          category('cat-trans', '交通', 'EXPENSE'),
        ],
        INCOME: [category('cat-salary', '薪水', 'INCOME')],
      },
      'led-2': {
        EXPENSE: [category('cat-flight', '機票', 'EXPENSE')],
        INCOME: [],
      },
      'led-3': {
        EXPENSE: [category('cat-grocery', '日用品', 'EXPENSE')],
        INCOME: [category('cat-bonus', '紅包', 'INCOME')],
      },
    };

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const target = String(url);
      const method = init?.method ?? 'GET';

      if (target.includes('/categories')) {
        const ledgerId = target.split('/ledgers/')[1]?.split('/')[0] ?? '';
        const group = store[ledgerId];

        if (method === 'POST') {
          if (options.nameTaken) {
            return Promise.resolve(
              jsonResponse(409, {
                statusCode: 409,
                errorCode: 'CATEGORY_NAME_TAKEN',
                message: 'A category with this name and type already exists.',
              }),
            );
          }
          const body = JSON.parse(readBody(init)) as {
            name: string;
            type: CategoryType;
          };
          const created: Category = {
            id: 'cat-created',
            name: body.name,
            type: body.type,
            sortOrder: 99,
            createdAt: '2026-08-02T00:00:00.000Z',
          };
          group?.[body.type].push(created);
          return Promise.resolve(jsonResponse(201, created));
        }

        if (method === 'PATCH') {
          const categoryId = target.split('/categories/')[1] ?? '';
          const body = JSON.parse(readBody(init)) as { name: string };
          for (const type of ['EXPENSE', 'INCOME'] as const) {
            const found = group?.[type].find((item) => item.id === categoryId);
            if (found) {
              found.name = body.name;
              return Promise.resolve(jsonResponse(200, { ...found }));
            }
          }
          return Promise.resolve(
            jsonResponse(404, { statusCode: 404, errorCode: 'NOT_FOUND', message: 'Not found' }),
          );
        }

        if (method === 'DELETE') {
          if (options.inUse) {
            return Promise.resolve(
              jsonResponse(409, {
                statusCode: 409,
                errorCode: 'CATEGORY_IN_USE',
                message: 'Cannot delete a category that transactions reference.',
              }),
            );
          }
          const categoryId = target.split('/categories/')[1] ?? '';
          for (const type of ['EXPENSE', 'INCOME'] as const) {
            const list = group?.[type] ?? [];
            const index = list.findIndex((item) => item.id === categoryId);
            if (index >= 0) {
              list.splice(index, 1);
              break;
            }
          }
          return Promise.resolve(new Response(null, { status: 204 }));
        }

        const type = new URL(target).searchParams.get('type');
        return Promise.resolve(
          jsonResponse(200, group?.[type === 'INCOME' ? 'INCOME' : 'EXPENSE'] ?? []),
        );
      }

      if (target.includes('/ledgers')) {
        return Promise.resolve(jsonResponse(200, ledgers));
      }
      return Promise.resolve(jsonResponse(200, []));
    });
  }

  function renderPage(initialUrl = '/categories') {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ActiveLedgerProvider>
            <MemoryRouter initialEntries={[initialUrl]}>
              <RightPanelProvider>
                <SearchProbe />
                <CategoriesPage />
                <RightPanel />
              </RightPanelProvider>
            </MemoryRouter>
          </ActiveLedgerProvider>
        </AuthProvider>
      </QueryClientProvider>,
    );
  }

  it('shows the expense and income groups with their counts', async () => {
    routeFetch();
    renderPage();

    expect(await screen.findByRole('heading', { name: '支出（2）' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '收入（1）' })).toBeInTheDocument();
    expect(screen.getByText('餐飲')).toBeInTheDocument();
    expect(screen.getByText('薪水')).toBeInTheDocument();
  });

  it('creates an expense category with the right type and shows it', async () => {
    routeFetch();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '新增支出分類' }));
    await user.type(screen.getByLabelText('名稱'), '娛樂');
    await user.click(screen.getByRole('button', { name: '新增' }));

    // 送出去的 body 必須帶正確的 type——表單上沒有型別欄位，它由按鈕那一組決定。
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
      );
      expect(post).toBeDefined();
      const body = JSON.parse(readBody(post?.[1] as RequestInit | undefined)) as {
        name: string;
        type: CategoryType;
      };
      expect(body).toEqual({ name: '娛樂', type: 'EXPENSE' });
    });
    // 建立成功 → 快取失效 → 重取，新分類出現在支出那一組。
    expect(await screen.findByRole('heading', { name: '支出（3）' })).toBeInTheDocument();
    expect(screen.getByText('娛樂')).toBeInTheDocument();
  });

  it('keeps the create dialog open and shows the error on a name conflict', async () => {
    routeFetch({ nameTaken: true });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '新增支出分類' }));
    await user.type(screen.getByLabelText('名稱'), '餐飲');
    await user.click(screen.getByRole('button', { name: '新增' }));

    // errorCode 有對照到中文就顯示中文；後端原文只是 mock 的一部分。
    expect(
      await screen.findByText('這個名稱已經有同型別的分類在用了，換一個名稱。'),
    ).toBeInTheDocument();
    // 關掉的話使用者剛打的字全沒了，多半也沒看到錯誤。
    expect(screen.getByRole('dialog', { name: '新增支出分類' })).toBeInTheDocument();
  });

  it('opens the create form in the right panel instead of inside the group', async () => {
    routeFetch();
    const user = userEvent.setup();
    renderPage();

    const expense = await screen.findByRole('button', { name: '新增支出分類' });
    expect(expense).toHaveAttribute('aria-expanded', 'false');

    await user.click(expense);

    expect(expense).toHaveAttribute('aria-expanded', 'true');
    const form = screen.getByRole('dialog', { name: '新增支出分類' });
    // SC-42：表單 portal 進外殼的右側欄，所以它不在頁面的任何一個 <section> 裡
    // （頁面本身與兩個分類區塊都是 section）。這個判準不依賴 CSS 類名。
    expect(form.closest('section')).toBeNull();
  });

  it('keeps only one create form expanded at a time', async () => {
    routeFetch();
    const user = userEvent.setup();
    renderPage();

    const expense = await screen.findByRole('button', { name: '新增支出分類' });
    const income = screen.getByRole('button', { name: '新增收入分類' });

    await user.click(expense);
    await user.click(income);

    // SC-30.5：兩個型別各有一顆新增鈕，但頁面上只能有一張新增表單——
    // 兩張同時展開的話，使用者打完字按「新增」根本分不清建到哪一組。
    expect(screen.getByRole('dialog', { name: '新增收入分類' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '新增支出分類' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(expense).toHaveAttribute('aria-expanded', 'false');
    expect(income).toHaveAttribute('aria-expanded', 'true');
  });

  it('updates the list after a rename', async () => {
    routeFetch();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '改名餐飲' }));
    const dialog = screen.getByRole('dialog', { name: '編輯分類' });
    const field = within(dialog).getByLabelText('名稱');
    await user.clear(field);
    await user.type(field, '伙食');
    await user.click(within(dialog).getByRole('button', { name: '儲存' }));

    expect(await screen.findByText('伙食')).toBeInTheDocument();
    expect(screen.queryByText('餐飲')).not.toBeInTheDocument();
  });

  it('keeps the confirm dialog open when the category is still in use', async () => {
    routeFetch({ inUse: true });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '刪除餐飲' }));
    await user.click(screen.getByRole('button', { name: '刪除' }));

    expect(
      await screen.findByText('這個分類已經有交易在用，不能刪除。可以改名，或先改那些交易的分類。'),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '刪除分類' })).toBeInTheDocument();
  });

  it('switches to another ledger and moves the ledgerId into the URL', async () => {
    routeFetch();
    const user = userEvent.setup();
    renderPage();

    // 起始畫面是作用中帳本（個人帳本）的分類。
    expect(await screen.findByText('餐飲')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('管理哪一本帳本的分類'), 'led-2');

    expect(await screen.findByText('機票')).toBeInTheDocument();
    expect(screen.queryByText('餐飲')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('search')).toHaveTextContent('ledgerId=led-2');
    });
  });

  it('shows the mismatch banner and dismisses it after syncing', async () => {
    routeFetch();
    const user = userEvent.setup();
    // 網址指定旅遊帳本，作用中帳本仍是個人帳本——兩邊不一致。
    renderPage('/categories?ledgerId=led-2');

    expect(await screen.findByText(/你正在管理「旅遊帳本」的分類/)).toBeInTheDocument();
    expect(screen.getByText(/記帳目前使用的是「個人帳本」/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '改用旅遊帳本記帳' }));

    // 同步之後兩邊一致，提示條消失——它只在需要時出現。
    await waitFor(() => {
      expect(screen.queryByText(/你正在管理/)).not.toBeInTheDocument();
    });
  });

  it('hides every write action from a viewer and says why', async () => {
    routeFetch();
    renderPage('/categories?ledgerId=led-3');

    expect(await screen.findByText('你在這本帳本是檢視者，無法變更分類。')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: '支出（1）' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新增支出分類' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新增收入分類' })).not.toBeInTheDocument();
    // 列上的兩顆鈕也完全不畫（CategoryList 的 canEdit），不是停用。
    expect(screen.queryByRole('button', { name: '改名日用品' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刪除日用品' })).not.toBeInTheDocument();
  });

  it('falls back to the active ledger when the URL points at a missing one', async () => {
    routeFetch();
    // 帳本被刪、被移出成員、被封存或手打亂填，都會長成「清單裡對不上」。
    renderPage('/categories?ledgerId=led-gone');

    expect(
      await screen.findByText('找不到指定的帳本，已改為顯示『個人帳本』的分類。'),
    ).toBeInTheDocument();
    // 不導頁、不清空畫面：退回作用中帳本的內容照常顯示。
    expect(await screen.findByRole('heading', { name: '支出（2）' })).toBeInTheDocument();
    expect(screen.getByText('餐飲')).toBeInTheDocument();
  });
});
