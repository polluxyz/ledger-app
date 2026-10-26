import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParseTransactionResponse } from '@ledger/shared';
import { AI_TEXT_MAX_LENGTH, ErrorCode } from '@ledger/shared';
import { ApiError } from '../../lib/api-client';
import { usePageToolbarSlot } from '../../app/PageToolbarSlotContext';
import { PageToolbarSlotProvider } from '../../app/PageToolbarSlotProvider';
import { AiEntry } from './AiEntry';
import { AiSessionProvider } from './ai-session';

const mocks = vi.hoisted(() => ({
  token: 'token-a',
  userId: 'user-a',
  authenticated: true,
  parse: vi.fn(),
  mutateAsync: vi.fn(),
}));

vi.mock('../auth/use-auth', () => ({
  useAuth: () => ({
    token: mocks.authenticated ? mocks.token : null,
    isAuthenticated: mocks.authenticated,
  }),
}));
vi.mock('../auth/use-current-user', () => ({
  useCurrentUser: () => ({
    data: mocks.authenticated ? { id: mocks.userId } : undefined,
  }),
}));
vi.mock('../transactions/use-transactions', () => ({
  useCreateTransactionForLedger: () => ({ mutateAsync: mocks.mutateAsync }),
}));
vi.mock('./use-ai-parse', () => ({ useAiParse: () => ({ parse: mocks.parse }) }));

const ledger = {
  id: 'ledger-1',
  name: '日常',
  currency: 'TWD',
  kind: 'PERSONAL',
  archivedAt: null,
  role: 'OWNER',
  createdAt: '2026-10-01T00:00:00.000Z',
} as const;

function ToolbarSlot({ name = 'page-toolbar-slot' }: { name?: string }) {
  const { setElement } = usePageToolbarSlot();
  return <div ref={setElement} data-testid={name} />;
}

