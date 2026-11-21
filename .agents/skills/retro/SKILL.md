---
name: retro
description: 'Manually review the current or specified development session. Propose evidence-based improvements to agent docs, tools and checks.'
license: MIT
metadata:
  source: 'mattpocock/skills@5beb35b040e3de97e54fa9e386d7e42d15c295c2'
---

# 開發流程復盤

Adapted from Matt Pocock 1.3.1 [retro](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/retro/SKILL.md) and [writing-for-agents](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/productivity/writing-for-agents/SKILL.md). See [MIT notice](../LICENSE.mattpocock.txt).

User-invoked. Review the current session unless the user specifies a session or subphase (e.g. `3l`). End with recommendations. Change rules, code or schedules only for specific items the user explicitly authorizes.

## 從實際紀錄找問題

Read scoped conversations, tool results, acceptance output, commits, repo rules and check settings. Local session records:

- Claude Code: directories containing `ledger-app` under `~/.claude/projects/`, including `d--Projects-ledger-app` and Orca worktrees.
- Codex shell/desktop: `~/.codex/sessions/`. Orca workers: `%APPDATA%/Orca/codex-accounts/<帳號>/home/sessions/`.

For Claude Code usage and per-call context, use the local Pollux measurement script instead of reading full JSONL:

```bash
uv run --directory D:/Projects/pollux python -X utf8 scripts/session_usage.py --match ledger-app [--session <id>]
```

`--session <id>` lists individual calls. The script only reads local files. Its `>210,000` threshold belongs to Pollux. For Orca history search first obtain `orca skills get orca-cli` and confirm index availability. Disclose missing records and use available evidence.

Investigate observed problems:

- Repeated or misdirected searches: consider explicit read triggers.
- Excessive reads, identical retries, missing logs or permissions: cite calls and results. Claim token savings only with usage data.
- Stale, conflicting, duplicate or undiscoverable rules: judge by behavior. Length alone never justifies removal. Consider moving lasting rules found only in Claude Code memory (`~/.claude/projects/D--Projects-ledger-app/memory/`) into repo docs workers can read.
- Before adding prevention, check ESLint, types, tests, `.github/workflows/` and hooks for existing but disconnected checks.

## 選擇改善方式

Use existing rules, tests or CI for mechanically decidable errors. Put cross-file judgments and tradeoffs in the applicable guide. Name the observed error each new check would prevent. CI changes and new dependencies require approval under `CLAUDE.md` §14. Builds and tests must work without external hooks (`~/.claude/settings.json`, `~/.orca/`).

Fix the canonical document. Elsewhere link it with a read trigger. Split out references as needed. State expected behavior and verifiable completion criteria first. Preserve requirements, tradeoffs and constraints.

## 回報候選

Rank a few evidenced candidates by impact. For each provide:

1. Observed problem and session excerpt, tool result or file:line.
2. Target document/setting/check, concrete change and expected behavior.
3. Cost or impact, verification and rollback.

Separate observation from inference. Say when no change is warranted. For lasting reports requested by the user, write to `docs/reports/` and update the report table in `docs/README.md`. Record approved decisions in [專案決策脈絡.md](../../../專案決策脈絡.md), execution in the plan and lasting pitfalls in `CLAUDE.md` or `docs/orca-multi-agent.md`. Disclose unavailable records and unsupported conclusions.
