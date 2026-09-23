import { ApiError } from '../lib/api-client';
import { toUserMessage } from '../lib/error-messages';
import styles from './FormError.module.css';

/**
 * 顯示表單送出後的錯誤。
 *
 * 訊息由 `toUserMessage` 產生：`errorCode` 有收錄在對照表就顯示中文，沒有就
 * 原樣顯示後端的訊息。**訊息的內容仍由後端定義**（這裡與各 mutation 都不攔截
 * 錯誤），前端只負責把代碼換成在地化字串，不另外猜測或潤飾。
 *
 * `details`（驗證失敗的欄位層級訊息）照舊原樣呈現——那些字串是後端的
 * class-validator 產生的，要在地化得改後端，不在對照表的管轄內。
 *
 * `role="alert"` 讓螢幕閱讀器在錯誤出現時主動朗讀。
 */
export function FormError({ error }: { error: unknown }) {
  if (!error) {
    return null;
  }

  const message = toUserMessage(error);
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
