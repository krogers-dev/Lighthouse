import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  loadApprovalRecords,
  manifestSha256,
  sha256Hex,
  verifyRatification,
} from '../../scripts/lib/ratification.mjs';

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
    decisionRecordDigest: digest,
    lockfileSha256: LOCKFILE,
    ...overrides.entry,
  };
  const stored = overrides.storedRecord ?? recordBuffer;
  const context = {
    // Supplied OUT-OF-BAND, keyed by the digest the approver stated.
    approvalRecords: new Map([[digest, stored]]),
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

test('NEGATIVE: a fabricated all-zero digest matches no supplied record', () => {
  const { entry, context } = makeWorld({ entry: { decisionRecordDigest: '0'.repeat(64) } });
  const problems = verifyRatification(entry, context);
  assert.ok(
    problems.some((p) => p.includes('no out-of-band decision record')),
    JSON.stringify(problems),
  );
});

test('NEGATIVE: a malformed digest is rejected before any lookup', () => {
  for (const bad of [undefined, '', 'abc123', 'A'.repeat(64)]) {
    const { entry, context } = makeWorld({ entry: { decisionRecordDigest: bad } });
    assert.ok(
      verifyRatification(entry, context).some((p) => p.includes('must be a sha256 hex digest')),
      `expected rejection for ${JSON.stringify(bad)}`,
    );
  }
});

test('NEGATIVE: an entry claiming ratification with NO record supplied fails', () => {
  const { entry, context } = makeWorld({ context: { approvalRecords: new Map() } });
  const problems = verifyRatification(entry, context);
  assert.ok(
    problems.some((p) => p.includes('no out-of-band decision record')),
    JSON.stringify(problems),
  );
});

test('NEGATIVE: an entry may not name a record path — that is the in-repo model', () => {
  const { entry, context } = makeWorld({
    entry: { decisionRecordPath: 'security/decisions/waivers-2026-08-21.json' },
  });
  const problems = verifyRatification(entry, context);
  assert.ok(
    problems.some((p) => p.includes('decisionRecordPath is no longer accepted')),
    JSON.stringify(problems),
  );
});

test('NEGATIVE: a record edited after approval no longer matches its digest', () => {
  const base = makeWorld();
  const mutated = Buffer.from(
    JSON.stringify({ ...base.decision, destination: 'somewhere else' }),
    'utf8',
  );
  const { entry, context } = makeWorld({ storedRecord: mutated });
  const problems = verifyRatification(entry, context);
  assert.ok(problems.some((p) => p.includes('digest mismatch')));
});

test('NEGATIVE: supplying the record file without stating its digest is not authority', () => {
  const { entry, context } = makeWorld({ context: { approvalDigests: new Set() } });
  const problems = verifyRatification(entry, context);
  assert.ok(
    problems.some((p) => p.includes('not presented out-of-band')),
    JSON.stringify(problems),
  );
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
      decisionRecordDigest: 'a'.repeat(64),
      lockfileSha256: 'b'.repeat(64),
    },
  ];
  assert.equal(manifestSha256(proposed), manifestSha256(ratified));
  const edited = [{ ...ENTRY_SUBSTANCE, approvalStatus: 'proposed', severity: 'critical' }];
  assert.notEqual(manifestSha256(proposed), manifestSha256(edited));
});

// ---------------------------------------------------------------------------
// RETURN-5 ruling: approval material must live OUTSIDE the repository
// ---------------------------------------------------------------------------

test('the loader keys supplied records by their computed digest', () => {
  const body = Buffer.from('{"approver":"Kody"}', 'utf8');
  const { records, problems } = loadApprovalRecords('/outside/approval.json', {
    realpath: (p) => p,
    readFile: () => body,
    repoRoot: '/repo',
  });
  assert.deepEqual(problems, []);
  assert.equal(records.get(sha256Hex(body)), body);
});

test('NEGATIVE: a decision record INSIDE the repository is refused before it is read', () => {
  let read = false;
  const { records, problems } = loadApprovalRecords('/repo/security/decisions/approval.json', {
    realpath: (p) => p,
    readFile: () => {
      read = true;
      return Buffer.from('{}');
    },
    repoRoot: '/repo',
  });
  assert.equal(records.size, 0);
  assert.ok(
    problems.some((p) => p.includes('inside the repository')),
    JSON.stringify(problems),
  );
  assert.equal(read, false, 'an in-repo record is refused without being read');
});

test('repository containment is path-exact, not a string prefix', () => {
  // `/repo-evil` is not inside `/repo` — the same class of bug as the
  // approved-origin suffix hosts.
  const body = Buffer.from('{}', 'utf8');
  const io = { realpath: (p) => p, readFile: () => body, repoRoot: '/repo' };
  assert.deepEqual(loadApprovalRecords('/repo-evil/approval.json', io).problems, []);
  assert.equal(loadApprovalRecords('/repo-evil/approval.json', io).records.size, 1);
  // A trailing slash on the root does not change containment.
  assert.ok(
    loadApprovalRecords('/repo/approval.json', { ...io, repoRoot: '/repo/' }).problems.some((p) =>
      p.includes('inside the repository'),
    ),
  );
  // The repository root itself is inside the repository.
  assert.ok(
    loadApprovalRecords('/repo', io).problems.some((p) => p.includes('inside the repository')),
  );
});

test('NEGATIVE: missing and unreadable records are reported, not skipped', () => {
  const missing = loadApprovalRecords('/outside/gone.json', {
    realpath: () => {
      throw new Error('ENOENT');
    },
    readFile: () => Buffer.from('{}'),
    repoRoot: '/repo',
  });
  assert.ok(missing.problems.some((p) => p.includes('does not exist')));
  const unreadable = loadApprovalRecords('/outside/locked.json', {
    realpath: (p) => p,
    readFile: () => {
      throw new Error('EACCES');
    },
    repoRoot: '/repo',
  });
  assert.ok(unreadable.problems.some((p) => p.includes('unreadable')));
});

test('an empty or absent HIVE_APPROVAL_RECORDS supplies nothing, without error', () => {
  const io = { realpath: (p) => p, readFile: () => Buffer.from('{}'), repoRoot: '/repo' };
  for (const spec of [undefined, '', '   ', ',,']) {
    const { records, problems } = loadApprovalRecords(spec, io);
    assert.equal(records.size, 0);
    assert.deepEqual(problems, []);
  }
});
