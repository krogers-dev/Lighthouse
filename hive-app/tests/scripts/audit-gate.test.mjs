import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  checkProhibitedAssets,
  detectProhibitedAssetPayload,
  evaluateAudit,
  isRealIsoDate,
  validateAuditReport,
  validateWaivers,
} from '../../scripts/audit-gate.mjs';

/** A schema-complete single-advisory report whose metadata reconciles. */
function report(severity, ghsa, name) {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      [name]: {
        name,
        severity,
        via: [{ severity, url: `https://github.com/advisories/${ghsa}`, name }],
      },
    },
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: severity === 'moderate' ? 1 : 0,
        high: severity === 'high' ? 1 : 0,
        critical: severity === 'critical' ? 1 : 0,
        total: 1,
      },
    },
  };
}

const EMPTY_REPORT = {
  auditReportVersion: 2,
  vulnerabilities: {},
  metadata: {
    vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
  },
};

function makeWaiver(overrides = {}) {
  return {
    advisory: 'GHSA-test-0001-aaaa',
    package: 'demo',
    severity: 'high',
    owner: 'Kody',
    reason: 'synthetic unit-test waiver',
    approvalStatus: 'ratified',
    proposedOn: '2026-08-01',
    ratifiedOn: '2026-08-02',
    expires: '2026-12-01',
    retest: 'Recheck monthly, on lockfile or Expo change, before any RC, and at expiry.',
    ...overrides,
  };
}

const ratified = { waivers: [makeWaiver()] };
const proposed = {
  waivers: [makeWaiver({ approvalStatus: 'proposed', ratifiedOn: undefined })],
};

// ---------------------------------------------------------------------------
// Date validation
// ---------------------------------------------------------------------------

test('isRealIsoDate accepts real dates and rejects impossible ones', () => {
  assert.equal(isRealIsoDate('2026-08-21'), true);
  assert.equal(isRealIsoDate('2028-02-29'), true); // leap year
  assert.equal(isRealIsoDate('2026-02-30'), false);
  assert.equal(isRealIsoDate('2026-13-01'), false);
  assert.equal(isRealIsoDate('2026-00-10'), false);
  assert.equal(isRealIsoDate('2027-02-29'), false); // not a leap year
  assert.equal(isRealIsoDate('yesterday'), false);
  assert.equal(isRealIsoDate(''), false);
});

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

test('unwaived high advisories fail', () => {
  const { failures } = evaluateAudit(
    report('high', 'GHSA-none-0002-bbbb', 'demo'),
    { waivers: [] },
    '2026-08-21',
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /unwaived/);
});

test('ratified waivers pass and are labeled as ratified', () => {
  assert.deepEqual(validateWaivers(ratified, '2026-08-21'), []);
  const { failures, holds, notes } = evaluateAudit(
    report('high', 'GHSA-test-0001-aaaa', 'demo'),
    ratified,
    '2026-08-21',
  );
  assert.equal(failures.length, 0);
  assert.equal(holds.length, 0);
  assert.ok(notes.some((n) => n.includes('ratified')));
});

