/*
 * 在第一次繪製之前，把使用者選的深淺色套到 <html data-theme> 上（phase-2h D19）。
 *
 * 為什麼不在 React 裡做：React 的程式要等整包 JS 下載、執行完才跑，那之前瀏覽器
 * 已經用預設的深色畫出第一個畫面。選了淺色的人每次重新整理都會先閃一下深色。
 *
 * 為什麼是獨立檔案而不是寫在 index.html 裡：2g 的 CSP 是 `script-src 'self'`，
 * 禁止 inline script。外部檔案同源，CSP 本來就允許，不必放寬。
 *
 * 在 index.html 裡**不能加 defer 或 async**——它必須在畫面出來之前同步跑完。
 *
 * ⚠️ localStorage 的 key 與 `src/app/use-theme.ts` 的 THEME_STORAGE_KEY 必須相同。
 * 這裡不能 import，所以 `src/app/theme-init.test.ts` 會拿兩邊比對。
 */
(function () {
  try {
    var theme = window.localStorage.getItem('ledger.theme');
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  } catch (error) {
    // 讀不到（隱私模式、被瀏覽器封鎖）就什麼都不做，等於跟隨系統。
  }
})();
