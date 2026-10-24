import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParseTransactionResponse } from '@ledger/shared';
import { AI_TEXT_MAX_LENGTH, ErrorCode } from '@ledger/shared';
import { ApiError, apiRequest } from '../../lib/api-client';
import { toDateInputValue } from '../../lib/format';
import { usePageToolbarSlot } from '../../app/PageToolbarSlotContext';
import { PageToolbarSlotProvider } from '../../app/PageToolbarSlotProvider';
import { AiDraftInput } from './AiDraftInput';

vi.mock('../../lib/api-client', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api-client')>('../../lib/api-client');
  return { ...actual, apiRequest: vi.fn() };
});

const requestApi = vi.mocked(apiRequest);

function ToolbarSlot() {
  const { setElement } = usePageToolbarSlot();
  return <div ref={setElement} data-testid="page-toolbar-slot" />;
}

function renderInput(onParsed: (drafts: ParseTransactionResponse['drafts']) => void) {
  return render(
    <PageToolbarSlotProvider>
      <ToolbarSlot />
      <AiDraftInput ledgerId="ledger-1" onParsed={onParsed} />
    </PageToolbarSlotProvider>,
  );
}

/**
 * 驗證交易頁的 AI 輸入會 portal 到頂端橫條，送出鎖定與錯誤提示仍留在頁面內容。
 * 以測試用插槽承接 portal，並沿用假 API 檢查不同回應路徑。
 */
describe('AI transaction input', () => {
  beforeEach(() => requestApi.mockReset());

  it('W208 sends today and the shared limit; Enter and clicks cannot resubmit while W213 keeps an empty response in the field', async () => {
    const user = userEvent.setup();
    requestApi.mockImplementation(
      () =>
        new Promise<ParseTransactionResponse>((resolve) => {
          setTimeout(() => resolve({ drafts: [] }), 50);
        }),
    );
    const onParsed = vi.fn();
    renderInput(onParsed);

    const input = screen.getByRole('textbox', { name: '用一句話記帳' });
    expect(screen.getByTestId('page-toolbar-slot')).toContainElement(input);
    expect(screen.queryByText('AI 記帳')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('maxLength', String(AI_TEXT_MAX_LENGTH));
    await user.type(input, '早餐 60 現金');
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(input).toBeDisabled());

    expect(requestApi).toHaveBeenCalledTimes(1);
    expect(requestApi).toHaveBeenCalledWith('/ai/parse-transaction', {
      method: 'POST',
      body: { text: '早餐 60 現金', ledgerId: 'ledger-1', today: toDateInputValue() },
    });
    expect(input).toBeDisabled();
    const processingButton = screen.getByRole('button', { name: '處理中…' });
    expect(processingButton).toBeDisabled();
    expect(processingButton).toHaveAttribute('aria-busy', 'true');
    expect(processingButton.querySelector('[aria-hidden="true"]')).toBeInTheDocument();

    fireEvent.submit(input.closest('form')!);
    fireEvent.click(processingButton);
    fireEvent.click(processingButton);
    expect(requestApi).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('看不懂，換個說法再試。'),
    );
    expect(screen.getByTestId('page-toolbar-slot')).not.toContainElement(screen.getByRole('alert'));
    expect(input).toHaveValue('早餐 60 現金');
    expect(onParsed).not.toHaveBeenCalled();
  });

  it.each([
    [new ApiError(429, ErrorCode.AI_DAILY_LIMIT, 'ignored'), '今天的 AI 次數用完了'],
    [new ApiError(429, ErrorCode.TOO_MANY_REQUESTS, 'ignored'), '太頻繁了，等一分鐘再試。'],
    [new ApiError(429, 'UNKNOWN', 'ignored'), '太頻繁了，等一分鐘再試。'],
    [new ApiError(503, 'AI_NOT_CONFIGURED', 'ignored'), 'AI 記帳還沒啟用。'],
    [new ApiError(503, 'AI_UNAVAILABLE', 'ignored'), 'AI 暫時沒有回應，請稍後再試。'],
  ])(
    'W213 keeps the sentence for a retry and maps the API error to one sentence',
    async (error, message) => {
      const user = userEvent.setup();
      requestApi.mockRejectedValueOnce(error);
      const onParsed = vi.fn();
      renderInput(onParsed);
      const input = screen.getByRole('textbox', { name: '用一句話記帳' });
      await user.type(input, '午餐 120 刷卡');
      await user.click(screen.getByRole('button', { name: '送出' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(input).toHaveValue('午餐 120 刷卡');
      expect(input).toBeEnabled();
      expect(onParsed).not.toHaveBeenCalled();
    },
  );

  it('allows the sentence to be edited after an error and appends successful response drafts', async () => {
    const user = userEvent.setup();
    const draft = {
      ledgerId: 'ledger-1',
      type: 'EXPENSE',
      amount: 6000,
      date: '2026-10-23',
      title: '早餐',
      categoryId: 'cat-1',
      accountId: 'acc-1',
      toAccountId: null,
    } as const;
    requestApi
      .mockRejectedValueOnce(new Error('private provider detail'))
      .mockResolvedValueOnce({ drafts: [draft] });
    const onParsed = vi.fn();
    renderInput(onParsed);
    const input = screen.getByRole('textbox', { name: '用一句話記帳' });
    await user.type(input, '錯的句子');
    await user.click(screen.getByRole('button', { name: '送出' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('AI 暫時沒有回應，請稍後再試。');

    await user.clear(input);
    await user.type(input, '早餐 60 現金');
    await user.click(screen.getByRole('button', { name: '送出' }));
    await waitFor(() => expect(onParsed).toHaveBeenCalledWith([draft]));
    expect(input).toHaveValue('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
