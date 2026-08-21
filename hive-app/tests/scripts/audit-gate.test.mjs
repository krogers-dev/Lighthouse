import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  checkProhibitedAssets,
  evaluateAudit,
  validateAuditReport,
  validateWaivers,
} from '../../scripts/audit-gate.mjs';

function report(severity, ghsa, name) {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      [name]: {
        via: [{ severity, url: `https://github.com/advisories/${ghsa}`, name }],
      },
    },
    metadata: { vulnerabilities: {} },
  };
}

const waiver = {
  waivers: [
    {
      advisory: 'GHSA-test-0001-aaaa',
      package: 'demo',
      severity: 'high',
      owner: 'Kody',
      reason: 'synthetic unit-test waiver',
      approvedOn: '2026-08-01',
      expires: '2026-12-01',
    },
  ],
};

test('unwaived high advisories fail', () => {
  const { failures } = evaluateAudit(
    report('high', 'GHSA-none-0002-bbbb', 'demo'),
    { waivers: [] },
    '2026-08-21',
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /unwaived/);
});

test('waived high advisories pass until expiry', () => {
  assert.deepEqual(validateWaivers(waiver, '2026-08-21'), []);
  const { failures, notes } = evaluateAudit(
    report('high', 'GHSA-test-0001-aaaa', 'demo'),
    waiver,
    '2026-08-21',
  );
  assert.equal(failures.length, 0);
  assert.ok(notes.some((n) => n.includes('waived')));
});

test('expired waivers fail validation so the retest happens', () => {
  const problems = validateWaivers(waiver, '2027-01-01');
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
  const { failures } = evaluateAudit(
    { auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: {} } },
    waiver,
    '2026-08-21',
  );
  assert.ok(failures.some((f) => f.includes('orphaned')));
});

test('report schema validation catches npm error payloads and bad versions', () => {
  assert.ok(validateAuditReport({ error: { code: 'E503' } }).length > 0);
  assert.ok(validateAuditReport({ auditReportVersion: 1 }).length > 0);
  assert.ok(validateAuditReport('nope').length > 0);
  assert.deepEqual(
    validateAuditReport({
      auditReportVersion: 2,
      vulnerabilities: {},
      metadata: { vulnerabilities: {} },
    }),
    [],
  );
});

test('waiver schema validation rejects malformed and duplicate entries', () => {
  const bad = {
    waivers: [
      {
        advisory: 'nope',
        package: '',
        severity: 'sky-high',
        owner: '',
        reason: 'x',
        approvedOn: 'yesterday',
        expires: 'soon',
      },
      waiver.waivers[0],
      waiver.waivers[0],
    ],
  };
  const problems = validateWaivers(bad, '2026-08-21');
  assert.ok(problems.some((p) => p.includes('malformed advisory id')));
  assert.ok(problems.some((p) => p.includes('invalid severity')));
  assert.ok(problems.some((p) => p.includes('duplicate')));
});

test('prohibited assets: ICNS/JXL/HEIF/HEIC tracked files fail while an image-size waiver is active (P2-11)', () => {
  const activeImageSize = { waivers: [{ advisory: 'GHSA-test-0001-aaaa', package: 'image-size' }] };
  const files = [
    'assets/images/icon.png',
    'assets/legacy/mac-icon.icns',
    'assets/photos/sample.JXL',
    'assets/photos/frame.heif',
    'assets/photos/live.heic',
    'docs/notes.md',
  ];
  const failures = checkProhibitedAssets(activeImageSize, files);
  assert.equal(failures.length, 4);
  assert.ok(failures.some((f) => f.includes('mac-icon.icns')));
  // Case-insensitive: uppercase extensions are still the vulnerable parsers.
  assert.ok(failures.some((f) => f.includes('sample.JXL')));
  assert.ok(failures.some((f) => f.includes('frame.heif')));
  assert.ok(failures.some((f) => f.includes('live.heic')));
});

test('prohibited assets: no image-size waiver means no asset prohibition', () => {
  const otherWaiver = { waivers: [{ advisory: 'GHSA-test-0002-bbbb', package: 'left-pad' }] };
  const files = ['assets/legacy/mac-icon.icns'];
  assert.deepEqual(checkProhibitedAssets(otherWaiver, files), []);
  assert.deepEqual(checkProhibitedAssets({ waivers: [] }, files), []);
});

test('prohibited assets: clean tree passes with the waiver active', () => {
  const activeImageSize = { waivers: [{ advisory: 'GHSA-test-0001-aaaa', package: 'image-size' }] };
  assert.deepEqual(
    checkProhibitedAssets(activeImageSize, ['assets/images/icon.png', 'src/app.ts']),
    [],
  );
});