test('PROPOSED waivers produce HOLD, never approval wording', () => {
  assert.deepEqual(validateWaivers(proposed, '2026-08-21'), []);
  const { failures, holds, notes } = evaluateAudit(
    report('high', 'GHSA-test-0001-aaaa', 'demo'),
    proposed,
    '2026-08-21',
  );
  assert.equal(failures.length, 0);
  assert.equal(holds.length, 1);
  assert.match(holds[0], /PROPOSED/);
  assert.match(holds[0], /ratification/);
  // Nothing may read as already-approved.
  assert.ok(!notes.some((n) => /waived \(ratified/.test(n)));
});

test('a free-text approval string is not an approval state', () => {
  const bad = {
    waivers: [makeWaiver({ approvalStatus: 'PM directive 2026-08-21; Kody ratification pending' })],
  };
  const problems = validateWaivers(bad, '2026-08-21');
  assert.ok(problems.some((p) => p.includes("exactly 'proposed' or 'ratified'")));
});

test('TAMPERED package: waiver whose package differs from the live report fails', () => {
  const tampered = { waivers: [makeWaiver({ package: 'some-other-package' })] };
  const { failures } = evaluateAudit(
    report('high', 'GHSA-test-0001-aaaa', 'demo'),
    tampered,
    '2026-08-21',
  );
  assert.ok(failures.some((f) => f.includes('does not match the live report')));
});

test('TAMPERED severity: waiver whose severity differs from the live report fails', () => {
  const tampered = { waivers: [makeWaiver({ severity: 'critical' })] };
  const { failures } = evaluateAudit(
    report('high', 'GHSA-test-0001-aaaa', 'demo'),
    tampered,
    '2026-08-21',
  );
  assert.ok(failures.some((f) => f.includes('does not match the live report')));
});

test('expired waivers fail validation so the retest happens', () => {
  const problems = validateWaivers(ratified, '2027-01-01');
  assert.ok(problems.some((p) => p.includes('expired')));
});

test('moderate advisories stay below the gate', () => {
  const { failures, notes } = evaluateAudit(
    report('moderate', 'GHSA-modx-0003-cccc', 'demo'),
    { waivers: [] },
    '2026-08-21',
  );
  assert.equal(failures.length, 0);
  assert.ok(notes.some((n) => n.includes('below the high gate')));
});

test('orphaned waivers fail evaluation', () => {
  const { failures } = evaluateAudit(EMPTY_REPORT, ratified, '2026-08-21');
  assert.ok(failures.some((f) => f.includes('orphaned')));
});

// ---------------------------------------------------------------------------
// Report schema
// ---------------------------------------------------------------------------

test('report schema validation catches npm error payloads and bad versions', () => {
  assert.ok(validateAuditReport({ error: { code: 'E503' } }).length > 0);
  assert.ok(validateAuditReport({ auditReportVersion: 1 }).length > 0);
  assert.ok(validateAuditReport('nope').length > 0);
  assert.deepEqual(validateAuditReport(EMPTY_REPORT), []);
  assert.deepEqual(validateAuditReport(report('high', 'GHSA-test-0001-aaaa', 'demo')), []);
});

test('malformed vulnerability nodes are rejected field by field', () => {
  const base = report('high', 'GHSA-test-0001-aaaa', 'demo');
  const wrongName = structuredClone(base);
  wrongName.vulnerabilities.demo.name = 'other';
  assert.ok(validateAuditReport(wrongName).some((p) => p.includes('does not match its key')));

  const badSeverity = structuredClone(base);
  badSeverity.vulnerabilities.demo.severity = 'sky-high';
  assert.ok(validateAuditReport(badSeverity).some((p) => p.includes('invalid severity')));

  const emptyVia = structuredClone(base);
  emptyVia.vulnerabilities.demo.via = [];
  assert.ok(validateAuditReport(emptyVia).some((p) => p.includes('non-empty array')));

  const badVia = structuredClone(base);
  badVia.vulnerabilities.demo.via = [{ severity: 'high' }];
  assert.ok(validateAuditReport(badVia).some((p) => p.includes('no package name')));

  const noUrl = structuredClone(base);
  noUrl.vulnerabilities.demo.via = [{ name: 'demo', severity: 'high', url: 'nope' }];
  assert.ok(validateAuditReport(noUrl).some((p) => p.includes('no advisory url')));
});

test('INCONSISTENT summary counts are rejected', () => {
  const inflated = structuredClone(report('high', 'GHSA-test-0001-aaaa', 'demo'));
  inflated.metadata.vulnerabilities.high = 3;
  inflated.metadata.vulnerabilities.total = 3;
  assert.ok(validateAuditReport(inflated).some((p) => p.includes('does not reconcile')));

  const wrongTotal = structuredClone(report('high', 'GHSA-test-0001-aaaa', 'demo'));
  wrongTotal.metadata.vulnerabilities.total = 9;
  assert.ok(validateAuditReport(wrongTotal).some((p) => p.includes('per-severity sum')));

  const nonInteger = structuredClone(EMPTY_REPORT);
  nonInteger.metadata.vulnerabilities.high = 'many';
  assert.ok(validateAuditReport(nonInteger).some((p) => p.includes('non-negative integer')));
});

// ---------------------------------------------------------------------------
// Waiver schema
// ---------------------------------------------------------------------------

test('waiver schema validation rejects malformed and duplicate entries', () => {
  const bad = {
    waivers: [
      {
        advisory: 'nope',
        package: '',
        severity: 'sky-high',
        owner: '',
        reason: 'x',
        approvalStatus: 'maybe',
        proposedOn: 'yesterday',
        expires: 'soon',
        retest: '',
      },
      makeWaiver(),
      makeWaiver(),
    ],
  };
  const problems = validateWaivers(bad, '2026-08-21');
  assert.ok(problems.some((p) => p.includes('malformed advisory id')));
  assert.ok(problems.some((p) => p.includes('invalid severity')));
  assert.ok(problems.some((p) => p.includes('duplicate')));
  assert.ok(problems.some((p) => p.includes('retest')));
  assert.ok(problems.some((p) => p.includes('approvalStatus')));
});

test('IMPOSSIBLE calendar dates are rejected', () => {
  const impossible = { waivers: [makeWaiver({ proposedOn: '2026-02-30' })] };
  assert.ok(
    validateWaivers(impossible, '2026-08-21').some((p) => p.includes('real calendar date')),
  );
  const badExpiry = { waivers: [makeWaiver({ expires: '2026-13-01' })] };
  assert.ok(validateWaivers(badExpiry, '2026-08-21').some((p) => p.includes('real calendar date')));
});

test('BLANK retest is rejected', () => {
  const blank = { waivers: [makeWaiver({ retest: '   ' })] };
  assert.ok(validateWaivers(blank, '2026-08-21').some((p) => p.includes('retest')));
});

test('ratified entries need a real ratifiedOn no earlier than proposedOn', () => {
  const missing = { waivers: [makeWaiver({ ratifiedOn: undefined })] };
  assert.ok(validateWaivers(missing, '2026-08-21').some((p) => p.includes('ratifiedOn')));
  const before = { waivers: [makeWaiver({ ratifiedOn: '2026-07-01' })] };
  assert.ok(validateWaivers(before, '2026-08-21').some((p) => p.includes('precede')));
});

// ---------------------------------------------------------------------------
// Prohibited assets (compensating control from MATCHED advisories)
// ---------------------------------------------------------------------------

const noHead = () => Buffer.alloc(16);
const IMAGE_SIZE_MATCH = [{ ghsa: 'GHSA-test-0001-aaaa', package: 'image-size' }];

test('prohibited assets derive from the matched advisories, not waiver labels', () => {
  const files = ['assets/legacy/mac-icon.icns'];
  // Advisory matched against another package: no prohibition.
  assert.deepEqual(
    checkProhibitedAssets([{ ghsa: 'GHSA-test-0002-bbbb', package: 'left-pad' }], files, noHead),
    [],
  );
  assert.deepEqual(checkProhibitedAssets([], files, noHead), []);
  // image-size matched in the live report: prohibition active.
  const failures = checkProhibitedAssets(IMAGE_SIZE_MATCH, files, noHead);
  assert.equal(failures.length, 1);
  assert.ok(failures[0].includes('mac-icon.icns'));
});

test('prohibited extensions are rejected case-insensitively', () => {
  const files = [
    'assets/images/icon.png',
    'assets/photos/sample.JXL',
    'assets/photos/frame.heif',
    'assets/photos/live.heic',
    'docs/notes.md',
  ];
  const failures = checkProhibitedAssets(IMAGE_SIZE_MATCH, files, noHead);
  assert.equal(failures.length, 3);
});

test('file SIGNATURES are detected even under innocent extensions', () => {
  const heads = new Map([
    ['assets/images/sneaky.png', Buffer.from('icnsAAAABBBB', 'latin1')],
    [
      'assets/images/frame.png',
      Buffer.concat([
        Buffer.from([0, 0, 0, 24]),
        Buffer.from('ftypheic', 'latin1'),
        Buffer.alloc(4),
      ]),
    ],
    ['assets/images/stream.png', Buffer.from([0xff, 0x0a, 1, 2, 3, 4])],
    [
      'assets/images/container.png',
      Buffer.from([0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a, 0, 0]),
    ],
    ['assets/images/honest.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  ]);
  const failures = checkProhibitedAssets(IMAGE_SIZE_MATCH, [...heads.keys()], (f) => heads.get(f));
  assert.equal(failures.length, 4);
  assert.ok(failures.every((f) => f.includes('file signature')));
});

test('unreadable files fail closed while the control is active', () => {
  const failures = checkProhibitedAssets(IMAGE_SIZE_MATCH, ['assets/x.png'], () => null);
  assert.equal(failures.length, 1);
  assert.ok(failures[0].includes('failing closed'));
});

test('detectProhibitedAssetPayload classifies signatures exactly', () => {
  assert.equal(detectProhibitedAssetPayload(Buffer.from('icnsAAAA', 'latin1')), 'icns');
  assert.equal(detectProhibitedAssetPayload(Buffer.from([0xff, 0x0a, 0, 0])), 'jxl');
  assert.equal(
    detectProhibitedAssetPayload(
      Buffer.from([0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]),
    ),
    'jxl',
  );
  assert.equal(
    detectProhibitedAssetPayload(
      Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmif1', 'latin1')]),
    ),
    'heif',
  );
  assert.equal(
    detectProhibitedAssetPayload(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    null,
  );
  assert.equal(detectProhibitedAssetPayload(Buffer.alloc(2)), null);
});
