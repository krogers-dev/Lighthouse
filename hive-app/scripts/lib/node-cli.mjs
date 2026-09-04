/** Spawning npm, npx and other Node-ecosystem CLIs on Windows.
 *
 * On Windows these ship as `.cmd`/`.bat` wrappers, and CreateProcess
 * cannot execute a batch file: `spawnSync('npm', …)` dies with ENOENT
 * before the tool runs. This has now been found FIVE separate times on the
 * desktop that owns the device lane — local-supabase (find 2),
 * verify-toolchain (find 15), the Maestro enrollment runner (find 25), and
 * audit-gate plus candidate-export (find 27) — each time presenting as
 * something else: a registry problem, a missing tool, an unpinned CLI. The
 * audit and export gates were reported as environmentally unrunnable here
 * on that basis, which was wrong; they were unrunnable because of this.
 *
 * Two ways to survive it, and the choice is NOT stylistic:
 *
 *  - `shell: true` re-parses one command STRING, so any argument holding a
 *    space is re-split. Only safe when every argument is a hardcoded
 *    literal, which is why local-supabase and verify-toolchain use it.
 *  - Routing through the command processor with an ARGV ARRAY keeps Node's
 *    per-argument quoting. Required whenever an argument is a generated
 *    path — a temp directory or a run root containing a space would
 *    otherwise split silently.
 *
 * This helper is the second form, because its callers pass generated
 * paths. Returns the command and args to hand to spawnSync/execFileSync
 * unchanged, so call sites keep their own options.
 */
import process from 'node:process';

export function nodeCliCommand(tool, args, platform = process.platform) {
  if (platform !== 'win32') return { command: tool, args };
  return { command: process.env.ComSpec ?? 'cmd.exe', args: ['/c', tool, ...args] };
}
