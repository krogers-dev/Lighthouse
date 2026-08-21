import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RELEASE_ONLY_PATTERNS,
  SECRET_PATTERNS,
  allowlistHolds,
  isAllowed,
  looksBinary,
  reconcileHistoryAllowlist,
  scanText,
  validateAllowlist,
} from '../../scripts/lib/secret-patterns.mjs';

// All secret-shaped inputs are assembled at runtime (never literals).
const jwt = ['eyJsyntheticA', 'eyJsyntheticB', 'signature99'].join('.');
const sbSecret = 'sb_' + 'secret_' + 'syntheticsynthetic';
const pem = ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ');

test('detects each secret class with line numbers', () => {
  const text = `line one\n${jwt}\nplain\n${sbSecret}\n${pem}\n`;
  const findings = scanText(text, SECRET_PATTERNS, 'file.txt');
  const byPattern = new Map(findings.map((f) => [f.pattern, f]));
  assert.equal(byPattern.get('jwt-shaped-token')?.line, 2);
  assert.equal(byPattern.get('supabase-secret-key')?.line, 4);
  assert.equal(byPattern.get('private-key-block')?.line, 5);
});

test('never includes the matched value in findings', () => {
  const findings = scanText(sbSecret, SECRET_PATTERNS, 'file.txt');
  for (const finding of findings) {
    assert.ok(!JSON.stringify(finding).includes('syntheticsynthetic'));
  }
});

test('does not flag publishable keys or prose mentions of service_role', () => {
  const clean = 'sb_publishable_syntheticsynthetic and the service_role stays server-side';
  assert.deepEqual(scanText(clean, SECRET_PATTERNS, 'x'), []);
});

test('flags populated secret-ish env lines but not empty ones', () => {
  const findings = scanText('MY_SERVICE_KEY=value123\nOTHER_SECRET=\n', SECRET_PATTERNS, '.env');
  assert.equal(findings.filter((f) => f.pattern === 'generic-secret-env').length, 1);
});

test('release-only patterns catch loopback and development identifiers', () => {
  const text = 'http://127.0.0.1:54321 plus com.myhbcfo.hive.development';
  const patterns = scanText(text, RELEASE_ONLY_PATTERNS, 'bundle.js').map((f) => f.pattern);
  assert.ok(patterns.includes('loopback-endpoint'));
  assert.ok(patterns.includes('development-identifier'));
});

// ---------------------------------------------------------------------------
// History-exception gate (P2-10 hardened)
// ---------------------------------------------------------------------------

const BLOB_A = 'a'.repeat(40);
const BLOB_B = 'b'.repeat(40);

function validEntry(overrides = {}) {
  return {
    blob: BLOB_A,
    path: 'hive-app/src/x.test.ts',
    pattern: 'jwt-shaped-token',
    expectedCount: 1,
    owner: 'Kody',
    reason: 'Labeled synthetic historical test value, replaced by runtime concatenation.',
    approvalStatus: 'ratified',
    approvalReference: 'Synthetic unit-test ratification record',
    proposedOn: '2026-08-20',
    ratifiedOn: '2026-08-21',
    expiry: '2026-11-21',
    retest: 'Re-run secrets:scan monthly and at expiry.',
    ...overrides,
  };
}

const TODAY = '2026-08-21';

test('tracked findings (no blob) are never allowlisted', () => {
  // Hardened rule: current files must be fixed, not excepted.
  const entry = validEntry();
  assert.ok(!isAllowed({ file: 'hive-app/src/x.test.ts', pattern: 'jwt-shaped-token' }, [entry]));
});

test('history exceptions require the exact (blob, path, pattern) triple', () => {
  const entry = validEntry();
  const finding = {
    file: `history:${BLOB_A.slice(0, 12)}:hive-app/src/x.test.ts`,
    blob: BLOB_A,
    blobPath: 'hive-app/src/x.test.ts',
    pattern: 'jwt-shaped-token',
  };
  assert.ok(isAllowed(finding, [entry]));
  // A prefix of the blob id no longer matches — full 40-hex equality only.
  assert.ok(!isAllowed({ ...finding, blob: BLOB_A.slice(0, 12) }, [entry]));
  assert.ok(!isAllowed({ ...finding, blob: BLOB_B }, [entry]));
  assert.ok(!isAllowed({ ...finding, blobPath: 'hive-app/src/other.ts' }, [entry]));
  assert.ok(!isAllowed({ ...finding, pattern: 'supabase-secret-key' }, [entry]));
});

test('validateAllowlist accepts a fully specified entry', () => {
  assert.deepEqual(validateAllowlist([validEntry()], TODAY), []);
});

