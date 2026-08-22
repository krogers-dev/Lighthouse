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

// ---------------------------------------------------------------------------
// RETURN-4 P1-1: adapter contract and fail-stop termination
// ---------------------------------------------------------------------------

test("CONTRACT: the real adapter shape without 'ok' is rejected as a contract violation, never misread", async () => {
  // Exactly what the real e2e admin() once returned: {status, body}, no ok.
  const realShape = async () => ({ status: 200, body: [] });
  const result = await cleanAllFactors(realShape, identity);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /violates the contract/);
  assert.match(result.problems[0], /missing boolean 'ok'/);
});

test('requireFactorsClean THROWS on failure so nothing after it can run', async () => {
  const { requireFactorsClean, FactorCleanupError } =
    await import('../../scripts/lib/admin-factors.mjs');
  const calls = [];
  const failing = async (pathname, options = {}) => {
    calls.push(options.method ?? 'GET');
    return { ok: false, status: 500, body: {} };
  };
  let mutationRan = false;
  await assert.rejects(
    (async () => {
      await requireFactorsClean(failing, identity);
      mutationRan = true; // would represent OTP/enrollment/any mutation
    })(),
    FactorCleanupError,
  );
  assert.equal(mutationRan, false);
  // Only the failed listing happened — no deletions, no other calls.
  assert.deepEqual(calls, ['GET']);
});

test('requireFactorsClean resolves with the deletion count on success', async () => {
  const { requireFactorsClean } = await import('../../scripts/lib/admin-factors.mjs');
  let listed = 0;
  const healthy = async (pathname, options = {}) => {
    if ((options.method ?? 'GET') === 'DELETE') return { ok: true, status: 200, body: {} };
    listed += 1;
    return { ok: true, status: 200, body: listed === 1 ? [{ id: 'f1' }] : [] };
  };
  assert.equal(await requireFactorsClean(healthy, identity), 1);
});
