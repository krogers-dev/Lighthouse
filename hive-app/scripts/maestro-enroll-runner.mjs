#!/usr/bin/env node
/**
 * maestro:enroll — the ONE supported entry point for the TOTP enrollment
 * and login flows on a machine with a device lane (RETURN-4 P1-8).
 *
 * The prior instructions were prose, and they were WRONG about Maestro's
 * artifact model: `--debug-output` receives logs and the command journal,
 * NOT screenshots. Maestro writes screenshots (including the failure
 * screenshot that can show the enrollment QR and setup key) to
 * `--test-output-dir`, or, when that flag is absent, to the default
 * `~/.maestro/tests/<timestamp>` location. Confining only --debug-output
 * therefore confined nothing. This runner makes the correct behavior
 * executable and fail-closed:
 *
 *  - creates mode-0700 temporary directories for BOTH --debug-output and
 *    --test-output-dir, under a private run root;
 *  - snapshots ~/.maestro/tests before and after every flow and FAILS on
 *    any new entry there (default-location leak detection);
 *  - bounds EVERY Maestro invocation with a watchdog and, on expiry,
 *    kills the whole process tree (cmd.exe -> maestro.bat -> java on
 *    Windows), so a wedged CLI can no longer suspend cleanup (find 36);
 *  - fails CLOSED at startup on the residue of a previous hand-killed
 *    run: a totp-helper still bound to the loopback port is a HOLD, and
 *    stale run roots are swept;
 *  - runs the deterministic sequence
 *        reset factors -> enroll -> sign out -> login (same factor,
 *        same helper session) -> revoke -> helper shutdown,
 *    explicitly sequential, one flow at a time; the factor is NEVER
 *    revoked between a successful enrollment and the subsequent login —
 *    that login is what proves the existing factor verifies;
 *  - starts the loopback totp-helper itself and terminates it in cleanup;
 *  - scrubs the clipboard, revokes the disposable factor, and removes the
 *    entire artifact tree on success, on failure, and on SIGINT/SIGTERM;
 *  - retains NO artifact from the enrollment screen: the enrollment flow's
 *    artifacts are scrubbed wholesale, and only post-secret assertions are
 *    reported.
 *
 * `--prove-confinement` runs the confinement probe instead: a flow that
 * fails deliberately while the QR and setup key are on screen, proving
 * the failure artifact lands inside the private run root, never in the
 * default location, and is scrubbed.
 *
 * Synthetic example.invalid identities and loopback services only. No
 * secret ever reaches a CLI argument, environment variable, URL, or file.
 *
 * EXECUTION IS HOLD in the build container (no device, simulator, or
 * Maestro binary): this script is authored and unit-tested here, and runs
 * on the QA machine after the PM passes this candidate for that lane.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { connect } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const QA_EMAIL = 'reviewer.rae@example.invalid';
export const DEFAULT_MAESTRO_TESTS = path.join(homedir(), '.maestro', 'tests');

/** The deterministic sequence. Enrollment is followed by sign-out and a
 * SUBSEQUENT LOGIN on the same factor and the same helper session; the
 * factor is revoked only after that login has proved it verifies. */
export const SEQUENCE = [
  { step: 'reset-factors', kind: 'admin' },
  { step: 'mfa-enroll.yaml', kind: 'flow', retainArtifacts: false },
  { step: 'staff-sign-out.yaml', kind: 'flow', retainArtifacts: true },
  { step: 'mfa-login.yaml', kind: 'flow', retainArtifacts: true },
  { step: 'revoke-factor', kind: 'admin' },
];

/** Entries in ~/.maestro/tests, or an empty set when it does not exist. */
export function snapshotDefaultLocation(readdir = readdirSync, dir = DEFAULT_MAESTRO_TESTS) {
  try {
    return new Set(readdir(dir));
  } catch {
    return new Set();
  }
}

/** Any entry that appeared in the default location during a flow is a
 * LEAK: the run's artifacts must live only under the private run root. */
export function detectDefaultLocationLeak(before, after) {
  const leaked = [...after].filter((entry) => !before.has(entry));
  return leaked.length === 0
    ? []
    : [
        `Maestro wrote ${leaked.length} artifact set(s) into the default location ${DEFAULT_MAESTRO_TESTS} (${leaked.join(', ')}) — screenshots must stay inside the run's private --test-output-dir`,
      ];
}

