# 名稱輸入先去掉前後空白再驗證

狀態：開發者 2026-10-29 核可。advisor 兩輪後雙方一致。

## 問題

註冊時姓名只驗證長度，`"   "` 這種純空白可以存進去，首頁頭貼就顯示空白（#200 在網頁補了預設頭貼，沒處理來源）。帳本、帳戶、分類的名稱也一樣。另外 `update-account.dto.ts` 用 `@IsOptional()`，`name: null` 會通過驗證，再寫進不能是 null 的欄位，變成 500（`accounts.service.ts:231`）。

## 目標（API 輸入規則變更）

8 個 DTO 的 `name` 先去掉前後空白，再照原本的長度規則驗證：

- `apps/api/src/auth/dto/register.dto.ts`
- `apps/api/src/users/dto/update-user.dto.ts`
- `apps/api/src/ledgers/dto/create-ledger.dto.ts`、`update-ledger.dto.ts`
- `apps/api/src/accounts/dto/create-account.dto.ts`、`update-account.dto.ts`
- `apps/api/src/categories/dto/create-category.dto.ts`、`update-category.dto.ts`

規則：

1. 去掉前後空白，包含 Tab、換行、全形空白（`String.prototype.trim` 都會去掉）。內部空白保留。
2. 去掉後是空字串回 400。長度上下限照原本，用去掉後的長度算。
3. 不是字串的值原樣交給 `@IsString()` 拒絕，不轉型。
4. 更新 DTO：沒帶 `name`（undefined）照舊略過；`name: null` 回 400。寫法參考 `apps/api/src/categories/dto/update-category.dto.ts:14` 的 `ValidateIf`。
5. OpenAPI：`description` 補「去掉前後空白後驗證」；`RegisterDto` 補 `minLength`、`maxLength`。

寫法參考 `apps/api/src/ledger-people/dto/rename-guest.dto.ts:10`：

```ts
@Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
```

8 個檔案用同一段，可以抽成 `apps/api/src/common/` 底下的共用 decorator；抽或不抽由實作決定，同一份 PR 裡要一致。

## 不做

- 網頁不改。網頁送出的值後端會去掉空白，網頁顯示的是伺服器回傳的值。
- 既有資料不處理。帳戶與分類去掉空白後可能和既有名稱撞名，另開一件：先只統計數量，不列真實資料。
- 不改 schema、錯誤碼、CI、相依套件。

## 對前端與 App 的影響

- 以前會存成「 Alice 」的請求，現在存成「Alice」。
- 以前會成功的純空白名稱，現在回 400 `VALIDATION_FAILED`。網頁的表單本來就要求非空，正常操作碰不到。
- 帳戶、分類的同名檢查用去掉空白後的值，所以「 午餐 」和既有的「午餐」會回 409。

## 驗收

| #   | 條件                                                                                                                                        | 驗證方式                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| N1  | 8 個 DTO 各驗：前後空白、Tab、換行、全形空白被去掉；內部空白保留；純空白 400；去掉後剛好上限通過、上限加 1 失敗；非字串 400；缺值照原本規則 | DTO 單元測試，經過 `plainToInstance` 加 `validate`，證明 transform 有跑 |
| N2  | 更新 DTO：沒帶 `name` 通過；`name: null` 400                                                                                                | 同上                                                                    |
| N3  | `PATCH` 帳戶 `name: null` 回 400，不再 500                                                                                                  | API e2e                                                                 |
| N4  | 註冊 `"  Alice  "` 存成 `"Alice"`；註冊 `"   "` 回 400                                                                                      | API e2e                                                                 |
| N5  | 帳戶、分類用「 既有名稱 」建立或改名回 409                                                                                                  | API e2e                                                                 |
| N6  | 既有 e2e 全過；lint、typecheck、test、format:check、build 過                                                                                | 協調者重跑（`ledger_nametrim_test`）                                    |

## 任務

| #   | 任務                         | 誰      |
| --- | ---------------------------- | ------- |
| T1  | 8 個 DTO 與共用 trim 寫法    | default |
| T2  | N1、N2 單元測試              | default |
| T3  | N3～N5 e2e                   | default |
| T4  | 驗收、PR、CI、合併、dev 部署 | 協調者  |

## 實作紀錄

（實作時補）
