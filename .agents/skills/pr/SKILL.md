---
name: pr
description: 'Create or update a ledger-app PR with rationale, acceptance evidence, impact and rollback.'
license: MIT
metadata:
  source: 'mattpocock/skills@5beb35b040e3de97e54fa9e386d7e42d15c295c2'
---

# PR 驗收說明

Adapted from Matt Pocock 1.3.1 [pr](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/pr/SKILL.md). Visual summaries derive from [Dex Horthy’s show-me](https://github.com/humanlayer/skills/blob/main/plugins/show-me/skills/show-me/SKILL.md). See [MIT notice](../LICENSE.mattpocock.txt).

Fill the three [PR template](../../../.github/pull_request_template.md) sections in Traditional Chinese. Follow [CLAUDE.md §10](../../../CLAUDE.md) for titles, Git and CI. Skip the preamble, use project terminology and link detailed evidence.

## 改動與原因

State the original problem, changed behavior and reason. Link the spec/plan section. If it clarifies relationships, use the smallest flow diagram, file tree, pseudocode or diff. For simple changes use short sentences.

## 驗證證據

- Identify the tested commit SHA. For uncommitted changes state their scope, then update the SHA after commit.
- Map each success criterion to actual commands/actions, results (exit code, counts or tests) and traceable output or CI job links. Explain skipped checks.
- Match evidence to the change: UI screenshots and actions, fixed inputs with independent expected and actual values for money/balances/splits, rejected unauthorized cases for access/isolation, same-case before/after results for bugs.
- Identify missing baselines. Passing tests alone do not prove all criteria. For docs show actual format, link or structure checks.
- If implementation changes after verification, rerun affected checks. For docs-only follow-ups explain why tested code is still identical. Verify CI belongs to the latest PR head.
- Redact credentials, connection strings, `JWT_SECRET`, tokens, real emails and financial data first. Link large traceable outputs and quote only relevant results.

## 合併風險與回復

Identify affected features, callers, data, recovery and residual limits. Distinguish code revert from data restoration/compensation. Cover every field, writing 「無」 when unchanged:

- **Prisma schema／migration**: whether deployment needs `prisma migrate deploy`. Reverting code after migration does not restore data. Describe restoration from a pre-deployment `pg_dump` or a compensating migration.
- **API**: endpoints, DTOs, `packages/shared` types and OpenAPI contract.
- **Web／App 端**: affected screens and calls.
- **環境變數**: `.env.example` updates and untracked files in `.worktreeinclude`.
- **相依套件**: additions, removals or upgrades.

Reviewers must be able to trace changes and evidence, see unverified items, and understand impact and recovery.