function renderEntry(props: Partial<ComponentProps<typeof AiEntry>> = {}) {
  return render(
    <AiSessionProvider>
      <PageToolbarSlotProvider>
        <ToolbarSlot />
        <AiEntry ledger={ledger} {...props} />
      </PageToolbarSlotProvider>
    </AiSessionProvider>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/**
 * 驗證 AI 圖示入口的顯示條件、portal、展開狀態、解析回應與鍵盤操作。
 * 以假解析請求控制成功、空結果與延遲錯誤，並確認錯誤仍留在工具列插槽內浮動。
 */
describe('AI entry', () => {
  beforeEach(() => {
    mocks.token = 'token-a';
    mocks.userId = 'user-a';
    mocks.authenticated = true;
    mocks.parse.mockReset();
    mocks.mutateAsync.mockReset().mockResolvedValue(undefined);
  });

  it.each([
    ['沒有帳本', { ledger: undefined }],
    ['帳本清單載入中', { isLedgerLoading: true }],
    ['帳本清單載入失敗', { ledgerError: new Error('failed') }],
    ['借還檢視', { isVisible: false }],
  ])('W247 hides the icon when %s and sends no request', (_name, props) => {
    renderEntry(props);

    expect(screen.queryByRole('button', { name: 'AI 記帳' })).not.toBeInTheDocument();
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it('W247 keeps a viewer icon focusable, announces its restriction, and does not expand', async () => {
    const user = userEvent.setup();
    renderEntry({ ledger: { ...ledger, role: 'VIEWER' } });

    const toggle = screen.getByRole('button', { name: 'AI 記帳：只能檢視' });
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    expect(toggle).not.toBeDisabled();
    expect(toggle).toHaveAttribute('aria-describedby');
    expect(screen.getByRole('tooltip')).toHaveTextContent('只能檢視');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('textbox', { name: '用一句話記帳' })).not.toBeInTheDocument();
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it('W248 (e) expands from the icon, moves focus, hides the input from tab order when closed, and scopes Escape to the input', async () => {
    const user = userEvent.setup();
    renderEntry();

    const toggle = screen.getByRole('button', { name: 'AI 記帳' });
    await user.click(toggle);
    const input = screen.getByRole('textbox', { name: '用一句話記帳' });
    const form = document.getElementById(toggle.getAttribute('aria-controls')!);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', form?.id);
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('maxLength', String(AI_TEXT_MAX_LENGTH));
    expect(input).toHaveAttribute('tabindex', '0');
    expect(form).toHaveAttribute('aria-hidden', 'false');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.click(toggle);
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveAttribute('tabindex', '-1');
    expect(form).toHaveAttribute('aria-hidden', 'true');

    await user.click(toggle);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('W248 (a) clears the shared sentence and collapses after at least one draft', async () => {
    const user = userEvent.setup();
    mocks.parse.mockResolvedValueOnce({
      drafts: [
        {
          ledgerId: ledger.id,
          type: 'EXPENSE',
          amount: 6000,
          date: '2026-10-23',
          title: '早餐',
          categoryId: 'category-1',
          newCategoryName: null,
          accountId: 'account-1',
          toAccountId: null,
        },
      ],
    } satisfies ParseTransactionResponse);
    renderEntry();

    await user.click(screen.getByRole('button', { name: 'AI 記帳' }));
    const input = screen.getByRole('textbox', { name: '用一句話記帳' });
    await user.type(input, '早餐 60 現金');
    await user.click(screen.getByRole('button', { name: '送出' }));

    await waitFor(() => expect(input).toHaveValue(''));
    expect(screen.getByRole('button', { name: 'AI 記帳' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('W248 (b) keeps the sentence and floats an empty-result alert in the toolbar without changing its height', async () => {
    const user = userEvent.setup();
    mocks.parse.mockResolvedValueOnce({ drafts: [] } satisfies ParseTransactionResponse);
    renderEntry();

    const slot = screen.getByTestId('page-toolbar-slot');
    const heightBefore = slot.getBoundingClientRect().height;
    await user.click(screen.getByRole('button', { name: 'AI 記帳' }));
    const input = screen.getByRole('textbox', { name: '用一句話記帳' });
    await user.type(input, '早餐 60 現金');
    await user.click(screen.getByRole('button', { name: '送出' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('看不懂，換個說法再試。');
    expect(slot).toContainElement(alert);
    expect(alert.className).toContain('error');
    expect(input).toHaveValue('早餐 60 現金');
    expect(screen.getByRole('button', { name: 'AI 記帳' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(slot.getBoundingClientRect().height).toBe(heightBefore);
  });

  it.each([
    [new ApiError(429, ErrorCode.AI_DAILY_LIMIT, 'private'), '今天的 AI 次數用完了'],
    [new ApiError(429, ErrorCode.TOO_MANY_REQUESTS, 'private'), '太頻繁了，等一分鐘再試。'],
    [new ApiError(503, ErrorCode.AI_NOT_CONFIGURED, 'private'), 'AI 記帳還沒啟用。'],
    [new ApiError(503, ErrorCode.AI_UNAVAILABLE, 'private'), 'AI 暫時沒有回應，請稍後再試。'],
    [new Error('private provider detail'), 'AI 暫時沒有回應，請稍後再試。'],
  ])(
    'keeps the sentence for retry and maps provider errors to safe UI text',
    async (error, message) => {
      const user = userEvent.setup();
      mocks.parse.mockRejectedValueOnce(error);
      renderEntry();

      await user.click(screen.getByRole('button', { name: 'AI 記帳' }));
      const input = screen.getByRole('textbox', { name: '用一句話記帳' });
      await user.type(input, '午餐 120 刷卡');
      await user.click(screen.getByRole('button', { name: '送出' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(screen.getByRole('button', { name: 'AI 記帳' })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      expect(input).toHaveValue('午餐 120 刷卡');
      expect(input).toBeEnabled();
    },
  );

  it('W248 (c,d) lets the icon collapse during parsing, then announces a late error and restores it on expansion', async () => {
    const user = userEvent.setup();
    const request = deferred<ParseTransactionResponse>();
    mocks.parse.mockReturnValueOnce(request.promise);
    renderEntry();

    const toggle = screen.getByRole('button', { name: 'AI 記帳' });
    await user.click(toggle);
    const input = screen.getByRole('textbox', { name: '用一句話記帳' });
    await user.type(input, '晚餐 300 現金');
    await user.click(screen.getByRole('button', { name: '送出' }));
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: '處理中…' })).toBeDisabled();
    expect(toggle).toBeEnabled();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    request.reject(new ApiError(503, ErrorCode.AI_UNAVAILABLE, 'private'));

    const alert = await screen.findByRole('alert');
    expect(toggle).toHaveAttribute('data-error', 'true');
    expect(alert).toHaveTextContent('AI 暫時沒有回應，請稍後再試。');
    expect(alert.className).toContain('visuallyHidden');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(screen.getByRole('textbox', { name: '用一句話記帳' })).toHaveValue('晚餐 300 現金');
    expect(within(screen.getByTestId('page-toolbar-slot')).getByRole('alert')).toHaveTextContent(
      'AI 暫時沒有回應，請稍後再試。',
    );
  });

  it('shares the parsing lock across two page entries', async () => {
    const user = userEvent.setup();
    const request = deferred<ParseTransactionResponse>();
    mocks.parse.mockReturnValueOnce(request.promise);
    render(
      <AiSessionProvider>
        <PageToolbarSlotProvider>
          <ToolbarSlot name="home-toolbar-slot" />
          <AiEntry ledger={ledger} />
        </PageToolbarSlotProvider>
        <PageToolbarSlotProvider>
          <ToolbarSlot name="transactions-toolbar-slot" />
          <AiEntry ledger={ledger} />
        </PageToolbarSlotProvider>
      </AiSessionProvider>,
    );

    const toggles = screen.getAllByRole('button', { name: 'AI 記帳' });
    const [homeToggle, transactionToggle] = toggles;
    if (!homeToggle || !transactionToggle) throw new Error('Expected both page entry icons.');
    await user.click(homeToggle);
    await user.click(transactionToggle);
    const inputs = screen.getAllByRole('textbox', {
      name: '用一句話記帳',
    });
    const [homeInput, transactionInput] = inputs;
    if (!homeInput || !transactionInput) throw new Error('Expected both page inputs.');
    await user.type(homeInput, '早餐 60 現金');
    await user.click(
      within(screen.getByTestId('home-toolbar-slot')).getByRole('button', { name: '送出' }),
    );
    expect(transactionInput).toBeDisabled();

    fireEvent.submit(transactionInput.closest('form')!);
    expect(mocks.parse).toHaveBeenCalledTimes(1);
    expect(transactionToggle).toBeEnabled();
    request.resolve({ drafts: [] });
  });
});
