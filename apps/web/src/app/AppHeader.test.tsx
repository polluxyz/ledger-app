import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

/**
 * 共用頁首的導覽（S5-A）。
 *
 * 重點是「未登入不該看到受保護頁面的入口」——那個連結按下去只會被導回登入頁，
 * 等於把人推進死路。
 */
describe('AppHeader', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.pushState({}, '', '/');
    // 已登入的首頁會去打帳本 / 交易 / 帳戶，這裡一律回空陣列，測試只看導覽。
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    );
  });

  it('links to the accounts page once signed in', () => {
    localStorage.setItem('ledger.accessToken', 'jwt-abc');

    render(<App />);

    const link = screen.getByRole('link', { name: '帳戶' });
    expect(link).toHaveAttribute('href', '/accounts');
    expect(screen.getByRole('link', { name: '首頁' })).toHaveAttribute('href', '/');
  });

  it('hides the navigation from signed-out visitors', () => {
    render(<App />);

    expect(screen.queryByRole('link', { name: '帳戶' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '登出' })).not.toBeInTheDocument();
    // 站名仍在，未登入者也看得到自己在哪個站。
    expect(screen.getByRole('heading', { name: '記帳系統' })).toBeInTheDocument();
  });

  it('keeps the navigation on the accounts page', async () => {
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    window.history.pushState({}, '', '/accounts');

    render(<App />);

    expect(await screen.findByRole('heading', { name: '帳戶' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '首頁' })).toBeInTheDocument();
  });
});
