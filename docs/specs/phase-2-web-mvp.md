# Spec：階段二 — 前端雛形（Web MVP）

> 狀態：**草案，待開發者審核**（2026-08-10）
> 依據：`CLAUDE.md` §4（重排後階段二）、《專案決策脈絡》「開發階段順序重排」。
> 前置：階段一後端已完成（認證、帳本、成員、分類、交易；API 前綴 `/api`，Swagger 於 `/docs`）。
> **相依：本階段先完成 2a 後端小步（付款方式，見 `docs/specs/phase-2a-payment-methods.md`），前端 MVP 才含付款方式、不返工。** 本文件涵蓋 2b（前端）。

---

## 1. 目標與成功樣貌

在現有 NestJS 後端之上，建立 `apps/web`（React + TypeScript + Vite），做出一個**看得到、點得動的記帳 Web 應用**。使用者能在瀏覽器完成註冊、登入，並對自己的帳本進行日常記帳。

**先切一條垂直薄片跑通端到端，再逐塊往外長**（對齊增量開發），避免一次做滿而 UX 問題晚發現。

嚴守 **單一後端原則**：`apps/web` 為純前端，所有業務邏輯留在後端，前端只透過 API 取用資料、負責呈現與互動。

### 範圍內（In scope）

- `apps/web` 專案 scaffolding（Vite + React + TS，掛進 pnpm workspace）。
- 認證流程：註冊、登入、登出、token 保存與附帶、未登入導向登入頁。
- 消費既有 API：帳本、成員、分類、付款方式（2a 新增）、交易（含分頁 / 篩選）。
- 交易表單可選填付款方式；付款方式管理頁（比照分類）。
- 一套樸素但一致的 UI（版面、表單、清單、載入 / 錯誤狀態）。
- 前端測試地基（單元 / 元件測試）。

### 範圍外（Out of scope，未來階段）

- 行動 App（React Native / Expo）——待 Web 定型後再搬（階段二只做 Web）。
- 好友 / 借還帳相關畫面（階段三）。
- AI 記帳輸入介面（階段四）。
- 進階 UX：離線、多語言 i18n、深色模式、圖表 / 報表、無障礙深度優化（先預留、不實作）。
- 後端功能新增（本階段原則上**不改後端**；若發現缺口，先停下討論再決定）。

---

## 2. 假設清單（動筆前先確認；多數已於 grilling 定案）

**已於 grilling 定案（列此對齊）**

1. 順序：前端雛形（本階段）→ 好友 / 借還帳 → AI → 語音 / 本地。
2. 先做 **Web only**；RN 之後搬。
3. 先切**垂直薄片**再擴充。
4. 伺服器狀態用 **TanStack Query**；樣式用 **CSS Modules**；型別重用 **`@ledger/shared`**（OpenAPI codegen 之後再評估）。

**本 spec 新增、需一併確認的假設**

5. **路由**用 **React Router**（SPA 客戶端路由）。
6. **Token 保存**：MVP 先存 **`localStorage`**（最簡單、單頁重整不掉登入）。⚠️ 取捨：`localStorage` 對 XSS 較敏感；正式化時可改 httpOnly cookie（需後端配合，屬未來）。本階段接受此取捨並在程式註解標明。
7. **測試**：**Vitest + React Testing Library**（元件 / 單元）；瀏覽器端到端（Playwright）**延後**，非本階段必要。
8. **表單**：MVP 先用 React 受控元件手刻驗證即可；如表單變多再評估 `react-hook-form`（暫不引入）。
9. **後端變更僅限 2a**：本階段含一個已核可的後端小步（2a 付款方式，見專屬 spec）；**除此之外不改後端**。若前端薄片實作中又發現非改後端不可，**先停下說明再決定**。
10. **設計語言**：先樸素自製（無 UI 元件庫）；顏色 / 間距用少量 CSS 變數統一。

> 上述 5–10 屬「Ask first」性質（新增相依、安全取捨）。同意後才在對應 Step 安裝套件並更新 `.env.example` / CI。

