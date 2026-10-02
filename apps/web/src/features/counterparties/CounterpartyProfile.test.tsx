import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Counterparty } from '@ledger/shared';
import { CounterpartyProfile } from './CounterpartyProfile';

/**
 * CounterpartyProfile 驗「人的資料＋管理按鈕」（W52、W53）：已連動顯示帳號名稱與
 * 暱稱列、五個管理動作只在符合條件時出現，而且畫面上沒有任何帳（SC-W61）。
 * 策略：mock fetch 回固定對象與 entries total，逐項檢查按鈕與對話框文字（§10.2）。
 */
describe('CounterpartyProfile', () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;

  const linkedUser = { userId: 'user-2', userName: '王小明', theirBalance: 987600 };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => vi.unstubAllGlobals());

  function respondWith(
    options: {
      link?: Counterparty['link'];
      name?: string | null;
      displayName?: string;
      entriesTotal?: number;
    } = {},
  ) {
    fetchMock.mockImplementation((url: string) => {
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.includes('/counterparties/cp-1/entries')) {
        return json({ items: [], page: 1, limit: 1, total: options.entriesTotal ?? 0 });
      }
      if (url.endsWith('/counterparties/cp-1/link')) {
        return json({});
      }
      if (url.includes('/counterparties?')) {
        return json({ items: [], page: 1, limit: 100, total: 0 });
      }
      if (url.includes('/counterparties/cp-1')) {
        const name = options.name === undefined ? (options.link ? null : '小明') : options.name;
        return json({
          id: 'cp-1',
          name,
          displayName: options.displayName ?? name ?? options.link?.userName ?? '小明',
          askMerge: false,
          balance: 900,
          link: options.link ?? null,
          createdAt: '2026-09-01T04:00:00.000Z',
          updatedAt: '2026-09-01T04:00:00.000Z',
        });
      }
      return Promise.reject(new Error(`未預期的請求：${url}`));
    });
  }

  function renderProfile(
    options: {
      link?: Counterparty['link'];
      name?: string | null;
      displayName?: string;
      entriesTotal?: number;
    } = {},
  ) {
    const onDeleted = vi.fn();
    respondWith(options);
    const result = render(
      <QueryClientProvider client={queryClient}>
        <CounterpartyProfile counterpartyId="cp-1" onDeleted={onDeleted} />
      </QueryClientProvider>,
    );
    return { onDeleted, ...result };
  }

  it('shows linked identity rows and management actions with no account content (SC-W61)', async () => {
    const { container } = renderProfile({
      link: linkedUser,
      name: '小明的暱稱',
      displayName: '小明的暱稱',
    });

    expect(await screen.findByRole('heading', { name: '小明的暱稱' })).toBeInTheDocument();
    expect(screen.getByText('連動')).toBeInTheDocument();
    // 帳號名稱與暱稱各一列；沒設暱稱的案例在下一條。
    expect(screen.getByText('帳號名稱')).toBeInTheDocument();
    expect(screen.getByText('王小明')).toBeInTheDocument();
    expect(screen.getByText('暱稱')).toBeInTheDocument();
    expect(screen.getByText('小明的暱稱', { selector: 'dd' })).toBeInTheDocument();
    // W53：已連動只有這三個管理按鈕。
    expect(screen.getByRole('button', { name: '設定暱稱' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '合併之前的紀錄' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '解除連動' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '改名' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刪除對象' })).not.toBeInTheDocument();
    // SC-W61：對象頁右側欄沒有任何帳的內容。
    expect(container).not.toHaveTextContent(/欠/);
    expect(container).not.toHaveTextContent(/餘額/);
    expect(container).not.toHaveTextContent(/記一筆/);
    expect(container).not.toHaveTextContent(/免除剩餘/);
    expect(container).not.toHaveTextContent(/往來紀錄/);
    expect(container).not.toHaveTextContent('$9,876');
  });

  it('omits the nickname row when a linked counterparty has none', async () => {
    renderProfile({ link: linkedUser, name: null, displayName: '王小明' });

    expect(await screen.findByRole('heading', { name: '王小明' })).toBeInTheDocument();
    expect(screen.getByText('帳號名稱')).toBeInTheDocument();
    expect(screen.getByText('王小明', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.queryByText('暱稱')).not.toBeInTheDocument();
  });

  it('shows unlinked management actions and delete only when no entries remain', async () => {
    const withEntries = renderProfile({ entriesTotal: 1 });
    expect(await screen.findByRole('heading', { name: '小明' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '改名' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刪除對象' })).not.toBeInTheDocument();

    withEntries.unmount();
    renderProfile({ entriesTotal: 0 });
    expect(await screen.findByRole('heading', { name: '小明' })).toBeInTheDocument();
    // entries total 會重拉（同一個 queryClient 有舊快取），用 findBy 等它變 0。
    expect(await screen.findByRole('button', { name: '刪除對象' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '設定暱稱' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '合併之前的紀錄' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '解除連動' })).not.toBeInTheDocument();
  });

  it('renames an unlinked counterparty through the dialog', async () => {
    const user = userEvent.setup();
    renderProfile({ entriesTotal: 0 });

    await user.click(await screen.findByRole('button', { name: '改名' }));
    const dialog = screen.getByRole('dialog', { name: '改名' });
    expect(within(dialog).getByLabelText('對象名字')).toHaveValue('小明');

    await user.clear(within(dialog).getByLabelText('對象名字'));
    await user.type(within(dialog).getByLabelText('對象名字'), '新名字');
    await user.click(within(dialog).getByRole('button', { name: '儲存' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/counterparties\/cp-1$/),
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: '新名字' }) }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '改名' })).toBeNull());
  });

  it('opens the nickname and merge dialogs from the linked actions', async () => {
    const user = userEvent.setup();
    renderProfile({ link: linkedUser, name: '小明', displayName: '小明' });

    await user.click(await screen.findByRole('button', { name: '設定暱稱' }));
    const nickname = screen.getByRole('dialog', { name: '設定暱稱' });
    expect(within(nickname).getByLabelText('暱稱')).toHaveValue('小明');
    await user.click(within(nickname).getByRole('button', { name: '取消' }));

    await user.click(screen.getByRole('button', { name: '合併之前的紀錄' }));
    const merge = screen.getByRole('dialog', { name: '合併之前的紀錄' });
    expect(within(merge).getByRole('combobox', { name: '併入' })).toBeInTheDocument();
  });

  it('unlinks after the specified confirmation', async () => {
    const user = userEvent.setup();
    renderProfile({ link: linkedUser, name: '小明', displayName: '小明' });

    await user.click(await screen.findByRole('button', { name: '解除連動' }));
    const unlinkDialog = screen.getByRole('dialog', { name: '解除和小明的連動' });
    expect(unlinkDialog).toHaveTextContent('名字和紀錄都會保留');
    expect(unlinkDialog).not.toHaveTextContent('之後想再連動');
    await user.click(within(unlinkDialog).getByRole('button', { name: '解除連動' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            typeof url === 'string' &&
            url.includes('/counterparties/cp-1/link') &&
            (options as RequestInit).method === 'DELETE',
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '解除和小明的連動' })).toBeNull(),
    );
  });

  it('deletes the counterparty after confirmation and reports back', async () => {
    const user = userEvent.setup();
    const { onDeleted } = renderProfile({ entriesTotal: 0 });

    await user.click(await screen.findByRole('button', { name: '刪除對象' }));
    const confirmation = screen.getByRole('dialog', { name: '刪除對象' });
    expect(within(confirmation).getByText('刪除「小明」？')).toBeInTheDocument();

    await user.click(within(confirmation).getByRole('button', { name: '刪除' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            typeof url === 'string' &&
            url.endsWith('/counterparties/cp-1') &&
            (options as RequestInit).method === 'DELETE',
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
  });
});
