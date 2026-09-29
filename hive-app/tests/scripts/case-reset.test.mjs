import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RESETTABLE_CASES,
  WORKFLOW_EVENT_KINDS,
  performCaseReset,
  resolveCaseResetTarget,
  verifyCaseReset,
  workflowEventsFilter,
} from '../../scripts/lib/case-reset.mjs';

test('only the seeded case can be reset, by key, never by an arbitrary id', () => {
  const target = resolveCaseResetTarget('a1');
  assert.equal(target.caseId, 'eeeeeeee-0000-4000-8000-0000000000a1');
  assert.equal(target.seededStatus, 'EVIDENCE_PENDING');
  assert.match(resolveCaseResetTarget('b1').problem, /unknown case key/);
  assert.match(resolveCaseResetTarget('eeeeeeee-0000-4000-8000-0000000000a1').problem, /unknown/);
  for (const entry of Object.values(RESETTABLE_CASES)) {
    assert.equal(entry.seededStatus, 'EVIDENCE_PENDING');
  }
});

test('the trail filter names every workflow kind and nothing else', () => {
  const filter = workflowEventsFilter(resolveCaseResetTarget('a1'));
  assert.ok(filter.startsWith('case_id=eq.eeeeeeee-0000-4000-8000-0000000000a1&event_kind=in.('));
  for (const kind of WORKFLOW_EVENT_KINDS) assert.ok(filter.includes(kind));
  assert.ok(!filter.includes('request.answered'));
  assert.ok(!filter.includes('document.'));
});

test('readback must show the seeded status and no package', () => {
  const target = resolveCaseResetTarget('a1');
  assert.deepEqual(verifyCaseReset(target, { status: 'EVIDENCE_PENDING' }, []), []);
  assert.deepEqual(verifyCaseReset(target, { status: 'APPROVED' }, []), [
    'case status is APPROVED, not EVIDENCE_PENDING',
  ]);
  assert.deepEqual(verifyCaseReset(target, undefined, []), ['the case is missing after the reset']);
  assert.deepEqual(verifyCaseReset(target, { status: 'EVIDENCE_PENDING' }, [{ id: 'x' }]), [
    '1 package row(s) remain',
  ]);
});

test('performCaseReset removes receipts, references, approvals, verdicts, and packages in that order, restores the status, drops the trail, and verifies', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push(
      `${options.method ?? 'GET'} ${String(url).replace('http://127.0.0.1:54321/rest/v1', '')}`,
    );
    const body = String(url).includes('/cases?select=')
      ? JSON.stringify([{ id: 'x', status: 'EVIDENCE_PENDING', version: 9 }])
      : '[]';
    return { ok: true, status: 200, text: async () => body };
  };
  try {
    const result = await performCaseReset({
      url: 'http://127.0.0.1:54321',
      serviceKey: 'service-bearer-in-memory',
      caseKey: 'a1',
    });
    assert.deepEqual(result, { ok: true, key: 'a1', version: 9 });
    assert.deepEqual(calls, [
      'DELETE /filing_receipts?case_id=eq.eeeeeeee-0000-4000-8000-0000000000a1',
      'DELETE /ledger_references?case_id=eq.eeeeeeee-0000-4000-8000-0000000000a1',
      'DELETE /case_approvals?case_id=eq.eeeeeeee-0000-4000-8000-0000000000a1',
      'DELETE /case_reviews?case_id=eq.eeeeeeee-0000-4000-8000-0000000000a1',
      'DELETE /case_review_packages?case_id=eq.eeeeeeee-0000-4000-8000-0000000000a1',
      'PATCH /cases?id=eq.eeeeeeee-0000-4000-8000-0000000000a1',
      `DELETE /activity_events?${workflowEventsFilter(resolveCaseResetTarget('a1'))}`,
      'GET /cases?select=id,status,version&id=eq.eeeeeeee-0000-4000-8000-0000000000a1',
      'GET /case_review_packages?select=id&case_id=eq.eeeeeeee-0000-4000-8000-0000000000a1',
    ]);
    const unknown = await performCaseReset({
      url: 'http://127.0.0.1:54321',
      serviceKey: 'k',
      caseKey: 'zz',
    });
    assert.equal(unknown.ok, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
