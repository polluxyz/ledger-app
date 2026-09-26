import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINK_INVITE_MESSAGES } from '../../lib/error-messages';
import { InviteDialog } from './InviteDialog';

describe('InviteDialog', () => {
  const fetchMock = vi.fn();
  const token = 'link-token-never-store';

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function renderInviteDialog(onClose = vi.fn(), open = true) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const result = render(
      <QueryClientProvider client={queryClient}>
        <InviteDialog open={open} onClose={onClose} />
      </QueryClientProvider>,
    );
    return { onClose, ...result };
  }

  function jsonResponse(body: unknown, status = 200) {
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }

  it('sends the entered email and closes after the API succeeds', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      if (String(input).includes('/friend-requests')) {
        expect(init?.method).toBe('POST');
        return jsonResponse({ id: 'invite-1' });
      }
      return Promise.reject(new Error(`未預期的請求：${input}`));
    });
    const { onClose } = renderInviteDialog();

    await user.type(screen.getByLabelText('對方的 email'), 'User@Example.com');
    await user.click(screen.getByRole('button', { name: '傳送邀請' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    const request = fetchMock.mock.calls.find(([input]) =>
      String(input).includes('/friend-requests'),
    );
    expect(String(request?.[0])).toContain('/friend-requests');
    expect(JSON.parse((request?.[1] as RequestInit).body as string)).toEqual({
      email: 'user@example.com',
    });
  });

  it('creates a fragment invite URL, copies it briefly, and keeps its token out of storage', async () => {
    const user = userEvent.setup();
    const clipboardWrite = vi
      .spyOn(window.navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined);
    const expiresAt = '2026-09-26T10:35:00.000Z';
    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      if (String(input).includes('/friend-invite-links')) {
        expect(init?.method).toBe('POST');
        expect(init?.body).toBeUndefined();
        return jsonResponse({ token, expiresAt });
      }
      if (String(input).includes('/friend-requests')) {
        return jsonResponse({ id: 'invite-1' });
      }
      return Promise.reject(new Error(`未預期的請求：${input}`));
    });
    const { onClose, rerender } = renderInviteDialog();

    await user.click(screen.getByRole('button', { name: '產生連結' }));

    const linkField = await screen.findByLabelText('邀請連結');
    const linkUrl = `${window.location.origin}/invite#${token}`;
    expect(linkField).toHaveValue(linkUrl);
    expect(screen.getByText(/^\d{2}:\d{2} 前有效$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新產生' })).toBeInTheDocument();
    expect(localStorage.length).toBe(1);
    expect(sessionStorage.length).toBe(0);
    const storedValues = [localStorage, sessionStorage].flatMap((storage) =>
      Array.from({ length: storage.length }, (_, index) =>
        storage.getItem(storage.key(index) ?? ''),
      ),
    );
    expect(storedValues).not.toContain(token);

    const dialog = screen.getByRole('dialog', { name: '邀請連動' });
    expect(dialog.querySelector('p')).toBeNull();
    expect(within(dialog).getByText('或')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '複製' }));
    expect(clipboardWrite).toHaveBeenCalledWith(linkUrl);
    expect(screen.getByRole('button', { name: '已複製' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '複製' })).toBeInTheDocument(), {
      timeout: 2500,
    });

    await user.click(within(dialog).getByText('關閉', { selector: 'button' }));
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <InviteDialog open={false} onClose={onClose} />
      </QueryClientProvider>,
    );
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <InviteDialog open={true} onClose={onClose} />
      </QueryClientProvider>,
    );
    expect(screen.queryByLabelText('邀請連結')).not.toBeInTheDocument();
  });

  it('uses the link-invite wording for USER_NOT_FOUND', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((input: string) => {
      if (String(input).includes('/friend-requests')) {
        return jsonResponse(
          {
            statusCode: 404,
            errorCode: 'USER_NOT_FOUND',
            message: 'No user exists.',
          },
          404,
        );
      }
      return Promise.reject(new Error(`未預期的請求：${input}`));
    });
    renderInviteDialog();

    await user.type(screen.getByLabelText('對方的 email'), 'missing@example.com');
    await user.click(screen.getByRole('button', { name: '傳送邀請' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      LINK_INVITE_MESSAGES.USER_NOT_FOUND ?? '',
    );
  });

  it('selects the link text when clipboard access fails', async () => {
    const user = userEvent.setup();
    const clipboardWrite = vi.spyOn(window.navigator.clipboard, 'writeText');
    clipboardWrite.mockRejectedValue(new Error('permission denied'));
    fetchMock.mockImplementation((input: string) =>
      String(input).includes('/friend-invite-links')
        ? jsonResponse({ token, expiresAt: '2026-09-26T10:35:00.000Z' })
        : jsonResponse({ id: 'invite-1' }),
    );
    renderInviteDialog();

    await user.click(screen.getByRole('button', { name: '產生連結' }));
    const linkField = await screen.findByLabelText('邀請連結');
    await user.click(screen.getByRole('button', { name: '複製' }));

    expect(linkField).toHaveFocus();
    expect((linkField as HTMLInputElement).selectionStart).toBe(0);
    expect((linkField as HTMLInputElement).selectionEnd).toBe(
      linkField.getAttribute('value')?.length,
    );
  });
});
