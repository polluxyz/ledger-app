import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { EmailField } from './EmailField';

/**
 * EmailField 的契約：打進去的大寫即時變小寫（改的是值，不只是畫面），並關掉手機
 * 鍵盤的自動大寫。用一個持有 state 的小元件包起來，模擬真實表單的受控用法。
 */
describe('EmailField', () => {
  function Harness() {
    const [email, setEmail] = useState('');
    return <EmailField label="Email" value={email} onChange={setEmail} />;
  }

  it('turns typed uppercase letters into lowercase', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const field = screen.getByLabelText('Email');
    await user.type(field, 'Bob@Example.COM');

    expect(field).toHaveValue('bob@example.com');
  });

  it('asks mobile keyboards not to auto-capitalize', () => {
    render(<Harness />);

    const field = screen.getByLabelText('Email');
    expect(field).toHaveAttribute('type', 'email');
    expect(field).toHaveAttribute('autocapitalize', 'none');
  });
});
