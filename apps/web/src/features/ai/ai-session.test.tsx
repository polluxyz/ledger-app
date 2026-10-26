import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParseTransactionResponse } from '@ledger/shared';
import { AiSessionProvider, useAiSession } from './ai-session';

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

const firstDraft = {
  ledgerId: 'ledger-a',
  type: 'EXPENSE',
  amount: 6000,
  date: '2026-10-23',
  title: '早餐',
  categoryId: 'category-a',
  newCategoryName: null,
  accountId: 'account-a',
  toAccountId: null,
} as const;
const secondDraft = { ...firstDraft, title: '午餐' } as const;
const lateDraft = { ...firstDraft, ledgerId: 'ledger-b', title: '機票' } as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function snapshot() {
  const state = screen.getByTestId('ai-session-state').textContent;
  return JSON.parse(state ?? '{}') as {
    text: string;
    error: string | null;
    isParsing: boolean;
    drafts: string[];
    writingKey: string | null;
    busyKeys: string[];
    isConfirmingAll: boolean;
  };
}

function SessionControls() {
  const session = useAiSession();
  return (
    <>
      <button type="button" onClick={() => void session.parse('早餐 60 現金', 'ledger-a')}>
        解析
      </button>
      <button type="button" onClick={() => void session.parse('新句子 100 現金', 'ledger-a')}>
        再解析
      </button>
      <button type="button" onClick={() => void session.confirmDraft('ai-draft-1')}>
        確認第一筆
      </button>
      <button type="button" onClick={() => void session.confirmDraft('ai-draft-1', 'ai-draft-1')}>
        編輯中確認第一筆
      </button>
      <button
        type="button"
        onClick={() => void session.confirmAll(null, ['ai-draft-1', 'ai-draft-2'])}
      >
        全部確認
      </button>
      <button type="button" onClick={() => session.discardDraft('ai-draft-1')}>
        移除第一筆
      </button>
      <button type="button" onClick={() => session.discardDraft('ai-draft-2')}>
        移除第二筆
      </button>
      <button type="button" onClick={() => session.removeSavedDraft('ai-draft-1')}>
        儲存第一筆
      </button>
      <button type="button" onClick={() => session.markDraftSaving('form-draft', true)}>
        表單開始送出
      </button>
      <button type="button" onClick={() => session.markDraftSaving('form-draft', false)}>
        表單送出結束
      </button>
      <output data-testid="ai-session-state">
        {JSON.stringify({
          text: session.text,
          error: session.error,
          isParsing: session.isParsing,
          drafts: session.drafts.map(({ key }) => key),
          writingKey: session.writingKey,
          busyKeys: [...session.busyKeys],
          isConfirmingAll: session.isConfirmingAll,
        })}
      </output>
    </>
  );
}

function Harness({ children }: { children: ReactNode }) {
  return <AiSessionProvider>{children}</AiSessionProvider>;
}

function renderControls() {
  return render(
    <Harness>
      <SessionControls />
    </Harness>,
  );
}

function setParseDrafts(...drafts: ParseTransactionResponse['drafts']) {
  mocks.parse.mockResolvedValueOnce({ drafts } satisfies ParseTransactionResponse);
}

/**
 * 驗證 AI session 的路由外狀態生命週期、使用者世代隔離，以及解析和交易寫入的同步鎖。
 * 以可控 Promise 模擬換頁、登出與延遲 API 回應，避免測試只依賴按鈕的 disabled 狀態。
 */
