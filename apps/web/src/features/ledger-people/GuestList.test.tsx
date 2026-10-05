import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuestList } from './GuestList';

/**
 * 非成員清單的測試確認共享名單只顯示 GUEST，並驗證管理操作與後端衝突訊息。
 * API 用 fetch 替身回傳完整 people 清單或指定錯誤，讓對話框與錯誤文案一起受測。
 */
describe('GuestList', () => {
  const fetchMock = vi.fn();
  const guest = { id: 'guest-1', name: '阿美', userId: null, status: 'GUEST' };
  const leftMember = { id: 'left-1', name: '小玲', userId: 'u2', status: 'LEFT' };

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, [guest, leftMember])));
    vi.stubGlobal('fetch', fetchMock);
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

  function renderGuestList(canManage = true) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={client}>
        <GuestList ledgerId="ledger-1" canManage={canManage} />
      </QueryClientProvider>,
    );
  }

  it('shows only GUEST people and the management controls for an editor', async () => {
    renderGuestList();

    expect(await screen.findByRole('heading', { name: '非成員' })).toBeInTheDocument();
    expect(await screen.findByText('阿美')).toBeInTheDocument();
    expect(screen.queryByText('小玲')).not.toBeInTheDocument();
    expect(screen.queryByText(/已離開|好友/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新增' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '改名阿美' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刪除阿美' })).toBeInTheDocument();
  });

  it('shows the specified duplicate-name error inside the shared add dialog', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).endsWith('/ledgers/ledger-1/people') && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse(409, {
            statusCode: 409,
            errorCode: 'LEDGER_PERSON_NAME_TAKEN',
            message: 'Name already exists.',
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, [guest, leftMember]));
    });
    const user = userEvent.setup();
    renderGuestList();

    await user.click(await screen.findByRole('button', { name: '新增' }));
    const dialog = screen.getByRole('dialog', { name: '新增非成員' });
    await user.type(within(dialog).getByLabelText('名字'), '阿美');
    await user.click(within(dialog).getByRole('button', { name: '新增' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('這個名字已經有人用了。');
  });

  it('shows the in-use error inside the delete confirmation dialog', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).endsWith('/people/guest-1') && init?.method === 'DELETE') {
        return Promise.resolve(
          jsonResponse(409, {
            statusCode: 409,
            errorCode: 'LEDGER_PERSON_IN_USE',
            message: 'Person is in use.',
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, [guest, leftMember]));
    });
    const user = userEvent.setup();
    renderGuestList();

    const personName = await screen.findByText('阿美');
    const personRow = personName.closest('li');
    if (!personRow) throw new Error('非成員列不存在');
    await user.click(within(personRow).getByRole('button', { name: '刪除阿美' }));
    const dialog = screen.getByRole('dialog', { name: '刪除非成員' });
    await user.click(within(dialog).getByRole('button', { name: '刪除' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '還有交易或結清用到這個人。',
    );
  });

  it('keeps the GUEST list visible to a viewer without management buttons', async () => {
    renderGuestList(false);

    expect(await screen.findByText('阿美')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新增' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '改名阿美' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刪除阿美' })).not.toBeInTheDocument();
  });
});
