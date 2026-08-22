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
  { step: 'sign-out.yaml', kind: 'flow', retainArtifacts: true },
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
  const maestroBin = spawnSync('which', ['maestro'], { encoding: 'utf8' });
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
  const installedVersion = spawnSync('maestro', ['--version'], { encoding: 'utf8' }).stdout ?? '';
  const pinProblems = pinnedMaestroProblems(toolchainRecord, installedVersion);
  if (pinProblems.length > 0) {
    for (const problem of pinProblems) console.error(`HOLD ${problem}`);
    console.error(
      'maestro:enroll HOLD — the Maestro CLI pin is incomplete or does not match the installed binary (exit 3)',
    );
    process.exit(3);
  }
  // Confinement must be provable before anything shows a QR.
  const help = spawnSync('maestro', ['test', '--help'], { encoding: 'utf8' });
  const helpText = `${help.stdout ?? ''}${help.stderr ?? ''}`;
  const flagProblems = outputFlagProblems(helpText);
  if (flagProblems.length > 0) {
    for (const problem of flagProblems) console.error(`FAIL ${problem}`);
    console.error(
      'maestro:enroll FAILED — refusing to run an enrollment flow whose screenshots cannot be confined',
    );
    process.exit(1);
  }

  // Private run root: 0700 all the way down.
  const runRoot = mkdtempSync(path.join(tmpdir(), 'hive-maestro-'));
  execFileSync('chmod', ['700', runRoot]);
  const debugDir = privateDir(runRoot, 'debug');
  const testOutputDir = privateDir(runRoot, 'artifacts');

  let helper = null;
  let factorMayExist = false;
  let cleanedUp = false;

  function revokeFactor(reason) {
    const result = spawnSync(
      process.execPath,
      [path.join(appRoot, 'scripts', 'local-supabase.mjs'), 'reset-totp', QA_EMAIL],
      { cwd: appRoot, encoding: 'utf8' },
    );
    if (result.status === 0) {
      console.log(`maestro:enroll: factor revoked and verified clean (${reason})`);
      return true;
    }
    console.error(
      `maestro:enroll: FACTOR REVOCATION FAILED (${reason}) — ${(result.stderr ?? '').trim()}`,
    );
    return false;
  }

  function scrubClipboard(reason) {
    // A run that died between "copy the setup key" and "overwrite the
    // clipboard" leaves the synthetic key on the device clipboard.
    const result = spawnSync(
      'maestro',
      [
        'test',
        '--debug-output',
        debugDir,
        '--test-output-dir',
        testOutputDir,
        path.join('.maestro', 'clipboard-scrub.yaml'),
      ],
      { cwd: appRoot, encoding: 'utf8' },
    );
    if (result.status === 0) {
      console.log(`maestro:enroll: device clipboard overwritten (${reason})`);
    } else {
      console.error(
        `maestro:enroll: CLIPBOARD SCRUB FAILED (${reason}) — overwrite the device clipboard manually before releasing the device`,
      );
    }
  }

  function cleanup(reason) {
    if (cleanedUp) return;
    cleanedUp = true;
    // 1. Terminate the loopback helper: the setup secret lives only in
    //    that process's memory, so its death is the secret's erasure.
    if (helper && helper.exitCode === null) {
      helper.kill('SIGTERM');
      console.log('maestro:enroll: totp-helper terminated (in-memory secret discarded)');
    }
    // 2. Overwrite the device clipboard on EVERY exit path.
    scrubClipboard(reason);
    // 3. Revoke the disposable factor if enrollment may have created one.
    if (factorMayExist) revokeFactor(reason);
    // 4. Scrub every artifact directory, verified.
    rmSync(runRoot, { recursive: true, force: true });
    if (existsSync(runRoot)) {
      console.error(`maestro:enroll: FAILED TO SCRUB ${runRoot} — remove it manually`);
    } else {
      console.log(`maestro:enroll: artifact tree scrubbed (${runRoot} removed and verified gone)`);
    }
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

  /** Run one flow, sequentially, with leak detection around it. */
  function runFlow(flowFile) {
    const before = snapshotDefaultLocation();
    const args = maestroArgs(flowFile, { debugDir, testOutputDir });
    console.log(
      `maestro:enroll: running ${flowFile} (sequential; artifacts confined to ${runRoot})`,
    );
    const result = spawnSync('maestro', args, {
      cwd: appRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: 'true' },
    });
    const after = snapshotDefaultLocation();
    const leaks = detectDefaultLocationLeak(before, after);
    return { status: result.status, leaks };
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
    const probe = runFlow('confinement-probe.yaml');
    if (probe.leaks.length > 0) {
      for (const leak of probe.leaks) console.error(`FAIL ${leak}`);
      fail('artifacts leaked into the default Maestro location');
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
    const outcome = runFlow(entry.step);
    if (outcome.leaks.length > 0) {
      for (const leak of outcome.leaks) console.error(`FAIL ${leak}`);
      fail(`${entry.step} leaked artifacts into the default Maestro location`);
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

  console.log(
    'maestro:enroll OK — reset -> enroll -> sign-out -> login on the SAME factor -> revoke completed sequentially; helper terminated, clipboard scrubbed by the flow, artifacts confined and removed',
  );
}
