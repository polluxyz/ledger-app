import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkInviteDialog } from './LinkInviteDialog';

/** 邀請視窗以 mock fetch 驗證 email 與連結請求，並確認 token 不進瀏覽器儲存區。 */
describe('LinkInviteDialog', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation(() => jsonResponse({}));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  function renderDialog() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onClose = vi.fn();
    const rendered = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <LinkInviteDialog open counterpartyId="cp-1" counterpartyName="小明" onClose={onClose} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return { onClose, ...rendered };
  }

  it('sends the email invitation to this counterparty', async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = await screen.findByRole('dialog', { name: '邀請連動：小明' });
    await user.type(within(dialog).getByLabelText('對方註冊用的 email'), 'B@EXAMPLE.COM');
    await user.click(within(dialog).getByRole('button', { name: '送出' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/counterparties/cp-1/link-invites');
    expect(options.method).toBe('POST');
    expect(parseRequestBody(options)).toEqual({ email: 'b@example.com' });
  });

  it('uses the invitation-specific message for an unregistered email', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { statusCode: 404, errorCode: 'USER_NOT_FOUND', message: 'User not found' },
        404,
      ),
    );
    renderDialog();
    const dialog = await screen.findByRole('dialog', { name: '邀請連動：小明' });
    await user.type(within(dialog).getByLabelText('對方註冊用的 email'), 'new@example.com');
    await user.click(within(dialog).getByRole('button', { name: '送出' }));

    expect(
      await within(dialog).findByText('找不到使用這個 email 的帳號。請對方先註冊。'),
    ).toBeInTheDocument();
  });

  it('links to the overview when the recipient already invited this user', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { statusCode: 409, errorCode: 'LINK_INVITE_FROM_THEM', message: 'Invite from them' },
        409,
      ),
    );
    renderDialog();
    const dialog = await screen.findByRole('dialog', { name: '邀請連動：小明' });
    await user.type(within(dialog).getByLabelText('對方註冊用的 email'), 'b@example.com');
    await user.click(within(dialog).getByRole('button', { name: '送出' }));

    const overviewLink = await within(dialog).findByRole('link', { name: '到總覽接受' });
    expect(overviewLink).toHaveAttribute('href', '/');
    expect(dialog).not.toHaveTextContent('好友');
  });

  it('shows the generated local-origin link and expiry, then copies it', async () => {
    const user = userEvent.setup();
    const token = 'temporary-token-abc';
    const expiresAt = '2026-09-25T06:32:00.000Z';
    fetchMock.mockResolvedValueOnce(jsonResponse({ token, expiresAt }));
    const clipboardWrite = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
    renderDialog();
    const dialog = await screen.findByRole('dialog', { name: '邀請連動：小明' });

    await user.click(within(dialog).getByRole('button', { name: '產生邀請連結' }));

    const linkField = await within(dialog).findByLabelText('邀請連結');
    const inviteUrl = `${window.location.origin}/invite#${token}`;
    expect(linkField).toHaveValue(inviteUrl);
    const localTime = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(expiresAt));
    expect(dialog).toHaveTextContent(`有效到 ${localTime}。只能用一次，重新產生會讓舊連結失效。`);
    expect(within(dialog).getByRole('button', { name: '重新產生' })).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: '複製' }));
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith(inviteUrl));
    expect(await within(dialog).findByRole('button', { name: '已複製' })).toBeInTheDocument();
    expect(localStorage.getItem('ledger.accessToken')).toBe('jwt-abc');
    expect(localStorage.getItem(token)).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it('selects the link field when clipboard access is unavailable', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ token: 'copy-fallback', expiresAt: '2026-09-25T06:32:00.000Z' }),
    );
    const select = vi.spyOn(HTMLInputElement.prototype, 'select');
    renderDialog();
    const dialog = await screen.findByRole('dialog', { name: '邀請連動：小明' });
    await user.click(within(dialog).getByRole('button', { name: '產生邀請連結' }));
    await within(dialog).findByLabelText('邀請連結');
    await user.click(within(dialog).getByRole('button', { name: '複製' }));

    expect(select).toHaveBeenCalled();
  });
});

function parseRequestBody(options: RequestInit): unknown {
  if (typeof options.body !== 'string') {
    throw new Error('連動邀請請求缺少 JSON body');
  }
  return JSON.parse(options.body) as unknown;
}

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}
