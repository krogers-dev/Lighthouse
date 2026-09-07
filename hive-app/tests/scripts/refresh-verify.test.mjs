import assert from 'node:assert/strict';
import { test } from 'node:test';

import { msUntilIatAdvance, verifyRefreshedSession } from '../../scripts/lib/refresh-verify.mjs';

const SUB = 'cccccccc-0000-4000-8000-000000000003';
function pair(overrides = {}) {
  return {
    previous: {
      accessToken: 'token-one',
      refreshToken: 'refresh-one',
      claims: { iat: 100, exp: 3700, sub: SUB, session_id: 'sess-1', aal: 'aal2' },
      ...overrides.previous,
    },
    refreshed: {
      accessToken: 'token-two',
      refreshToken: 'refresh-two',
      claims: { iat: 101, exp: 3701, sub: SUB, session_id: 'sess-1', aal: 'aal2' },
      ...overrides.refreshed,
    },
  };
}
const EXPECT = { canonicalSub: SUB, expectedAal: 'aal2', nowMs: 102_000 };

test('a properly advanced refresh verifies cleanly', () => {
  const { previous, refreshed } = pair();
  assert.deepEqual(verifyRefreshedSession(previous, refreshed, EXPECT), []);
});

test('REGRESSION: a valid same-second exchange is flagged as not-yet-advanced, deterministically', () => {
  // Same iat second; GoTrue may legally mint identical bytes here.
  const { previous } = pair();
  const refreshed = {
    accessToken: 'token-one',
    refreshToken: 'refresh-two',
    claims: { iat: 100, exp: 3700, sub: SUB, session_id: 'sess-1', aal: 'aal2' },
  };
  const problems = verifyRefreshedSession(previous, refreshed, EXPECT);
  assert.ok(problems.some((p) => p.includes('did not advance')));
  assert.ok(problems.some((p) => p.includes('byte-identical')));
});

test('msUntilIatAdvance computes the deterministic wait', () => {
  assert.equal(msUntilIatAdvance(100, 100_200), 800);
  assert.equal(msUntilIatAdvance(100, 100_999), 1);
  assert.equal(msUntilIatAdvance(100, 101_000), 0);
  assert.equal(msUntilIatAdvance(100, 250_000), 0);
});

test('rotation, sub, session, aal, and timing are all enforced', () => {
  const base = pair();
  const cases = [
    [{ refreshed: { ...base.refreshed, refreshToken: 'refresh-one' } }, /rotate/],
    [
      { refreshed: { ...base.refreshed, claims: { ...base.refreshed.claims, sub: 'other' } } },
      /canonical/,
    ],
    [
      { refreshed: { ...base.refreshed, claims: { ...base.refreshed.claims, session_id: 'x' } } },
      /session_id/,
    ],
    [
      { refreshed: { ...base.refreshed, claims: { ...base.refreshed.claims, aal: 'aal1' } } },
      /aal/,
    ],
    [{ refreshed: { ...base.refreshed, claims: { ...base.refreshed.claims, exp: 50 } } }, /exp/],
    [
      {
        refreshed: {
          ...base.refreshed,
          claims: { ...base.refreshed.claims, iat: 999_999, exp: 1_000_100 },
        },
      },
      /future/,
    ],
  ];
  for (const [override, expected] of cases) {
    const { previous, refreshed } = pair(override);
    const problems = verifyRefreshedSession(previous, refreshed, EXPECT);
    assert.ok(
      problems.some((p) => expected.test(p)),
      `${expected}: ${JSON.stringify(problems)}`,
    );
  }
});