describe('AI session', () => {
  beforeEach(() => {
    mocks.token = 'token-a';
    mocks.userId = 'user-a';
    mocks.authenticated = true;
    mocks.parse.mockReset();
    mocks.mutateAsync.mockReset().mockResolvedValue(undefined);
  });

  it('W250 clears a draft after ×, after a successful confirm, on logout or user change, and on a fresh page lifetime', async () => {
    const user = userEvent.setup();
    const view = renderControls();
    setParseDrafts(firstDraft, secondDraft);
    await user.click(screen.getByRole('button', { name: '解析' }));
    await waitFor(() => expect(snapshot().drafts).toEqual(['ai-draft-1', 'ai-draft-2']));

    await user.click(screen.getByRole('button', { name: '確認第一筆' }));
    await waitFor(() => expect(snapshot().drafts).toEqual(['ai-draft-2']));
    await user.click(screen.getByRole('button', { name: '移除第二筆' }));
    expect(snapshot().drafts).toEqual([]);

    // 使用者 id 改變時整份共用草稿清空。
    setParseDrafts(firstDraft, secondDraft);
    await user.click(screen.getByRole('button', { name: '再解析' }));
    await waitFor(() => expect(snapshot().drafts).toEqual(['ai-draft-3', 'ai-draft-4']));
    mocks.token = 'token-b';
    mocks.userId = 'user-b';
    mocks.authenticated = true;
    view.rerender(
      <Harness>
        <SessionControls />
      </Harness>,
    );
    await waitFor(() => expect(snapshot().drafts).toEqual([]));

    setParseDrafts(firstDraft);
    await user.click(screen.getByRole('button', { name: '解析' }));
    await waitFor(() => expect(snapshot().drafts).toEqual(['ai-draft-5']));
    view.unmount();
    renderControls();
    expect(snapshot().drafts).toEqual([]);
  });

  it('drops parse responses from an old user generation', async () => {
    const user = userEvent.setup();
    const request = deferred<ParseTransactionResponse>();
    mocks.parse.mockReturnValueOnce(request.promise);
    const view = renderControls();

    await user.click(screen.getByRole('button', { name: '解析' }));
    expect(snapshot().isParsing).toBe(true);
    mocks.token = 'token-b';
    mocks.userId = 'user-b';
    mocks.authenticated = true;
    view.rerender(
      <Harness>
        <SessionControls />
      </Harness>,
    );
    await waitFor(() => expect(snapshot().isParsing).toBe(false));
    request.resolve({ drafts: [firstDraft] });
    await waitFor(() => expect(snapshot().drafts).toEqual([]));
    expect(snapshot().error).toBeNull();
  });

  it('shares the write lock with draft form saves and excludes the draft currently open for editing', async () => {
    const user = userEvent.setup();
    renderControls();
    setParseDrafts(firstDraft);
    await user.click(screen.getByRole('button', { name: '解析' }));
    await waitFor(() => expect(snapshot().drafts).toEqual(['ai-draft-1']));

    await user.click(screen.getByRole('button', { name: '表單開始送出' }));
    expect(snapshot().writingKey).toBe('form-draft');
    await user.click(screen.getByRole('button', { name: '確認第一筆' }));
    expect(mocks.mutateAsync).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '表單送出結束' }));
    await user.click(screen.getByRole('button', { name: '編輯中確認第一筆' }));
    expect(mocks.mutateAsync).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '確認第一筆' }));
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(snapshot().drafts).toEqual([]));
  });

  it('keeps the write lock after its page unmounts until the request ends', async () => {
    const user = userEvent.setup();
    const request = deferred<void>();
    mocks.mutateAsync.mockReturnValueOnce(request.promise);
    setParseDrafts(firstDraft);

    function SwitchablePage() {
      const [page, setPage] = useState('home');
      return (
        <>
          <button type="button" onClick={() => setPage('transactions')}>
            換頁
          </button>
          <div key={page}>
            <SessionControls />
          </div>
        </>
      );
    }

    render(
      <Harness>
        <SwitchablePage />
      </Harness>,
    );
    await user.click(screen.getByRole('button', { name: '解析' }));
    await waitFor(() => expect(snapshot().drafts).toEqual(['ai-draft-1']));
    await user.click(screen.getByRole('button', { name: '確認第一筆' }));
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: '換頁' }));
    await user.click(screen.getByRole('button', { name: '確認第一筆' }));
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    expect(snapshot().writingKey).toBe('ai-draft-1');

    request.resolve(undefined);
    await waitFor(() => expect(snapshot().writingKey).toBeNull());
  });

  it('fixes the confirm-all candidate list before later parses add drafts', async () => {
    const user = userEvent.setup();
    const firstWrite = deferred<void>();
    const secondWrite = deferred<void>();
    mocks.mutateAsync
      .mockReturnValueOnce(firstWrite.promise)
      .mockReturnValueOnce(secondWrite.promise);
    mocks.parse
      .mockResolvedValueOnce({ drafts: [firstDraft, secondDraft] })
      .mockResolvedValueOnce({ drafts: [lateDraft] });
    renderControls();

    await user.click(screen.getByRole('button', { name: '解析' }));
    await waitFor(() => expect(snapshot().drafts).toEqual(['ai-draft-1', 'ai-draft-2']));
    await user.click(screen.getByRole('button', { name: '全部確認' }));
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(1));
    expect(snapshot().isConfirmingAll).toBe(true);

    await user.click(screen.getByRole('button', { name: '再解析' }));
    await waitFor(() =>
      expect(snapshot().drafts).toEqual(['ai-draft-1', 'ai-draft-2', 'ai-draft-3']),
    );
    firstWrite.resolve(undefined);
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(2));
    secondWrite.resolve(undefined);
    await waitFor(() => expect(snapshot().isConfirmingAll).toBe(false));
    expect(snapshot().drafts).toEqual(['ai-draft-3']);
    expect(mocks.mutateAsync).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ ledgerId: 'ledger-a' }),
    );
    expect(mocks.mutateAsync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ ledgerId: 'ledger-a' }),
    );
  });

  it('stops confirm-all after logout before sending the next draft', async () => {
    const user = userEvent.setup();
    const firstWrite = deferred<void>();
    mocks.mutateAsync.mockReturnValueOnce(firstWrite.promise);
    setParseDrafts(firstDraft, secondDraft);
    const view = renderControls();

    await user.click(screen.getByRole('button', { name: '解析' }));
    await waitFor(() => expect(snapshot().drafts).toEqual(['ai-draft-1', 'ai-draft-2']));
    await user.click(screen.getByRole('button', { name: '全部確認' }));
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(1));

    mocks.authenticated = false;
    view.rerender(
      <Harness>
        <SessionControls />
      </Harness>,
    );
    await waitFor(() => expect(snapshot().drafts).toEqual([]));
    firstWrite.resolve(undefined);
    await waitFor(() => expect(snapshot().writingKey).toBeNull());
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    expect(snapshot().isConfirmingAll).toBe(false);
  });
});
