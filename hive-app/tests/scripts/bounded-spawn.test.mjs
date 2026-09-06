/** Find 36's bounded-spawn shape, now a shared library (find 21 is its
 * second user). The two rules that matter are proven on real processes
 * here, not asserted from inspection. POSIX-only: the proofs use bash and
 * process groups; the Windows path (taskkill /T) is the desktop's. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { test } from 'node:test';

import { killTree, killTreeCommand, runBounded } from '../../scripts/lib/bounded-spawn.mjs';

const posixOnly = { skip: process.platform === 'win32' ? 'POSIX process-group proofs' : false };

test('the tree kill is taskkill /T on Windows and a process-group signal elsewhere', () => {
  assert.deepEqual(killTreeCommand(4242, 'win32'), {
    command: 'taskkill',
    args: ['/pid', '4242', '/T', '/F'],
  });
  assert.equal(killTreeCommand(4242, 'linux'), null);
  assert.equal(killTreeCommand(4242, 'darwin'), null);
  // Safe on nothing / on an exited child.
  killTree(null);
  killTree({ pid: null, exitCode: null });
  killTree({ pid: 1, exitCode: 0 });
});

test('settles on exit + drain even when a grandchild holds the pipe open', posixOnly, async () => {
  // bash exits 7 at once, leaving a backgrounded sleep holding the
  // inherited stdout pipe: 'close' would never fire, so a runner waiting
  // on it would hang forever — the find-36 shape.
  const started = Date.now();
  let seen = null;
  const result = await runBounded('bash', ['-c', 'sleep 600 & echo parent-out; exit 7'], {
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 20_000,
    label: 'held-pipe',
    onStart: (child) => {
      seen = child;
    },
  });
  const elapsed = Date.now() - started;
  assert.equal(result.status, 7);
  assert.equal(result.timedOut, false);
  assert.equal(result.stdout.trim(), 'parent-out', 'output drained before settling');
  assert.ok(elapsed < 10_000, `settled in ${elapsed}ms, not on the sleep`);
  assert.ok(seen && typeof seen.pid === 'number', 'onStart handed over the child');
  // Reap the straggler group so it does not outlive the test.
  killTree(seen);
});

test('the watchdog kills the whole tree and reports timedOut', posixOnly, async () => {
  const started = Date.now();
  let child = null;
  const result = await runBounded('bash', ['-c', 'sleep 600 & sleep 600'], {
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 500,
    label: 'stuck',
    onStart: (c) => {
      child = c;
    },
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.status, null);
  assert.ok(Date.now() - started < 10_000);
  // Nothing in the group is still RUNNING (zombies awaiting the reaper
  // show as state Z and are dead: no handles, no device, no CPU).
  const members = spawnSync('pgrep', ['-g', String(child.pid)], { encoding: 'utf8' })
    .stdout.trim()
    .split('\n')
    .filter(Boolean);
  for (const pid of members) {
    const stat = spawnSync('cat', [`/proc/${pid}/stat`], { encoding: 'utf8' }).stdout;
    const state = stat.split(') ')[1]?.[0];
    assert.ok(state === undefined || state === 'Z', `pid ${pid} still in state ${state}`);
  }
});

test('a command that cannot spawn settles with status null, not a rejection', async () => {
  const result = await runBounded('/definitely/not/a/real/binary', [], {
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 5_000,
    label: 'missing',
  });
  assert.equal(result.status, null);
  assert.equal(result.timedOut, false);
});
