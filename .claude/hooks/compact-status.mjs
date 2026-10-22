// 對話壓縮後補回現況（SessionStart hook，matcher 為 compact）。
//
// 壓縮只留摘要，PR 編號、run id、終端機 handle 這類精確值可能失真。這裡直接向 git、gh、
// orca 查，輸出會加進壓縮後的 context，讓 agent 以系統狀態為準，而不是靠摘要記憶。
// 見 tasks/token-saving-plan.md。
//
// 在 main 上也列出所有 open 的 PR：總控在 main 管理平行分支，要看得到各分支的 PR。
// 任何一項查不到（不在 Orca 終端機、沒網路、沒有 run）就略過那一項，不讓 hook 失敗。

import { execFileSync } from 'node:child_process';

function run(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000,
    }).trim();
  } catch {
    return null;
  }
}

function runJson(command, args) {
  const text = run(command, args);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const lines = ['壓縮後的現況（hook 從 git、gh、orca 查得，精確值以此為準）：'];

const branch = run('git', ['branch', '--show-current']);
const head = run('git', ['rev-parse', '--short', 'HEAD']);
if (branch || head) lines.push(`- 分支：${branch || '(detached)'} @ ${head || '?'}`);

if (branch === 'main') {
  const pulls = runJson('gh', [
    'pr',
    'list',
    '--state',
    'open',
    '--json',
    'number,headRefName,title',
  ]);
  for (const pull of pulls ?? [])
    lines.push(`- open PR #${pull.number}（${pull.headRefName}）${pull.title}`);
} else if (branch) {
  const pulls = runJson('gh', [
    'pr',
    'list',
    '--head',
    branch,
    '--state',
    'all',
    '--json',
    'number,state,title',
  ]);
  for (const pull of pulls ?? []) lines.push(`- PR #${pull.number}（${pull.state}）${pull.title}`);
}

const current = runJson('orca', ['orchestration', 'run-current', '--json']);
const activeRun = current?.result?.run;
if (activeRun) {
  lines.push(
    `- Orca run：${activeRun.id}「${activeRun.objective}」，coordinator ${activeRun.coordinator_handle}`,
  );
  const listing = runJson('orca', ['orchestration', 'worker-list', '--json']);
  // 已結束的 dispatch 不用再盯，只列還沒收尾的。
  const settled = new Set(['completed', 'failed', 'abandoned', 'stopped', 'cancelled']);
  for (const worker of listing?.result?.workers ?? []) {
    if (settled.has(worker.dispatchStatus)) continue;
    lines.push(
      `- worker：dispatch ${worker.dispatchId}（${worker.workerState}／${worker.dispatchStatus}），terminal ${worker.agentTerminalHandle}`,
    );
  }
}

console.log(lines.join('\n'));
