# Spec：階段二 (2g) — 收尾

> 狀態：**已核可**（2026-09-23）。方案 A 與 e2e 增加 webServer 同日拍板。
> 依據：`docs/specs/phase-2-web-mvp.md` §9「9. 收尾」與「尚未歸位的技術債」表、`docs/specs/security-baseline.md` SEC-4。
> 前置：Slice 4 已合併（PR #46）。階段二的所有畫面都已完成，本步**不新增任何頁面**。
> 對應成功條件：**SC-20**～**SC-23**（新增）、**SC-12**（既有）。

---

## 1. 目標與成功樣貌

把階段二累積下來的四件未歸位事項一次清掉，讓階段二可以正式收尾。

做完之後：

- Web 產出的頁面帶 CSP，XSS 得手後不容易再載入外部腳本。
- 使用者看到的錯誤訊息是中文，不再是後端的英文原文。
- 分類的顯示順序是固定的，不會每建一本帳本就換一種排法。
- README 反映實際狀態，剩下幾個無狀態元件也有測試。

**這一步不做新功能、不改畫面結構、不動任何既有的使用流程。**

---

## 2. 假設清單（2026-09-23 已與開發者確認）

1. **四項全做**：CSP、錯誤訊息在地化、分類排序修正、README 與補元件測試。
2. **CSP 走 `index.html` 的 `<meta http-equiv>`**，不連同部署設定一起做。
   理由：目前沒有任何部署設定（沒有 Dockerfile、沒有主機設定），HTTP 標頭沒有地方可以設。
   **已知限制**：`frame-ancestors` 與 `report-uri` 在 `meta` 裡無效，瀏覽器會忽略，
   要等有靜態主機時才補得上。這一點寫進 `security-baseline.md`，不假裝已經做完。
3. **錯誤訊息在地化走前端的 `errorCode` 對照表**，不改後端訊息。
   這不是權宜之計——`packages/shared/src/constants/error-codes.ts` 的檔頭本來就寫著
   「這也是未來 i18n 的擴充點：前端把代碼對應到在地化字串」。現在是照原本的設計做。
4. **分類排序修正走方案 A**（`Category` 加 `sortOrder` 欄位）。這是資料模型變更，已於 2026-09-23 取得同意，替代方案與理由見 §4.3。
5. 不做部署、不做 SEC-2（token 撤銷）、不做 SEC-1（相依漏洞掃描）、不做 SEC-3 的 API 標頭層。
   那些各自是獨立的 Step，不塞進收尾。

---

## 3. 可驗證的成功條件

### SC-20｜前端 CSP（對應 SEC-4）

1. `pnpm --filter @ledger/web build` 產出的 `dist/index.html` 含 `<meta http-equiv="Content-Security-Policy">`。
2. 以 `vite preview` 開啟建置產物，瀏覽器 console **沒有任何 CSP 違規訊息**，畫面功能正常
   （登入、記帳、切帳本都能用）。
3. 在頁面注入一段 inline `<script>`，**會被擋下並產生違規**。
4. **`pnpm --filter @ledger/web dev` 不受影響。** 開發伺服器靠 inline script 做 HMR，
   CSP 只能在 build 時注入。

### SC-21｜錯誤訊息在地化

1. 以下六種情境顯示中文，且句子講得出「發生什麼事、該怎麼辦」：
   重複的分類名稱、使用中的分類不可刪、重複的帳戶名稱、使用中的帳戶不可刪、
   加入成員時查無該 email、最後一位 owner 不能退出。
2. **對照表查不到的 `errorCode` 退回後端原文**，不顯示空白，也不顯示「未知錯誤」。
3. 網路層失敗（`fetch` 直接拋錯）仍顯示既有的「無法連線到伺服器…」。
4. 既有 e2e 若有斷言英文訊息，**一併改成中文**；斷言的意圖不變。

### SC-22｜分類排序穩定

1. 同一組預設分類，在任何新建的帳本裡**顯示順序都相同**。
2. 順序與 `packages/shared/src/constants/default-categories.ts` 的定義一致
   （支出：餐飲、交通、購物、居住、娛樂、醫療、教育、其他）。
3. 分類頁與記帳表單的分類下拉**用同一種順序**。
4. 使用者新增的分類有確定的位置，不會每次重整就跳來跳去。

### SC-23｜文件與測試