/** The exact argv for one flow. Screenshots follow --test-output-dir;
 * --debug-output takes logs only. Both are private, mode-0700 dirs.
 * One flow file per invocation: execution is sequential by construction,
 * and no sharding flag (--shard-all/--shard-split) is ever passed. */
export function maestroArgs(flowFile, { debugDir, testOutputDir }) {
  return [
    'test',
    '--debug-output',
    debugDir,
    '--test-output-dir',
    testOutputDir,
    path.join('.maestro', flowFile),
  ];
}

/** The device lane may only run a Maestro CLI that is pinned by version
 * AND artifact checksum in security/hardware-toolchain.json (RETURN-4
 * P2-1). An unpinned CLI is an unreviewed binary on the machine that
 * displays the enrollment QR, and the validator's payload schemas are
 * declared against one specific version. Returns problems; empty means
 * the installed CLI matches the pinned record. */
/** Windows ships the Maestro CLI as `maestro.bat`, which CreateProcess
 * cannot execute: every spawn below named `maestro` directly, so on the
 * desktop that actually owns the device lane the runner read an empty
 * `--version` (reported as the installed CLI being "unknown" and therefore
 * not the pinned version), an empty `--help` (reported as the CLI not
 * supporting `--debug-output`), and could not have launched a flow at all
 * — find 25, 2026-09-04, the same trap as find 2 and find 15.
 *
 * Routing through the command processor with an ARGV ARRAY is deliberate:
 * these arguments include generated temporary paths, so a `shell: true`
 * command STRING would be a quoting hazard — a run root containing a space
 * would split and confine QR-bearing screenshots to the wrong directory,
 * which is the one failure this runner exists to prevent. */
export function maestroCommand(args, platform = process.platform) {
  if (platform !== 'win32') return { command: 'maestro', args };
  return { command: process.env.ComSpec ?? 'cmd.exe', args: ['/c', 'maestro', ...args] };
}

