import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api-client';
import { FormError } from './FormError';

/**
 * FormError 是錯誤對照表（`lib/error-messages.ts`）對外的唯一出口，
 * `toUserMessage` 的三條規則都在這裡驗呈現結果：已知代碼顯示中文、未知代碼
 * 原樣顯示後端訊息、非 ApiError 顯示連線失敗句。另外兩件事也釘住：
 * 沒有錯誤時整個不渲染、`details` 的欄位層級訊息不在地化（那要改後端）。
 */
describe('FormError', () => {
  it('renders nothing when there is no error', () => {
    const { container } = render(<FormError error={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the localized message for a code the table covers', () => {
    render(
      <FormError
        error={
          new ApiError(
            409,
            'ACCOUNT_IN_USE',
            'Cannot delete an account that transactions reference.',
          )
        }
      />,
    );

    // errorCode 有收錄 → 顯示中文，而不是後端的英文句。
    expect(screen.getByRole('alert')).toHaveTextContent('這個帳戶已經有交易在用，不能刪除。');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Cannot delete');
  });

  it('shows the backend message verbatim for a code the table does not cover', () => {
    render(
      <FormError
        error={
          new ApiError(
            400,
            'TRACKS_BALANCE_IMMUTABLE',
            'The tracksBalance flag cannot be changed after creation.',
          )
        }
      />,
    );

    // 對照表沒有的代碼退回後端原文——空字串或佔位文字都比英文更糟。
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The tracksBalance flag cannot be changed after creation.',
    );
  });

  it('shows the network-failure message for a non-ApiError', () => {
    render(<FormError error={new TypeError('Failed to fetch')} />);

    expect(screen.getByRole('alert')).toHaveTextContent('無法連線到伺服器，請確認網路後再試一次。');
  });

  it('keeps field-level details as-is under the localized summary', () => {
    render(
      <FormError
        error={
          new ApiError(400, 'VALIDATION_FAILED', 'Validation failed', [
            'password must be longer than or equal to 8 characters',
          ])
        }
      />,
    );

    // 摘要是在地化的；details 是 class-validator 的原文，原樣呈現。
    expect(screen.getByRole('alert')).toHaveTextContent('有欄位不符合要求');
    expect(
      screen.getByText('password must be longer than or equal to 8 characters'),
    ).toBeInTheDocument();
    // 對照表只換摘要，不該有人偷偷把 details 也換掉——它們是 class-validator
    // 的原文，要在地化得改後端。
    expect(screen.getByRole('listitem')).toBeInTheDocument();
  });
});
