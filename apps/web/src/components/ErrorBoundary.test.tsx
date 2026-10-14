import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

/** 渲染時一定丟例外的元件；訊息刻意帶「內部細節」，用來確認不會顯示給使用者。 */
function Broken(): never {
  throw new Error('SQL: select * from secret_table');
}

/**
 * ErrorBoundary 的三件事：沒出錯時原樣渲染、出錯時顯示錯誤頁但不洩漏例外內容、
 * `resetKey` 一變就恢復（頁面層級靠它做到「一導覽就好」）。
 *
 * React 會把接到的例外印到 console.error，這裡靜音，測試輸出才不會被洗版。
 */
describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>內容</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('內容')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the error page without the error message when a child throws', () => {
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );

    const alert = screen.getByRole('alert');
    expect(screen.getByRole('heading', { level: 2, name: '畫面出錯了' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新整理' })).toBeInTheDocument();
    expect(alert).not.toHaveTextContent('secret_table');
  });

  it('uses an h1 when it fills the screen', () => {
    render(
      <ErrorBoundary fullScreen>
        <Broken />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('heading', { level: 1, name: '畫面出錯了' })).toBeInTheDocument();
  });

  it('recovers when resetKey changes', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/transactions">
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(
      <ErrorBoundary resetKey="/accounts">
        <p>帳戶頁</p>
      </ErrorBoundary>,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('帳戶頁')).toBeInTheDocument();
  });

  it('stays on the error page when resetKey does not change', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/transactions">
        <Broken />
      </ErrorBoundary>,
    );

    rerender(
      <ErrorBoundary resetKey="/transactions">
        <p>同一頁</p>
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('同一頁')).not.toBeInTheDocument();
  });
});
