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
    ratifiedBy: 'Kody',
    approvalReference: 'Written ratification wording of 2026-08-02, recorded in decision log',
    decisionRecordDigest: 'a'.repeat(64),
    lockfileSha256: 'a'.repeat(64),
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
  assert.ok(validateAuditReport(noUrl).some((p) => p.includes('canonical GitHub advisory url')));
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
  // icon.png carries a genuine PNG head so only the three prohibited
  // extensions fail (the positive allowlist covers .png separately).
  const pngHead = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const files = [
    'assets/images/icon.png',
    'assets/photos/sample.JXL',
    'assets/photos/frame.heif',
    'assets/photos/live.heic',
    'docs/notes.md',
  ];
  const failures = checkProhibitedAssets(IMAGE_SIZE_MATCH, files, (f) =>
    f.endsWith('.png') ? pngHead : noHead(),
  );
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

// ---------------------------------------------------------------------------
// RETURN-3 area 1: GHSA occurrence consistency and dedup-order bypass
// ---------------------------------------------------------------------------

function twoNodeReport(firstSeverity, secondSeverity, options = {}) {
  const ghsa = 'GHSA-test-0001-aaaa';
  const secondName = options.secondName ?? 'demo';
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      'a-first': {
        name: 'a-first',
        severity: firstSeverity,
        via: [
          {
            severity: firstSeverity,
            url: `https://github.com/advisories/${ghsa}`,
            name: 'demo',
          },
        ],
      },
      'b-second': {
        name: 'b-second',
        severity: secondSeverity,
        via: [
          {
            severity: secondSeverity,
            url: `https://github.com/advisories/${ghsa}`,
            name: secondName,
          },
        ],
      },
    },
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: [firstSeverity, secondSeverity].filter((s) => s === 'moderate').length,
        high: [firstSeverity, secondSeverity].filter((s) => s === 'high').length,
        critical: 0,
        total: 2,
      },
    },
  };
}

test('BYPASS REGRESSION: moderate-first/high-second same GHSA cannot pass unwaived', () => {
  const report = twoNodeReport('moderate', 'high');
  // Conflicting severities for one GHSA are a schema/engine failure...
  const problems = validateAuditReport(report);
  assert.ok(
    problems.some((p) => p.includes('conflicting')),
    `expected a conflicting-occurrence problem; got ${JSON.stringify(problems)}`,
  );
  // ...and even if evaluation ran, the high occurrence must not be skipped.
  const { failures } = evaluateAudit(report, { waivers: [] }, '2026-08-21');
  assert.ok(
    failures.some((f) => f.includes('GHSA-test-0001-aaaa')),
    `expected the high occurrence to fail; got ${JSON.stringify(failures)}`,
  );
});

test('BYPASS REGRESSION: high-first/moderate-second same GHSA still fails unwaived', () => {
  const report = twoNodeReport('high', 'moderate');
  assert.ok(validateAuditReport(report).some((p) => p.includes('conflicting')));
  const { failures } = evaluateAudit(report, { waivers: [] }, '2026-08-21');
  assert.ok(failures.some((f) => f.includes('GHSA-test-0001-aaaa')));
});

test('package-conflict for one GHSA is a schema failure', () => {
  const report = twoNodeReport('high', 'high', { secondName: 'other-package' });
  assert.ok(
    validateAuditReport(report).some((p) => p.includes('conflicting') && p.includes('package')),
  );
});

test('consistent duplicate occurrences of one GHSA validate and evaluate once', () => {
  const report = twoNodeReport('high', 'high');
  assert.deepEqual(validateAuditReport(report), []);
  const { failures } = evaluateAudit(report, { waivers: [] }, '2026-08-21');
  assert.equal(failures.filter((f) => f.includes('GHSA-test-0001-aaaa')).length, 1);
});

test('metadata.vulnerabilities.total is required as a nonnegative integer', () => {
  const missingTotal = structuredClone(EMPTY_REPORT);
  delete missingTotal.metadata.vulnerabilities.total;
  assert.ok(validateAuditReport(missingTotal).some((p) => p.includes('total')));
  const negativeTotal = structuredClone(EMPTY_REPORT);
  negativeTotal.metadata.vulnerabilities.total = -1;
  assert.ok(validateAuditReport(negativeTotal).some((p) => p.includes('total')));
});

