import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageErrorBoundary } from './PageErrorBoundary';

function BrokenPage(): never {
  throw new Error('render failed');
}

/**
 * 頁面層級的錯誤邊界：某一頁出錯時，邊界外的導覽（這裡用一個 Link 代表側欄或站名）
 * 還在，點到別頁、或點同一頁的連結就恢復，不必重新整理。用 MemoryRouter 模擬導覽。
 */
describe('PageErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps navigation usable and recovers on the next page', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/broken']}>
        <Link to="/accounts">帳戶</Link>
        <PageErrorBoundary>
          <Routes>
            <Route path="/broken" element={<BrokenPage />} />
            <Route path="/accounts" element={<p>帳戶頁</p>} />
          </Routes>
        </PageErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: '畫面出錯了' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: '帳戶' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('帳戶頁')).toBeInTheDocument();
  });

  it('recovers when navigating to the same path with a different query', async () => {
    const user = userEvent.setup();
    function MaybeBroken() {
      if (new URLSearchParams(useLocation().search).has('boom')) throw new Error('render failed');
      return <p>首頁</p>;
    }
    render(
      <MemoryRouter initialEntries={['/?boom=1']}>
        <Link to="/">首頁連結</Link>
        <PageErrorBoundary>
          <MaybeBroken />
        </PageErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: '首頁連結' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('首頁')).toBeInTheDocument();
  });
});
