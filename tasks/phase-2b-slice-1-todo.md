# 任務清單：階段二 (2b) Slice 1 — 帳戶管理與餘額（前端）

> 狀態：**待開發者審核**
> 依據：`docs/specs/phase-2-web-mvp.md`、`tasks/phase-2b-slice-1-plan.md`（皆已核可）。
> 用法：依序執行；每個任務有驗收條件。勾選＝「開發者已驗收」。
> 標 👤 = 開發者親手操作（Claude 陪跑）。
> 通用驗收（每任務皆適用，不再重複）：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全綠。
> 分支：於 `feature/accounts-ui`（自 `main` 開）。**本步不改後端。**

### 設計決策（已於 Plan §4 核可，實作時一律照此）

| #   | 結論                                                                   |
| --- | ---------------------------------------------------------------------- |
| D1  | `ProtectedRoute` 提前到本切片；`state.from` 只接受站內相對路徑         |
| D2  | 從 `AuthDialog` 抽出通用 `components/Dialog.tsx`（純重構、零行為變更） |
| D3  | 刪除帳戶要二次確認，但**不做**「輸入名稱才能刪」那種強度               |
| D4  | 帳戶餘額在首頁**另成一列**，不與「本月支出／收入／結餘」統計卡混在一起 |
| D5  | 任何會改變交易的 mutation 都要一併失效 `['accounts']`                  |
| D6  | 負餘額用紅色呈現；初始餘額欄位**允許輸入負數**（不設 `min`）           |

---

## Step 1：抽出通用 Dialog

- [ ] **1.1 `components/Dialog.tsx`**
  - 內容：把 `AuthDialog` 的外殼抽成通用元件——原生 `<dialog>` + `showModal()`、標題列、關閉鈕、`onClose` 同步、**關閉時整個卸載**（`open` 為 false 時回傳 `null`）。props：`open` / `title` / `onClose` / `children`。
  - 驗收：元件本身有測試——`showModal` 有被呼叫；Esc 會觸發 `onClose`；關閉後內容從 DOM 消失（不是只隱藏）。
- [ ] **1.2 `AuthDialog` 改用 `Dialog`**
  - 內容：只換外殼，登入／註冊表單與切換邏輯完全不動。
  - 驗收：**既有 `AuthDialog.test.tsx` 一字未改仍全綠**——這是這次重構唯一的正確性依據。

## Step 2：受保護路由

- [ ] **2.1 `app/ProtectedRoute.tsx`**
  - 內容：未登入時 `<Navigate to="/login" state={{ from: location.pathname + location.search }} replace />`；已登入則 `<Outlet />`。
  - 驗收：測試——未登入存取受保護路徑會被導向 `/login`；已登入則正常渲染。
- [ ] **2.2 `state.from` 限制為站內路徑（安全性）**
  - 內容：新增純函式（例如 `lib/safe-redirect.ts`），只接受**以單一 `/` 開頭**的字串；`//`、`https://`、`javascript:` 等一律退回 `/`。`LoginPage` 改用它。
  - 驗收：測試逐一涵蓋 `/accounts`（通過）、`//evil.com`（擋下）、`https://evil.example`（擋下）、`javascript:alert(1)`（擋下）、`undefined`（退回 `/`）。**`//evil.com` 是最容易漏的形式，必須有獨立案例。**
- [ ] **2.3 路由表接上**
  - 內容：`/` 維持公開（首頁預覽模式不變）；新的 `/accounts` 包在 `ProtectedRoute` 之下。
  - 驗收：未登入直接開 `/accounts` 會被導向 `/login`，登入後回到 `/accounts`。

## Step 3：帳戶的 mutation

- [ ] **3.1 `use-accounts.ts` 補 create / update / remove**
  - 內容：三個 `useMutation`，成功後 `invalidateQueries({ queryKey: ['accounts'] })`；沿用 `apiRequest`，錯誤原樣往上拋給 `FormError` 呈現。**在檔案註解寫明「任何會改變交易的操作也必須失效這個 key」**（呼應 D5）。
  - 驗收：型別綠；`DELETE` 回 204 時不嘗試解析 JSON（`apiRequest` 已處理，確認沒有回歸）。

## Step 4：帳戶頁

