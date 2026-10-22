---
name: pr
description: '撰寫 ledger-app PR 描述，呈現改動原因、已執行的驗收證據，以及影響範圍與回復方式。建立或更新本專案 PR 時使用。'
license: MIT
metadata:
  source: 'mattpocock/skills@5beb35b040e3de97e54fa9e386d7e42d15c295c2'
---

# PR 驗收說明

改寫自 Matt Pocock 1.3.1 的 [pr](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/pr/SKILL.md)。視覺摘要的上游來源為 [Dex Horthy 的 show-me](https://github.com/humanlayer/skills/blob/main/plugins/show-me/skills/show-me/SKILL.md)。授權見 [MIT notice](../LICENSE.mattpocock.txt)。

依 [PR 範本](../../../.github/pull_request_template.md) 填寫三節。標題、Git／CI 流程依 [CLAUDE.md §10](../../../CLAUDE.md)，本 skill 負責讓驗收者看懂這次改動。不寫前言，文字精簡，細節以連結指向證據。

## 改動與原因

先說原本的問題、改後的行為與原因，連結對應 spec／plan 的章節。當關係用圖更清楚時，選最小的流程圖、檔案樹、偽碼或 diff；單純改動用短句即可。沿用專案用語。

## 驗證證據

- 寫出驗證時的 commit SHA；若含未提交變更，先註明其範圍，提交後更新對應 SHA。
- 逐項連到成功條件：實際指令或操作、結果（含 exit code、筆數或測試數等有用數字）、可追溯的輸出位置或 CI job 連結。未執行的項目如實標示原因。
- 用與改動相符的證據：UI 附截圖與操作；金額、餘額、分帳這類計算附固定樣本、獨立的預期值與實際結果；授權與資料隔離附越權案例被拒的測試；bug 修正附同一案例修正前後的結果。
- 沒有變更前基準時註明缺少什麼。只取得測試綠燈，不能推稱所有成功條件已驗收。純文件變更保留格式、連結或結構檢查的實際結果。
- 實作在驗證後又改動時，重跑受影響的檢查；僅補文件時，說明先前證據涵蓋的程式碼為何仍相同。CI 證據確認屬於目前 PR 的最新 head。
- 先遮蔽憑證、連線字串、`JWT_SECRET`、token、真實 email 與真實帳務資料。大型輸出放在可追溯的位置，PR 只摘相關結果。

## 合併風險與回復

說明影響到的功能、呼叫者或資料，以及回復方式。區分可直接 revert 的程式變更與需要資料還原／補償的操作；列出剩餘限制。逐項註明有沒有變更，沒有就寫無：

- **Prisma schema／migration**：部署要不要跑 `prisma migrate deploy`。migration 套用後 revert 程式不會還原資料，寫出還原方式（部署前 `pg_dump` 的備份或補償 migration）。
- **API**：端點、DTO、`packages/shared` 型別的變更，OpenAPI 契約是否改變。
- **Web／App 端**：哪些畫面或呼叫受影響。
- **環境變數**：是否已同步 `.env.example`，未版控的檔案是否已列進 `.worktreeinclude`。
- **相依套件**：新增、移除或升級的套件。

完成條件：驗收者能從描述追到實際改動與證據，看清尚未驗證的部分，以及合併後的影響與回復方法。
