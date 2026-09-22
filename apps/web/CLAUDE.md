# apps/web — 前端規範

補充根目錄 `CLAUDE.md`，只寫這一層的慣例。全局規則（安全性、界線、Git 流程）仍以根目錄那份為準。

**最重要的一條：前端不實作業務邏輯。** 金額計算規則、授權判斷、一致性驗證全部在後端。前端的檢查只為體驗（必填提示、格式提示），真正的驗證以後端回應為準。

## 結構

```
src/
  app/         路由、Provider、AppShell / Sidebar / TopBar、守衛（ProtectedRoute）
  pages/       頁面元件，一個路由一個
  features/    領域切分：accounts / auth / categories / ledgers / transactions
  components/  跨領域的無狀態 UI 元件（Button、Dialog、TextField…）
  lib/         api-client、格式化、localStorage 存取等工具
  styles/      global.css（設計 token 在這裡）
e2e/           Playwright 測試
```

`features/` 的切分刻意與平台無關，方便未來搬到 React Native。新增領域時建新資料夾，不要塞進 `pages/`。

## 慣例

- **樣式用 CSS Modules**（`X.module.css`）＋ `global.css` 的 CSS 變數。**不要另創配色**，顏色一律取設計 token。
- 元件檔與它的 `.module.css`、`.test.tsx` 放一起。
- 所有對後端的呼叫走 `lib/api-client.ts`，不要在元件裡直接 `fetch`。
- token 存取集中在 `lib/token-storage.ts`。**除了 token，任何機敏資訊都不進前端或 log。**
- 每個受保護頁面確認登入狀態（用 `app/ProtectedRoute.tsx`）。

## 已知陷阱

**`@ledger/shared` 必須留在 `vite.config.ts` 的 `optimizeDeps.include` 裡。**
shared 編譯成 CommonJS，而 Vite 預設不預先打包 workspace 連結的套件。拿掉這行，第一個「值」匯入（不是 `import type`）就會讓整頁全白。

**改了 `packages/shared` 並重新 build 之後，dev server 要重開**才會拿到新的預先打包結果。

## 指令

```bash
pnpm --filter @ledger/web dev        # 開發伺服器（5173）
pnpm --filter @ledger/web test       # 單元測試
pnpm --filter @ledger/web test:e2e   # Playwright，自己起 API 3100 與 web 5273
```

Playwright 會自己啟動前後端，不必先開。**不要與 api 的 e2e 同時跑**，兩者共用 `ledger_test` 資料庫。第一次要先裝瀏覽器：`pnpm --filter @ledger/web exec playwright install chromium`。

## 新增相依

前端套件也算新增相依，**先說明再裝**（見根目錄 §14）。