// ---------------------------------------------------------------------------
// RETURN-3 area 2: advisory-derived fixtures and the positive allowlist
// ---------------------------------------------------------------------------

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function bmff(sizeBytes, boxType, brand, rest = Buffer.alloc(0)) {
  return Buffer.concat([
    Buffer.from(sizeBytes),
    Buffer.from(boxType, 'latin1'),
    Buffer.from(brand, 'latin1'),
    rest,
  ]);
}

test('ADVISORY FIXTURE: zero-size JXL box (00 00 00 00 "JXL ") is detected', () => {
  const payload = Buffer.concat([
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('JXL ', 'latin1'),
    Buffer.from([0x0d, 0x0a, 0x87, 0x0a]),
  ]);
  assert.equal(detectProhibitedAssetPayload(payload), 'jxl');
});

test('ADVISORY FIXTURE: zero-size ftyp with AVIF-family brands is detected', () => {
  for (const brand of ['avif', 'avis', 'avci', 'avcs']) {
    const payload = bmff([0, 0, 0, 0], 'ftyp', brand, Buffer.alloc(8));
    assert.equal(detectProhibitedAssetPayload(payload), 'avif', `brand ${brand}`);
  }
});

test('HEIF-family brands are detected with zero-size boxes too', () => {
  for (const brand of ['heic', 'heif', 'mif1', 'msf1']) {
    const payload = bmff([0, 0, 0, 0], 'ftyp', brand, Buffer.alloc(8));
    assert.equal(detectProhibitedAssetPayload(payload), 'heif', `brand ${brand}`);
  }
});

test('COMPATIBLE-brand-only files are detected (major brand innocent)', () => {
  // major brand 'isom', minor version, compatible brands list contains avif.
  const payload = bmff(
    [0, 0, 0, 32],
    'ftyp',
    'isom',
    Buffer.concat([Buffer.alloc(4), Buffer.from('isomavifmif1', 'latin1')]),
  );
  assert.equal(detectProhibitedAssetPayload(payload), 'avif');
});

test('POSITIVE ALLOWLIST: a renamed crafted payload under .png fails', () => {
  const heads = new Map([
    ['assets/images/icon.png', PNG_MAGIC],
    ['assets/images/renamed.png', bmff([0, 0, 0, 0], 'ftyp', 'avif', Buffer.alloc(8))],
  ]);
  const failures = checkProhibitedAssets(IMAGE_SIZE_MATCH, [...heads.keys()], (f) => heads.get(f));
  assert.equal(failures.length, 1);
  assert.ok(failures[0].includes('renamed.png'));
});

test('POSITIVE ALLOWLIST: an image extension whose signature is not its approved magic fails', () => {
  // Not a prohibited signature — just NOT the PNG magic its extension claims.
  const heads = new Map([['assets/images/junk.png', Buffer.from('GIF89a??????', 'latin1')]]);
  const failures = checkProhibitedAssets(IMAGE_SIZE_MATCH, [...heads.keys()], (f) => heads.get(f));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /approved signature/);
});

