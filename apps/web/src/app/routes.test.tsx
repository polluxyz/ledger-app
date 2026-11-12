import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppRoutes } from './routes';

vi.mock('../pages/HomePage', () => new Promise(() => {}));

/** 延遲首頁的載入，確認路由等待時會顯示載入輪廓。 */
describe('AppRoutes loading', () => {
  it('shows a loading status while the page is loading', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByRole('status', { name: '載入中' })).toBeInTheDocument();
  });
});
