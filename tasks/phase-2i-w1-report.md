# 2i W1 完成回報：左側欄、使用者選單、901–1199px 浮動展開

分支 `polluxyz/2i-w1-sidebar`，commit `792d619`（＋本份回報）。未 push、未開 PR。

## 驗收指令

| 指令                                  | 結果                                            |
| ------------------------------------- | ----------------------------------------------- |
| `pnpm --filter @ledger/web lint`      | 綠                                              |
| `pnpm --filter @ledger/web typecheck` | 綠                                              |
| `pnpm --filter @ledger/web test`      | **321 通過 / 2 失敗**（失敗兩條是 W2 的，見下） |
| `pnpm format:check`                   | 綠                                              |

單元測試 304 → 323（+19），測試檔 48 → 49（+1，`UserMenu.test.tsx`）。

## 留給 W2 的兩條失敗

`apps/web/src/features/ledgers/LedgerSwitcher.test.tsx`

- `switches which ledger the home page records into`
- `never offers an archived ledger`

兩條都是 `render(<App />)` 後找 `getByLabelText('作用中帳本')`。切換器已依 SC-31.4 從側欄移除，W2 把它放進 `PageHeader` 之後就會恢復。協調者 2026-09-23 指示「B：留給 W2，你不動」，我沒有碰這個檔。

## 改過選取步驟的既有測試

斷言意圖一律不變，只多了「先打開使用者選單」這一步。

| 檔案:行號                                                | 改了什麼                                                                                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/App.test.tsx:30-33`                        | 測試改成 async，先點「帳號選單」再斷言「登出」按鈕；補 `userEvent` 的 import                                                       |
| `apps/web/src/app/AppShell.test.tsx:45-47`               | 未登入那條**多加**一行：連「帳號選單」都不該出現。原本的「登出」斷言保留                                                           |
| `apps/web/src/app/ProtectedRoute.test.tsx:88-90`         | `findByRole('button','登出')` → 先 `findByRole('button','帳號選單')` 再點開                                                        |
| `apps/web/src/features/auth/AuthDialog.test.tsx:110-112` | 同上                                                                                                                               |
| `apps/web/src/pages/LoginPage.test.tsx:41-44`            | 同上                                                                                                                               |
| `apps/web/src/pages/RegisterPage.test.tsx:47-49`         | 同上                                                                                                                               |
| `apps/web/src/app/AppSidebar.test.tsx:80-89`             | 「個人資料」不在側欄導覽了，改成打開選單後找 `link` 名稱「個人資料」→ `/profile`                                                   |
| `apps/web/src/app/AppSidebar.test.tsx:158-171`           | 收合後仍讀得到名稱：導覽清單改成五項（加「交易」、拿掉「個人資料」）；「作用中帳本」那兩行移除；「登出」改成打開選單後斷言         |
| `apps/web/src/components/ThemeToggle.test.tsx:65-81`     | **經協調者核可**。「全站同時只有一組外觀控制項」意圖不變：訪客仍是頂列那顆循環鈕；登入後改成「那顆不渲染」＋「選單裡有三顆 radio」 |

## 新增測試（+19）

`apps/web/src/app/UserMenu.test.tsx`（9 條）

開關與 `aria-expanded`、第一層三項的角色與去向、第二層三顆 radio 與選中狀態、選「淺色」會改 `<html data-theme>` 與 `localStorage['ledger.theme']`、↑↓ 移動、→ 開第二層並聚焦目前選中的 radio、Esc 一層一層關且焦點回歸、← 關第二層、點外面全關、取不到名稱時的「帳號選單」。

`apps/web/src/app/AppSidebar.test.tsx`（+5）

側欄裡沒有帳本卡與「個人資料」、「交易」連結指向 `/transactions`、901–1199px 預設收合但按鈕仍在、浮動展開不寫 localStorage 且點連結後收回、Esc 收回。

`apps/web/src/app/use-sidebar-collapsed.test.ts`（+3）

`useSidebarFloatingRange`：沒有 `matchMedia` 時回 false、有的時候照查詢結果回答。

`apps/web/src/components/ThemeToggle.test.tsx`（+2 淨值來自既有那條改寫後的分支，計入上表）。

## 偏離 Task spec 的地方

1. **使用者選單不是 ARIA menu，是揭露式面板（disclosure）。** 依協調者 2026-09-23 的更正訊息（主旨「修正：使用者選單不要用 role=menu，改用揭露式」）：`role="menuitem"` 會讓「登出」不再是 `button`，既有 e2e 與單元測試的 `getByRole('button', { name: '登出' })` 會整批失效。實際做法是觸發鈕 `aria-expanded` ＋ `aria-controls`；「設定」是 `<button aria-expanded>`、「個人資料」是 `Link`、「登出」是原生 `<button>`；第二層是 `role="radiogroup"` 加三顆原生 radio。觸發鈕也因此**沒有** `aria-haspopup="menu"`。
2. **第二層的 ↑↓ 交給瀏覽器內建。** radio 群組的方向鍵移動是原生行為，自己再寫一份只會打架。`←` 有 `preventDefault`，否則會被當成「移到上一顆 radio」。
3. **沒有開瀏覽器看樣版網站** `docs/artifacts/step-2i-02-prototype.html`。根目錄 `CLAUDE.md` §13 明說不要主動把 `docs/artifacts/` 當 context 來源，而 spec §4.3／§4.4 已經把尺寸、順序、行為寫死，所以一律照 spec 做。
4. **`AppSidebar` 多包一層 `.panel`。** 901–1199px 浮動展開時外殼第一欄必須維持 72px，而外殼 grid 的第一欄是 `auto`——`<aside>` 一變寬中間內容就被推走。所以 `<aside>` 固定 72px，真正變寬並浮起來的是內層 `.panel`。
5. **移除了 `<aside>` 上的 `data-sidebar-collapsed`。** 那是 2h 給 `LedgerSwitcher.module.css` 用的鉤子，切換器已不在側欄。`LedgerSwitcher.module.css` 裡對應的規則屬於 W2 的範圍，我沒有動。

## 沒有處理的事

- e2e 沒跑（共用資料庫，依 Task spec 交給協調者）。`e2e/layout.spec.ts` 的 SC-31.1（收合前後 icon 座標）與 SC-32.x 需要協調者補。
- 收合前後 icon 中心相同這件事是 CSS 保證的（`.panel` 8px ＋ 每列 8px ＝ 圖示一律從左緣 16px 起算，列高固定），jsdom 量不到，要靠 e2e 驗。
