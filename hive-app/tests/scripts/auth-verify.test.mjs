import assert from 'node:assert/strict';
import { test } from 'node:test';

import { verifyCanonicalUser } from '../../scripts/lib/auth-verify.mjs';
import { SYNTHETIC_IDENTITIES } from '../../scripts/lib/synthetic-identities.mjs';

const canonical = SYNTHETIC_IDENTITIES[0];

/** The exact GoTrue admin-API user shape the pinned stack returns
 * (supabase CLI 2.115.0 auth container), reduced to the verified fields. */
function gotrueUser(overrides = {}) {
  return {
    id: canonical.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: canonical.email,
    email_confirmed_at: '2026-08-21T00:00:00.000000Z',
    confirmed_at: '2026-08-21T00:00:00.000000Z',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [
      {
        identity_id: '11111111-2222-4333-8444-555555555555',
        id: canonical.id,
        user_id: canonical.id,
        identity_data: {
          email: canonical.email,
          email_verified: true,
          phone_verified: false,
          sub: canonical.id,
        },
        provider: 'email',
        last_sign_in_at: '2026-08-21T00:00:00.000000Z',
        created_at: '2026-08-21T00:00:00.000000Z',
        updated_at: '2026-08-21T00:00:00.000000Z',
      },
    ],
    created_at: '2026-08-21T00:00:00.000000Z',
    updated_at: '2026-08-21T00:00:00.000000Z',
    ...overrides,
  };
}

test('accepts the exact canonical user shape', () => {
  assert.deepEqual(verifyCanonicalUser(gotrueUser(), canonical), []);
});

test('accepts case-differing email as normalized match', () => {
  const user = gotrueUser({ email: canonical.email.toUpperCase() });
  user.identities[0].identity_data.email = canonical.email.toUpperCase();
  assert.deepEqual(verifyCanonicalUser(user, canonical), []);
});

test('rejects a non-canonical user id exactly', () => {
  const problems = verifyCanonicalUser(
    gotrueUser({ id: 'cccccccc-0000-4000-8000-00000000ffff' }),
    canonical,
  );
  assert.ok(problems.some((p) => p.includes('canonical id')));
});

test('rejects wrong email, unconfirmed state, and missing identities', () => {
  assert.ok(
    verifyCanonicalUser(gotrueUser({ email: 'other@example.invalid' }), canonical).length > 0,
  );
  assert.ok(
    verifyCanonicalUser(
      gotrueUser({ email_confirmed_at: null, confirmed_at: null }),
      canonical,
    ).some((p) => p.includes('confirmed')),
  );
  assert.ok(
    verifyCanonicalUser(gotrueUser({ identities: [] }), canonical).some((p) =>
      p.includes('exactly one email identity'),
    ),
  );
});

test('rejects a second email identity and non-email providers alone', () => {
  const doubled = gotrueUser();
  doubled.identities = [doubled.identities[0], { ...doubled.identities[0] }];
  assert.ok(
    verifyCanonicalUser(doubled, canonical).some((p) => p.includes('exactly one email identity')),
  );
  const phoneOnly = gotrueUser();
  phoneOnly.identities = [{ ...phoneOnly.identities[0], provider: 'phone' }];
  assert.ok(
    verifyCanonicalUser(phoneOnly, canonical).some((p) => p.includes('exactly one email identity')),
  );
});

test('rejects an identity bound to a different user_id', () => {
  const user = gotrueUser();
  user.identities[0].user_id = 'cccccccc-0000-4000-8000-00000000ffff';
  assert.ok(verifyCanonicalUser(user, canonical).some((p) => p.includes('identity user_id')));
});

test('rejects an identity carrying a different email', () => {
  const user = gotrueUser();
  user.identities[0].identity_data.email = 'other@example.invalid';
  assert.ok(verifyCanonicalUser(user, canonical).some((p) => p.includes('identity email')));
});

test('every synthetic identity has a well-formed unique canonical id', () => {
  const seen = new Set();
  for (const identity of SYNTHETIC_IDENTITIES) {
    assert.match(identity.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.ok(!seen.has(identity.id), `duplicate canonical id ${identity.id}`);
    seen.add(identity.id);
    assert.match(identity.email, /@example\.invalid$/);
  }
});

// ---------------------------------------------------------------------------
// RETURN-3 area 4: stricter canonical verification
// ---------------------------------------------------------------------------

test('phone-confirmed but email-unconfirmed is rejected (generic confirmed_at is not enough)', () => {
  const user = gotrueUser({
    email_confirmed_at: null,
    confirmed_at: '2026-08-21T00:00:00.000000Z',
    phone_confirmed_at: '2026-08-21T00:00:00.000000Z',
  });
  const problems = verifyCanonicalUser(user, canonical);
  assert.ok(
    problems.some((p) => p.includes('email_confirmed_at')),
    `expected email_confirmed_at rejection; got ${JSON.stringify(problems)}`,
  );
});

test('non-authenticated role is rejected (service_role negative)', () => {
  const problems = verifyCanonicalUser(gotrueUser({ role: 'service_role' }), canonical);
  assert.ok(problems.some((p) => p.includes('role')));
});

test('non-authenticated aud is rejected', () => {
  const problems = verifyCanonicalUser(gotrueUser({ aud: 'admin' }), canonical);
  assert.ok(problems.some((p) => p.includes('aud')));
});

test('anonymous users are rejected', () => {
  const problems = verifyCanonicalUser(gotrueUser({ is_anonymous: true }), canonical);
  assert.ok(problems.some((p) => p.includes('anonymous')));
  // Absent or false is fine.
  assert.deepEqual(verifyCanonicalUser(gotrueUser({ is_anonymous: false }), canonical), []);
});
