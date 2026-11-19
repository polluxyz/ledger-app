---
name: plan-map
description: 'Explain a phase or Slice plan in one HTML page with linked source IDs, steps, dependencies, decisions, success criteria and scope. Exclude progress.'
allowed-tools: Read, Glob, Grep, Write, Bash(grep:*)
---

# 規劃結構圖

Summarize one spec and plan on one page: what the slice does, step relationships, decision rationale and exclusions.

## 這頁「不是」什麼

Map the plan only. Exclude status badges (「未開始 / 進行中 / 已驗收」), checkbox states (`- [ ]` / `- [x]`), Git state, implementation checks, remaining-step counts, blockers and next actions. The sole exception is a conflict **between planning documents**: show it (e.g. spec §9 says Slice 2, plan D1 says Slice 1). Code bugs belong in review.

## 精簡優先

Keep only what explains structure. Link IDs for details. In each Step card use one line each for 「做什麼」「依據哪個決策」「怎麼驗」. Give each decision a one-sentence conclusion and strength. Leave rationale and alternatives in the linked original. Never paste whole plan paragraphs into the narrative.

## 頁面結構

1. **這個切片在做什麼** — 2–3 sentences from plan §1.
2. **在整個階段裡的位置** — Slice 0 → 1 → 2 → 3 → 4 → 收尾. One line per slice. Mark position only.
3. **流程與依賴圖** — central inline SVG showing Step order and reasons.
4. **Step 一覽** — short cards.
5. **設計決策** — D1, D2… conclusion and strength (必要 / 建議 / 待比較), with details on click.
6. **成功條件** — map each SC to Steps.
7. **範圍界線** — show both 範圍內 / 範圍外. Say where every exclusion belongs (e.g. 轉帳 UI → Slice 3).
8. **規劃內部的矛盾** — if present, quote originals side by side.
9. **代號索引** — see below.
10. **頁尾** — generation time and source files.

### 關於依賴圖

Plan §5 often gives sequence only. Infer dependencies from §3 components and §4 decisions. Label each inference beside the diagram, e.g.「Step 4 需要 Step 1 的 `Dialog`，因為 D2 提到帳戶的新增 / 編輯 / 刪除確認要用它三次」。

## 代號連結（本 skill 的核心，必做）

1. Link every occurrence of every ID, including inline references like D1–D6, SC-14, Step 6 and SC-C9.
2. Put one canonical entry per ID in the footer’s 「代號索引」: verbatim Markdown excerpt, source file:line (e.g. `tasks/archive/phase-2b-slice-1-plan.md:60`), and 「在 VS Code 開啟」 via `vscode://file/<絕對路徑>:<行號>`.
3. On click show a slide-out right panel in place. `clone` the index entry to avoid duplicate content.
4. For JS fallback use real `href="#ref-D5"` anchors to index DOM nodes outside JS strings.
5. Find source lines with `grep -n`. Never guess.
6. Verify every `href="#ref-…"` matches an `id="ref-…"` and vice versa.

## 資料來源

- `docs/specs/phase-*.md`: §1 範圍內 / 範圍外, full §3 成功條件, §9 Step 拆分 and technical debt.
- `tasks/*-plan.md`: §1 為什麼是這一塊, §2 範圍, §3 元件與相依, §4 決策, §5 順序, §6 風險.
- `docs/README.md` 開發階段: position among the six phases.

**不要讀 git，不要讀 `apps/` 底下的程式碼。**

## 範圍

Default to the current Slice or backend step. Expand only on explicit request (「整個階段二」「全專案地圖」). For larger maps summarize by Slice.

## 技術要求

- Write `docs/artifacts/plan-<scope>.html` (e.g. `plan-slice-1.html`). Overwrite the same filename for the same scope.
- Inline CSS/JS/SVG. Open via `file://` without `fetch` or CDN.
- Use design tokens from `apps/web/src/styles/global.css` (see `docs/artifacts/design-system.html`). No new palette.
- Presentation interactions only: ID panel, expand/collapse, anchor navigation. No checkboxes or editable fields.
- Wide tables and SVG may scale or scroll inside their container on narrow screens. Never scroll the whole page horizontally.
- Never include `.env` / `.env.test` contents.

## 產出後

In chat give a one-sentence structural summary: Step count, main dependency chain and number of decisions pending approval. Call out any contradictions in the plan. Avoid a status-only reply like 「圖做好了」.
