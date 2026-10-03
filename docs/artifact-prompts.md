# HTML artifact — prompt 範本

規範見 `CLAUDE.md` §13 與 `docs/README.md` 的「HTML 產出」。產出一律落在 `docs/artifacts/`（已 gitignore）。

skill 已經知道頁面該有什麼區塊，prompt 只需要給三樣東西：**範圍與來源檔**、**你最想看清楚的 2～4 個問題**、**你還沒有定見的地方**。

## 1. 規劃結構圖（`plan-map`）

```
用 plan-map 把 <3c> 的規劃攤開來看。來源：docs/specs/<phase-3c-split.md>、tasks/<phase-3c-plan.md>。
我最想看懂：<Step 之間的依賴>、<哪些決策其實還沒定案>、<範圍外的項目各被排到哪裡>。
```

## 2. Step 提案（`step-proposal`）

```
用 step-proposal 幫 <Step X：某頁面／某重構> 出一份提案。依據 <plan 檔 §章節 與決策編號>。
特別想比較：<版面的哪一塊／哪個職責界線／哪個流程>。<前端：並排 2～3 個版面方案。>
決策做成可勾選並能複製成 prompt。
```

## 3. 機制圖解（不走 skill，用完即丟）

```
做一頁 HTML 解釋 <某機制，例如 TanStack Query 的快取失效鏈>，放 docs/artifacts/。
起點是 <檔案或決策>。畫一張 SVG 圖標出 <要看的關係>，再說明 <為什麼這種問題難抓>。
```

## 4. 重新萃取設計語彙（不走 skill）

```
重新萃取 docs/artifacts/design-system.html。來源是 apps/web/src/styles/global.css 的 token
與所有 *.module.css。數值逐字照抄，並列出逃出 token 系統的硬寫色值。
```

談出來的結論要回寫 Markdown，否則會隨頁面消失。
