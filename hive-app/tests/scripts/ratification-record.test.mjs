/** The ratification-record tooling must produce exactly what the real
 * verifier accepts, and nothing the approval model forbids. Proven here
 * against the LIVE allowlist and the real `verifyRatification`, with a
 * record that exists only in memory: nothing is ratified by running this. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { manifestSha256, verifyRatification } from '../../scripts/lib/ratification.mjs';
import {
  ALLOWLIST_PATH,
  APPROVER,
  HISTORY_EXCEPTION_ACTION,
  applyRatification,
  buildHistoryExceptionRecord,
  isInsideRepo,
  verificationCommands,
} from '../../scripts/ratification-record.mjs';

const CANDIDATE = 'a'.repeat(40);
const readLive = () => JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')).entries;
/** The live entries' SUBSTANCE viewed as proposed. The allowlist was
 * ratified on 2026-09-07, so these tests strip the provenance the flip
 * adds and re-prove the draft/apply/verify mechanics on exactly the same
 * blobs, paths, patterns, counts, and expiry — state-independent, and the
 * manifest digest (substance only) is identical either way. */
const liveEntries = () =>
  readLive().map(
    ({ ratifiedOn: _on, ratifiedBy: _by, decisionRecordDigest: _digest, ...entry }) => ({
      ...entry,
      approvalStatus: 'proposed',
      approvalReference: 'proposed view for the tooling tests',
    }),
  );

test('a drafted record, applied, verifies against the real verifier for every live entry', () => {
  const entries = liveEntries();
  assert.ok(entries.length > 0);
  const built = buildHistoryExceptionRecord({
    entries,
    candidate: CANDIDATE,
    approvedAt: '2026-09-06T21:00:00Z',
  });
  assert.equal(built.problem, undefined);
  const applied = applyRatification(entries, { digest: built.digest, ratifiedOn: '2026-09-06' });
  assert.equal(applied.flipped, entries.length);
  // Exactly the context secrets:scan builds, with the record supplied
  // out-of-band under the digest the approver states.
  const context = {
    approvalRecords: new Map([[built.digest, built.bytes]]),
    todayIso: '2026-09-06',
    expectedAction: HISTORY_EXCEPTION_ACTION,
    manifestSha256: manifestSha256(applied.entries),
    candidateSha: CANDIDATE,
    approvalDigests: new Set([built.digest]),
  };
  for (const entry of applied.entries) {
    assert.deepEqual(
      verifyRatification(entry, context),
      [],
      `entry ${entry.blob}:${entry.pattern}`,
    );
  }
});

test('the flip changes no substance: the manifest digest is identical before and after', () => {
  const entries = liveEntries();
  const built = buildHistoryExceptionRecord({
    entries,
    candidate: CANDIDATE,
    approvedAt: '2026-09-06T21:00:00Z',
  });
  const applied = applyRatification(entries, { digest: built.digest, ratifiedOn: '2026-09-06' });
  assert.equal(manifestSha256(applied.entries), manifestSha256(entries));
  assert.equal(built.record.manifestSha256, manifestSha256(entries));
});

test('the record is deterministic: same inputs, same bytes, same digest', () => {
  const entries = liveEntries();
  const a = buildHistoryExceptionRecord({
    entries,
    candidate: CANDIDATE,
    approvedAt: '2026-09-06T21:00:00Z',
  });
  const b = buildHistoryExceptionRecord({
    entries,
    candidate: CANDIDATE,
    approvedAt: '2026-09-06T21:00:00Z',
  });
  assert.equal(a.digest, b.digest);
  assert.ok(a.bytes.equals(b.bytes));
  // And any material change moves it.
  const c = buildHistoryExceptionRecord({
    entries,
    candidate: 'b'.repeat(40),
    approvedAt: '2026-09-06T21:00:00Z',
  });
  assert.notEqual(a.digest, c.digest);
});

test('NEGATIVE: the verifier rejects a record whose candidate or date drifted from the entries', () => {
  const entries = liveEntries();
  const built = buildHistoryExceptionRecord({
    entries,
    candidate: CANDIDATE,
    approvedAt: '2026-09-06T21:00:00Z',
  });
  const applied = applyRatification(entries, { digest: built.digest, ratifiedOn: '2026-09-07' });
  const context = {
    approvalRecords: new Map([[built.digest, built.bytes]]),
    todayIso: '2026-09-07',
    expectedAction: HISTORY_EXCEPTION_ACTION,
    manifestSha256: manifestSha256(applied.entries),
    candidateSha: 'c'.repeat(40),
    approvalDigests: new Set([built.digest]),
  };
  const problems = verifyRatification(applied.entries[0], context);
  assert.ok(problems.some((p) => p.includes('approvedAt')));
  assert.ok(problems.some((p) => p.includes('candidate')));
});

