/** Integration tests for the audit gate against a fake npm executable
 * (PM directive P1 item 6): engine failure, registry failure, malformed
 * output, empty output, signal termination, clean report, valid waived
 * finding, and valid unwaived finding. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { manifestSha256 } from '../../scripts/lib/ratification.mjs';

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

// Ratified waivers are bound to the CURRENT lockfile digest — computed
// here exactly as the gate computes it.
const REAL_LOCKFILE_SHA256 = createHash('sha256')
  .update(readFileSync(path.join(appRoot, 'package-lock.json')))
  .digest('hex');

// ---------------------------------------------------------------------------
// RETURN-4 P1-6: a ratified waiver must resolve to a REAL decision record,
// and that record's digest must ALSO arrive out-of-band. The harness builds
// a complete, internally consistent approval world so the verified path is
// exercised end to end — and each negative removes exactly one binding.
// ---------------------------------------------------------------------------

// RETURN-5 ruling: the approver's decision record lives OUTSIDE the
// repository and is supplied out-of-band (HIVE_APPROVAL_RECORDS) together
// with its digest (HIVE_APPROVAL_DIGESTS). The fixture therefore writes to
// a temp directory, never into the working tree — and one negative proves
// that a record placed inside the repository is refused outright.
const DECISION_DIR = mkdtempSync(path.join(tmpdir(), 'hive-approval-'));
const DECISION_ABS = path.join(DECISION_DIR, 'waivers-approval.json');
const CANDIDATE_SHA = 'f'.repeat(40);

const RAW_AUDIT_SHA256 = createHash('sha256')
  .update(readFileSync(path.join(appRoot, 'security', 'evidence', 'npm-audit-current.json')))
  .digest('hex');

const VALID_WAIVER = {
  advisory: 'GHSA-aaaa-bbbb-cccc',
  package: 'demo',
  severity: 'high',
  owner: 'Kody',
  reason: 'synthetic integration-test waiver',
  approvalStatus: 'ratified',
  proposedOn: '2026-08-01',
  ratifiedOn: '2026-08-02',
  ratifiedBy: 'Kody',
  approvalReference: 'Synthetic written ratification record for integration tests',
  decisionRecordDigest: 'a'.repeat(64),
  lockfileSha256: REAL_LOCKFILE_SHA256,
  expires: '2099-01-01',
  retest: 'Recheck monthly, on lockfile or Expo change, before any RC, and at expiry.',
};

const PROPOSED_WAIVER = {
  ...VALID_WAIVER,
  approvalStatus: 'proposed',
  ratifiedOn: undefined,
};

function runGate(mode, report, waivers, approval = {}) {
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
      HIVE_CANDIDATE_SHA: approval.candidateSha ?? CANDIDATE_SHA,
      HIVE_APPROVAL_DIGESTS: approval.digests ?? '',
      HIVE_APPROVAL_RECORDS: approval.records ?? '',
    },
  });
  return result;
}

/** Build the complete approval world for one waiver set: write the
 * decision record, return the ratified waiver bound to it plus the
 * out-of-band digest. `decisionOverrides` breaks exactly one binding. */
function withApproval(waiverOverrides = {}, decisionOverrides = {}) {
  const waiver = { ...VALID_WAIVER, ...waiverOverrides };
  const substance = manifestSha256([waiver]);
  const decision = {
    approver: 'Kody',
    role: 'Security owner (synthetic integration fixture)',
    action: 'waiver-ratification',
    manifestSha256: substance,
    candidate: CANDIDATE_SHA,
    lockfileSha256: REAL_LOCKFILE_SHA256,
    rawAuditSha256: RAW_AUDIT_SHA256,
    destination: 'HIVE Milestone 0 audit lane (synthetic integration fixture)',
    approvedAt: `${waiver.ratifiedOn}T10:00:00Z`,
    expires: waiver.expires,
    ...decisionOverrides,
  };
  const raw = Buffer.from(JSON.stringify(decision), 'utf8');
  writeFileSync(DECISION_ABS, raw);
  const digest = createHash('sha256').update(raw).digest('hex');
  return {
    waiver: { ...waiver, decisionRecordDigest: digest },
    digest,
    decision,
    records: DECISION_ABS,
  };
}

function clearApproval() {
  rmSync(DECISION_ABS, { force: true });
}

test('clean report with no waivers passes', () => {
  const result = runGate('clean', CLEAN_REPORT, []);
  assert.equal(result.status, 0, result.stderr);
});

test('RATIFIED waived high finding passes ONLY with a verifiable decision record', () => {
  try {
    const { waiver, digest } = withApproval();
    const result = runGate('findings', HIGH_REPORT, [waiver], {
      digests: digest,
      records: DECISION_ABS,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /waived \(ratified 2026-08-02/);
    assert.match(result.stdout, /GHSA-aaaa-bbbb-cccc/);
  } finally {
    clearApproval();
  }
});

test('NEGATIVE: a self-declared ratification with NO record supplied fails (a repo field is not authority)', () => {
  clearApproval();
  const result = runGate('findings', HIGH_REPORT, [VALID_WAIVER], { digests: 'a'.repeat(64) });
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /no out-of-band decision record/);
});

test('NEGATIVE: without the OUT-OF-BAND digest an internally consistent record does not clear HOLD', () => {
  try {
    const { waiver } = withApproval();
    const result = runGate('findings', HIGH_REPORT, [waiver], { digests: '' });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /out-of-band/);
  } finally {
    clearApproval();
  }
});

