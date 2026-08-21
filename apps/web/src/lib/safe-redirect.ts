/**
 * 把「登入後要回哪裡」的值收斂成一個安全的站內路徑。
 *
 * 為什麼需要這個：轉址目標是從 `location.state` 來的，而 state 可以被任何一個
 * `<Link to="/login" state={{ from: … }}>` 或程式碼寫入。若原樣採信，一個帶著
 * `from = "https://evil.example"` 的連結就能讓使用者在**我們的網域**登入、成功後
 * 被送去外部網站——這叫開放轉址（open redirect）。它特別危險的地方在於：使用者
 * 剛輸入完密碼，對這個網域正處於最信任的時刻。
 *
 * 規則只有一條：**只接受站內的絕對路徑**。
 */
export function toSafeRedirect(value: unknown): string {
  if (typeof value !== 'string' || value === '') {
    return '/';
  }
  // 擋掉 https://evil.example、javascript:alert(1) 這類完整的 URL 與其他 scheme。
  if (!value.startsWith('/')) {
    return '/';
  }
  // 擋掉「協定相對 URL」。`//evil.com` 確實以 / 開頭，只檢查第一個字元會放行，
  // 但瀏覽器會把它當成 https://evil.com——這是這個防護裡最容易漏掉的一種形式。
  if (value.startsWith('//')) {
    return '/';
  }
  return value;
}