---

## 3. 可驗證的成功條件

### 垂直薄片（Slice 0）— 本階段第一個驗收目標

在真實後端（本機 `apps/api` 運行中）操作，達成端到端：

- **SC-1**：可在 `/register` 註冊新帳號；成功後自動登入並導向主畫面。
- **SC-2**：可在 `/login` 以帳密登入；取得的 token 保存後，重整頁面仍維持登入。
- **SC-3**：登入後看得到自己的（註冊時自動建立的）個人帳本，及其交易列表（新到舊）。
- **SC-4**：可新增一筆交易（選 type / 金額 / 日期 / 分類 / **付款方式（選填）** / 備註），送出後**不需重整**即出現在列表。
- **SC-5**：可登出；登出後存取受保護頁面被導回 `/login`。
- **SC-6**：API 回錯（如 401 過期、400 驗證）時，畫面顯示清楚訊息，不白屏、不洩漏內部細節（沿用後端統一錯誤格式的 `message`）。

### 後續切片（Slice 1+，本階段陸續完成）

- **SC-7**：帳本列表 / 建立 / 切換；帳本明細顯示成員與角色。
- **SC-8**：成員管理（owner 可加成員 / 改角色 / 移除；非 owner 對應動作被隱藏或擋下並顯示 403 訊息）。
- **SC-9**：分類管理（列表 / 新增 / 改名 / 刪除；重複名稱、使用中不可刪等錯誤有對應提示）。
- **SC-9b**：付款方式管理（同 SC-9 形狀，比照分類）。
- **SC-10**：交易編輯 / 刪除（軟刪除後從列表消失）；列表支援分頁與（日期 / 分類 / 型別）篩選。
- **SC-11**：個人資料頁（檢視 / 改名）。

### 全階段通用

- **SC-12**：`pnpm --filter @ledger/web lint / typecheck / test / build` 全綠；併入根目錄遞迴指令與 CI。
- **SC-13**：前端**零業務邏輯**——金額 / 授權 / 一致性等規則一律由後端把關，前端僅呈現與呼叫。

---

## 4. 技術方案與新增相依

| 用途        | 選擇                                | 備註                                                     |
| ----------- | ----------------------------------- | -------------------------------------------------------- |
| 建構 / 框架 | **Vite + React + TypeScript**       | 已定案；`strict` 模式                                    |
| 路由        | **react-router-dom**                | 客戶端路由、受保護路由                                   |
| 伺服器狀態  | **@tanstack/react-query**           | 快取、重取、載入 / 錯誤狀態                              |
| HTTP        | 原生 `fetch` 薄封裝                 | 統一附 `Authorization`、解析統一錯誤格式；暫不引入 axios |
| 樣式        | **CSS Modules** + 少量 CSS 變數     | 樸素、學習成本低；日後可換 Tailwind                      |
| 型別        | **`@ledger/shared`**                | 直接 import request/response 契約型別，前後端一致        |
| 測試        | **Vitest + @testing-library/react** | 元件 / 單元；e2e（Playwright）延後                       |

- **API base URL** 以環境變數提供（如 `VITE_API_BASE_URL`，預設 `http://localhost:3000/api`）；新增變數同步 `apps/web/.env.example`。
- **Auth**：登入取得 `accessToken` → 存 `localStorage` → 每次請求附 `Authorization: Bearer`；收到 401 統一導向登入。
- **不新增後端相依**；不改後端程式（除非依假設 9 先行討論）。

---

## 5. 對專案結構的影響

```
apps/
  web/                 # ← 新增
    src/
      main.tsx
      app/             # 路由、Providers（QueryClient、AuthProvider）
      features/        # 依領域切：auth / ledgers / categories / transactions
      lib/             # api client、token 儲存、共用 hooks
      components/      # 共用 UI 元件
      styles/          # 全域樣式與 CSS 變數
    index.html
    vite.config.ts
    tsconfig.json
    package.json       # name: @ledger/web
    .env.example
```

