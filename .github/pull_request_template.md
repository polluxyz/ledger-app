<!--
For the PR author:
- Use an English Conventional Commits title (`<type>: <簡述>`) that stands alone as the squash commit on main.
- Fill the three sections below. Remove the instructional comments. Follow .agents/skills/pr/SKILL.md.
- For a chat draft the developer will paste, supply title and description in one copyable Markdown block. List the title separately from the body for GitHub’s two fields. Use four outer backticks if the body contains fences. Skip this packaging for gh pr create.
-->

## 改動與原因

<!--
State problem, changed behavior and rationale. Link the relevant docs/specs/ or tasks/ section. Use a minimal diagram, file tree or diff if helpful. One concern per PR.
-->

## 驗證證據

<!--
Give actual results and tested commit. Explain unrun checks, missing baselines and inapplicable items. Docs-only changes still need actual checks (e.g. pnpm format:check). An unchecked list is not evidence.
-->

驗證 commit：

| 驗收條件 | 實際指令／操作 | 實際結果 | 證據位置 |
| -------- | -------------- | -------- | -------- |

<!--
As applicable, show failing/passing output, fixed-sample expected and actual results, before/after UI screenshots or CI job links. Redact sensitive data first. Link large raw outputs.
-->

## 合併風險與回復

<!--
Describe reversibility, recovery and affected features/data. A code revert may leave data changed. Cover each field, writing 無 if unchanged:
- Prisma schema／migration (migrate deploy at deployment, data restoration)
- API (endpoints, DTOs, packages/shared types, OpenAPI contract)
- Web／App 端影響
- 環境變數 (.env.example, .worktreeinclude)
- 相依套件
-->
