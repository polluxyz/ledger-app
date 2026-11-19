---
name: implement-spec
description: 'Deliver an approved ledger-app spec or subphase with Orca dependency-based dispatch, integration and acceptance.'
license: MIT
metadata:
  source: 'mattpocock/skills@5beb35b040e3de97e54fa9e386d7e42d15c295c2'
---

# 完成整份 Spec

Adapted from Matt Pocock 1.3.1 [implement-spec](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/implement-spec/SKILL.md). See [MIT notice](../LICENSE.mattpocock.txt).

User-invoked. Use Orca to deliver the user-specified approved spec/plan/todo through integrated acceptance. Reuse approved decisions and test interfaces without asking per task. Observe 決策門控 below.

## 載入契約與恢復現況

1. Read [CLAUDE.md §5, §10, §11](../../../CLAUDE.md), [多代理派工規則](../../../docs/orca-multi-agent.md) and §11 handoffs for assignments, parallel branches and shared resources. For `apps/api` or `apps/web` tasks read that app’s `CLAUDE.md`.
2. Before Orca commands obtain version-matched guides via `orca skills get orchestration` and `orca skills get orca-cli` from the executable, regardless of installed skills. For task graphs get `orca skills get orchestration --reference references/coordinator-loop.md`. For placement and integration bases use `--reference references/placement-and-remote.md`. These references are external. Use the verified CLI, never Claude Code’s built-in Agent tool in its place.
3. Resolve the supplied spec path or phase (e.g. `3l`, `2j`). Read its `docs/specs/` spec, `tasks/<功能>-plan.md`, `tasks/<功能>-todo.md` and success criteria. Ask for a user decision only if approval or scope is genuinely missing.
4. Check branch, uncommitted changes, existing Run/Task/Dispatch, integrated commits and acceptance evidence first. Resume verified state. Never duplicate tasks or live workers, or overwrite others’ edits.
5. Confirm workspace scope per [§1](../../../docs/orca-multi-agent.md#1-分工). The local coordinator splits and assigns work.

## 建立任務圖

Record role, acceptance, actual prerequisites, Target and Ownership per task in the todo. Label inferred dependencies and check them against interfaces. If no task list exists, propose a breakdown first.

Check for cycles and cover every success criterion with a task or integration check. Track dependencies/status in Orca Tasks. Log IDs, branches, commits and evidence in the plan. Ready view lists candidates. Dispatch only after prerequisites pass acceptance and enter the integration base. Coordinate resources separately. While resources are busy, dispatch independent work. Contention is not failure.

- **Test DB**: coordinator provisions and verifies before dispatch per [測試環境](../../../docs/operations/test-environment.md). Workers must never touch `ledger_dev`.
- **Web e2e**: Playwright uses fixed ports 3100/5273. Check ports first. One suite per host across all worktrees and sessions. API e2e may run in parallel on separate DBs.
- **Dev**: ports 3000/5173 belong to the developer’s main-workspace servers. Deploy dev only from main per the handoff deployment steps.
- **Codex quota**: before each new child plan check current 5h and weekly usage per `docs/orca-multi-agent.md` §4. Its threshold applies only to that plan. For implementation/advisors use §0 roles.
- **Paid external calls** (e.g. real LLM providers): only for acceptance authorized by spec or user.
- **Ownership**: never dispatch overlapping files concurrently.

## 派工與持續續派

- Integrate into one confirmed feature branch. Reuse suitable worktrees/branches and preserve unintegrated work. For new workers default to `--worktree new-child` with integration base. For precreation specify `--parent-worktree`. Top-level only on explicit developer request.
- Dispatch ready tasks per `docs/orca-multi-agent.md` §3. Take model/effort from §0 and implementation, Web and fallback rules from §1/§4.
- Dispatch independent tasks, then advance local work. When none remains end the turn and await an Orca wakeup. Follow the receipt.
- Workers test approved interfaces and implement item by item. Skip e2e by default. Report unauthorized e2e/external calls as unrun for coordinator acceptance. Respect resource limits for every test.
- On `worker_done` verify current Dispatch, full `git status` and `git diff`, evidence and scope. Local coordinator reruns `pnpm typecheck` and `pnpm test`. Orca settles valid completion reports. If acceptance fails, fix per guide and hold dependents. For unknown causes use `systematic-debugging` first. Release dependencies only after acceptance and integration. Handle Dispatch per current guide.
- Integrate serially. Have the worker merge the current integration branch and rerun affected checks before integrating its work. Assign one owner per conflict and reverify. Recompute ready tasks and dispatch immediately after prerequisites finish, without a new user prompt.
- After acceptance/integration handle the Dispatch per current Orca guide. Main cleans worktrees and branches per §7.2.
- For quota, failures, timeouts and retries follow §4 and the receipt. Unknown liveness does not mean exit. Avoid duplicate editors. Keep completed edits and task mappings for recovery.

## 決策門控與溝通

- Explain changes to data models, API interfaces, dependencies and CI before acting, even when planned (root §5 決策門控 and §14 approval). Stop and explain before deviating from the approved spec/plan. Obtain the required approval. Resolve in-scope issues and log them in the plan.
- Communicate with your workers via `orca orchestration`. For developer decisions consult two independent advisors concurrently per `docs/orca-multi-agent.md` §1.1, then discuss with the developer locally.
- Follow [§1](../../../docs/orca-multi-agent.md#1-分工) for cross-line milestones and shared-resource conflicts.

## 整份驗收與收尾

After task acceptance verify every spec criterion and root §3 check on the integration branch. Run both e2e suites under the resource limits. For schema/API/authorization the coordinator reviews the diff line by line (authorization conditions, transaction boundaries, migration SQL) and personally reruns isolation tests and both e2e suites. Finally the local coordinator assigns a read-only reviewer who did not implement the reviewed part, including coordinator-written changes. Check project compliance and spec completeness, correctness and scope. Keep both sets of findings and evidence after fixes.

Write the PR per [pr skill](../pr/SKILL.md). Follow `CLAUDE.md` §10 for PR, CI, updates when behind `main` and merge. Mark tasks done only after acceptance and integration. Close the spec only when all criteria pass. Main cleans worktrees/branches per `docs/orca-multi-agent.md` §7.2. Before deleting integration-branch test DBs, list them for developer confirmation. Preserve `ledger_dev`, `ledger_test` and DBs of active worktrees.

Per `CLAUDE.md` §5 報告方式, report completed scope, integration commit/PR, acceptance counts, deviations and remaining issues. Update spec status in `docs/README.md` and move completed plan/todo into `tasks/archive/`. For out-of-scope design, missing permission or unverifiable state, save state and report what needs attention. The user may later invoke `retro` manually. Do not change environment rules automatically.
