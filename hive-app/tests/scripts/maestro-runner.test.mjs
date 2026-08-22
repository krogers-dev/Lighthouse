/** RETURN-4 P1-8: the enrollment runner's fail-closed decisions —
 * artifact confinement, default-location leak detection, and the
 * deterministic sequence — are unit-tested here because the device lane
 * itself is HOLD in this container. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_MAESTRO_TESTS,
  SEQUENCE,
  detectDefaultLocationLeak,
  maestroArgs,
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
  assert.equal(args.at(-1), '.maestro/mfa-enroll.yaml');
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
    'sign-out.yaml',
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
  // The repository's CURRENT record is an operator-fill HOLD: it must not
  // be mistaken for a pin.
  const { readFileSync } = await import('node:fs');
  const recordPath = new URL('../../security/hardware-toolchain.json', import.meta.url);
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  const live = pinnedMaestroProblems(record, 'maestro 1.39.9\n');
  assert.ok(live.some((p) => p.includes('not pinned')));
  assert.ok(live.some((p) => p.includes('no sha256')));
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
