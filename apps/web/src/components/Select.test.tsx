import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Select } from './Select';

/**
 * Select 與 TextField 同一套可及性契約：label 綁定 select、選項由 children
 * 提供、選了要反應成值並通知 onChange。交易表單的分類／帳戶下拉都靠這個綁定。
 */
describe('Select', () => {
  it('ties the label to the select', () => {
    render(
      <Select label="分類" onChange={() => {}}>
        <option value="food">餐飲</option>
      </Select>,
    );

    expect(screen.getByLabelText('分類')).toBeInTheDocument();
  });

  it('renders its options and reports the chosen value', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <Select label="分類" onChange={onChange}>
        <option value="food">餐飲</option>
        <option value="trans">交通</option>
      </Select>,
    );

    const select = screen.getByLabelText('分類');
    // 預設停在第一個選項。
    expect(select).toHaveValue('food');

    await user.selectOptions(select, 'trans');

    expect(select).toHaveValue('trans');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('can be disabled', () => {
    render(
      <Select label="分類" disabled onChange={() => {}}>
        <option value="food">餐飲</option>
      </Select>,
    );

    expect(screen.getByLabelText('分類')).toBeDisabled();
  });
});