1. README 的功能敘述涵蓋分類管理與個人資料頁。
2. `Button`、`TextField`、`Select`、`FormError`、`Pagination` 各有測試。
3. `docs/README.md` 的階段二狀態改為「完成」。

### SC-12（既有，仍須成立）

`pnpm lint / typecheck / test / build / format:check` 全綠，CI 通過。
**既有 17 條 e2e 除了 SC-21.4 允許的訊息字串之外，不得修改選取器或斷言意圖。**

---

## 4. 技術方案與決策

### 4.1 CSP 怎麼注入

Vite 的 dev server 會注入 inline script（HMR 與 React Refresh 的 preamble），
所以**把 CSP 直接寫死在 `index.html` 會讓 `pnpm dev` 整個壞掉**。

做法：在 `vite.config.ts` 加一個 `apply: 'build'` 的小插件，用 `transformIndexHtml`
只在建置時注入那個 `meta`。原始的 `index.html` 保持乾淨。

初始政策（實作時以實測為準，不照抄）：

```
default-src 'self';
script-src 'self';
style-src 'self';
img-src 'self' data:;
connect-src 'self' <VITE_API_BASE_URL 的來源>;
font-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self'
```

兩個要實測的點：

- **`style-src` 能不能不放 `'unsafe-inline'`。** 目前建置產物只有一個外部 `.css`
  （已確認 `dist/index.html` 裡沒有任何 inline style），所以理論上不用放寬。
  但 React 或某個相依可能在執行時注入 style，**要開著 console 點過每一頁才算數**。
- **`connect-src` 要允許 API 的來源。** API 與 Web 不同埠就是不同來源；漏了這一條，
  每一個請求都會被 CSP 擋掉。這個值來自 `VITE_API_BASE_URL`，是建置時決定的。

### 4.2 錯誤訊息的對照表放哪裡

放 `apps/web/src/lib/error-messages.ts`，匯出一個 `errorCode → 中文` 的對照，
以及一個 `toUserMessage(error: unknown): string`。

- `FormError` 與 `ConfirmDialog` 改用 `toUserMessage`。
- **查不到的代碼退回後端原文**（SC-21.2）。新增代碼時忘了補中文，使用者看到的是英文，
  不是空白或「未知錯誤」——那兩種比英文更糟。
- `details`（驗證失敗的欄位層級訊息）**這次不動**。那些字串是 class-validator 產生的，
  在地化必須改後端，屬另一個 Step。列進技術債表。

要一併更新的既有註解：`FormError.tsx`、`use-accounts.ts`、`use-ledgers.ts`、
`use-categories.ts` 都寫著「前端不自行改寫錯誤訊息」。那句話在對照表存在之後就不對了，
**留著會讓下一個人照舊做法走**。改成說明新的分界：代碼對應在地化字串由前端負責，
訊息內容仍由後端定義。

### 4.3 分類排序怎麼修（已拍板：方案 A）

問題在 `apps/api/src/ledgers/ledgers.service.ts:77`：預設分類用 `createMany` 一次寫入，
12 筆的 `createdAt` 完全相同；而 `categories.service.ts` 依 `createdAt` 排序，
同值就沒有穩定順序。實際看到的順序與 `DEFAULT_CATEGORIES` 定義的完全不同。

| 方案                               | 做法                                                                                                                 | 代價                                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **A. 加 `sortOrder` 欄位（採用）** | `Category` 加 `sortOrder Int @default(0)`，種子依定義順序填 0..n；`orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]` | **Prisma schema 變更 + migration**（Ask first）。但它是唯一能保住「餐飲排第一」這個策展順序的做法，也為未來的使用者自訂排序留好路 |
| **B. 改 `orderBy` 加次要排序鍵**   | `orderBy: [{ createdAt: 'asc' }, { name: 'asc' }]`                                                                   | 不動 schema，最小改動。但順序變成**中文字的字典序**，「餐飲」仍然不會排第一——只是從不確定變成確定的錯順序                         |
| **C. 種子時給遞增的 `createdAt`**  | 每筆 +1ms 寫入                                                                                                       | 不動 schema。但用時間戳表達「策展順序」是錯的語意，下一個人看不懂為什麼這 12 筆差 1 毫秒                                          |

**結論：選 A**（開發者拍板於 2026-09-23）。B 解決的是「不確定」，沒解決「順序不對」；
C 解決了兩者但留下一個沒人看得懂的巧合。A 要動 schema，但那是純加法的 migration
（欄位有預設值），既有資料不會壞。

