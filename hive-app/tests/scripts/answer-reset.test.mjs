import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RESETTABLE_REQUESTS,
  answeredEventsFilter,
  performAnswerReset,
  resolveAnswerResetTarget,
  verifyReset,
} from '../../scripts/lib/answer-reset.mjs';

test('only the seeded OPEN requests can be reset, by key, never by an arbitrary id', () => {
  const target = resolveAnswerResetTarget('a1Question');
  assert.equal(target.requestId, 'dddddddd-0000-4000-8000-0000000000a3');
  assert.equal(target.seededStatus, 'OPEN');
  assert.match(resolveAnswerResetTarget('b1Open').problem, /unknown request key/);
  assert.match(resolveAnswerResetTarget('dddddddd-0000-4000-8000-0000000000a2').problem, /unknown/);
  for (const entry of Object.values(RESETTABLE_REQUESTS)) {
    assert.equal(entry.seededStatus, 'OPEN', 'an ANSWERED seed row is never "reset" to OPEN');
  }
});

test('the trail filter removes only "request answered" entries added after the seeded one', () => {
  const filter = answeredEventsFilter(resolveAnswerResetTarget('a1Question'));
  assert.ok(filter.includes('case_id=eq.eeeeeeee-0000-4000-8000-0000000000a1'));
  assert.ok(filter.includes('event_kind=eq.request.answered'));
  assert.ok(filter.includes('occurred_at=gt.2026-08-11T09%3A15%3A00Z'));
});

test('readback must show OPEN and no answer row', () => {
  assert.deepEqual(verifyReset({ status: 'OPEN' }, []), []);
  assert.deepEqual(verifyReset({ status: 'ANSWERED' }, []), [
    'request status is ANSWERED, not OPEN',
  ]);
  assert.deepEqual(verifyReset(undefined, []), ['the request is missing after the reset']);
  assert.deepEqual(verifyReset({ status: 'OPEN' }, [{ id: 'x' }]), ['1 answer row(s) remain']);
});

test('performAnswerReset deletes the answer, reopens the request, drops the added trail entries, and verifies by readback', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method ?? 'GET' });
    const body = String(url).includes('/requests?select=')
      ? JSON.stringify([{ id: 'x', status: 'OPEN', version: 3 }])
      : '[]';
    return { ok: true, status: 200, text: async () => body };
  };
  try {
    const result = await performAnswerReset({
      url: 'http://127.0.0.1:54321',
      serviceKey: 'service-bearer-in-memory',
      requestKey: 'a1Question',
    });
    assert.deepEqual(result, { ok: true, key: 'a1Question', version: 3 });
    assert.deepEqual(
      calls.map(
        (call) => `${call.method} ${call.url.replace('http://127.0.0.1:54321/rest/v1', '')}`,
      ),
      [
        'DELETE /request_answers?request_id=eq.dddddddd-0000-4000-8000-0000000000a3',
        'PATCH /requests?id=eq.dddddddd-0000-4000-8000-0000000000a3',
        'DELETE /activity_events?case_id=eq.eeeeeeee-0000-4000-8000-0000000000a1&event_kind=eq.request.answered&occurred_at=gt.2026-08-11T09%3A15%3A00Z',
        'GET /requests?select=id,status,version&id=eq.dddddddd-0000-4000-8000-0000000000a3',
        'GET /request_answers?select=id&request_id=eq.dddddddd-0000-4000-8000-0000000000a3',
      ],
    );
    const unknown = await performAnswerReset({
      url: 'http://127.0.0.1:54321',
      serviceKey: 'k',
      requestKey: 'dddddddd-0000-4000-8000-0000000000a3',
    });
    assert.equal(unknown.ok, false);
    assert.match(unknown.problems[0], /unknown request key/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
