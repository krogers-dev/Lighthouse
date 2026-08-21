import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cleanAllFactors } from '../../scripts/lib/admin-factors.mjs';

const identity = {
  id: 'cccccccc-0000-4000-8000-000000000004',
  email: 'reviewer.rae@example.invalid',
};

function fakeAdmin(script) {
  const calls = [];
  return {
    calls,
    request: async (pathname, options = {}) => {
      calls.push({ pathname, method: options.method ?? 'GET' });
      return script(pathname, options, calls.length);
    },
  };
}

test('happy path: list, delete each, readback zero', async () => {
  const admin = fakeAdmin((pathname, options) => {
    if (options.method === 'DELETE') return { ok: true, status: 200, body: {} };
    // First listing has two factors; readback (second GET) has none.
    const isFirstListing = admin.calls.filter((c) => c.method === 'GET').length === 1;
    return {
      ok: true,
      status: 200,
      body: isFirstListing ? [{ id: 'f1' }, { id: 'f2' }] : [],
    };
  });
  const result = await cleanAllFactors(admin.request, identity);
  assert.deepEqual(result.problems, []);
  assert.equal(result.deleted, 2);
  assert.equal(admin.calls.filter((c) => c.method === 'DELETE').length, 2);
});

test('listing failure is fatal — no deletions are attempted', async () => {
  const admin = fakeAdmin(() => ({ ok: false, status: 500, body: {} }));
  const result = await cleanAllFactors(admin.request, identity);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /listing/);
  assert.equal(admin.calls.filter((c) => c.method === 'DELETE').length, 0);
});

test('a non-array listing body is fatal', async () => {
  const admin = fakeAdmin(() => ({ ok: true, status: 200, body: { weird: true } }));
  const result = await cleanAllFactors(admin.request, identity);
  assert.match(result.problems[0], /factor array/);
});

test('every deletion must succeed', async () => {
  const admin = fakeAdmin((pathname, options) => {
    if (options.method === 'DELETE') {
      return pathname.endsWith('/f2')
        ? { ok: false, status: 500, body: {} }
        : { ok: true, status: 200, body: {} };
    }
    const isFirstListing = admin.calls.filter((c) => c.method === 'GET').length === 1;
    return {
      ok: true,
      status: 200,
      body: isFirstListing ? [{ id: 'f1' }, { id: 'f2' }] : [{ id: 'f2' }],
    };
  });
  const result = await cleanAllFactors(admin.request, identity);
  assert.ok(result.problems.some((p) => p.includes('deleting factor f2')));
  assert.ok(result.problems.some((p) => p.includes('remain')));
});

test('nonzero readback fails even when every deletion reported success', async () => {
  const admin = fakeAdmin((pathname, options) => {
    if (options.method === 'DELETE') return { ok: true, status: 200, body: {} };
    // Both listings return one factor: deletion silently did not stick.
    return { ok: true, status: 200, body: [{ id: 'f1' }] };
  });
  const result = await cleanAllFactors(admin.request, identity);
  assert.ok(result.problems.some((p) => p.includes('remain')));
});
