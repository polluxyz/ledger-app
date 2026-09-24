import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Counterparty } from '@ledger/shared';
import { CounterpartyPicker, findCounterparty } from './CounterpartyPicker';

/**
 * 對象選擇器顯示 API 提供的目前餘額，並只在名字完全相符時視為既有對象；
 * 這組測試直接傳入清單，確認元件本身不需要重複查詢。
 */
describe('CounterpartyPicker', () => {
  const counterparties: Counterparty[] = [
    {
      id: 'cp-1',
      name: '小明',
      balance: 120,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
    {
      id: 'cp-2',
      name: '阿華',
      balance: -11,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
    {
      id: 'cp-3',
      name: '小美',
      balance: 0,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
  ];

  it.each([
    [' 小明 ', '目前小明欠你 $120'],
    ['阿華', '目前你欠阿華 $11'],
    ['小美', '目前和小美兩清'],
  ])('shows the matching balance for %s', (value, expectedHint) => {
    const onChange = vi.fn();
    const view = render(
      <CounterpartyPicker value="" onChange={onChange} counterparties={counterparties} />,
    );

    fireEvent.change(screen.getByLabelText('對象'), { target: { value } });

    expect(onChange).toHaveBeenCalledWith(value);
    view.rerender(
      <CounterpartyPicker value={value} onChange={onChange} counterparties={counterparties} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(expectedHint);
  });

  it('shows the new-counterparty hint when the name does not match', () => {
    render(
      <CounterpartyPicker value="小明同學" onChange={vi.fn()} counterparties={counterparties} />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('新對象，送出時建立');
  });

  it('matches trimmed names exactly', () => {
    expect(findCounterparty(' 小明 ', counterparties)).toEqual(counterparties[0]);
    expect(findCounterparty('小', counterparties)).toBeNull();
    expect(findCounterparty('   ', counterparties)).toBeNull();
  });
});
