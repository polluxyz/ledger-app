import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuestList } from './GuestList';

/** 虛擬成員管理測試以 render prop 將操作放進同一份帳本成員清單。 */
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
        <GuestList ledgerId="ledger-1" canManage={canManage}>
          {({ virtualMembers, openCreate, openRename, openDelete }) => (
            <section aria-label="成員清單測試架">
              {canManage && <button onClick={openCreate}>新增虛擬成員</button>}
              <ul>
                {virtualMembers.map((person) => (
                  <li key={person.id}>
                    <span>{person.name}</span>
                    {canManage && (
                      <>
                        <button onClick={() => openRename(person)}>改名{person.name}</button>
                        <button onClick={() => openDelete(person)}>刪除{person.name}</button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </GuestList>
      </QueryClientProvider>,
    );
  }

  it('provides only virtual members to the unified list controls', async () => {
    renderGuestList();

    expect(await screen.findByText('阿美')).toBeInTheDocument();
    expect(screen.queryByText('小玲')).not.toBeInTheDocument();
    expect(screen.queryByText(/非成員/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新增虛擬成員' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '改名阿美' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刪除阿美' })).toBeInTheDocument();
  });

  it('shows the backend duplicate-name error when creating a virtual member', async () => {
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

    await user.click(await screen.findByRole('button', { name: '新增虛擬成員' }));
    const dialog = screen.getByRole('dialog', { name: '新增虛擬成員' });
    await user.type(within(dialog).getByLabelText('名字'), '阿美');
    await user.click(within(dialog).getByRole('button', { name: '新增' }));

    // FormError 會把 LEDGER_PERSON_NAME_TAKEN 換成在地化訊息（error-messages.ts），
    // 不是後端原文——這裡驗的是使用者真正看到的那句。
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('這個名字已經有人用了。');
  });

  it('renames a virtual member through the existing name form', async () => {
    // 改名成功後清單會重新抓取；替身要記住新名字，重抓的結果才跟得上畫面。
    let renamed = false;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).endsWith('/people/guest-1') && init?.method === 'PATCH') {
        renamed = true;
        return Promise.resolve(jsonResponse(200, { ...guest, name: '阿美同學' }));
      }
      const people = renamed ? [{ ...guest, name: '阿美同學' }, leftMember] : [guest, leftMember];
      return Promise.resolve(jsonResponse(200, people));
    });
    const user = userEvent.setup();
    renderGuestList();

    await user.click(await screen.findByRole('button', { name: '改名阿美' }));
    const dialog = screen.getByRole('dialog', { name: '改名' });
    await user.clear(within(dialog).getByLabelText('名字'));
    await user.type(within(dialog).getByLabelText('名字'), '阿美同學');
    await user.click(within(dialog).getByRole('button', { name: '儲存' }));

    // 名字用 <span> 包住（見上方測試架），這裡才能用純文字查詢驗清單換上新名字。
    expect(await screen.findByText('阿美同學')).toBeInTheDocument();
    const patch = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(JSON.parse((patch?.[1] as RequestInit).body as string)).toEqual({ name: '阿美同學' });
  });

  it('shows the in-use error inside the virtual-member delete confirmation', async () => {
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

    await user.click(await screen.findByRole('button', { name: '刪除阿美' }));
    const dialog = screen.getByRole('dialog', { name: '刪除虛擬成員' });
    await user.click(within(dialog).getByRole('button', { name: '刪除' }));

    // LEDGER_PERSON_IN_USE 一樣走 error-messages.ts 的在地化訊息。
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '還有交易或結清用到這個人。',
    );
  });

  it('keeps virtual members visible to a viewer without management controls', async () => {
    renderGuestList(false);

    expect(await screen.findByText('阿美')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新增虛擬成員' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '改名阿美' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刪除阿美' })).not.toBeInTheDocument();
  });
});
