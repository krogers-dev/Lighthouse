import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateAudit } from '../../scripts/audit-gate.mjs';

function report(severity, ghsa, name) {
  return {
    vulnerabilities: {
      [name]: {
        via: [{ severity, url: `https://github.com/advisories/${ghsa}`, name }],
      },
    },
  };
}

const waiver = {
  waivers: [
    {
      advisory: 'GHSA-test-0001',
      package: 'demo',
      severity: 'high',
      owner: 'Kody',
      reason: 'synthetic',
      approvedOn: '2026-08-01',
      expires: '2026-12-01',
    },
  ],
};

test('unwaived high advisories fail', () => {
  const { failures } = evaluateAudit(report('high', 'GHSA-none-0002', 'demo'), waiver, '2026-08-21');
  assert.equal(failures.length, 1);
});

test('waived high advisories pass until expiry', () => {
  const { failures, notes } = evaluateAudit(
    report('high', 'GHSA-test-0001', 'demo'),
    waiver,
    '2026-08-21',
  );
  assert.equal(failures.length, 0);
  assert.ok(notes.some((n) => n.includes('waived')));
});

test('expired waivers fail so the retest happens', () => {
  const { failures } = evaluateAudit(report('high', 'GHSA-test-0001', 'demo'), waiver, '2027-01-01');
  assert.ok(failures[0].includes('expired'));
});

test('moderate advisories stay below the gate', () => {
  const { failures, notes } = evaluateAudit(
    report('moderate', 'GHSA-mod-0003', 'demo'),
    { waivers: [] },
    '2026-08-21',
  );
  assert.equal(failures.length, 0);
  assert.ok(notes.some((n) => n.includes('below the high gate')));
});
