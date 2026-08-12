import { ApiError } from '../lib/api-client';
import styles from './FormError.module.css';

/**
 * 顯示表單送出後的錯誤。
 *
 * 一律直接呈現後端給的訊息——後端已保證訊息對使用者清楚且不洩漏內部細節，
 * 前端不再自行改寫或猜測，避免兩邊說法不一致。
 *
 * `role="alert"` 讓螢幕閱讀器在錯誤出現時主動朗讀。
 */
export function FormError({ error }: { error: unknown }) {
  if (!error) {
    return null;
  }

  const message =
    error instanceof ApiError ? error.message : '無法連線到伺服器，請確認網路後再試一次。';
  const details = error instanceof ApiError ? error.details : undefined;

  return (
    <div className={styles.error} role="alert">
      <span>{message}</span>
      {details && details.length > 0 && (
        <ul className={styles.list}>
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