test('POSITIVE ALLOWLIST: unapproved image extensions fail while the control is active', () => {
  const heads = new Map([['assets/images/photo.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])]]);
  const failures = checkProhibitedAssets(IMAGE_SIZE_MATCH, [...heads.keys()], (f) => heads.get(f));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /approved safe extension/);
});

test('POSITIVE ALLOWLIST: genuine PNGs under .png pass', () => {
  const heads = new Map([
    ['assets/images/icon.png', PNG_MAGIC],
    ['docs/notes.md', Buffer.from('# notes', 'latin1')],
  ]);
  assert.deepEqual(
    checkProhibitedAssets(IMAGE_SIZE_MATCH, [...heads.keys()], (f) => heads.get(f)),
    [],
  );
});

// ---------------------------------------------------------------------------
// RETURN-3 area 3: ratification provenance
// ---------------------------------------------------------------------------

const SHA64 = 'a'.repeat(64);

function provenancedWaiver(overrides = {}) {
  return makeWaiver({
    ratifiedBy: 'Kody',
    approvalReference: 'Written ratification wording of 2026-08-02, recorded in decision log',
    decisionRecordDigest: SHA64,
    lockfileSha256: SHA64,
    ...overrides,
  });
}

test('a fully provenanced ratified waiver validates', () => {
  assert.deepEqual(validateWaivers({ waivers: [provenancedWaiver()] }, '2026-08-21'), []);
});

test('ratified waivers REQUIRE approver, reference, decision digest, and lockfile binding', () => {
  const cases = [
    [{ ratifiedBy: undefined }, /ratifiedBy/],
    [{ ratifiedBy: '   ' }, /ratifiedBy/],
    [{ approvalReference: undefined }, /approvalReference/],
    [{ approvalReference: '   ' }, /approvalReference/],
    [{ decisionRecordDigest: undefined }, /decisionRecordDigest/],
    [{ decisionRecordDigest: 'abc' }, /decisionRecordDigest/],
    [{ lockfileSha256: undefined }, /lockfileSha256/],
    [{ lockfileSha256: 'zz' }, /lockfileSha256/],
  ];
  for (const [override, expected] of cases) {
    const problems = validateWaivers({ waivers: [provenancedWaiver(override)] }, '2026-08-21');
    assert.ok(
      problems.some((p) => expected.test(p)),
      `expected ${expected} for ${JSON.stringify(override)}; got ${JSON.stringify(problems)}`,
    );
  }
});

test('owner alone is never proof of approval', () => {
  // owner present, ratifiedBy missing: must fail.
  const problems = validateWaivers(
    { waivers: [provenancedWaiver({ ratifiedBy: undefined, owner: 'Kody' })] },
    '2026-08-21',
  );
  assert.ok(problems.some((p) => p.includes('ratifiedBy')));
});

test('ratified references containing pending-style wording are rejected', () => {
  for (const bad of [
    'ratification pending',
    'PROPOSED per directive',
    'not approved yet',
    'approval not yet given',
  ]) {
    const problems = validateWaivers(
      { waivers: [provenancedWaiver({ approvalReference: bad })] },
      '2026-08-21',
    );
    assert.ok(
      problems.some((p) => p.includes('approvalReference')),
      `expected rejection for reference ${JSON.stringify(bad)}`,
    );
  }
});

test('whitespace cannot satisfy reason or retest', () => {
  const blankReason = validateWaivers(
    { waivers: [provenancedWaiver({ reason: '          x' })] },
    '2026-08-21',
  );
  assert.ok(blankReason.some((p) => p.includes('reason')));
});

test('NEGATIVE: flipping the CURRENT proposed waivers to ratified without new provenance fails', async () => {
  const { readFileSync } = await import('node:fs');
  const real = JSON.parse(readFileSync(new URL('../../security/waivers.json', import.meta.url)));
  const flipped = {
    waivers: real.waivers.map((w) => ({ ...w, approvalStatus: 'ratified' })),
  };
  const problems = validateWaivers(flipped, '2026-08-21');
  assert.ok(problems.length > 0, 'flipping without provenance must fail');
  assert.ok(problems.some((p) => p.includes('ratifiedBy') || p.includes('ratifiedOn')));
});

test('ratified waivers are BOUND to the approved lockfile digest', async () => {
  const { checkWaiverBindings } = await import('../../scripts/audit-gate.mjs');
  const current = SHA64;
  const other = 'b'.repeat(64);
  assert.deepEqual(checkWaiverBindings([provenancedWaiver()], current), []);
  const failures = checkWaiverBindings([provenancedWaiver({ lockfileSha256: other })], current);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /lockfile/);
  // Proposed entries carry no binding yet: nothing to check.
  assert.deepEqual(
    checkWaiverBindings(
      [makeWaiver({ approvalStatus: 'proposed', ratifiedOn: undefined })],
      current,
    ),
    [],
  );
});

// ---------------------------------------------------------------------------
// RETURN-4 P1-5: advisory URLs and via-graph resolution
// ---------------------------------------------------------------------------

test('only canonical advisory URLs yield an id — trailing slash and foreign hosts fail', async () => {
  const { advisoryIdFromUrl } = await import('../../scripts/audit-gate.mjs');
  assert.equal(
    advisoryIdFromUrl('https://github.com/advisories/GHSA-test-0001-aaaa'),
    'GHSA-test-0001-aaaa',
  );
  assert.equal(advisoryIdFromUrl('https://github.com/advisories/'), null);
  assert.equal(advisoryIdFromUrl('https://github.com/advisories/GHSA-test-0001-aaaa/'), null);
  assert.equal(advisoryIdFromUrl('https://evil.example/advisories/GHSA-test-0001-aaaa'), null);
  assert.equal(advisoryIdFromUrl('http://github.com/advisories/GHSA-test-0001-aaaa'), null);
  assert.equal(advisoryIdFromUrl('https://github.com/advisories/GHSA-bad'), null);
});

test('REGRESSION: a trailing-slash advisory URL cannot make a high finding disappear', () => {
  const sneaky = report('high', 'GHSA-test-0001-aaaa', 'demo');
  sneaky.vulnerabilities.demo.via[0].url = 'https://github.com/advisories/';
  // Schema validation rejects it outright — never "validates then skips".
  assert.ok(validateAuditReport(sneaky).some((p) => p.includes('canonical')));
});

function graphReport(nodes, totals) {
  return { auditReportVersion: 2, vulnerabilities: nodes, metadata: { vulnerabilities: totals } };
}
const T = (moderate, high) => ({
  info: 0,
  low: 0,
  moderate,
  high,
  critical: 0,
  total: moderate + high,
});
const via = (ghsa, severity, name) => ({
  severity,
  name,
  url: `https://github.com/advisories/${ghsa}`,
});

test('REGRESSION: a high node whose via is only an unresolved string cannot evaluate as zero advisories', () => {
  const dangling = graphReport(
    { demo: { name: 'demo', severity: 'high', via: ['ghost-package'] } },
    T(0, 1),
  );
  const problems = validateAuditReport(dangling);
  assert.ok(problems.some((p) => p.includes('does not resolve')));
  assert.ok(problems.some((p) => p.includes('ZERO advisories')));
});

test('a via-graph CYCLE that reaches no advisory cannot hide a high node', () => {
  // Real npm reports contain legitimate cycles (metro <-> metro-config),
  // so a cycle is traversed safely rather than rejected outright. What
  // must not happen is a high node resolving to nothing: that is caught
  // directly, and it is the property the cycle rule existed to protect.
  const cyclic = graphReport(
    {
      a: { name: 'a', severity: 'high', via: ['b'] },
      b: { name: 'b', severity: 'high', via: ['a'] },
    },
    T(0, 2),
  );
  const problems = validateAuditReport(cyclic);
  assert.ok(
    problems.some((p) => p.includes('ZERO advisories') && p.includes('"a"')),
    JSON.stringify(problems),
  );
  assert.ok(problems.some((p) => p.includes('ZERO advisories') && p.includes('"b"')));
});

test('a CYCLE that does reach a real advisory terminates and resolves it', () => {
  // b <-> c cycle, with the advisory hanging off c. Traversal must
  // terminate AND find the advisory through the cycle.
  const cyclic = graphReport(
    {
      b: { name: 'b', severity: 'high', via: ['c'] },
      c: {
        name: 'c',
        severity: 'high',
        via: ['b', via('GHSA-test-0001-aaaa', 'high', 'c')],
      },
    },
    T(0, 2),
  );
  assert.deepEqual(validateAuditReport(cyclic), []);
});

test('the ARCHIVED real npm report validates through the same resolver', async () => {
  // The evidence npm actually produced for this lockfile — including its
  // real metro cycles — must pass schema + graph validation, or the gate
  // is unrunnable rather than strict.
  const { readFileSync } = await import('node:fs');
  const raw = JSON.parse(
    readFileSync(
      new URL('../../security/evidence/npm-audit-current.json', import.meta.url),
      'utf8',
    ),
  );
  assert.deepEqual(validateAuditReport(raw), []);
});

test('string vias resolve transitively and reconcile severities', () => {
  const good = graphReport(
    {
      source: {
        name: 'source',
        severity: 'high',
        via: [via('GHSA-test-0001-aaaa', 'high', 'source')],
      },
      parent: { name: 'parent', severity: 'high', via: ['source'] },
    },
    T(0, 2),
  );
  assert.deepEqual(validateAuditReport(good), []);
});

test('REGRESSION: a high node reaching only moderate advisories is a severity conflict', () => {
  const conflicted = graphReport(
    {
      source: {
        name: 'source',
        severity: 'moderate',
        via: [via('GHSA-modx-0003-cccc', 'moderate', 'source')],
      },
      parent: { name: 'parent', severity: 'high', via: ['source'] },
    },
    T(1, 1),
  );
  assert.ok(
    validateAuditReport(conflicted).some(
      (p) => p.includes('does not reconcile') && p.includes('via graph'),
    ),
  );
});

// ---------------------------------------------------------------------------
// RETURN-4 P1-7: governed image extensions with Metro drift protection
// ---------------------------------------------------------------------------

test('SVG and PSD are governed: rejected while the compensating control is active', () => {
  const pngHead = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const files = ['assets/vector/logo.svg', 'assets/source/mock.psd', 'assets/images/icon.png'];
  const failures = checkProhibitedAssets(IMAGE_SIZE_MATCH, files, (f) =>
    f.endsWith('.png') ? pngHead : Buffer.from('anything'),
  );
  assert.equal(failures.length, 2);
  assert.ok(failures.some((f) => f.includes('logo.svg')));
  assert.ok(failures.some((f) => f.includes('mock.psd')));
});

test('DRIFT: every image-like extension in the pinned Metro defaults is governed', async () => {
  const { IMAGE_EXTENSIONS, PROHIBITED_ASSET_EXTENSIONS } =
    await import('../../scripts/audit-gate.mjs');
  const { readFileSync } = await import('node:fs');
  const defaults = readFileSync(
    new URL('../../node_modules/metro-config/src/defaults/defaults.js', import.meta.url),
    'utf8',
  );
  // Every known raster/vector image format name that appears in the
  // pinned metro-config defaults must be covered by the governed or
  // prohibited sets.
  const IMAGE_FORMAT_NAMES = [
    'png',
    'jpg',
    'jpeg',
    'bmp',
    'gif',
    'webp',
    'psd',
    'svg',
    'tiff',
    'tif',
    'heic',
    'heif',
    'avif',
    'jxl',
    'ico',
    'icns',
    'ktx',
    'astc',
    'exr',
    'pvr',
  ];
  const governed = new Set([...IMAGE_EXTENSIONS, ...PROHIBITED_ASSET_EXTENSIONS]);
  for (const format of IMAGE_FORMAT_NAMES) {
    if (new RegExp(`['\\"]${format}['\\"]`).test(defaults)) {
      assert.ok(governed.has(`.${format}`), `metro default image ext .${format} is ungoverned`);
    }
  }
});

// ---------------------------------------------------------------------------
// RETURN-4 P1-6: ratification is a verifiable act, not a self-written field
// ---------------------------------------------------------------------------

test('NEGATIVE: a ratification dated in the FUTURE is rejected', () => {
  const problems = validateWaivers(
    { waivers: [makeWaiver({ ratifiedOn: '2026-09-15' })] },
    '2026-08-21',
  );
  assert.ok(
    problems.some((p) => p.includes('future')),
    JSON.stringify(problems),
  );
});

test('NEGATIVE: ratification AFTER the waiver expiry is rejected', () => {
  const problems = validateWaivers(
    {
      waivers: [
        makeWaiver({ proposedOn: '2026-01-01', expires: '2026-06-01', ratifiedOn: '2026-08-02' }),
      ],
    },
    '2026-08-21',
  );
  assert.ok(
    problems.some((p) => p.includes('after expiry')),
    JSON.stringify(problems),
  );
});

test('NEGATIVE: a ratified waiver may not name a decision record path (RETURN-5)', () => {
  // The record lives outside the repository and is supplied out-of-band;
  // an entry that names a location points at something the implementer
  // controls, which is the model this replaced.
  for (const bad of ['security/decisions/waivers.json', 'notes/somewhere.json', '/etc/passwd']) {
    const problems = validateWaivers(
      { waivers: [makeWaiver({ decisionRecordPath: bad })] },
      '2026-08-21',
    );
    assert.ok(
      problems.some((p) => p.includes('no longer accepted')),
      `expected path rejection for ${JSON.stringify(bad)}; got ${JSON.stringify(problems)}`,
    );
  }
  // Absent is correct, and still requires the digest.
  assert.deepEqual(validateWaivers({ waivers: [makeWaiver()] }, '2026-08-21'), []);
});