/** `which` is not a Windows command; `where` is. */
export function lookupMaestroCommand(platform = process.platform) {
  if (platform !== 'win32') return { command: 'which', args: ['maestro'] };
  return { command: process.env.ComSpec ?? 'cmd.exe', args: ['/c', 'where', 'maestro'] };
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
export function pinnedMaestroProblems(record, installedVersion) {
  const pin = record?.maestro ?? {};
  const problems = [];
  if (pin.status !== 'pinned') {
    problems.push(
      `the Maestro CLI is not pinned (status ${JSON.stringify(pin.status ?? null)}) — fill security/hardware-toolchain.json with the exact version, artifact URL, and sha256 before any device run`,
    );
  }
  if (typeof pin.version !== 'string' || pin.version.trim() === '') {
    problems.push('security/hardware-toolchain.json records no Maestro version');
  } else if (typeof installedVersion === 'string' && !installedVersion.includes(pin.version)) {
    problems.push(
      `the installed Maestro CLI (${installedVersion.trim() || 'unknown'}) is not the pinned version ${pin.version}`,
    );
  }
  if (!SHA256_HEX.test(pin.sha256 ?? '')) {
    problems.push(
      'security/hardware-toolchain.json records no sha256 for the Maestro artifact — an unverified download must not run the enrollment flow',
    );
  }
  if (typeof pin.verifiedBy !== 'string' || pin.verifiedBy.trim() === '') {
    problems.push('the Maestro pin records no verifier');
  }
  return problems;
}

/** Confinement depends on flags the INSTALLED Maestro actually supports.
 * Rather than assume, the runner reads `maestro test --help` and refuses
 * to run when the screenshot-directing flag is absent — an unconfinable
 * run is a HOLD, never a best-effort run with the QR on screen. */
export function outputFlagProblems(helpText) {
  const problems = [];
  if (!helpText.includes('--debug-output')) {
    problems.push('the installed Maestro CLI does not support --debug-output');
  }
  if (!helpText.includes('--test-output-dir')) {
    problems.push(
      'the installed Maestro CLI does not support --test-output-dir — screenshots would fall back to ~/.maestro/tests, which cannot be confined; pin the recorded Maestro version (docs/plans hardware toolchain record) or stop: a QR-bearing screenshot must never land outside the private run root',
    );
  }
  return problems;
}

/** Find 36: twice on the Windows desktop, `maestro:enroll` stopped making
 * progress with the runner alive, no Maestro child visible, and no further
 * output — and killing the stuck runner SKIPPED cleanup, leaving the
 * totp-helper listening with a setup secret in memory, the run root on
 * disk, and the clipboard unscrubbed. A cleanup guarantee that holds only
 * on a normal exit is not a guarantee.
 *
 * The vulnerable shape was `spawnSync` through `cmd.exe /c` with inherited
 * stdio: it blocks the event loop, so the SIGINT/SIGTERM handlers that
 * guarantee cleanup cannot run while it is stuck, and it has no bound of
 * its own, so anything wedged below it (a straggler java or adb child, a
 * blocked inherited handle) suspends the runner forever. The fix removes
 * the shape: every Maestro invocation is async `spawn` awaited on its
 * `exit` event, bounded by these watchdogs, and on expiry the whole
 * process TREE is killed — on Windows killing only cmd.exe would orphan
 * the java process that owns the device, hence `taskkill /T`. */
export const FLOW_TIMEOUT_DEFAULT_MS = 600_000;
export const PROBE_TIMEOUT_MS = 60_000;
export const CLEANUP_STEP_TIMEOUT_MS = 120_000;

/** Per-flow watchdog: 10 minutes by default (a flow includes a cold app
 * start and Metro bundle), overridable for a legitimately slower lane.
 * Garbage in the override returns NaN so the caller can refuse to run —
 * a misread watchdog must never silently become a default or infinity. */
export function flowTimeoutMs(env = process.env) {
  const raw = env.HIVE_MAESTRO_FLOW_TIMEOUT_MS;
  if (raw === undefined || raw === '') return FLOW_TIMEOUT_DEFAULT_MS;
  if (!/^\d+$/.test(raw) || Number(raw) <= 0) return NaN;
  return Number(raw);
}

/** The tree kill for a wedged invocation. Windows: `taskkill /T /F` on the
 * spawned cmd.exe takes maestro.bat and java down with it (taskkill is a
 * native exe, so it spawns directly — no ComSpec wrapper needed). POSIX
 * returns null: there the child is spawned detached into its own process
 * group and the group is signalled instead. */
export function killTreeCommand(pid, platform = process.platform) {
  if (platform !== 'win32') return null;
  return { command: 'taskkill', args: ['/pid', String(pid), '/T', '/F'] };
}

/** Run roots are created as mkdtemp(tmpdir()/RUN_ROOT_PREFIX). A run that
 * hung and was killed by hand leaves its root behind; startup sweeps every
 * entry matching THIS runner's prefix only — the denied runner has its own
 * (2026-09-06 review, P2-D) — so a match is always a leftover, never a
 * concurrent peer's confined artifacts. */
export const RUN_ROOT_PREFIX = 'hive-maestro-enroll-';
export function isStaleRunRoot(name) {
  return name.startsWith(RUN_ROOT_PREFIX);
}

function privateDir(parent, name) {
  const dir = path.join(parent, name);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const proveConfinement = process.argv.includes('--prove-confinement');

  if (!existsSync(path.join(appRoot, '.maestro'))) {
    console.error('maestro:enroll ENGINE FAILURE: .maestro/ is missing');
    process.exit(2);
  }

  const flowTimeout = flowTimeoutMs(process.env);
  if (!Number.isFinite(flowTimeout)) {
    console.error(
      'maestro:enroll ENGINE FAILURE: HIVE_MAESTRO_FLOW_TIMEOUT_MS must be a positive integer of milliseconds — refusing to run with an unreadable watchdog',
    );
    process.exit(2);
  }

  /** The Maestro invocation currently in flight, so cleanup and the signal
   * handlers can kill its whole tree (find 36). */
  let inFlight = null;

  function killTree(child) {
    if (!child || child.pid == null || child.exitCode !== null || child.signalCode !== null) return;
    const kill = killTreeCommand(child.pid);
    if (kill) {
      spawnSync(kill.command, kill.args, {
        stdio: 'ignore',
        timeout: 15_000,
        killSignal: 'SIGKILL',
      });
      return;
    }
    // POSIX: the child was spawned detached into its own process group, so
    // the negative pid signals the whole group — killing only the wrapper
    // script would orphan the java process that owns the device.
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

  /** One Maestro invocation, bounded (find 36). Resolves — never rejects,
   * never hangs — with { status, stdout, stderr, timedOut }; status is
   * null when the process was killed or failed to spawn. Settles on
   * `exit` plus a short stdio drain, with `close` as the normal
   * fully-drained path — never on `close` ALONE, because `close`
   * additionally waits for the stdio streams, and a straggler grandchild
   * holding an inherited pipe handle keeps them open forever. */
  function runMaestro(args, { timeoutMs, label, inheritOutput = false }) {
    const cmd = maestroCommand(args);
    return new Promise((resolve) => {
      const child = spawn(cmd.command, cmd.args, {
        cwd: appRoot,
        stdio: inheritOutput ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: 'true' },
        // POSIX: own process group, so the watchdog can kill the whole
        // tree. Not on Windows, where taskkill /T does that job.
        detached: process.platform !== 'win32',
      });
      inFlight = child;
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
        inFlight = null;
        resolve({ status, stdout, stderr, timedOut });
      };
      const watchdog = setTimeout(() => {
        console.error(
          `maestro:enroll: WATCHDOG — ${label} still had no exit after ${timeoutMs}ms; killing its process tree (find 36)`,
        );
        killTree(child);
        settle(null, true);
      }, timeoutMs);
      child.on('error', () => settle(null, false));
      child.on('close', (code) => settle(code, false));
      child.on('exit', (code) => {
        drainTimer = setTimeout(() => settle(code, false), 1000);
      });
    });
  }

  /** True when something already listens on 127.0.0.1:port. Inconclusive
   * (no answer within 2s) counts as in use: fail closed. */
  function portInUse(port) {
    return new Promise((resolve) => {
      const socket = connect({ host: '127.0.0.1', port });
      let done = false;
      const finish = (busy) => {
        if (done) return;
        done = true;
        socket.destroy();
        resolve(busy);
      };
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.setTimeout(2000, () => finish(true));
    });
  }

  const lookup = lookupMaestroCommand();
  const maestroBin = spawnSync(lookup.command, lookup.args, {
    encoding: 'utf8',
    timeout: PROBE_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  if (maestroBin.status !== 0) {
    console.error(
      'maestro:enroll HOLD — the Maestro CLI is not installed here. This runner executes on the QA machine with the device lane; the build container has no device, simulator, or Maestro binary (exit 3)',
    );
    process.exit(3);
  }
  // The CLI must be the pinned, checksum-verified one before anything
  // shows a QR.
  let toolchainRecord;
  try {
    toolchainRecord = JSON.parse(
      readFileSync(path.join(appRoot, 'security', 'hardware-toolchain.json'), 'utf8'),
    );
  } catch {
    console.error(
      'maestro:enroll ENGINE FAILURE: security/hardware-toolchain.json is missing or unreadable',
    );
    process.exit(2);
  }
  const version = await runMaestro(['--version'], {
    timeoutMs: PROBE_TIMEOUT_MS,
    label: 'maestro --version',
  });
  if (version.timedOut) {
    console.error(
      `maestro:enroll HOLD — \`maestro --version\` gave no answer within ${PROBE_TIMEOUT_MS}ms and its process tree was killed; the CLI on this machine wedges before any flow could run (find 36) (exit 3)`,
    );
    process.exit(3);
  }
  const installedVersion = version.stdout;
  const pinProblems = pinnedMaestroProblems(toolchainRecord, installedVersion);
  if (pinProblems.length > 0) {
    for (const problem of pinProblems) console.error(`HOLD ${problem}`);
    console.error(
      'maestro:enroll HOLD — the Maestro CLI pin is incomplete or does not match the installed binary (exit 3)',
    );
    process.exit(3);
  }
  // Confinement must be provable before anything shows a QR.
  const help = await runMaestro(['test', '--help'], {
    timeoutMs: PROBE_TIMEOUT_MS,
    label: 'maestro test --help',
  });
  if (help.timedOut) {
    console.error(
      `maestro:enroll HOLD — \`maestro test --help\` gave no answer within ${PROBE_TIMEOUT_MS}ms and its process tree was killed; the CLI on this machine wedges before any flow could run (find 36) (exit 3)`,
    );
    process.exit(3);
  }
  const helpText = `${help.stdout}${help.stderr}`;
  const flagProblems = outputFlagProblems(helpText);
  if (flagProblems.length > 0) {
    for (const problem of flagProblems) console.error(`FAIL ${problem}`);
    console.error(
      'maestro:enroll FAILED — refusing to run an enrollment flow whose screenshots cannot be confined',
    );
    process.exit(1);
  }

  // Fail CLOSED on a survivor of a previous hung run (find 36): a stale
  // totp-helper still listening means a setup secret may still be in
  // memory on this machine — and this run's helper would crash on bind
  // (totp-helper has no listen-error recovery), after which the flows
  // would silently talk to the WRONG helper. Nothing has been created
  // yet, so holding here leaves nothing to clean.
  const helperPort = Number(process.env.HIVE_TOTP_HELPER_PORT ?? 8477);
  if (await portInUse(helperPort)) {
    console.error(
      `maestro:enroll HOLD — 127.0.0.1:${helperPort} is already in use, most likely a totp-helper left listening by a previous hung run (find 36). End the stray Node.js process (Task Manager -> Details -> node.exe on Windows; lsof -i :${helperPort} elsewhere), run \`node scripts/local-supabase.mjs reset-totp ${QA_EMAIL}\` to confirm no factor survived, then rerun (exit 3)`,
    );
    process.exit(3);
  }

  // Sweep run roots a hand-killed run left behind, loudly. The helper
  // port check above excludes a concurrent run, so a match is always a
  // leftover, never a peer.
  for (const entry of readdirSync(tmpdir())) {
    if (!isStaleRunRoot(entry)) continue;
    const stale = path.join(tmpdir(), entry);
    try {
      rmSync(stale, { recursive: true, force: true });
    } catch {
      // fall through to the existence check
    }
    if (existsSync(stale)) {
      console.error(
        `maestro:enroll: stale run root ${stale} could not be removed — remove it manually before trusting artifact confinement`,
      );
    } else {
      console.log(`maestro:enroll: removed stale run root from a previous run (${stale})`);
    }
  }

  // Private run root: 0700 all the way down. chmod is a POSIX concept and
  // binary; on Windows %TEMP% lives inside the user profile and is
  // already ACL'd to that user, and there is no chmod to call.
  const runRoot = mkdtempSync(path.join(tmpdir(), RUN_ROOT_PREFIX));
  if (process.platform !== 'win32') execFileSync('chmod', ['700', runRoot]);
  const debugDir = privateDir(runRoot, 'debug');
  const testOutputDir = privateDir(runRoot, 'artifacts');

  let helper = null;
  let factorMayExist = false;
  let cleanedUp = false;

  function revokeFactor(reason) {
    // Sync on purpose: this also runs from cleanup inside
    // process.on('exit'), where only synchronous work executes. Bounded
    // so a wedged stack cannot suspend cleanup (find 36).
    const result = spawnSync(
      process.execPath,
      [path.join(appRoot, 'scripts', 'local-supabase.mjs'), 'reset-totp', QA_EMAIL],
      {
        cwd: appRoot,
        stdio: ['ignore', 'inherit', 'inherit'],
        timeout: CLEANUP_STEP_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      },
    );
    if (result.status === 0) {
      console.log(`maestro:enroll: factor revoked and verified clean (${reason})`);
      return true;
    }
    // A failed cleanup step must never hide behind a successful run's exit
    // code (2026-09-06 review, P2-E).
    process.exitCode = 1;
    const timedOut = result.error && result.error.code === 'ETIMEDOUT';
    console.error(
      `maestro:enroll: FACTOR REVOCATION FAILED (${reason})${timedOut ? ` — timed out after ${CLEANUP_STEP_TIMEOUT_MS}ms` : ''} — run \`node scripts/local-supabase.mjs reset-totp ${QA_EMAIL}\` by hand and verify zero factors`,
    );
    return false;
  }

  function scrubClipboard(reason) {
    // A run that died between "copy the setup key" and "overwrite the
    // clipboard" leaves the synthetic key on the device clipboard.
    const scrubCmd = maestroCommand([
      'test',
      '--debug-output',
      debugDir,
      '--test-output-dir',
      testOutputDir,
      path.join('.maestro', 'clipboard-scrub.yaml'),
    ]);
    // Sync on purpose (cleanup can run inside process.on('exit')), but
    // bounded: `timeout` kills the direct child only, and a straggler
    // grandchild is accepted there over an unbounded hang holding the
    // secret (find 36).
    const result = spawnSync(scrubCmd.command, scrubCmd.args, {
      cwd: appRoot,
      stdio: ['ignore', 'inherit', 'inherit'],
      timeout: CLEANUP_STEP_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
    if (result.status === 0) {
      console.log(`maestro:enroll: device clipboard overwritten (${reason})`);
      return true;
    }
    process.exitCode = 1;
    if (result.error && result.error.code === 'ETIMEDOUT') {
      console.error(
        `maestro:enroll: CLIPBOARD SCRUB TIMED OUT after ${CLEANUP_STEP_TIMEOUT_MS}ms (${reason}) — overwrite the device clipboard manually before releasing the device`,
      );
    } else {
      console.error(
        `maestro:enroll: CLIPBOARD SCRUB FAILED (${reason}) — overwrite the device clipboard manually before releasing the device`,
      );
    }
    return false;
  }

  /** Returns { scrubbed, revoked } so a success path can refuse to report OK
   * over a failed cleanup. Runs once; later calls are no-ops. */
  let cleanupOutcome = null;
  function cleanup(reason) {
    if (cleanedUp) return cleanupOutcome ?? { scrubbed: false, revoked: false };
    cleanedUp = true;
    // 0. Kill any Maestro invocation still in flight (a SIGINT mid-flow
    //    lands here with the flow running — reachable now that the event
    //    loop is no longer blocked by spawnSync): it holds the device and
    //    open handles under the run root, and the scrub flow plus the
    //    rmSync below need both released.
    killTree(inFlight);
    // 1. Terminate the loopback helper: the setup secret lives only in
    //    that process's memory, so its death is the secret's erasure.
    if (helper && helper.exitCode === null) {
      helper.kill('SIGTERM');
      console.log('maestro:enroll: totp-helper terminated (in-memory secret discarded)');
    }
    // 2. Overwrite the device clipboard on EVERY exit path.
    const scrubbed = scrubClipboard(reason);
    // 3. Revoke the disposable factor if enrollment may have created one.
    const revoked = factorMayExist ? revokeFactor(reason) : true;
    // 4. Scrub every artifact directory, verified.
    rmSync(runRoot, { recursive: true, force: true });
    if (existsSync(runRoot)) {
      console.error(`maestro:enroll: FAILED TO SCRUB ${runRoot} — remove it manually`);
    } else {
      console.log(`maestro:enroll: artifact tree scrubbed (${runRoot} removed and verified gone)`);
    }
    cleanupOutcome = { scrubbed, revoked };
    return cleanupOutcome;
  }

  process.on('exit', () => cleanup('process exit'));
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      console.error(`maestro:enroll: received ${signal} — cleaning up`);
      cleanup(signal);
      process.exit(1);
    });
  }

  function fail(message) {
    console.error(`maestro:enroll FAILED — ${message}`);
    process.exit(1);
  }

  /** Run one flow, sequentially, with leak detection around it and the
   * find-36 watchdog bounding it. */
  async function runFlow(flowFile) {
    const before = snapshotDefaultLocation();
    const args = maestroArgs(flowFile, { debugDir, testOutputDir });
    console.log(
      `maestro:enroll: running ${flowFile} (sequential; artifacts confined to ${runRoot}; watchdog ${flowTimeout}ms)`,
    );
    const result = await runMaestro(args, {
      timeoutMs: flowTimeout,
      label: flowFile,
      inheritOutput: true,
    });
    const after = snapshotDefaultLocation();
    const leaks = detectDefaultLocationLeak(before, after);
    return { status: result.status, timedOut: result.timedOut, leaks };
  }

  // Start the loopback TOTP helper for the WHOLE sequence: enrollment and
  // the subsequent login share one helper session, because the secret
  // lives only in that process's memory.
  helper = spawn(process.execPath, [path.join(appRoot, 'scripts', 'totp-helper.mjs')], {
    cwd: appRoot,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  helper.on('exit', (code) => {
    if (!cleanedUp && code !== 0) {
      console.error(`maestro:enroll: totp-helper exited unexpectedly (${code})`);
    }
  });

  if (proveConfinement) {
    console.log(
      'maestro:enroll: CONFINEMENT PROOF — forcing a failure while the QR and setup key are on screen',
    );
    if (!revokeFactor('pre-probe reset')) fail('pre-probe factor reset failed');
    factorMayExist = true;
    const probe = await runFlow('confinement-probe.yaml');
    if (probe.leaks.length > 0) {
      for (const leak of probe.leaks) console.error(`FAIL ${leak}`);
      fail('artifacts leaked into the default Maestro location');
    }
    if (probe.timedOut) {
      // Before the status check: a killed probe must never pass for the
      // designed failure.
      fail(
        `the confinement probe hit the ${flowTimeout}ms watchdog; its process tree was killed and cleanup ran (find 36)`,
      );
    }
    if (probe.status === 0) {
      fail('the confinement probe PASSED — it is designed to fail while the secret is on screen');
    }
    // The probe failed as designed: prove the failure artifact landed
    // inside the private run root, then scrub it without retaining it.
    const captured = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else captured.push(path.relative(runRoot, full));
      }
    };
    walk(runRoot);
    const screenshots = captured.filter((file) => /\.(png|jpe?g)$/i.test(file));
    console.log(
      `maestro:enroll: confinement proof — ${captured.length} artifact(s) captured, ${screenshots.length} screenshot(s), ALL inside ${runRoot}; none in ${DEFAULT_MAESTRO_TESTS}`,
    );
    if (screenshots.length === 0) {
      fail(
        'no screenshot was captured by the forced failure — the confinement claim would be unproven (check --test-output-dir support in the pinned Maestro CLI)',
      );
    }
    const proofCleanup = cleanup('confinement proof');
    if (!proofCleanup.scrubbed || !proofCleanup.revoked) {
      fail(
        'the probe ran but cleanup FAILED (see above) — finish it by hand before releasing the device',
      );
    }
    console.log(
      'maestro:enroll CONFINEMENT PROOF OK — the QR-bearing failure artifact was confined to the private run root and is now scrubbed (no such screenshot is retained)',
    );
    process.exit(0);
  }

  for (const entry of SEQUENCE) {
    if (entry.kind === 'admin') {
      if (entry.step === 'reset-factors') {
        if (!revokeFactor('pre-run reset')) fail('pre-run factor reset failed');
        factorMayExist = true;
        continue;
      }
      if (entry.step === 'revoke-factor') {
        if (!revokeFactor('post-run revocation')) fail('post-run factor revocation failed');
        factorMayExist = false;
        continue;
      }
    }
    if (helper.exitCode !== null || helper.signalCode !== null) {
      // Fail CLOSED instead of running flows against whatever else might
      // answer on the helper port (find 36's fail-open sibling).
      fail(
        `the totp-helper exited (${helper.exitCode ?? helper.signalCode}) before ${entry.step} — without it the flows cannot fetch codes; check 127.0.0.1:${helperPort} for a conflict`,
      );
    }
    const outcome = await runFlow(entry.step);
    if (outcome.leaks.length > 0) {
      for (const leak of outcome.leaks) console.error(`FAIL ${leak}`);
      fail(`${entry.step} leaked artifacts into the default Maestro location`);
    }
    if (outcome.timedOut) {
      fail(
        `${entry.step} hit the ${flowTimeout}ms watchdog; its process tree was killed and cleanup ran (find 36) — if the flow legitimately needs longer, set HIVE_MAESTRO_FLOW_TIMEOUT_MS`,
      );
    }
    if (outcome.status !== 0) {
      fail(`${entry.step} exited ${outcome.status}`);
    }
    if (!entry.retainArtifacts) {
      console.log(
        `maestro:enroll: ${entry.step} artifacts discarded unread — the enrollment screen shows the QR and setup key, so nothing from it is retained`,
      );
    }
  }

  // Explicit, verified cleanup, then EXIT. This is the ROOT CAUSE of find
  // 36, found by the 2026-09-06 review: the totp-helper ChildProcess kept
  // the event loop alive after this OK line, so the process never exited,
  // the exit-time cleanup never ran, and the helper stayed listening with
  // the setup secret in memory — "runner alive, no Maestro child, no
  // further output". The watchdog above is real hardening; this is the fix.
  const outcome = cleanup('success');
  if (!outcome.scrubbed || !outcome.revoked) {
    fail(
      'the sequence passed but cleanup FAILED (see above) — finish it by hand before releasing the device',
    );
  }
  console.log(
    'maestro:enroll OK — reset -> enroll -> sign-out -> login on the SAME factor -> revoke completed sequentially; helper terminated, clipboard scrubbed, artifacts confined and removed',
  );
  process.exit(0);
}
