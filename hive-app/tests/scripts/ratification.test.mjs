import assert from 'node:assert/strict';
import { test } from 'node:test';

import { manifestSha256, sha256Hex, verifyRatification } from '../../scripts/lib/ratification.mjs';

const ENTRY_SUBSTANCE = {
  advisory: 'GHSA-test-0001-aaaa',
  package: 'demo',
  severity: 'high',
  owner: 'Kody',
  reason: 'synthetic ratification-test waiver',
  proposedOn: '2026-08-01',
  expires: '2026-12-01',
  retest: 'Recheck monthly and at expiry.',
};
const CANDIDATE = 'f'.repeat(40);
const LOCKFILE = '1'.repeat(64);
const RAW_AUDIT = '2'.repeat(64);

function makeWorld(overrides = {}) {
  const manifest = manifestSha256([{ ...ENTRY_SUBSTANCE, approvalStatus: 'ratified' }]);
  const decision = {
    approver: 'Kody',
    role: 'Security owner',
    action: 'waiver-ratification',
    manifestSha256: manifest,
    candidate: CANDIDATE,
    lockfileSha256: LOCKFILE,
    rawAuditSha256: RAW_AUDIT,
    destination: 'HIVE Milestone 0 audit lane',
    approvedAt: '2026-08-21T10:00:00Z',
    expires: '2026-12-01',
    ...overrides.decision,
  };
  const recordBuffer = Buffer.from(JSON.stringify(decision), 'utf8');
  const digest = sha256Hex(recordBuffer);
  const entry = {
    ...ENTRY_SUBSTANCE,
    approvalStatus: 'ratified',
    ratifiedOn: '2026-08-21',
    ratifiedBy: 'Kody',
    approvalReference: 'Decision record of 2026-08-21',
    decisionRecordPath: 'security/decisions/waivers-2026-08-21.json',
    decisionRecordDigest: digest,
    lockfileSha256: LOCKFILE,
    ...overrides.entry,
  };
  const context = {
    readFile: (path) =>
      path === entry.decisionRecordPath ? (overrides.storedRecord ?? recordBuffer) : null,
    todayIso: '2026-08-21',
    expectedAction: 'waiver-ratification',
    manifestSha256: manifest,
    currentLockfileSha256: LOCKFILE,
    currentRawAuditSha256: RAW_AUDIT,
    candidateSha: CANDIDATE,
    approvalDigests: new Set([digest]),
    ...overrides.context,
  };
  return { entry, context, decision, digest };
}

test('a fully bound, out-of-band-anchored ratification verifies', () => {
  const { entry, context } = makeWorld();
  assert.deepEqual(verifyRatification(entry, context), []);
});

test('NEGATIVE: an arbitrary actor (Mallory) is rejected even with a consistent record', () => {
  const { entry, context } = makeWorld({
    decision: { approver: 'Mallory' },
    entry: { ratifiedBy: 'Mallory' },
  });
  const problems = verifyRatification(entry, context);
  assert.ok(problems.some((p) => p.includes('not an authorized approver')));
});

test('NEGATIVE: a fabricated all-zero digest fails (record resolves but digest mismatches)', () => {
  const { entry, context } = makeWorld({ entry: { decisionRecordDigest: '0'.repeat(64) } });
  const problems = verifyRatification(entry, context);
  assert.ok(problems.some((p) => p.includes('digest mismatch')));
});

test('NEGATIVE: a missing decision record fails', () => {
  const { entry, context } = makeWorld({ context: { readFile: () => null } });
  const problems = verifyRatification(entry, context);
  assert.ok(problems.some((p) => p.includes('does not exist')));
});

test('NEGATIVE: a mutated decision record invalidates the approval', () => {
  const base = makeWorld();
  const mutated = Buffer.from(
    JSON.stringify({ ...base.decision, destination: 'somewhere else' }),
    'utf8',
  );
  const { entry, context } = makeWorld({ storedRecord: mutated });
  const problems = verifyRatification(entry, context);
  assert.ok(problems.some((p) => p.includes('digest mismatch')));
});

test('NEGATIVE: without the out-of-band digest, an internally consistent repo record is NOT authority', () => {
  const { entry, context } = makeWorld({ context: { approvalDigests: new Set() } });
  const problems = verifyRatification(entry, context);
  assert.ok(problems.some((p) => p.includes('out-of-band')));
});

test('NEGATIVE: wrong candidate, wrong manifest, wrong lockfile, wrong raw-audit digest all fail', () => {
  const wrongCandidate = makeWorld({ context: { candidateSha: 'e'.repeat(40) } });
  assert.ok(
    verifyRatification(wrongCandidate.entry, wrongCandidate.context).some((p) =>
      p.includes('not the one under verification'),
    ),
  );
  const wrongManifest = makeWorld({ context: { manifestSha256: '9'.repeat(64) } });
  assert.ok(
    verifyRatification(wrongManifest.entry, wrongManifest.context).some((p) =>
      p.includes('material change invalidates'),
    ),
  );
  const wrongLockfile = makeWorld({ context: { currentLockfileSha256: '8'.repeat(64) } });
  assert.ok(
    verifyRatification(wrongLockfile.entry, wrongLockfile.context).some((p) =>
      p.includes('lockfile'),
    ),
  );
  const wrongAudit = makeWorld({ context: { currentRawAuditSha256: '7'.repeat(64) } });
  assert.ok(
    verifyRatification(wrongAudit.entry, wrongAudit.context).some((p) => p.includes('raw-audit')),
  );
});

test('NEGATIVE: wrong action and record/entry date-expiry mismatches fail', () => {
  const wrongAction = makeWorld({ context: { expectedAction: 'history-exception-ratification' } });
  assert.ok(
    verifyRatification(wrongAction.entry, wrongAction.context).some((p) => p.includes('action')),
  );
  const dateMismatch = makeWorld({ entry: { ratifiedOn: '2026-08-20' } });
  assert.ok(
    verifyRatification(dateMismatch.entry, dateMismatch.context).some((p) =>
      p.includes('approvedAt'),
    ),
  );
});

test('the manifest digest ignores ratification fields but tracks substance', () => {
  const proposed = [{ ...ENTRY_SUBSTANCE, approvalStatus: 'proposed' }];
  const ratified = [
    {
      ...ENTRY_SUBSTANCE,
      approvalStatus: 'ratified',
      ratifiedOn: '2026-08-21',
      ratifiedBy: 'Kody',
      decisionRecordPath: 'security/decisions/x.json',
      decisionRecordDigest: 'a'.repeat(64),
      lockfileSha256: 'b'.repeat(64),
    },
  ];
  assert.equal(manifestSha256(proposed), manifestSha256(ratified));
  const edited = [{ ...ENTRY_SUBSTANCE, approvalStatus: 'proposed', severity: 'critical' }];
  assert.notEqual(manifestSha256(proposed), manifestSha256(edited));
});