test('NEGATIVE: the tooling refuses what the model forbids', () => {
  assert.match(
    buildHistoryExceptionRecord({
      entries: [],
      candidate: CANDIDATE,
      approvedAt: '2026-09-06T21:00:00Z',
    }).problem,
    /no entries/,
  );
  const mixed = liveEntries().map((e, i) => (i === 0 ? { ...e, expiry: '2027-01-01' } : e));
  assert.match(
    buildHistoryExceptionRecord({
      entries: mixed,
      candidate: CANDIDATE,
      approvedAt: '2026-09-06T21:00:00Z',
    }).problem,
    /one expiry/,
  );
  assert.match(
    buildHistoryExceptionRecord({
      entries: liveEntries(),
      candidate: 'HEAD',
      approvedAt: '2026-09-06T21:00:00Z',
    }).problem,
    /40-hex/,
  );
  assert.match(
    applyRatification(liveEntries(), { digest: 'abc', ratifiedOn: '2026-09-06' }).problem,
    /sha256/,
  );
  assert.match(
    applyRatification(liveEntries(), { digest: 'a'.repeat(64), ratifiedOn: 'today' }).problem,
    /YYYY-MM-DD/,
  );
  // A record inside the repository is refused by the loader; the drafter
  // applies the same containment rule (and it is not prefix-confused).
  assert.ok(isInsideRepo('/repo', '/repo/security/x.json'));
  assert.ok(isInsideRepo('/repo/', '/repo'));
  assert.ok(!isInsideRepo('/repo', '/repo-evil/x.json'));
  assert.ok(!isInsideRepo('/repo', '/tmp/x.json'));
});

test('apply is idempotent and leaves already-ratified entries alone', () => {
  const entries = liveEntries();
  const once = applyRatification(entries, { digest: 'a'.repeat(64), ratifiedOn: '2026-09-06' });
  const twice = applyRatification(once.entries, {
    digest: 'b'.repeat(64),
    ratifiedOn: '2026-09-07',
  });
  assert.equal(twice.flipped, 0);
  assert.deepEqual(twice.entries, once.entries);
  assert.ok(
    once.entries.every((e) => e.ratifiedBy === APPROVER && e.approvalStatus === 'ratified'),
  );
});

test('NEGATIVE: the LIVE ratified entries prove nothing without their out-of-band record', () => {
  const live = readLive();
  assert.ok(live.length > 0 && live.every((e) => e.approvalStatus === 'ratified'));
  const context = {
    approvalRecords: new Map(),
    todayIso: '2026-09-07',
    expectedAction: HISTORY_EXCEPTION_ACTION,
    manifestSha256: manifestSha256(live),
    candidateSha: 'c'.repeat(40),
    approvalDigests: new Set(),
  };
  for (const entry of live) {
    const problems = verifyRatification(entry, context);
    assert.ok(
      problems.some((p) => /no out-of-band decision record/.test(p)),
      `entry ${entry.blob}:${entry.pattern}: ${JSON.stringify(problems)}`,
    );
  }
  // And the substance the record binds is unchanged by the flip.
  assert.equal(manifestSha256(live), manifestSha256(liveEntries()));
});

test('the verification commands carry all three out-of-band anchors', () => {
  const commands = verificationCommands({
    candidate: CANDIDATE,
    recordPath: '/outside/record.json',
    digest: 'd'.repeat(64),
  });
  for (const cmd of [commands.bash, commands.powershell]) {
    assert.ok(cmd.includes(`HIVE_CANDIDATE_SHA`) && cmd.includes(CANDIDATE));
    assert.ok(cmd.includes(`HIVE_APPROVAL_RECORDS`) && cmd.includes('/outside/record.json'));
    assert.ok(cmd.includes(`HIVE_APPROVAL_DIGESTS`) && cmd.includes('d'.repeat(64)));
    assert.ok(cmd.endsWith('npm run secrets:scan'));
  }
});
