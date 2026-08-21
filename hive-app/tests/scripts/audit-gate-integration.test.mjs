/** Integration tests for the audit gate against a fake npm executable
 * (PM directive P1 item 6): engine failure, registry failure, malformed
 * output, empty output, signal termination, clean report, valid waived
 * finding, and valid unwaived finding. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const gate = path.join(appRoot, 'scripts', 'audit-gate.mjs');

const CLEAN_REPORT = JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: {},
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
});

const HIGH_REPORT = JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: {
    demo: {
      name: 'demo',
      severity: 'high',
      via: [
        {
          severity: 'high',
          name: 'demo',
          url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
        },
      ],
    },
  },
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } },
});

function makeFakeNpm(behavior) {
  const dir = mkdtempSync(path.join(tmpdir(), 'hive-fake-npm-'));
  const script = `#!/bin/sh
case "$FAKE_NPM_MODE" in
  clean) printf '%s' "$FAKE_NPM_REPORT"; exit 0 ;;
  findings) printf '%s' "$FAKE_NPM_REPORT"; exit 1 ;;
  engine-fail) echo "npm ERR! EBADDEVENGINES" 1>&2; exit 1 ;;
  weird-exit) printf '%s' "$FAKE_NPM_REPORT"; exit 7 ;;
  malformed) printf 'not json at all'; exit 1 ;;
  empty) exit 1 ;;
  registry-error) printf '{"error":{"code":"E503","summary":"registry unavailable"}}'; exit 1 ;;
  signal) kill -KILL $$ ;;
esac
exit 9
`;
  const npmPath = path.join(dir, 'npm');
  writeFileSync(npmPath, script);
  chmodSync(npmPath, 0o755);
  return { dir, behavior };
}

function makeWaivers(waivers) {
  const dir = mkdtempSync(path.join(tmpdir(), 'hive-waivers-'));
  const file = path.join(dir, 'waivers.json');
  writeFileSync(file, JSON.stringify({ waivers }));
  return file;
}

const VALID_WAIVER = {
  advisory: 'GHSA-aaaa-bbbb-cccc',
  package: 'demo',
  severity: 'high',
  owner: 'Kody',
  reason: 'synthetic integration-test waiver',
  approvalStatus: 'ratified',
  proposedOn: '2026-08-01',
  ratifiedOn: '2026-08-02',
  expires: '2099-01-01',
  retest: 'Recheck monthly, on lockfile or Expo change, before any RC, and at expiry.',
};

const PROPOSED_WAIVER = {
  ...VALID_WAIVER,
  approvalStatus: 'proposed',
  ratifiedOn: undefined,
};

function runGate(mode, report, waivers) {
  const fake = makeFakeNpm(mode);
  const waiverPath = makeWaivers(waivers);
  const result = spawnSync('node', [gate], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fake.dir}:${process.env.PATH}`,
      FAKE_NPM_MODE: mode,
      FAKE_NPM_REPORT: report ?? '',
      HIVE_WAIVERS_PATH: waiverPath,
    },
  });
  return result;
}

test('clean report with no waivers passes', () => {
  const result = runGate('clean', CLEAN_REPORT, []);
  assert.equal(result.status, 0, result.stderr);
});

test('RATIFIED waived high finding passes and is reported as ratified', () => {
  const result = runGate('findings', HIGH_REPORT, [VALID_WAIVER]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /waived \(ratified 2026-08-02\): GHSA-aaaa-bbbb-cccc/);
});

test('PROPOSED waiver produces HOLD with exit 3, never approval wording', () => {
  const result = runGate('findings', HIGH_REPORT, [PROPOSED_WAIVER]);
  assert.equal(result.status, 3, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PROPOSED/);
  assert.match(result.stdout, /HOLD/);
  assert.ok(!/waived \(ratified/.test(result.stdout));
});

test('TAMPERED waiver package fails against the live report', () => {
  const tampered = { ...VALID_WAIVER, package: 'left-pad' };
  const result = runGate('findings', HIGH_REPORT, [tampered]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not match the live report/);
});

test('actual spawn ENOENT (npm missing from PATH) is an engine failure', () => {
  const emptyDir = mkdtempSync(path.join(tmpdir(), 'hive-empty-path-'));
  const waiverPath = makeWaivers([]);
  const result = spawnSync(process.execPath, [gate], {
    encoding: 'utf8',
    env: {
      HOME: process.env.HOME ?? '/root',
      PATH: emptyDir,
      HIVE_WAIVERS_PATH: waiverPath,
    },
  });
  assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /could not spawn npm/);
  assert.match(result.stderr, /ENOENT/);
});

test('INCONSISTENT summary counts are an engine failure', () => {
  const inconsistent = JSON.parse(HIGH_REPORT);
  inconsistent.metadata.vulnerabilities.high = 4;
  inconsistent.metadata.vulnerabilities.total = 4;
  const result = runGate('clean', JSON.stringify(inconsistent), []);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /does not reconcile/);
});

test('valid unwaived high finding fails with exit 1', () => {
  const result = runGate('findings', HIGH_REPORT, []);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unwaived high advisory GHSA-aaaa-bbbb-cccc/);
});

test('npm engine failure (empty stdout, exit 1) is an engine failure, never findings', () => {
  const result = runGate('engine-fail', '', [VALID_WAIVER]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /ENGINE FAILURE/);
});

test('registry error payload is an engine failure', () => {
  const result = runGate('registry-error', '', []);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /top-level error/);
});

test('malformed JSON is an engine failure', () => {
  const result = runGate('malformed', '', []);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not valid JSON/);
});

test('empty output is an engine failure', () => {
  const result = runGate('empty', '', []);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no output/);
});

test('unexpected exit code is an engine failure even with a clean-looking report', () => {
  const result = runGate('weird-exit', CLEAN_REPORT, []);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /exited 7/);
});

test('signal termination is an engine failure', () => {
  const result = runGate('signal', '', []);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /signal/i);
});

test('invalid report schema is an engine failure', () => {
  const result = runGate(
    'clean',
    JSON.stringify({ auditReportVersion: 1, vulnerabilities: {} }),
    [],
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /auditReportVersion/);
});

test('expired waiver fails so the retest happens', () => {
  const expired = { ...VALID_WAIVER, expires: '2026-08-02' };
  const result = runGate('findings', HIGH_REPORT, [expired]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /expired/);
});

test('duplicate waiver entries fail', () => {
  const result = runGate('findings', HIGH_REPORT, [VALID_WAIVER, VALID_WAIVER]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate/);
});

test('orphaned waiver fails when the advisory is no longer present', () => {
  const result = runGate('clean', CLEAN_REPORT, [VALID_WAIVER]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /orphaned waiver/);
});

test('malformed waiver fields fail', () => {
  const bad = { ...VALID_WAIVER, advisory: 'not-a-ghsa', owner: '' };
  const result = runGate('findings', HIGH_REPORT, [bad]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /malformed advisory id/);
  assert.match(result.stderr, /missing owner/);
});
