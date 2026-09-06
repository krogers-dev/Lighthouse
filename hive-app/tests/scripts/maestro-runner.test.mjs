/** RETURN-4 P1-8: the enrollment runner's fail-closed decisions —
 * artifact confinement, default-location leak detection, and the
 * deterministic sequence — are unit-tested here because the device lane
 * itself is HOLD in this container. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import {
  CLEANUP_STEP_TIMEOUT_MS,
  DEFAULT_MAESTRO_TESTS,
  FLOW_TIMEOUT_DEFAULT_MS,
  PROBE_TIMEOUT_MS,
  RUN_ROOT_PREFIX,
  SEQUENCE,
  detectDefaultLocationLeak,
  flowTimeoutMs,
  isStaleRunRoot,
  killTreeCommand,
  lookupMaestroCommand,
  maestroArgs,
  maestroCommand,
  outputFlagProblems,
  snapshotDefaultLocation,
} from '../../scripts/maestro-enroll-runner.mjs';

test('screenshots are directed to --test-output-dir, not --debug-output', () => {
  const args = maestroArgs('mfa-enroll.yaml', {
    debugDir: '/tmp/run/debug',
    testOutputDir: '/tmp/run/artifacts',
  });
  // The corrected artifact model: BOTH directories are passed, and the
  // screenshot directory is a distinct private path.
  assert.ok(args.includes('--debug-output'));
  assert.ok(args.includes('--test-output-dir'));
  assert.equal(args[args.indexOf('--debug-output') + 1], '/tmp/run/debug');
  assert.equal(args[args.indexOf('--test-output-dir') + 1], '/tmp/run/artifacts');
  assert.notEqual(
    args[args.indexOf('--debug-output') + 1],
    args[args.indexOf('--test-output-dir') + 1],
  );
  // Exactly one flow file, and never a sharding flag: execution is
  // sequential by construction.
  // path.join, so the separator is the platform's — asserting a literal
  // '/' failed on the Windows desktop that actually owns this lane
  // (find 26).
  assert.equal(args.at(-1), path.join('.maestro', 'mfa-enroll.yaml'));
  assert.ok(!args.some((a) => a.startsWith('--shard')));
});

test('NEGATIVE: a CLI without --test-output-dir cannot confine screenshots and is refused', () => {
  const full = 'Usage: maestro test [options]\n  --debug-output <dir>\n  --test-output-dir <dir>\n';
  assert.deepEqual(outputFlagProblems(full), []);
  const missing = 'Usage: maestro test [options]\n  --debug-output <dir>\n';
  const problems = outputFlagProblems(missing);
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes('--test-output-dir'));
  assert.ok(problems[0].includes('~/.maestro/tests'));
  const neither = 'Usage: maestro test [options]\n';
  assert.equal(outputFlagProblems(neither).length, 2);
});

test('NEGATIVE: any new entry in the default location is a leak', () => {
  const before = new Set(['2026-08-20_120000']);
  assert.deepEqual(detectDefaultLocationLeak(before, new Set(['2026-08-20_120000'])), []);
  const after = new Set(['2026-08-20_120000', '2026-08-22_093000']);
  const leaks = detectDefaultLocationLeak(before, after);
  assert.equal(leaks.length, 1);
  assert.ok(leaks[0].includes(DEFAULT_MAESTRO_TESTS));
  assert.ok(leaks[0].includes('2026-08-22_093000'));
  // A default location that did not exist before but appears mid-run is
  // still a leak, not an absence.
  assert.equal(detectDefaultLocationLeak(new Set(), new Set(['fresh'])).length, 1);
});

test('a missing default location snapshots as empty, never as a failure', () => {
  assert.deepEqual(
    [
      ...snapshotDefaultLocation(() => {
        throw new Error('ENOENT');
      }),
    ],
    [],
  );
});

test('the sequence never revokes between enrollment and the subsequent login', () => {
  const steps = SEQUENCE.map((entry) => entry.step);
  assert.deepEqual(steps, [
    'reset-factors',
    'mfa-enroll.yaml',
    'staff-sign-out.yaml',
    'mfa-login.yaml',
    'revoke-factor',
  ]);
  const enroll = steps.indexOf('mfa-enroll.yaml');
  const login = steps.indexOf('mfa-login.yaml');
  const revoke = steps.indexOf('revoke-factor');
  assert.ok(enroll < login, 'enrollment precedes the subsequent login');
  assert.ok(revoke > login, 'revocation happens only AFTER the login proves the factor verifies');
  const between = steps.slice(enroll + 1, login);
  assert.ok(
    !between.includes('revoke-factor') && !between.includes('reset-factors'),
    'no factor revocation may sit between a successful enrollment and the login that uses it',
  );
  // The enrollment flow's artifacts are never retained: that screen shows
  // the QR and the setup key.
  const enrollEntry = SEQUENCE.find((e) => e.step === 'mfa-enroll.yaml');
  assert.equal(enrollEntry.retainArtifacts, false);
  assert.equal(SEQUENCE.find((e) => e.step === 'mfa-login.yaml').retainArtifacts, true);
});

test('NEGATIVE: an unpinned or mismatched Maestro CLI is refused (RETURN-4 P2-1)', async () => {
  const { pinnedMaestroProblems } = await import('../../scripts/maestro-enroll-runner.mjs');
  const pinned = {
    maestro: {
      status: 'pinned',
      version: '1.39.9',
      artifactUrl: 'https://example.invalid/maestro-1.39.9.zip',
      sha256: 'a'.repeat(64),
      verifiedBy: 'Kody',
    },
  };
  assert.deepEqual(pinnedMaestroProblems(pinned, 'maestro 1.39.9\n'), []);
  // The repository's LIVE record was signed by Kody Rogers on 2026-09-04,
  // so it is now expected to be complete — but "complete" is asserted
  // field by field rather than trusted, because a pin is the thing that
  // lets an unreviewed binary near the enrollment QR. A record that says
  // 'pinned' while carrying a placeholder digest or an empty verifier is
  // worse than one that says nothing.
  const { readFileSync } = await import('node:fs');
  const recordPath = new URL('../../security/hardware-toolchain.json', import.meta.url);
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  assert.equal(record.maestro.status, 'pinned');
  assert.match(record.maestro.sha256 ?? '', /^[0-9a-f]{64}$/);
  assert.ok((record.maestro.verifiedBy ?? '').trim().length > 0);
  assert.match(record.maestro.verifiedOn ?? '', /^\d{4}-\d{2}-\d{2}$/);
  assert.match(record.maestro.artifactUrl ?? '', /^https:\/\/github\.com\/.*maestro\.zip$/);
  // With the version it names, the live record must actually clear.
  assert.deepEqual(pinnedMaestroProblems(record, `maestro ${record.maestro.version}\n`), []);
  // And it must still refuse a DIFFERENT installed binary: a signature
  // pins one version, never whatever happens to be on the machine.
  assert.ok(
    pinnedMaestroProblems(record, 'maestro 9.9.9\n').some((p) =>
      p.includes('is not the pinned version'),
    ),
  );
  // A version mismatch between record and installed binary is refused.
  assert.ok(
    pinnedMaestroProblems(pinned, 'maestro 1.40.0\n').some((p) =>
      p.includes('is not the pinned version'),
    ),
  );
  // A fabricated/short digest is not a checksum.
  assert.ok(
    pinnedMaestroProblems(
      { maestro: { ...pinned.maestro, sha256: 'abc123' } },
      'maestro 1.39.9\n',
    ).some((p) => p.includes('no sha256')),
  );
  assert.ok(
    pinnedMaestroProblems(
      { maestro: { ...pinned.maestro, verifiedBy: '' } },
      'maestro 1.39.9\n',
    ).some((p) => p.includes('no verifier')),
  );
});

// Find 25: Windows ships the Maestro CLI as maestro.bat, which
// CreateProcess cannot execute. Every spawn in this runner named 'maestro'
// directly, so on the desktop that actually owns the device lane the
// runner read an empty --version (reported as the installed CLI being
// "unknown" and therefore not the pinned 2.10.0), an empty --help
// (reported as the CLI not supporting --debug-output), and could not have
// launched a flow at all. Same trap as find 2 (local-supabase) and find 15
// (verify:toolchain).
test('on Windows the Maestro CLI is invoked through the command processor', () => {
  const { command, args } = maestroCommand(['test', '--help'], 'win32');
  assert.match(command, /cmd\.exe$/i);
  assert.deepEqual(args, ['/c', 'maestro', 'test', '--help']);
});

test('on POSIX the Maestro CLI is invoked directly', () => {
  const { command, args } = maestroCommand(['test', '--help'], 'linux');
  assert.equal(command, 'maestro');
  assert.deepEqual(args, ['test', '--help']);
});

// Arguments carry generated temp paths, so they must stay an ARGV array
// that Node quotes — a `shell: true` command STRING would split a path
// containing a space and confine screenshots to the wrong directory.
test('generated paths stay separate argv entries, never concatenated', () => {
  const dir = 'C:\\Users\\qa lead\\AppData\\Local\\Temp\\run root';
  const { args } = maestroCommand(['test', '--debug-output', dir], 'win32');
  assert.ok(args.includes(dir), 'the path must survive as one argument');
  assert.equal(args.filter((a) => a === dir).length, 1);
});

test('the CLI lookup also goes through the command processor on Windows', () => {
  assert.match(lookupMaestroCommand('win32').command, /cmd\.exe$/i);
  assert.deepEqual(lookupMaestroCommand('win32').args, ['/c', 'where', 'maestro']);
  assert.equal(lookupMaestroCommand('darwin').command, 'which');
});

// Find 36: the runner hung on Windows with cleanup unreachable — the
// spawnSync + cmd.exe /c + inherited-stdio shape blocks the event loop
// (so signal handlers cannot run) and has no bound of its own. Every
// Maestro invocation is now async under a watchdog that kills the whole
// process TREE on expiry; the pieces below are the pure decisions.
test('find 36: the watchdog kill takes the whole process tree', () => {
  // Windows: killing only the spawned cmd.exe would orphan the java
  // process that owns the device — /T is the point. taskkill is a native
  // exe, so no ComSpec wrapper, and the pid must arrive as one argv entry.
  const win = killTreeCommand(4242, 'win32');
  assert.equal(win.command, 'taskkill');
  assert.deepEqual(win.args, ['/pid', '4242', '/T', '/F']);
  // POSIX: no command at all — the child is spawned detached into its own
  // process group and the group is signalled, which a single argv cannot
  // express.
  assert.equal(killTreeCommand(4242, 'linux'), null);
  assert.equal(killTreeCommand(4242, 'darwin'), null);
});

test('find 36: the flow watchdog is bounded, overridable, and fail-closed on garbage', () => {
  assert.equal(flowTimeoutMs({}), FLOW_TIMEOUT_DEFAULT_MS);
  assert.equal(flowTimeoutMs({ HIVE_MAESTRO_FLOW_TIMEOUT_MS: '' }), FLOW_TIMEOUT_DEFAULT_MS);
  assert.equal(flowTimeoutMs({ HIVE_MAESTRO_FLOW_TIMEOUT_MS: '120000' }), 120000);
  // Garbage must come back non-finite so the runner refuses to start — a
  // misread watchdog silently becoming the default (or no watchdog) would
  // recreate the fail-open this closes.
  for (const bad of ['soon', '0', '-5', '1.5', '10s', '1e6']) {
    assert.ok(
      Number.isNaN(flowTimeoutMs({ HIVE_MAESTRO_FLOW_TIMEOUT_MS: bad })),
      `${JSON.stringify(bad)} must be refused, not defaulted`,
    );
  }
  // Sanity on the tiers: everything positive and finite, and the flow
  // default the largest — a flow contains a cold app start and a Metro
  // bundle, while the probes are --version/--help.
  for (const ms of [FLOW_TIMEOUT_DEFAULT_MS, PROBE_TIMEOUT_MS, CLEANUP_STEP_TIMEOUT_MS]) {
    assert.ok(Number.isFinite(ms) && ms > 0);
  }
  assert.ok(FLOW_TIMEOUT_DEFAULT_MS > CLEANUP_STEP_TIMEOUT_MS);
  assert.ok(FLOW_TIMEOUT_DEFAULT_MS > PROBE_TIMEOUT_MS);
});

test('find 36: stale run roots from a hand-killed run are recognized for the startup sweep', () => {
  // The sweep and mkdtemp share one prefix constant; this pins the
  // on-disk contract between them.
  assert.equal(RUN_ROOT_PREFIX, 'hive-maestro-enroll-');
  // Each runner sweeps only its own prefix (2026-09-06 review, P2-D): the
  // denied runner's roots must never match the enrollment sweep.
  assert.ok(!isStaleRunRoot('hive-maestro-denied-Ab12Cd'));
  assert.ok(isStaleRunRoot(`${RUN_ROOT_PREFIX}Ab12Cd`));
  assert.ok(!isStaleRunRoot('maestro-tests'));
  assert.ok(!isStaleRunRoot('hive-app'));
  assert.ok(!isStaleRunRoot(''));
});
