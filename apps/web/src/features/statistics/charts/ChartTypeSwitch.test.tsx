import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChartTypeSwitch } from './ChartTypeSwitch';

/** 驗證圖型切換按鈕有文字、可用鍵盤操作，並公開選中狀態給讀屏。 */
describe('ChartTypeSwitch', () => {
  it('changes the chart type by keyboard and exposes the pressed state', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ChartTypeSwitch
        label="趨勢圖型"
        value="bar"
        onChange={onChange}
        options={[
          { value: 'bar', label: '長條' },
          { value: 'line', label: '折線' },
          { value: 'table', label: '表格' },
        ]}
      />,
    );

    const barButton = screen.getByRole('button', { name: '長條' });
    expect(barButton).toHaveAttribute('aria-pressed', 'true');
    const lineButton = screen.getByRole('button', { name: '折線' });
    expect(lineButton).toHaveAttribute('aria-pressed', 'false');
    lineButton.focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith('line');
  });
});