test('validateAllowlist rejects malformed entries field by field', () => {
  const cases = [
    [{ blob: BLOB_A.slice(0, 12) }, /full 40-character/],
    [{ blob: BLOB_A.toUpperCase() }, /full 40-character/],
    [{ path: '' }, /path/],
    [{ pattern: 'not-a-real-pattern' }, /pattern/],
    [{ expectedCount: 0 }, /expectedCount/],
    [{ expectedCount: 1.5 }, /expectedCount/],
    [{ expectedCount: undefined }, /expectedCount/],
    [{ owner: '' }, /owner/],
    [{ reason: 'too short' }, /reason/],
    [{ approvalStatus: 'maybe' }, /approvalStatus/],
    [{ approvalReference: '' }, /approvalReference/],
    [{ proposedOn: 'yesterday' }, /proposedOn/],
    [{ proposedOn: '2026-02-30' }, /real calendar date/],
    [{ expiry: 'never' }, /expiry/],
    [{ expiry: '2026-13-01' }, /real calendar date/],
    [{ retest: '' }, /retest/],
  ];
  for (const [override, expected] of cases) {
    const problems = validateAllowlist([validEntry(override)], TODAY);
    assert.ok(
      problems.some((p) => expected.test(p)),
      `expected a problem matching ${expected} for ${JSON.stringify(override)}; got ${JSON.stringify(problems)}`,
    );
  }
});

test('a free-text approval string is not an approval state', () => {
  const problems = validateAllowlist(
    [validEntry({ approvalStatus: 'Kody ratification pending per directive' })],
    TODAY,
  );
  assert.ok(problems.some((p) => p.includes('approvalStatus')));
});

test('ratified entries require a real ratifiedOn no earlier than proposedOn', () => {
  const missing = validateAllowlist([validEntry({ ratifiedOn: undefined })], TODAY);
  assert.ok(missing.some((p) => p.includes('ratifiedOn')));
  const before = validateAllowlist([validEntry({ ratifiedOn: '2026-08-19' })], TODAY);
  assert.ok(before.some((p) => p.includes('precede')));
});

test('PROPOSED entries validate but surface as HOLD lines', () => {
  const proposed = validEntry({ approvalStatus: 'proposed', ratifiedOn: undefined });
  assert.deepEqual(validateAllowlist([proposed], TODAY), []);
  const holds = allowlistHolds([proposed]);
  assert.equal(holds.length, 1);
  assert.match(holds[0], /PROPOSED/);
  assert.match(holds[0], /ratification/);
  assert.deepEqual(allowlistHolds([validEntry()]), []);
});

test('validateAllowlist rejects expired entries and expiry not after proposedOn', () => {
  const expired = validateAllowlist([validEntry({ expiry: '2026-08-21' })], TODAY);
  assert.ok(expired.some((p) => /expired|not after/.test(p)));
  const inverted = validateAllowlist(
    [validEntry({ proposedOn: '2026-12-01', ratifiedOn: '2026-12-01', expiry: '2026-11-21' })],
    TODAY,
  );
  assert.ok(inverted.some((p) => /after proposedOn/.test(p)));
});

test('validateAllowlist rejects duplicate (blob, path, pattern) entries', () => {
  const problems = validateAllowlist([validEntry(), validEntry()], TODAY);
  assert.ok(problems.some((p) => /duplicate/.test(p)));
});

test('reconcileHistoryAllowlist covers exact counts and flags drift', () => {
  const finding = {
    file: `history:${BLOB_A.slice(0, 12)}:hive-app/src/x.test.ts`,
    blob: BLOB_A,
    blobPath: 'hive-app/src/x.test.ts',
    pattern: 'jwt-shaped-token',
  };
  // Exact expected count: covered, no problems.
  const ok = reconcileHistoryAllowlist([finding], [validEntry()]);
  assert.deepEqual(ok.uncovered, []);
  assert.deepEqual(ok.problems, []);
  // More occurrences than recorded: count drift fails the gate.
  const drift = reconcileHistoryAllowlist([finding, { ...finding }], [validEntry()]);
  assert.ok(drift.problems.some((p) => /expected 1.*found 2/.test(p)));
});

test('reconcileHistoryAllowlist rejects orphaned (unused) entries', () => {
  // An entry whose blob/pattern no longer matches anything is dead policy
  // and must fail loudly instead of lingering.
  const { problems } = reconcileHistoryAllowlist([], [validEntry()]);
  assert.ok(problems.some((p) => /orphan/.test(p)));
});

test('reconcileHistoryAllowlist reports unmatched findings as uncovered', () => {
  const finding = {
    file: `history:${BLOB_B.slice(0, 12)}:hive-app/src/y.ts`,
    blob: BLOB_B,
    blobPath: 'hive-app/src/y.ts',
    pattern: 'supabase-secret-key',
  };
  const { uncovered } = reconcileHistoryAllowlist([finding], [validEntry()]);
  assert.equal(uncovered.length, 1);
  assert.equal(uncovered[0]?.blob, BLOB_B);
});

test('binary detection', () => {
  assert.equal(looksBinary(Buffer.from('plain text')), false);
  assert.equal(looksBinary(Buffer.from([0x89, 0x50, 0x00, 0x47])), true);
});
