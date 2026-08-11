import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

/**
 * 冒煙測試：確認測試管線（Vitest + jsdom + Testing Library）可正常渲染元件。
 * 真正的功能測試隨各 slice 加入。
 */
describe('App', () => {
  it('renders the app title', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: '記帳系統' })).toBeInTheDocument();
  });
});
