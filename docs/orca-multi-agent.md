# Orca 多代理派工與交接

Before dispatch run `orca skills get orchestration` and `orca skills get orca-cli`. For task graphs, placement or recovery read the applicable current reference. Commands and fields checked against Orca 1.4.261.

## 0. 角色表（模型與強度的唯一來源）

Use role names only in other docs, Task specs and examples below. For new chats/workers substitute the parameters here. Existing chats retain their settings.

| 角色                             | 什麼時候用                                                                     | 啟動參數                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 主工作區協調者                   | New main chat coordinating workspaces                                          | `--agent codex --model gpt-6.2-astra --effort high`                                                                                               |
| `planner`                        | New child plan below §4 threshold                                              | `--agent codex --model gpt-6.2-sol --effort xhigh`                                                                                                |
| `planner`（單次切換）            | New child plan if either Codex window reaches §4 threshold                     | `--agent claude --model claude-opus-5-5 --effort high`                                                                                            |
| `default`                        | General implementation, frontend, tests, refactors, docs, simple API endpoints | `--agent codex --model gpt-6.2-sol --effort medium`                                                                                               |
| `backend`                        | High-accuracy migration SQL, access/isolation, locks, money and accounts       | `--agent codex --model gpt-6.2-sol --effort medium`                                                                                               |
| `fallback-1`                     | default exhausted and task may switch tiers                                    | `--agent pi --model zai/glm-5.3`; for a single file requiring no judgment and mechanically verifiable, use `--agent pi --model zai/glm-5.3-flash` |
| `fallback-2`                     | fallback-1 also exhausted                                                      | `--agent antigravity --model gemini-3.8-flash-high`                                                                                               |
| `fallback-3`                     | First three tiers unavailable                                                  | `--agent claude --model claude-sonnet-5-5 --effort high`                                                                                          |
| `advisor`（第一位，Codex 規劃）  | Actual planner is Codex                                                        | `--agent claude --model claude-opus-5-5 --effort xhigh`                                                                                           |
| `advisor`（第一位，Claude 規劃） | Actual planner is Claude                                                       | `--agent codex --model gpt-6.2-sol --effort xhigh`                                                                                                |
| `advisor`（第二位）              | Every consultation, concurrently with first advisor                            | `--agent antigravity --model gemini-4-hydrogen-xhigh`                                                                                             |

Antigravity encodes effort in the model ID: omit `--effort`. Current `worker-start` accepts Pi models directly. Verify actual model, effort and workspace in the launch receipt. If parameters are rejected, retain the full error and follow the guide.

## 1. 分工

- Main (`ledger-app` on `main`) coordinates direction, priorities, cross-workspace dependencies and shared resources. Main assigns scope to the responsible workspace.
- Each workspace splits, dispatches, follows up, verifies and opens PRs within approved scope. Workers report to the dispatching coordinator. Discuss local issues and approvals with the developer there.
- Report completed milestones to main only if they could affect other branches (e.g. merged shared API unblocks clients). Include branches, results, evidence and next step. Record local-only approvals, acceptance and merges in the local handoff.
- Contact main immediately for cross-line blockers or shared-resource conflicts (e.g. simultaneous Web e2e).
- Select `default` or `backend` per §0. Local coordinators may write `packages/shared` type contracts, write authorization/isolation tests first and verify failure, or handle small fixes cheaper than dispatch. Codex owns Web design and implementation. Local coordinators may review design. Return Web fixes to Codex.
- Locally review schema, API and authorization output line by line. The reviewer personally reruns isolation and both e2e suites under §3 resource limits.
- Use `orca orchestration` when results must return, `orca-cli` for handoff only.

### 1.1 徵詢 `advisor`

Before any developer decision (Ask first, tradeoffs, deviations or spec assumptions), consult two independent advisors concurrently.

1. The local coordinator creates tasks and assigns both advisors. Choose the first by actual planning tool and the second per §0. Start separate Dispatches together. Read-only consultations may share the planning workspace: explicitly pass its selector.
2. Supply identical background, known facts, question and options. Withhold planner preferences and the other advisor’s opinion. Request recommendation, reasons, cost, missed alternatives and risks.
3. Read-only: no edits, commits, database tests, e2e or `prisma migrate`. Report in Traditional Chinese via `worker_done`.
4. After both independent reports arrive, exchange new evidence only on disagreements. Retain disagreements without new evidence. Check workspace changes and Dispatch status during consultation.
5. Present both recommendations, the planner’s recommendation, agreement and disagreement. Identify unavailable opinions and why. Submit to the developer for approval.

For information or screen confirmation only, ask the developer locally.

## 2. 派工與放置

For a whole approved spec read [implement-spec](../.agents/skills/implement-spec/SKILL.md). Track dependencies in Orca Tasks. Dispatch dependents only after acceptance and integration into the base.