test('NEGATIVE: a decision record MUTATED after ratification invalidates the approval', () => {
  try {
    const { waiver, digest } = withApproval();
    // Same path, different bytes. The loader keys records by their COMPUTED
    // digest, so the edited file no longer answers to the approved one.
    writeFileSync(
      DECISION_ABS,
      JSON.stringify({ approver: 'Kody', destination: 'somewhere else entirely' }),
    );
    const result = runGate('findings', HIGH_REPORT, [waiver], {
      digests: digest,
      records: DECISION_ABS,
    });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /no out-of-band decision record/);
  } finally {
    clearApproval();
  }
});

test('NEGATIVE: a decision record committed INSIDE the repository is refused (RETURN-5)', () => {
  try {
    const { waiver, digest } = withApproval();
    // Copy the byte-identical, fully valid record into the working tree and
    // point the gate at it there. It must be refused for its LOCATION, not
    // its contents — that is what keeps approval outside the artifact.
    const inRepo = path.join(appRoot, 'security', 'in-repo-approval-fixture.json');
    writeFileSync(inRepo, readFileSync(DECISION_ABS));
    try {
      const result = runGate('findings', HIGH_REPORT, [waiver], {
        digests: digest,
        records: inRepo,
      });
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stderr, /inside the repository/);
    } finally {
      rmSync(inRepo, { force: true });
    }
  } finally {
    clearApproval();
  }
});

test('NEGATIVE: an approval for a DIFFERENT candidate does not approve this one', () => {
  try {
    const { waiver, digest } = withApproval({}, { candidate: 'e'.repeat(40) });
    const result = runGate('findings', HIGH_REPORT, [waiver], {
      digests: digest,
      records: DECISION_ABS,
    });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /not the one under verification/);
  } finally {
    clearApproval();
  }
});

test('NEGATIVE: an unauthorized approver cannot ratify, however consistent the record', () => {
  try {
    const { waiver, digest } = withApproval({ ratifiedBy: 'Mallory' }, { approver: 'Mallory' });
    const result = runGate('findings', HIGH_REPORT, [waiver], {
      digests: digest,
      records: DECISION_ABS,
    });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /not an authorized approver/);
  } finally {
    clearApproval();
  }
});

test('NEGATIVE: an approval bound to a DIFFERENT raw-audit archive fails', () => {
  try {
    const { waiver, digest } = withApproval({}, { rawAuditSha256: '7'.repeat(64) });
    const result = runGate('findings', HIGH_REPORT, [waiver], {
      digests: digest,
      records: DECISION_ABS,
    });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /raw-audit digest/);
  } finally {
    clearApproval();
  }
});

test('PROPOSED waiver produces HOLD with exit 3, never approval wording', () => {
  const result = runGate('findings', HIGH_REPORT, [PROPOSED_WAIVER]);
  assert.equal(result.status, 3, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PROPOSED/);
  assert.match(result.stdout, /HOLD/);
  assert.ok(!/waived \(ratified/.test(result.stdout));
});

test('TAMPERED waiver package fails against the live report', () => {
  try {
    // A fully approved world, then the package is edited: the finding no
    // longer matches the live report AND the manifest digest no longer
    // matches what was approved.
    const { waiver, digest } = withApproval();
    const tampered = { ...waiver, package: 'left-pad' };
    const result = runGate('findings', HIGH_REPORT, [tampered], {
      digests: digest,
      records: DECISION_ABS,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /does not match the live report/);
    assert.match(result.stderr, /material change invalidates the approval/);
  } finally {
    clearApproval();
  }
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
  try {
    const { waiver, digest } = withApproval();
    const result = runGate('clean', CLEAN_REPORT, [waiver], {
      digests: digest,
      records: DECISION_ABS,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /orphaned waiver/);
  } finally {
    clearApproval();
  }
});

test('malformed waiver fields fail', () => {
  const bad = { ...VALID_WAIVER, advisory: 'not-a-ghsa', owner: '' };
  const result = runGate('findings', HIGH_REPORT, [bad]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /malformed advisory id/);
  assert.match(result.stderr, /missing owner/);
});

test('a ratified waiver bound to a DIFFERENT lockfile digest fails (re-approval required)', () => {
  try {
    const { waiver, digest } = withApproval({ lockfileSha256: 'b'.repeat(64) });
    const result = runGate('findings', HIGH_REPORT, [waiver], {
      digests: digest,
      records: DECISION_ABS,
    });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /different lockfile digest/);
  } finally {
    clearApproval();
  }
});
