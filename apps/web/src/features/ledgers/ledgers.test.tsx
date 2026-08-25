import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';

/**
 * 帳本列表與建立（Slice 2 Step 3）。
 *
 * 從真實的 App 出發、只換掉 fetch，比照 `accounts.test.tsx`。重心放在兩件容易做錯
 * 的事：兩組「建立後不可更改」的選擇有沒有正確送出，以及參與者部分失敗時畫面
 * 有沒有留住使用者的輸入。
 */
describe('Ledgers page', () => {
  const fetchMock = vi.fn();

  const personal = {
    id: 'led-1',
    name: '個人帳本',
    currency: 'TWD',
    kind: 'PERSONAL',
    tracksBalance: true,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    role: 'OWNER',
  };
  const shared = {
    ...personal,
    id: 'led-2',
    name: '家庭帳本',
    kind: 'SHARED',
    tracksBalance: false,
  };
  const archived = {
    ...personal,
    id: 'led-3',
    name: '舊帳本',
    archivedAt: '2026-06-01T00:00:00.000Z',
  };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    window.history.pushState({}, '', '/ledgers');
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

  function apiError(status: number, errorCode: string, message: string): Response {
    return jsonResponse(status, { statusCode: status, errorCode, message });
  }

  /** 預設路由：帳本清單依 includeArchived 給不同結果，其餘端點回空的。 */
  function routeFetch(overrides: Record<string, () => Promise<Response>> = {}) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const target = String(url);
      const method = init?.method ?? 'GET';

      // 用 endsWith 而非 includes：`/ledgers/led-1/members` 也包含 `/ledgers`，
      // 用 includes 的話加成員的請求會被建立帳本的那條規則攔走，症狀是「成員永遠成功」。
      for (const [pattern, handler] of Object.entries(overrides)) {
        const [patternMethod, patternPath] = pattern.split(' ');
        if (method === patternMethod && target.endsWith(patternPath ?? '')) {
          return handler();
        }
      }

      if (method === 'GET' && target.includes('/ledgers')) {
        const list = target.includes('includeArchived=true')
          ? [personal, shared, archived]
          : [personal, shared];
        return Promise.resolve(jsonResponse(200, list));
      }
      return Promise.resolve(jsonResponse(200, []));
    });
  }

  /** 送出去的請求，body 已轉成字串（`api-client` 一律送 JSON 字串）。 */
  const requests = () =>
    fetchMock.mock.calls.map((call) => {
      const init = call[1] as RequestInit | undefined;
      return {
        url: String(call[0]),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : '',
      };
    });

  // ── 列表 ─────────────────────────────────────────────────────────────────

  it('labels each ledger as personal or shared', async () => {
    routeFetch();

    render(<App />);

    expect(await screen.findByRole('link', { name: '個人帳本' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '家庭帳本' })).toBeInTheDocument();
    expect(screen.getByText('私人')).toBeInTheDocument();
    expect(screen.getByText('共享')).toBeInTheDocument();
    // 非連動帳本才標示；連動是預設，一律標會讓每列長出一堆標籤。
    expect(screen.getByText('不影響餘額')).toBeInTheDocument();
  });

  it('asks the server for archived ledgers only when the box is ticked', async () => {
    routeFetch();
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByRole('link', { name: '個人帳本' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '舊帳本' })).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('顯示已封存的帳本'));

    expect(await screen.findByRole('link', { name: '舊帳本' })).toBeInTheDocument();
    expect(screen.getByText('已封存')).toBeInTheDocument();
    expect(requests().some((request) => request.url.includes('includeArchived=true'))).toBe(true);
  });

  // ── 建立 ─────────────────────────────────────────────────────────────────

  async function openCreateDialog() {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('link', { name: '個人帳本' });
    await user.click(screen.getByRole('button', { name: '建立帳本' }));
    return user;
  }

  it('defaults to a personal ledger that tracks balances, and hides participants', async () => {
    routeFetch();
    await openCreateDialog();

    expect(screen.getByLabelText('私人：只有自己看得到')).toBeChecked();
    expect(screen.getByLabelText('連動：記帳時扣減我的帳戶')).toBeChecked();
    // 私人帳本加不了成員，欄位不該出現。
    expect(screen.queryByLabelText('參與者 1 的 email')).not.toBeInTheDocument();
  });

  it('sends kind and tracksBalance with the new ledger', async () => {
    routeFetch({
      'POST /ledgers': () => Promise.resolve(jsonResponse(201, { ...personal, id: 'led-new' })),
    });
    const user = await openCreateDialog();

    await user.type(screen.getByLabelText('名稱'), '旅遊');
    await user.click(screen.getByLabelText('不連動：出遊分帳、社團公款這類「錢不是我的」帳本'));
    await user.click(screen.getByRole('button', { name: '建立' }));

    await waitFor(() => {
      const created = requests().find(
        (request) => request.method === 'POST' && request.url.endsWith('/ledgers'),
      );
      expect(created).toBeDefined();
      expect(JSON.parse(created?.body ?? '{}')).toEqual({
        name: '旅遊',
        kind: 'PERSONAL',
        tracksBalance: false,
      });
    });
  });

  it('creates a shared ledger without members when no email is filled in', async () => {
    routeFetch({
      'POST /ledgers': () => Promise.resolve(jsonResponse(201, { ...shared, id: 'led-new' })),
    });
    const user = await openCreateDialog();

    await user.type(screen.getByLabelText('名稱'), '家庭');
    await user.click(screen.getByLabelText('共享：和別人一起記'));
    // 參與者欄位展開了，但一位都不填——2d 決策 5 允許之後再加人。
    expect(screen.getByLabelText('參與者 1 的 email')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '建立' }));

    await waitFor(() => {
      expect(requests().some((request) => request.url.includes('/members'))).toBe(false);
    });
  });

  it('offers no owner role for participants', async () => {
    routeFetch();
    const user = await openCreateDialog();

    await user.click(screen.getByLabelText('共享：和別人一起記'));

    const role = screen.getByLabelText('參與者 1 的角色');
    const options = within(role)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual(['可編輯', '唯讀']);
  });

  it('keeps the ledger and the dialog when a participant cannot be added', async () => {
    let addCalls = 0;
    routeFetch({
      'POST /ledgers': () => Promise.resolve(jsonResponse(201, { ...shared, id: 'led-new' })),
      'POST /members': () => {
        addCalls += 1;
        // 第一位成功，第二位查無此人。
        return addCalls === 1
          ? Promise.resolve(jsonResponse(201, { userId: 'u2', email: 'bob@example.com' }))
          : Promise.resolve(apiError(404, 'USER_NOT_FOUND', '查無此使用者，請確認對方已經註冊。'));
      },
    });
    const user = await openCreateDialog();

    await user.type(screen.getByLabelText('名稱'), '家庭');
    await user.click(screen.getByLabelText('共享：和別人一起記'));
    await user.type(screen.getByLabelText('參與者 1 的 email'), 'bob@example.com');
    await user.click(screen.getByRole('button', { name: '+ 再加一位' }));
    await user.type(screen.getByLabelText('參與者 2 的 email'), 'ghost@example.com');
    await user.click(screen.getByRole('button', { name: '建立' }));

    // 帳本建好了，說明文字要講清楚，不能只丟一個紅框讓人以為整件事失敗。
    expect(await screen.findByText(/帳本已經建立/)).toBeInTheDocument();
    expect(screen.getByText('查無此使用者，請確認對方已經註冊。')).toBeInTheDocument();

    // 只剩失敗的那一位；成功的不重送，也不再佔著畫面。
    expect(screen.getByLabelText('參與者 1 的 email')).toHaveValue('ghost@example.com');
    expect(screen.queryByLabelText('參與者 2 的 email')).not.toBeInTheDocument();

    // 名稱與兩組選擇都鎖住——帳本已經建立，改它們沒有意義。
    expect(screen.getByLabelText('名稱')).toBeDisabled();
  });

  it('retries only the failing participant, without creating a second ledger', async () => {
    let addCalls = 0;
    routeFetch({
      'POST /ledgers': () => Promise.resolve(jsonResponse(201, { ...shared, id: 'led-new' })),
      'POST /members': () => {
        addCalls += 1;
        return addCalls === 1
          ? Promise.resolve(apiError(404, 'USER_NOT_FOUND', '查無此使用者。'))
          : Promise.resolve(jsonResponse(201, { userId: 'u2', email: 'bob@example.com' }));
      },
    });
    const user = await openCreateDialog();

    await user.type(screen.getByLabelText('名稱'), '家庭');
    await user.click(screen.getByLabelText('共享：和別人一起記'));
    await user.type(screen.getByLabelText('參與者 1 的 email'), 'typo@example.com');
    await user.click(screen.getByRole('button', { name: '建立' }));

    await screen.findByText(/帳本已經建立/);

    await user.clear(screen.getByLabelText('參與者 1 的 email'));
    await user.type(screen.getByLabelText('參與者 1 的 email'), 'bob@example.com');
    await user.click(screen.getByRole('button', { name: '重試' }));

    await waitFor(() => {
      expect(screen.queryByText(/帳本已經建立/)).not.toBeInTheDocument();
    });

    // 帳本只建立一次；成員送了兩次（失敗一次、重試一次）。
    const created = requests().filter(
      (request) => request.method === 'POST' && request.url.endsWith('/ledgers'),
    );
    expect(created).toHaveLength(1);
    expect(addCalls).toBe(2);
  });
});
