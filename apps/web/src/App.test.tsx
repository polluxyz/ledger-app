import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from './App';

/**
 * 應用外殼的測試：確認「未登入時受保護路由會導向登入頁」這條最基本的規則
 * （體驗層的保護；真正的安全防線在後端）。
 */
describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.pushState({}, '', '/');
  });

  it('redirects to the login page when not signed in', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: '登入' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
  });

  it('renders the home page when a token is present', () => {
    localStorage.setItem('ledger.accessToken', 'fake.jwt.token');

    render(<App />);

    expect(screen.getByRole('heading', { name: '記帳系統' })).toBeInTheDocument();
  });
});
