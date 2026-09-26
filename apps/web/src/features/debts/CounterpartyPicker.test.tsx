import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Counterparty } from '@ledger/shared';
import { CounterpartyPicker } from './CounterpartyPicker';

const counterparties: Counterparty[] = [
  {
    id: 'cp-ming',
    name: '舊小明',
    displayName: '小明',
    askMerge: false,
    balance: 120,
    link: { userId: 'user-1', userName: '王小明', theirBalance: -50 },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'cp-hua',
    name: '阿華',
    displayName: '阿華',
    askMerge: false,
    balance: -11,
    link: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'cp-hua-classmate',
    name: '小華同學',
    displayName: '小華同學',
    askMerge: false,
    balance: 0,
    link: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
];

interface PickerHarnessProps {
  initialValue?: string;
  excludeLinked?: boolean;
  onChange?: (name: string) => void;
  onSelect?: (counterparty: Counterparty | null) => void;
}

function PickerHarness({
  initialValue = '',
  excludeLinked,
  onChange = () => undefined,
  onSelect,
}: PickerHarnessProps) {
  const [value, setValue] = useState(initialValue);
  return (
    <CounterpartyPicker
      value={value}
      onChange={(nextValue) => {
        onChange(nextValue);
        setValue(nextValue);
      }}
      onSelect={onSelect}
      excludeLinked={excludeLinked}
    />
  );
}

/**
 * 選人元件以真實 query hook 搭配 fetch mock 驗證 ARIA、後端篩選與選取回報，
 * 讓測試能抓到 debounce 或清單行為不慎改成前端比對的回歸。
 */
describe('CounterpartyPicker', () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    fetchMock.mockImplementation((url: string) => {
      const query = new URL(url).searchParams.get('q')?.trim() ?? '';
      const items = query
        ? counterparties.filter((counterparty) => counterparty.displayName.includes(query))
        : counterparties;
      return Promise.resolve(
        new Response(
          JSON.stringify({ items, page: 1, limit: 50, total: query === '' ? 60 : items.length }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function renderPicker(props: PickerHarnessProps = {}) {
    return render(
      <QueryClientProvider client={queryClient}>
        <PickerHarness {...props} />
      </QueryClientProvider>,
    );
  }

  it('shows names and the linked tag without exposing balances in the option list', async () => {
    renderPicker();
    const input = screen.getByRole('combobox', { name: '對象' });
    fireEvent.focus(input);

    expect(await screen.findByRole('option', { name: /小明.*連動/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '阿華' })).toBeInTheDocument();
    expect(screen.getByText('連動')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '繼續輸入以縮小範圍' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.queryByText(/\$\d+/)).not.toBeInTheDocument();
    expect(screen.queryByText(/目前.*欠你/)).not.toBeInTheDocument();
  });

  it('uses displayName for options, exact matching, selection, and the balance hint', async () => {
    const onChange = vi.fn();
    const onSelect = vi.fn();
    renderPicker({ onChange, onSelect });
    const input = screen.getByRole('combobox', { name: '對象' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '小明' } });

    const option = await screen.findByRole('option', { name: /小明.*連動/ });
    expect(screen.queryByRole('option', { name: /舊小明/ })).not.toBeInTheDocument();
    expect(await screen.findByText('目前小明欠你 $120')).toBeInTheDocument();
    fireEvent.click(option);

    expect(onChange).toHaveBeenLastCalledWith('小明');
    expect(onSelect).toHaveBeenLastCalledWith(counterparties[0]);
    expect(input).toHaveValue('小明');
  });

  it('sends the trimmed q only after the 300 ms debounce', async () => {
    renderPicker();
    const input = screen.getByRole('combobox', { name: '對象' });
    fireEvent.focus(input);
    await screen.findByRole('option', { name: '阿華' });

    vi.useFakeTimers();
    fireEvent.change(input, { target: { value: ' 小華 ' } });
    act(() => {
      void vi.advanceTimersByTime(299);
    });
    expect(fetchMock.mock.calls.some(([url]) => new URL(String(url)).searchParams.has('q'))).toBe(
      false,
    );

    act(() => {
      void vi.advanceTimersByTime(1);
    });
    expect(
      fetchMock.mock.calls.some(([url]) => new URL(String(url)).searchParams.get('q') === '小華'),
    ).toBe(true);
    vi.useRealTimers();
    const queryUrl = fetchMock.mock.calls
      .map(([url]) => new URL(String(url)))
      .find((url) => url.searchParams.has('q'));
    expect(queryUrl?.searchParams.get('limit')).toBe('50');
    expect(await screen.findByRole('option', { name: '小華同學' })).toBeInTheDocument();
  });

  it('offers and selects a new name when no exact match is returned', async () => {
    const onChange = vi.fn();
    const onSelect = vi.fn();
    renderPicker({ onChange, onSelect });
    const input = screen.getByRole('combobox', { name: '對象' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '小華' } });

    const createOption = await screen.findByRole('option', { name: '＋ 新增「小華」' });
    expect(createOption).toBe(screen.getAllByRole('option').at(-1));
    fireEvent.click(createOption);

    expect(onChange).toHaveBeenLastCalledWith('小華');
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(input).toHaveValue('小華');
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('moves through options with both arrows, selects with Enter, and closes with Escape', async () => {
    const onSelect = vi.fn();
    renderPicker({ onSelect });
    const input = screen.getByRole('combobox', { name: '對象' });
    fireEvent.focus(input);
    await screen.findByRole('option', { name: /小明.*連動/ });

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getByRole('option', { name: /小明.*連動/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith(counterparties[0]);
    expect(input).toHaveAttribute('aria-expanded', 'false');

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('option', { name: /小明.*連動/ })).not.toBeInTheDocument();
  });

  it('only lists unlinked people and omits the balance hint when requested', async () => {
    renderPicker({ excludeLinked: true });
    const input = screen.getByRole('combobox', { name: '對象' });
    fireEvent.focus(input);

    expect(await screen.findByRole('option', { name: '阿華' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /小明/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: '小明' } });
    expect(await screen.findByRole('option', { name: '＋ 新增「小明」' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /小明.*連動/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
