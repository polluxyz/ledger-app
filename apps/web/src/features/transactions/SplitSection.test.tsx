import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SplitParticipantDraft } from './split-form';
import { SplitSection } from './SplitSection';

/**
 * 分帳名單下方的箭頭預覽（3c W67、決策 87）。
 *
 * 策略：直接渲染 `SplitSection`，餵固定的名單與份額，只看箭頭的讀屏文字。
 * 這是合併驗收時補的回歸測試：別人付時曾經把「小華欠付款人」也畫出來，
 * 而且讀屏文字寫成「小華欠你」。對象選單會打 API，所以 stub 掉 fetch。
 */
function person(key: string, counterpartyId: string | null, name: string): SplitParticipantDraft {
  return {
    key,
    counterpartyId,
    name,
    isMe: counterpartyId === null,
    included: true,
    amountFixed: false,
    amountInput: '',
    amountValue: 0,
    ratioFixed: false,
    ratioInput: '',
    ratioValue: 0,
  };
}

const participants = [
  person('me', null, '我'),
  person('yi', 'cp-yi', '乙'),
  person('hua', 'cp-hua', '小華'),
];
const shares = new Map([
  ['me', 100000],
  ['yi', 100000],
  ['hua', 100000],
]);

function renderSection(
  isPayerOther: boolean,
  type: 'EXPENSE' | 'INCOME' = 'EXPENSE',
  people: SplitParticipantDraft[] = participants,
  onToggleMe = vi.fn(),
) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SplitSection
        enabled
        pending={false}
        type={type}
        isPayerOther={isPayerOther}
        participants={people}
        previewShares={shares}
        onToggle={vi.fn()}
        onAddCounterparty={vi.fn()}
        onAddName={vi.fn()}
        onRemoveParticipant={vi.fn()}
        onToggleMe={onToggleMe}
        onOpenOptions={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe('SplitSection 的箭頭預覽', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ items: [], page: 1, limit: 20, total: 0 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('我付的支出：每個別人一行「欠你」', () => {
    renderSection(false);
    expect(screen.getByText('乙欠你 $1,000')).toBeInTheDocument();
    expect(screen.getByText('小華欠你 $1,000')).toBeInTheDocument();
  });

  it('我收的收入：每個別人一行「你欠」', () => {
    renderSection(false, 'INCOME');
    expect(screen.getByText('你欠乙 $1,000')).toBeInTheDocument();
    expect(screen.getByText('你欠小華 $1,000')).toBeInTheDocument();
  });

  it('別人付時不畫任何人的箭頭：其他人欠付款人不關我的事，我那行在帳戶列下方', () => {
    renderSection(true);
    expect(screen.queryByText(/欠你/)).not.toBeInTheDocument();
    expect(screen.queryByText(/你欠/)).not.toBeInTheDocument();
  });

  // 修訂 2（W92）：「我」用「−」移除後沒有地方加回來，改成勾選框。
  it('「我」是勾選框，沒有移除按鈕；取消勾選呼叫 onToggleMe(false)', () => {
    const onToggleMe = vi.fn();
    renderSection(false, 'EXPENSE', participants, onToggleMe);
    const me = screen.getByRole('checkbox', { name: '我' });
    expect(me).toBeChecked();
    expect(screen.queryByRole('button', { name: '移除我' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '移除乙' })).toBeInTheDocument();
    fireEvent.click(me);
    expect(onToggleMe).toHaveBeenCalledWith(false);
  });

  it('沒勾「我」時那一列還在、沒有金額，可以再勾回來', () => {
    const onToggleMe = vi.fn();
    const withoutMe = participants.map((person) =>
      person.isMe ? { ...person, included: false } : person,
    );
    renderSection(false, 'EXPENSE', withoutMe, onToggleMe);
    const me = screen.getByRole('checkbox', { name: '我' });
    expect(me).not.toBeChecked();
    fireEvent.click(me);
    expect(onToggleMe).toHaveBeenCalledWith(true);
  });
});
