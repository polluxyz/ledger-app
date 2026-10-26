import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { LedgerSummary, ParseTransactionResponse, TransactionDraft } from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';
import { RightPanelProvider } from '../../app/RightPanelProvider';
import { AiDraftSection } from './AiDraftSection';
import { AiSessionProvider, useAiSession } from './ai-session';

const mocks = vi.hoisted(() => ({
  token: 'token-a',
  userId: 'user-a',
  authenticated: true,
  ledgers: new Array<unknown>(),
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
vi.mock('../../lib/api-client', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api-client')>('../../lib/api-client');
  return {
    ...actual,
    apiRequest: vi.fn((path: string) => {
      if (path === '/accounts') return Promise.resolve([]);
      if (path === '/ledgers?includeArchived=true') return Promise.resolve(mocks.ledgers);
      return Promise.resolve([]);
    }),
  };
});

const writableLedger = {
  id: 'ledger-a',
  name: '日常',
  currency: 'TWD',
  kind: 'PERSONAL',
  archivedAt: null,
  role: 'OWNER',
  createdAt: '2026-10-01T00:00:00.000Z',
} satisfies LedgerSummary;
const viewerLedger = {
  ...writableLedger,
  id: 'ledger-viewer',
  name: '只能檢視帳本',
  role: 'VIEWER',
} satisfies LedgerSummary;
const archivedLedger = {
  ...writableLedger,
  id: 'ledger-archived',
  name: '已封存帳本',
  archivedAt: '2026-10-25T00:00:00.000Z',
} satisfies LedgerSummary;

function draft(ledgerId: string): TransactionDraft {
  return {
    ledgerId,
    type: 'EXPENSE',
    amount: 6000,
    date: '2026-10-23',
    title: ledgerId,
    categoryId: null,
    newCategoryName: '日常',
    accountId: 'account-a',
    toAccountId: null,
  };
}

function SeedDrafts() {
  const session = useAiSession();
  return (
    <button type="button" onClick={() => void session.parse('早餐 60 現金', 'ledger-a')}>
      解析草稿
    </button>
  );
}

function renderSection(ledgers: LedgerSummary[]) {
  mocks.ledgers = ledgers;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSelect = vi.fn();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AiSessionProvider>
        <MemoryRouter>
          <RightPanelProvider>
            <SeedDrafts />
            <AiDraftSection currentLedgerId={writableLedger.id} onSelect={onSelect} />
          </RightPanelProvider>
        </MemoryRouter>
      </AiSessionProvider>
    </QueryClientProvider>,
  );
  return { ...view, onSelect };
}

function setDrafts(...drafts: TransactionDraft[]) {
  mocks.parse.mockResolvedValueOnce({ drafts } satisfies ParseTransactionResponse);
}

/**
 * 驗證每筆 AI 草稿以 draft.ledgerId 判斷是否可編輯與寫入。
 * 用假帳本清單覆蓋檢視、封存與已退出狀態，並確認「全部確認」只送出可寫入項目。
 */
describe('AI draft section', () => {
  beforeEach(() => {
    mocks.token = 'token-a';
    mocks.userId = 'user-a';
    mocks.authenticated = true;
    mocks.ledgers = [];
    mocks.parse.mockReset();
    mocks.mutateAsync.mockReset().mockResolvedValue(undefined);
  });

  it('W251 disables ✓ and editing for a draft the user can no longer access while leaving × available', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderSection([writableLedger]);
    setDrafts(draft('ledger-gone'));
    await user.click(screen.getByRole('button', { name: '解析草稿' }));

    const rowButton = await screen.findByRole('button', { name: '編輯草稿：ledger-gone' });
    expect(rowButton).toBeDisabled();
    expect(screen.getByText('我已退出')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '確認草稿：ledger-gone' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '移除草稿：ledger-gone' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '全部確認' })).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '移除草稿：ledger-gone' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: '草稿' })).not.toBeInTheDocument(),
    );
  });

  it('W251 reports viewer and archived ledgers and confirms only complete drafts in writable ledgers', async () => {
    const user = userEvent.setup();
    renderSection([writableLedger, viewerLedger, archivedLedger]);
    setDrafts(
      draft(writableLedger.id),
      draft(viewerLedger.id),
      draft(archivedLedger.id),
      draft('gone'),
    );
    await user.click(screen.getByRole('button', { name: '解析草稿' }));

    expect(await screen.findByText('只能檢視')).toBeInTheDocument();
    expect(screen.getByText('帳本已封存')).toBeInTheDocument();
    expect(screen.getByText('我已退出')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全部確認' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '確認草稿：ledger-viewer' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '確認草稿：ledger-archived' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '確認草稿：gone' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '全部確認' }));
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(1));
    expect(mocks.mutateAsync).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ ledgerId: writableLedger.id }),
    );
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /^確認草稿：/ })).toHaveLength(3),
    );
  });

  it('does not request category data or open a form for an inaccessible ledger', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderSection([]);
    setDrafts(draft('ledger-gone'));
    await user.click(screen.getByRole('button', { name: '解析草稿' }));

    const row = await screen.findByRole('button', { name: '編輯草稿：ledger-gone' });
    fireEvent.click(row);
    expect(onSelect).not.toHaveBeenCalled();
    expect(vi.mocked(apiRequest)).not.toHaveBeenCalledWith(
      expect.stringContaining('/categories'),
      expect.anything(),
    );
  });
});
