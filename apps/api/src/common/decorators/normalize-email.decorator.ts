import { Transform } from 'class-transformer';

/**
 * 把 email 欄位正規化成「去頭尾空白、全小寫」，在 DTO 驗證之前套用。
 *
 * 為什麼在後端做：email 實務上不分大小寫，但資料庫的唯一索引分，於是
 * `Foo@x.com` 與 `foo@x.com` 會被當成兩個人——同一個人可能註冊兩次，或用另一種
 * 大小寫登入時被說「帳密錯誤」。Web 表單雖然也會即時轉小寫，但行動 App 與直接
 * 呼叫 API 的請求不經過它，所以規則必須在這裡。資料庫另有 CHECK 約束兜底。
 *
 * 非字串原樣放行，交給後面的 `@IsEmail()` 回 400，不在這裡吞掉錯誤。
 */
export function NormalizeEmail(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );
}