- [ ] **4.1 `AccountList` + `AccountsPage`**
  - 內容：列表每列顯示名稱與餘額（負數紅色，D6），右側「編輯」「刪除」；載入中／錯誤／空狀態各有呈現。
  - 驗收：測試——餘額 `-12000` 顯示為負且套用 expense 樣式；空清單時顯示引導文案。
- [ ] **4.2 `AccountDialog`（新增／編輯共用）**
  - 內容：以 `Dialog` 承載表單；欄位為名稱與初始餘額（`type="number"`，**不設 `min`**）。編輯時預填現值。送出成功後關閉並自動重取列表。
  - 驗收：測試兩條路徑——新增成功後彈窗關閉且列表出現新帳戶；重複名稱時後端回 409，**訊息顯示在彈窗內且彈窗不關閉**。
- [ ] **4.3 刪除與 `ConfirmDialog`**
  - 內容：`components/ConfirmDialog.tsx`（基於 `Dialog`）；刪除前確認。後端回 409 `ACCOUNT_IN_USE` 時，顯示「此帳戶已有交易紀錄，無法刪除」之類的可理解訊息。
  - 驗收：測試——確認後才送出 DELETE；取消則完全不發請求；409 有對應提示且帳戶仍在列表中。
- [ ] **4.4 帳戶為零時的引導**
  - 內容：帳戶全部刪光時，列表顯示「至少保留一個帳戶才能記帳」的提示；`TransactionForm` 在無帳戶可選時顯示明確引導與前往 `/accounts` 的連結，**而不是一個空的下拉**。
  - 驗收：測試——`accounts` 回空陣列時，交易表單不會渲染出「送出必定 400」的狀態。

## Step 5：首頁與導覽

- [ ] **5.1 `AccountBalances`（首頁餘額列）**
  - 內容：依 D4 放在三張統計卡**下方**、自成一列；每個帳戶一小格（名稱 + 餘額），右側「管理」連結到 `/accounts`。未登入時不顯示（首頁預覽模式維持原樣）。
  - 驗收：測試——已登入顯示餘額；未登入不呼叫 `/accounts`。
- [ ] **5.2 header 導覽**
  - 內容：登入後 header 顯示「首頁 / 帳戶」連結與登出；未登入維持現狀。
  - 驗收：測試——已登入時「帳戶」連結存在且指向 `/accounts`。

## Step 6：快取一致性（D5）

- [ ] **6.1 建立交易後一併失效 `['accounts']`**
  - 內容：`useCreateTransaction` 的 `onSuccess` 加上 `invalidateQueries({ queryKey: ['accounts'] })`。
  - 驗收：**獨立測試**——記一筆交易後，`/accounts` 有被重新請求。這種錯誤不會拋例外、不會讓測試變紅，只會讓畫面停在舊數字，因此必須有專屬案例釘住。

## Step 7：收尾與驗收

- [ ] **7.1 全套指令**
  - 內容：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`。
  - 驗收：全綠。
- [ ] **7.2 👤 瀏覽器實測**
  - 內容：新增「國泰世華」（初始 5000）→ 用它記一筆 1200 支出 → 餘額變 3800 → 嘗試刪除得到 409 → 改名成功 → 未登入開 `/accounts` 被導向登入。
  - 驗收：逐項符合；對照 spec 的 **SC-14**、**SC-18**。
- [ ] **7.3 回頭判斷「帳戶型別／分組」**
  - 內容：畫面做出來之後，重新評估 `phase-2c-accounts.md` §8 延後的「帳戶型別與型別專屬欄位」——列表只有三五個帳戶時是否真的需要分組。結論**寫回該 spec 的 §8**，不論做或不做。
  - 驗收：spec §8 該列有更新（含判斷理由）。
- [ ] **7.4 👤 PR `feature/accounts-ui`：自我 review 後合併**
  - 驗收：CI 全綠；squash merge 進 `main`。

---

## 對外提醒

- **不改後端**、不新增 npm 套件、不新增環境變數。
- 新增路由 `/accounts`（需登入）；`/` 維持公開預覽。
- `ProtectedRoute` 上線後，日後新增的受保護頁面請一併掛在它之下——不要各自寫登入檢查。