- 掛進 **pnpm workspace**；`@ledger/web` 依賴 `@ledger/shared`。
- 根目錄遞迴指令（`pnpm lint / typecheck / test / build`）需涵蓋 web。
- **CI**：新增 web job（install → lint → typecheck → test → build）。⚠️ 改 CI 屬「Ask first」，於對應 Step 單獨提出。

---

## 6. 測試策略

- **元件 / 單元測試**（Vitest + RTL）：表單驗證與送出、清單渲染、載入 / 錯誤狀態、受保護路由未登入導向。
- **API client 測試**：附帶 token、401 導向、統一錯誤格式解析。
- **手動端到端驗收**：對照 SC-1～SC-6 在真實後端逐條操作（每個薄片完成時）。
- 後端已有的授權 / 資料隔離測試仍是安全防線；前端測試聚焦「呈現正確、狀態正確」，**不重測業務規則**。
- e2e（Playwright）留待前端穩定後再評估，非本階段門檻。

---

## 7. 界線（Always / Ask first / Never）— 階段二補充

**Always**：前端所有對外輸入送後端前僅做「體驗性」前置檢查（如必填提示），真正驗證以後端為準；每個受保護頁面確認登入狀態；新增環境變數同步 `.env.example`。

**Ask first**：新增前端相依套件；修改 CI 加 web job；任何需要改動後端 API / schema 的情況（先停下討論）。

**Never**：在前端實作業務邏輯（金額計算規則、授權判斷、一致性驗證）；把 token 以外的機敏資訊寫進前端或 log；為了畫面方便繞過後端授權。

---

## 8. 擴充點（未來如何接上，現在不實作）

- **Google OAuth 登入**：已確定要做，排在 Slice 0 完成後的獨立小步。前端只是登入頁多一顆按鈕；後端需 `googleId` 欄位與 `/auth/google` 流程（`passwordHash` 屆時改選填）。本階段先不預留任何程式碼。詳見《專案決策脈絡》對應章節。
- **行動 App**：RN + Expo 重用同一組 API 與 `@ledger/shared`，UI 層另寫。Web 的 `features/` 領域切分刻意與平台無關，便於心智模型搬移。未來 App 若走**離線優先**（資料存手機、登入才同步），現有的 UUID 主鍵 / 軟刪除 / `updatedAt` 已是有利基礎；本階段的 Web 維持連線模式，不受影響。詳見《專案決策脈絡》「離線優先與同步的立場」。
- **好友 / 借還帳（階段三）**：預留 `features/` 可新增 `friends` / `debts` 領域夾；不預先建檔。
- **AI 記帳（階段四）**：預留一個「新增交易」入口日後可並列「AI 輸入」分頁；現在只做手動表單。
- **OpenAPI codegen**：第二版可由後端 OpenAPI 產生 typed client 取代手寫 fetch；現階段用 `@ledger/shared` 足矣。

---

## 9. Step 拆分概觀（細節於核可後寫入 `tasks/`）

0. **（2a，前置）付款方式後端**：見 `docs/specs/phase-2a-payment-methods.md`；完成並驗收後才進以下前端步驟。
1. **Scaffolding**：建 `apps/web`（Vite+React+TS）、掛 workspace、跑起空白頁、併入根指令。
2. **API client + Auth 骨架**：fetch 封裝、token 儲存、QueryClient、AuthProvider、受保護路由。
3. **Slice 0 垂直薄片**：註冊 / 登入 / 登出 + 個人帳本交易列表 + 新增交易（達成 SC-1～SC-6）。
4. **Slice 1**：帳本列表 / 建立 / 切換 / 明細 + 成員（SC-7、SC-8）。
5. **Slice 2**：分類管理 + 付款方式管理（SC-9、SC-9b）。
6. **Slice 3**：交易編輯 / 刪除 / 分頁 / 篩選（SC-10）+ 個人資料（SC-11）。
7. **收尾**：前端測試補完、CI 加 web job、README 更新（SC-12）。

> 每個 Step 仍遵守門控：開工前說明、等同意；完成後展示與驗收再進下一步。