```bash
orca orchestration run-create --objective "<目標>" --json
orca orchestration task-create --spec "<自足的 Task spec>" --deps '["<前置 Task ID>"]' --json
orca orchestration task-list --ready --brief --json

# Default to a child of the caller; take role parameters from §0.
orca orchestration worker-start --task <task_id> --worktree new-child --name <短名> --base-branch <整合基底> --setup run <角色參數> --json

# For precreation specify parent; use --branch to name the branch.
orca worktree create --name <短名> --parent-worktree <父工作區> --base-branch <基底> --branch <分支> --setup run --json

# Reuse existing workspaces; dispatch each read-only advisor separately.
orca orchestration worker-start --task <task_id> --worktree <既有工作區> <角色參數> --json
```

- Run from the responsible workspace. Pass `--deps` only with actual prerequisites.
- Default to children. Use `new-top-level` or `worktree create --no-parent` only on explicit user request. For cross-host placement verify actual parent in receipt per placement guide. Stop for confirmation if an older host cannot guarantee child placement.
- Dispatch all independent work first. When no local work remains end the turn and await Orca wakeup. Follow concrete terminal `check` instructions. Never substitute polling, `check --wait` or watcher scripts for wakeup.
- Orca settles Dispatch on `worker_done`. Accept and integrate before releasing dependencies. Send fixes via `send --to dispatch:<dispatch_id>` per guide, or redispatch a failed Task per §4.
- For unclear activity inspect `worker-show` and `worker-read --dispatch <dispatch_id> --source auto`. Chat workers may lack terminals. Follow receipt `next` and recovery guide. Silence, timeout or unverified liveness cannot establish exit.
- If the user wants a worker retained, use `--keep-open` or `worker-keep-open`. Clean up closed work per §7.2.

## 3. Task spec

Make each Task spec self-contained. Dispatched workers read this section, assigned spec and applicable app guide. Read the whole guide for dispatch or handoff. Use five fields: **Target** (in-scope files), **Change** (deliverable), **Constraints** (boundaries), **Ownership** (allowed edits and worker boundaries), **Observable acceptance** (checkable tests/output per item).

Include applicable environment and quality constraints each time:

- Do not change Prisma schema or API interfaces unless explicitly assigned. Report required changes.
- Workers skip e2e unless tasked. Before DB commands or e2e verify target and concurrency limits per [測試環境](operations/test-environment.md).
- Run `pnpm exec prettier --write <檔案>` only on Target files. Root `pnpm format` could edit others’ work.
- Before completion run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm format:check`.
- On provider error return the verbatim error via escalation or `worker_done --outcome failed`. Do not retry yourself or report only 「失敗」. Coordinators also check §4 because exhausted workers may be unable to report.

Before dispatching Prisma work the local coordinator prepares a dedicated DB per [測試環境](operations/test-environment.md).

- **Codex**: start Task with 「先讀根目錄與對應 app 的 `CLAUDE.md`」. Orca Codex accounts load the root via `project_doc_fallback_filenames = ["CLAUDE.md"]`. Workers launched from root still need the app guide. Set this in each new account’s `config.toml`.
- **Claude**: include 「清單還有未完成項目、又沒有東西擋住你時，不要用摘要結束回合，直接做下一項」. Long tasks may otherwise stop after a progress update without `worker_done`.

Leave global money, default-deny, frontend logic and Traditional Chinese comment rules in `CLAUDE.md`.

## 4. 額度與恢復

### 4.1 子工作區的新規劃

Before **each new child plan** query current Codex usage with `orca account list --json`. Read 5h from `result.rateLimits.codex.session.usedPercent` and weekly from `result.rateLimits.codex.weekly.usedPercent`. Check `windowMinutes` (300, 10080). Extract only usage and reset times. Never output full response or account info.

- For missing values refresh usage, checking that account’s usage screen if needed. Mark missing/null windows 「未知」.
- If any known usage is **at least 80%**, select §0 `planner`（單次切換） for this plan.
- Otherwise use the Codex `planner`. Preserve unknown labels.
- Recheck next time. This threshold does not change main, implementation, advisors or existing chats.

Run on the actual planning host. This example prints only the two usage windows:

```bash
orca account list --json | node -e "let input = ''; process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => { const codex = JSON.parse(input).result?.rateLimits?.codex; for (const [label, window, minutes] of [['5h', codex?.session, 300], ['weekly', codex?.weekly, 10080]]) { const percent = window?.windowMinutes === minutes && Number.isFinite(window.usedPercent) ? window.usedPercent : 'unknown'; console.log(label, percent); } });"
```

### 4.2 實作額度與失敗

- Before dispatch check current usage and known provider errors. Count Codex implementation quota exhausted only on an actual quota error. For other providers use a quota error or known window at least 95%. Record unknown usage as unknown. For a transient rate limit, after confirming stop, retry the same role once per receipt.
- For ordinary `default` tasks follow §0 fallback order. Reserve Web for Codex: on exhaustion notify the developer and await reset. Reserve high-risk `backend` for Codex too. Wait if reset is within one hour, otherwise explain to developer. Defer `fallback-3` when Claude 5h usage exceeds 80% to preserve coordinator capacity.
- Record known reset times, reassess before next dispatch and return to preferred tier on recovery. If a fallback with unknown usage stops on quota, record the time and retry after 5 hours if needed. Let running workers finish.
- On launch failure read `failedStage`, `residualResources` and `next` before acting. Never blindly resubmit. Once the old attempt has ended and redispatch is safe, reuse the Task with `--retry-of` and specify workspace and role again. Explain quota switches and recovery to the local developer.
- Follow recovery guide for unknown outcomes, stopping and release. At retry limit report evidence and wait for explicit authorization. Preserve possibly active or user-taken resources.

```bash
orca orchestration worker-list --run <run_id> --include-remote --json
orca orchestration worker-start --task <task_id> --retry-of <dispatch_id> --worktree <工作區選擇值> <角色參數> --json
```

## 5. 工具差異

- Orca-managed Codex launches use the current Orca account. System CLI may use another account/model list. Check Orca receipt.
- Pi uses the first directory guide in order `AGENTS.override.md`, `AGENTS.md`, `CLAUDE.md`. Keep `CLAUDE.md` here. Pi Flash fallback is only for simple jobs per §0. Exclude tests, Prisma, API, authorization, specs and plans.
- For trust, login or agent configuration issues read the receipt and applicable guide. After fixing, check old resources before relaunch.
- Even after worker-reported green, independently inspect complete `git status` and `git diff`, rerun `pnpm typecheck` and `pnpm test`. Antigravity has missed type errors and test timeouts.

## 6. Session 交接

### 6.0 舊聊天收尾

After the new session confirms takeover, the old session stops writing. Report both IDs. The developer closes the old tab. For terminals provide `orca terminal close --terminal <舊 handle>`. The developer closes native chats in Orca. Keep arrangements for running or user-retained chats.

### 6.1 舊 session

Update your `docs/handoff/<工作區>.md` and its index row with status, next step, developer decisions, unverified items and evidence links. For a Run include Run ID, outstanding tasks and required decisions. Handle pending messages per current guide.

### 6.2 新 session

Start in the existing workspace per role table and user’s Orca Chat/CLI preference. Use coordinator for main. Before new child planning do §4.1 and choose the corresponding `planner`.

```bash
orca agent launch --worktree <既有工作區> <角色參數> --prompt "讀 docs/handoff.md 與自己工作區的交接檔。先確認分支、HEAD、下一步與待核可事項。" --json
```

Check actual workspace, session ID and role in receipt. If reply is lost resume with receipt’s `--retry-launch`. To transfer a Run, stop handling it in the old session first, then bind via `run-use` in the new session per guide. Verify `task-list`, `worker-list` and pending messages. Confirm next step locally with developer after takeover. Report to main only for §1 milestones.

### 6.3 何時換 session

Switch after a complete work unit and developer requests are done, with no active workers, pending replies or acceptance. For long chats record evidence and todos in plan/handoff before switching at a safe point. Keep the session across a PR merge if the same work continues.

## 7. 環境

Use `orca` from the environment first. If missing from PATH, check the common Windows desktop location: `%LOCALAPPDATA%/Programs/orca/resources/bin/orca.exe`. Read actual path, branch and parent from creation receipt. Run `pnpm install` in new worktrees with separate `node_modules`.

### 7.1 worktree 規則的細節（`CLAUDE.md` §11）

Worktrees share Git storage but have separate working files. `pnpm install` triggers `postinstall: prisma generate` to generate Prisma Client for that worktree. Branches may have different locks/schemas: never share `node_modules`.

- `.worktreeinclude` copies files including `apps/api/.env`, `apps/api/.env.test` and `.claude/settings.local.json`.
- For databases, ports and concurrency see [測試環境](operations/test-environment.md).
- Orca hooks live outside the repo in `~/.claude/settings.json` and `~/.orca/`, skills in `~/.agents/skills/`. CI needs none. Skills: `orca-cli` (worktrees, terminals, embedded browser), `orchestration` (multi-agent coordination), `orca-per-workspace-env` (container/VM recipes, currently unused).

### 7.2 每週清理

Every Sunday **10:00 Asia/Taipei**, clean from `ledger-app` on `main`. Limit to this project. Preserve existing parent/child relationships. Only consider adjusting currently parentless workspaces.

1. Inventory workspace handoffs and PR status. Recheck immediately before closing.
2. Check branch-only commits, tracked changes, untracked and ignored files. Verify traceable preservation or merge evidence for branch-only commits. For financial records, imports and credentials report categories only, omitting filenames and contents.
3. Check workers, chats, terminals, children, remote connections and activity. Inspect Orca-visible state then relevant hosts. Retain parents needed by active children or remote connections.
4. Retain in-progress work, candidate drafts, unsaved work, connected resources and unknown state. Close only finished, verifiably saved, inactive work. For paused, confirmed saved and inactive work, you may remove just the workspace and retain the branch.
5. First confirm target host supports branch retention. Use an explicit workspace selector. Retain the workspace if removal could delete a wanted branch or its effect is unclear. Report closed and retained workspaces with reasons.

Release completed coordinator-owned workers via current Orca recovery guide. If release is unconfirmed retain related workspaces. Example for hosts supporting branch retention:

```bash
orca worktree rm --worktree <明確的工作區選擇值> --json
```
