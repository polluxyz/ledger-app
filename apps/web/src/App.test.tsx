import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from './App';

/**
 * 應用外殼與路由的行為測試：首頁的兩種狀態，以及登入頁對已登入者的轉址。
 */
describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.pushState({}, '', '/');
  });

  it('shows the signed-out preview on the public home page', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: '記帳系統' })).toBeInTheDocument();
    // 空狀態：統計卡片顯示 0，並引導登入 / 註冊。
    expect(screen.getAllByText('$0')).toHaveLength(3);
    expect(screen.getByRole('button', { name: '登入' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '註冊' })).toBeInTheDocument();
  });

  it('shows the signed-in home page when a token is stored', () => {
    localStorage.setItem('ledger.accessToken', 'fake.jwt.token');

    render(<App />);

    expect(screen.getByRole('button', { name: '登出' })).toBeInTheDocument();
    // 已登入時統計改為待補（正確數字需後端彙總端點）。
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
  });

  it('lets a signed-out visitor open the login page', () => {
    window.history.pushState({}, '', '/login');

    render(<App />);

    expect(screen.getByRole('heading', { name: '登入' })).toBeInTheDocument();
  });

  it('redirects a signed-in user away from the login page', () => {
    localStorage.setItem('ledger.accessToken', 'fake.jwt.token');
    window.history.pushState({}, '', '/login');

    render(<App />);

    expect(screen.queryByRole('heading', { name: '登入' })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });
});
