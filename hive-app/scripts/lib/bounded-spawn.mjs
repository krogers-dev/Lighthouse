/** Bounded child processes for device-lane runners (find 36's shape, made
 * reusable).
 *
 * `spawnSync` through `cmd.exe /c` with inherited stdio blocked the event
 * loop, so signal handlers could not run, and carried no bound of its
 * own, so a wedged CLI suspended the runner forever with its cleanup
 * unreachable. This module is the answer, with two rules that are not
 * stylistic:
 *
 *  - settle on `exit` plus a short stdio drain, with `close` as the normal
 *    fully-drained path — never on `close` ALONE, because `close` also
 *    waits for the stdio streams, and a straggler grandchild holding an
 *    inherited pipe handle keeps them open forever (reproduced 2026-09-06:
 *    `exit` at +1ms, `close` never, drain settled at +1s);
 *  - on watchdog expiry kill the whole process TREE — on Windows killing
 *    only the spawned cmd.exe would orphan the java process that owns the
 *    device, hence `taskkill /T`; on POSIX the child is spawned detached
 *    into its own process group and the group is signalled.
 *
 * The enrollment runner still carries its own inline copy; it stays
 * untouched until its desktop verification lands, then consolidates here.
 */
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';

export function killTreeCommand(pid, platform = process.platform) {
  if (platform !== 'win32') return null;
  return { command: 'taskkill', args: ['/pid', String(pid), '/T', '/F'] };
}

/** Kill a child and everything under it. Safe on an already-exited child. */
export function killTree(child, platform = process.platform) {
  if (!child || child.pid == null || child.exitCode !== null || child.signalCode !== null) return;
  const kill = killTreeCommand(child.pid, platform);
  if (kill) {
    spawnSync(kill.command, kill.args, { stdio: 'ignore', timeout: 15_000, killSignal: 'SIGKILL' });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // already gone
    }
  }
}

/** Run one command bounded by a watchdog. Resolves — never rejects, never
 * hangs — with { status, stdout, stderr, timedOut }; status is null when
 * the process was killed or failed to spawn. `onStart(child)` lets the
 * caller track the in-flight child for its own cleanup. */
export function runBounded(
  command,
  args,
  { cwd, env, timeoutMs, label = command, inheritOutput = false, onStart, drainMs = 1000 },
) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: inheritOutput ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    onStart?.(child);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    let settled = false;
    let drainTimer = null;
    const settle = (status, timedOut) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      clearTimeout(drainTimer);
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve({ status, stdout, stderr, timedOut });
    };
    const watchdog = setTimeout(() => {
      console.error(
        `bounded-spawn: WATCHDOG — ${label} still had no exit after ${timeoutMs}ms; killing its process tree`,
      );
      killTree(child);
      settle(null, true);
    }, timeoutMs);
    child.on('error', () => settle(null, false));
    child.on('close', (code) => settle(code, false));
    child.on('exit', (code) => {
      drainTimer = setTimeout(() => settle(code, false), drainMs);
    });
  });
}