`sortOrder` 對既有資料的行為：所有既有分類都拿到預設值 `0`，所以它們之間的順序由
次要排序鍵 `name` 決定。**這是刻意接受的**——回頭去猜既有帳本「本來應該」是什麼順序
沒有意義，而且那些分類使用者可能早就改過名了。新建的帳本從此順序正確。

### 4.4 補哪些元件測試

`Button`、`TextField`、`Select`、`FormError`、`Pagination`。

`AccountsPage`、`LedgersPage`、`HomePage` **沒有同名測試檔，但不算沒測**——
它們的行為被 `features/accounts/accounts.test.tsx`、`features/ledgers/ledgers.test.tsx`、
`features/transactions/transactions.test.tsx` 蓋到了。**不要為了檔名對稱再寫一份重複的。**

`FormError` 的測試特別重要：它是 4.2 對照表的唯一出口，查不到代碼要退回原文這件事
必須有測試釘住。

---

## 5. 對專案結構的影響

```
apps/web/
├── index.html                          不動（CSP 由插件在 build 時注入）
├── vite.config.ts                      改：加 apply:'build' 的 CSP 插件
├── src/lib/error-messages.ts           新：errorCode → 中文 + toUserMessage
├── src/lib/error-messages.test.ts      新
├── src/components/FormError.tsx        改：改用 toUserMessage；更新註解
├── src/components/ConfirmDialog.tsx    改：同上
├── src/components/*.test.tsx           新：Button / TextField / Select / FormError / Pagination
├── src/features/**/use-*.ts            改：只更新那句過時的註解
└── e2e/csp.spec.ts                     新：對 vite preview 的建置產物驗 CSP

apps/api/                               改：schema 加 sortOrder + migration + 種子填值 + orderBy
README.md                               改：功能敘述
docs/README.md                          改：階段二狀態改「完成」
docs/specs/security-baseline.md         改：SEC-4 註明 meta 的限制
```

CSP 的 e2e 需要一個跑 `vite preview` 的 webServer。**這會改動 `playwright.config.ts`
並讓 e2e 多跑一個伺服器**，CI 時間會增加。實作計畫要交代增加多少。

---

## 6. 測試策略

| SC      | 怎麼驗                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------- |
| SC-20   | 新增 `e2e/csp.spec.ts`：對 `vite preview` 的產物，驗 meta 存在、console 無違規、注入 inline script 被擋 |
| SC-20.4 | 手動：`pnpm dev` 開得起來、HMR 正常                                                                     |
| SC-21   | `error-messages.test.ts`（對照與退回原文）＋ 既有元件測試改驗中文                                       |
| SC-22   | 後端單元測試：建帳本後列分類，順序等於 `DEFAULT_CATEGORIES`                                             |
| SC-23   | 五個元件測試；README 用人眼讀過                                                                         |
| SC-12   | 五個指令 ＋ 完整 e2e                                                                                    |

⚠️ 跑 e2e 前確認沒有別的 worktree 在跑（共用 `ledger_test`）。

---

## 7. 界線

**Always**：CSP 政策以實測決定，不照抄範本；對照表查不到就退回後端原文；
改動既有註解時，把過時的立場改掉而不是留著。

**Ask first**：任何新增套件。

> 兩項原本要問的事**已於 2026-09-23 取得同意**：4.3 的方案 A（`Category` 加 `sortOrder`，
> Prisma schema 變更），以及 `playwright.config.ts` 增加一個跑 `vite preview` 的 webServer。

**Never**：為了讓 CSP 過而加 `'unsafe-inline'` 到 `script-src`——那等於沒做；
把 CSP 說成「token 不會外洩」的保證（SEC-4 明文禁止這個說法）；
在對照表裡寫出比後端更具體的錯誤原因（那會變成前端自己在猜業務規則）。

---

## 8. 範圍外

- 部署（Dockerfile、主機、HTTP 標頭、`frame-ancestors`）。
- SEC-2 token 撤銷、SEC-1 相依漏洞掃描、SEC-3 的 API 安全標頭。
- `details`（class-validator 的欄位層級訊息）在地化——要改後端，另立 Step。
- 多語言 i18n 框架。這次只做一份中文對照表，不引入 i18n 套件。
- 使用者自訂分類排序（4.3 選 A 只是留路，不實作拖拉排序）。
