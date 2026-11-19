---
name: step-proposal
description: 'Before a Step or Slice needs approval, produce an HTML proposal comparing options, UI mockups, affected files and acceptance, with a 「複製成 prompt」 button. Wait for explicit approval.'
allowed-tools: Read, Glob, Grep, Write, Bash(git log:*), Bash(git status:*), Bash(git branch:*)
---

# Step 開工提案書

Per `CLAUDE.md §5` 決策門控, explain what/why, approach, outputs and acceptance, alternatives and rationale. Compare alternatives side by side (e.g. D1–D6 in `tasks/archive/phase-2b-slice-1-plan.md §4`).

## 當前 git 狀態

- 分支：!`git branch --show-current`
- 未提交變更：!`git status --short`

## 鐵則：提案 ≠ 開工

After presenting, wait for explicit developer approval (「同意」「開始」「OK」) before coding. For requested changes update the page and seek confirmation again. Record agreed decisions in `docs/specs/` or `tasks/` Markdown so they survive page deletion.

## 動筆前

1. Read the spec and plan. Map Step acceptance criteria to `SC-x` (e.g. Slice 1 to SC-14, SC-18).
2. Verify affected files with Glob / Grep against the current tree.
3. Check for data model, API interface, dependency and CI changes. Flag these root §14 Ask first items separately on the page. For new environment variables list purpose and example-file updates.

## 頁面區塊（依 Step 性質取用，不必全上）

Always include:

- **這一步要做什麼、為什麼是現在做** — 2–3 sentences from the plan (e.g. slice-1-plan §1「2c 做完了帳戶與餘額，但畫面上完全看不到」).
- **影響檔案樹** — three colors for additions/edits/deletions. Show current line counts.
- **驗收條件 ↔ SC-x 對照** — how to verify each item (test commands, browser steps).
- **Ask first 事項**——新套件 / 新環境變數 / API 破壞性變更。沒有就明寫「無」。

When alternatives exist, add a **決策卡** for each decision. Compare approaches side by side with cost and downside. Mark your recommendation and give a one-sentence reason.

For frontend UI Steps:

- Show 2–3 side-by-side **版面 mockup** options by default.
- Use medium-high fidelity, real `apps/web/src/styles/global.css` tokens and existing styles (see `docs/artifacts/design-system.html`) ready to copy into `*.module.css` after agreement. Label the page 「這是版面與資訊層級的提案，不是最終視覺定稿」.
- Match existing `Button` (primary/secondary), `TextField`, `Select`, `FormError`, `TransactionList` rows and `HomePage` stats cards.
- Invent realistic data (「現金」「國泰世華」). Show amounts via `@ledger/shared`’s `formatMoney` with inputs in 分, dates like `2026/08/16`. Never use `.env` contents, real emails or tokens.

For data flow or execution order use inline SVG, not ASCII art (e.g. TanStack Query cache invalidation, NestJS Guard → Filter, Prisma `onDelete` cascades).

## 「複製成 prompt」匯出

At the bottom provide one-click export back to the terminal:

- One radio group (方案 A / B / C) and a free-text note per decision.
- Combine choices into a Traditional Chinese prompt, e.g. `Step 4 提案：D1 選方案 B、D2 選方案 A（備註：確認彈窗不要輸入名稱）、D3 同意。其餘照提案執行。`
- For 「複製成 prompt」 and 「已複製」, always display the export text in a visible `<textarea>` for manual selection if `navigator.clipboard.writeText()` fails under `file://`.
- Label the button 「複製成 prompt」 and briefly show 「已複製」 after copying.

## 技術要求

- Write `docs/artifacts/step-<slice>-<step>.html` (e.g. `step-slice-1-04-accounts-page.html`).
- Inline all CSS/JS/data. The developer opens `file://`, where `fetch()` is blocked.
- Stack mockups on narrow screens. No page-wide horizontal scrolling.
- Never include secrets: `.env`, `.env.test`, DB connection strings, `JWT_SECRET`, real emails or tokens. Pages may be shared.

## 產出後

In chat give a one-sentence Step conclusion and list only the decision questions for developer approval. Leave details on the page. Stop and wait for approval before writing code.
