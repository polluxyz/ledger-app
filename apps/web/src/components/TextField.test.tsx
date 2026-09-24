import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TextField } from './TextField';

/**
 * TextField 的可及性契約：label 綁定 input（getByLabelText 找得到）、hint 透過
 * aria-describedby 掛上、原生屬性（required 等）原樣透傳。表單測試全都靠
 * label 定位欄位，這個綁定壞了會讓上層測試全面失準。
 */
describe('TextField', () => {
  it('ties the label to the input so typing reaches the field', async () => {
    const user = userEvent.setup();

    render(<TextField label="名稱" onChange={() => {}} />);

    const field = screen.getByLabelText('名稱');
    await user.type(field, '現金');
    expect(field).toHaveValue('現金');
  });

  it('links the hint through aria-describedby', () => {
    render(<TextField label="密碼" hint="至少 8 個字元" onChange={() => {}} />);

    const field = screen.getByLabelText('密碼');
    // 補充說明要真的被輔助技術讀到，不是只畫在旁邊。
    expect(field).toHaveAccessibleDescription('至少 8 個字元');
    expect(screen.getByText('至少 8 個字元')).toBeInTheDocument();
  });

  it('forwards native attributes like type and required', () => {
    render(<TextField label="密碼" type="password" required onChange={() => {}} />);

    const field = screen.getByLabelText('密碼');
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toBeRequired();
  });

  // 瀏覽器自動填入會把 email 之類的舊輸入推薦到金額欄；預設關掉，需要的欄位自己打開。
  it('turns browser autofill off by default but lets a field opt back in', () => {
    render(
      <>
        <TextField label="金額" type="number" onChange={() => {}} />
        <TextField label="Email" autoComplete="email" onChange={() => {}} />
      </>,
    );

    expect(screen.getByLabelText('金額')).toHaveAttribute('autocomplete', 'off');
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email');
  });

  it('omits the hint element when no hint is given', () => {
    render(<TextField label="名稱" onChange={() => {}} />);

    expect(screen.getByLabelText('名稱')).not.toHaveAccessibleDescription();
  });
});
