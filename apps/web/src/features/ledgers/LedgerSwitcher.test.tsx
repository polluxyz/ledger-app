import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';

/**
 * 頁首的帳本切換器（2i SC-33、§4.6）。
 *
 * 四件事要釘住：封存帳本不能被切過去、切換後首頁真的換了一本、只有一本時不畫下拉、
 * 膠囊上看得到「私人／共享」。第三輪（SC-40）把原生 `<select>` 換成自己畫的
 * listbox，所以再加三條：無障礙接線、鍵盤走完一次、Esc 與點外面只收起不切換。
 *
 * **查詢一律限縮在 `<main>` 之內。** 2i 把切換器從側欄搬到頁首，而側欄由另一位
 * worker 移除它——兩邊都在的那段期間，整頁會有兩個「作用中帳本」。限定範圍之後，
 * 這一檔驗的永遠是頁首那一份，不受側欄的進度影響。
 */
describe('Ledger switcher', () => {
  const fetchMock = vi.fn();

  const personal = {
    id: 'led-1',
    name: '個人帳本',
    currency: 'TWD',
    kind: 'PERSONAL',
    tracksBalance: true,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    role: 'OWNER',
  };
  const family = { ...personal, id: 'led-2', name: '家庭帳本', kind: 'SHARED' };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    window.history.pushState({}, '', '/');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** 頁首在 `<main>` 裡，側欄不在。 */
  const page = () => within(screen.getByRole('main'));

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** 交易端點回一筆帶帳本 id 的備註，好從畫面上看出現在用的是哪一本。 */
  function routeFetch(ledgers: unknown[]) {
    fetchMock.mockImplementation((url: string) => {
      const target = String(url);
      if (target.includes('/ledgers/') && target.includes('/transactions')) {
        const ledgerId = target.split('/ledgers/')[1]?.split('/')[0] ?? '';
        return Promise.resolve(
          jsonResponse(200, {
            items: [
              {
                id: `tx-${ledgerId}`,
                type: 'EXPENSE',
                amount: '100',
                occurredAt: '2026-08-01T00:00:00.000Z',
                note: `記在 ${ledgerId}`,
                categoryId: null,
                categoryName: null,
                accountId: null,
                accountName: null,
                creatorId: 'u1',
                creatorName: '我',
                createdAt: '2026-08-01T00:00:00.000Z',
                updatedAt: '2026-08-01T00:00:00.000Z',
              },
            ],
            page: 1,
            limit: 20,
            total: 1,
          }),
        );
      }
      if (target.includes('/ledgers')) {
        return Promise.resolve(jsonResponse(200, ledgers));
      }
      return Promise.resolve(jsonResponse(200, []));
    });
  }

  it('switches which ledger the home page records into', async () => {
    routeFetch([personal, family]);
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByText('記在 led-1')).toBeInTheDocument();

    // 第三輪換成自己畫的清單（SC-40），所以步驟是「點開膠囊 → 點那一項」，
    // 不再是原生 `<select>` 的 selectOptions。
    await user.click(page().getByRole('button', { name: /個人帳本/ }));
    await user.click(page().getByRole('option', { name: /家庭帳本/ }));

    // query key 帶著 ledgerId，所以換一本就自然重取，不必手動失效。
    expect(await screen.findByText('記在 led-2')).toBeInTheDocument();
    await waitFor(() => {
      expect(localStorage.getItem('ledger.activeLedgerId')).toBe('led-2');
    });
  });

  /** SC-40.2 的無障礙接線：按鈕指得到清單，清單的每一項說得出自己選中沒有。 */
  it('wires the trigger to a listbox', async () => {
    routeFetch([personal, family]);
    const user = userEvent.setup();

    render(<App />);

    const trigger = await page().findByRole('button', { name: /個人帳本/ });
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    const listId = trigger.getAttribute('aria-controls');
    expect(document.getElementById(listId ?? '')).toHaveAttribute('role', 'listbox');

    await user.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(page().getByRole('option', { name: /個人帳本/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(page().getByRole('option', { name: /家庭帳本/ })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  /**
   * 鍵盤全程走完一次（SC-40.2）：↓ 打開並停在目前這一本、↓ 移到下一本、
   * Enter 選取並收起。焦點一直在按鈕上，`aria-activedescendant` 負責說「停在哪」。
   */
  it('opens, moves and selects with the keyboard', async () => {
    routeFetch([personal, family]);
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByText('記在 led-1')).toBeInTheDocument();
    const trigger = page().getByRole('button', { name: /個人帳本/ });
    trigger.focus();

    await user.keyboard('{ArrowDown}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute(
      'aria-activedescendant',
      page().getByRole('option', { name: /個人帳本/ }).id,
    );

    await user.keyboard('{ArrowDown}');
    expect(trigger).toHaveAttribute(
      'aria-activedescendant',
      page().getByRole('option', { name: /家庭帳本/ }).id,
    );

    await user.keyboard('{Enter}');
    expect(await screen.findByText('記在 led-2')).toBeInTheDocument();
    // 換帳本時這一頁重畫，膠囊是**新的**節點（舊的已經離開 DOM），所以要重新查。
    expect(page().getByRole('button', { name: /家庭帳本/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('closes on Escape and on a click outside, without switching', async () => {
    routeFetch([personal, family]);
    const user = userEvent.setup();

    render(<App />);

    const trigger = await page().findByRole('button', { name: /個人帳本/ });

    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // 收起之後焦點要回到按鈕，否則鍵盤使用者會掉到頁面最上面。
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(document.body);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    // 兩條路都只是收起來，作用中帳本沒有被改掉。
    expect(localStorage.getItem('ledger.activeLedgerId')).not.toBe('led-2');
  });

  it('never offers an archived ledger', async () => {
    // `/ledgers` 預設就不含封存的，切換器直接沿用那份清單，不必自己再過濾。
    routeFetch([personal, family]);
    render(<App />);

    // 選項一直在 DOM 裡（SC-40.3），所以不必先點開就讀得到。每一項的帳本名在
    // `data-ledger-name` 那一格，勾選記號與「私人／共享」不混進來。
    const group = await page().findByLabelText('作用中帳本');
    const options = Array.from(group.querySelectorAll('[data-ledger-name]')).map(
      (option) => option.textContent,
    );
    expect(options).toEqual(['個人帳本', '家庭帳本']);
  });

  it('shows a plain name instead of a dropdown when there is only one ledger', async () => {
    routeFetch([personal]);

    render(<App />);

    // 一個永遠只有一個選項的下拉只會誤導人。
    expect(await page().findByText('個人帳本')).toBeInTheDocument();
    expect(page().queryByLabelText('作用中帳本')).not.toBeInTheDocument();
  });

  it('labels the ledger as personal or shared on the pill', async () => {
    // 膠囊上的小標籤（SC-33.1）。帳本名稱不會說出它是不是共享的，而「這筆記到
    // 哪裡」在共享帳本裡是別人也看得到的事，值得一眼看見。
    routeFetch([personal, family]);

    render(<App />);

    // 清單裡的每一項也帶同樣的小標籤，所以查詢要限縮在膠囊那顆按鈕之內。
    const pill = await page().findByRole('button', { name: /個人帳本/ });
    expect(within(pill).getByText('私人')).toBeInTheDocument();
  });

  it('stays out of the header while signed out', () => {
    localStorage.removeItem('ledger.accessToken');
    routeFetch([personal, family]);

    render(<App />);

    expect(screen.queryByLabelText('作用中帳本')).not.toBeInTheDocument();
  });
});
