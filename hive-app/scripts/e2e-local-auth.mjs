#!/usr/bin/env node
/**
 * e2e-local-auth — black-box proof of the executable auth path
 * (P0-1/P0-2; hardened by the second RETURN directive, areas 1, 4, 5).
 *
 * Runs only against the full local Supabase stack (Docker lane), after
 * `local-supabase.mjs up` and `seed`. Everything is exercised from the
 * outside — GoTrue REST, Mailpit REST, PostgREST — never through app code
 * and never through SQL impersonation. Every JWT assertion compares
 * against the CANONICAL identity definitions
 * (scripts/lib/synthetic-identities.mjs), not against any live listing.
 *
 * Reliability contract (area 5):
 *  - Mailpit message IDs are snapshotted BEFORE each OTP request; only a
 *    message that appears AFTER the request is accepted.
 *  - The accepted message must carry the exact recipient, the exact
 *    configured subject, and exactly one distinct six-digit token
 *    (the same token appears in both the text and HTML parts).
 *  - Refresh tokens are REQUIRED; refresh is executed unconditionally and
 *    must yield a new access token, a new refresh token, the unchanged
 *    canonical `sub`, and a retained `aal2` — and the refreshed token is
 *    what the protected PostgREST assertions use.
 *
 * Coverage (areas 1 and 4): every seeded account's OTP + JWT-sub binding;
 * repeated OTP for one user; the unknown-email negative; the full staff
 * TOTP path; and real-JWT PostgREST evidence for BOTH mixed-role users at
 * AAL1 (zero rows across all six protected tables, own membership rows
 * only) and AAL2 (exact permitted reach, zero wrong-scope rows).
 *
 * Usage: node scripts/local-supabase.mjs e2e  (wires env in memory).
 */
import process from 'node:process';

import { cleanAllFactors } from './lib/admin-factors.mjs';
import { SCOPE, SYNTHETIC_IDENTITIES } from './lib/synthetic-identities.mjs';
import { totpCode } from './lib/totp.mjs';

const url = process.env.HIVE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.HIVE_LOCAL_SERVICE_KEY;
const clientKey = process.env.HIVE_LOCAL_CLIENT_KEY;
const mailpitUrl = process.env.HIVE_LOCAL_MAILPIT_URL ?? 'http://127.0.0.1:54324';
const EXPECTED_SUBJECT = 'Your HIVE sign-in code';

if (!url || !serviceKey || !clientKey) {
  console.error('e2e-local-auth: run through `node scripts/local-supabase.mjs e2e`');
  process.exit(1);
}
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname)) {
  console.error('e2e-local-auth: refusing a non-loopback URL');
  process.exit(1);
}

let passed = 0;
let failed = 0;
function check(condition, label) {
  if (condition) {
    passed += 1;
    console.log(`ok - ${label}`);
  } else {
    failed += 1;
    console.error(`NOT OK - ${label}`);
  }
  return Boolean(condition);
}

async function auth(pathname, options = {}, bearer = clientKey) {
  const response = await fetch(`${url}/auth/v1${pathname}`, {
    ...options,
    headers: {
      apikey: clientKey,
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function admin(pathname, options = {}) {
  const response = await fetch(`${url}/auth/v1${pathname}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function rest(pathname, accessToken) {
  const response = await fetch(`${url}/rest/v1${pathname}`, {
    headers: { apikey: clientKey, Authorization: `Bearer ${accessToken}` },
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

function jwtClaims(token) {
  const payload = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Mailpit: snapshot-based, exact-message OTP retrieval (area 5).
// ---------------------------------------------------------------------------

async function mailpitSearch(email) {
  const response = await fetch(
    `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=50`,
  );
  const data = await response.json().catch(() => ({}));
  return Array.isArray(data?.messages) ? data.messages : [];
}

async function mailpitMessageIds(email) {
  return new Set((await mailpitSearch(email)).map((m) => m.ID));
}

/** Accept only a message that did not exist before the request, with the
 * exact recipient and subject, containing exactly one distinct six-digit
 * token. Returns { token } or an error marker. */
async function fetchFreshOtp(email, beforeIds) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const messages = await mailpitSearch(email);
    const fresh = messages.find((m) => !beforeIds.has(m.ID));
    if (fresh) {
      const detail = await fetch(`${mailpitUrl}/api/v1/message/${fresh.ID}`);
      const full = await detail.json().catch(() => ({}));
      const recipients = (full.To ?? []).map((t) => (t.Address ?? '').toLowerCase());
      if (!(recipients.length === 1 && recipients[0] === email.toLowerCase())) {
        return { error: `recipient mismatch: ${JSON.stringify(recipients)}` };
      }
      if (full.Subject !== EXPECTED_SUBJECT) {
        return { error: `subject mismatch: ${JSON.stringify(full.Subject)}` };
      }
      const body = `${full.Text ?? ''}\n${full.HTML ?? ''}`;
      const distinct = [...new Set(body.match(/\b\d{6}\b/g) ?? [])];
      if (distinct.length !== 1) {
        return { error: `expected exactly one distinct six-digit token, found ${distinct.length}` };
      }
      return { token: distinct[0] };
    }
    await sleep(500);
  }
  return { error: 'no new message arrived' };
}

/** Full OTP sign-in for a canonical identity; asserts the JWT sub equals
 * the canonical definition and the session is AAL1. */
async function signInWithOtp(identity) {
  const before = await mailpitMessageIds(identity.email);
  const request = await auth('/otp', {
    method: 'POST',
    body: JSON.stringify({ email: identity.email, create_user: false }),
  });
  if (!check(request.status === 200, `${identity.email}: OTP request accepted`)) return null;
  const otp = await fetchFreshOtp(identity.email, before);
  if (
    !check(
      Boolean(otp.token),
      `${identity.email}: fresh message with exact recipient/subject and exactly one distinct six-digit token (${otp.error ?? 'ok'})`,
    )
  ) {
    return null;
  }
  const verify = await auth('/verify', {
    method: 'POST',
    body: JSON.stringify({ type: 'email', email: identity.email, token: otp.token }),
  });
  if (
    !check(
      verify.status === 200 && Boolean(verify.body.access_token),
      `${identity.email}: token verified to a session (no link followed)`,
    )
  ) {
    return null;
  }
  const claims = jwtClaims(verify.body.access_token);
  check(
    claims.sub === identity.id,
    `${identity.email}: JWT sub equals the CANONICAL id ${identity.id}`,
  );
  check((claims.aal ?? 'aal1') === 'aal1', `${identity.email}: first factor yields AAL1`);
  return verify.body;
}

/** Refresh contract (area 5): refresh token REQUIRED; unconditional
 * exchange; new access + refresh tokens; canonical sub; retained AAL.
 * Returns the refreshed session — callers use IT for protected reads. */
async function mandatoryRefresh(session, identity, expectedAal, label) {
  if (!check(Boolean(session?.refresh_token), `${label}: refresh token present`)) return null;
  const refreshed = await auth('/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  if (
    !check(
      refreshed.status === 200 && Boolean(refreshed.body?.access_token),
      `${label}: refresh exchange succeeds`,
    )
  ) {
    return null;
  }
  check(
    refreshed.body.access_token !== session.access_token,
    `${label}: refresh yields a NEW access token`,
  );
  check(
    Boolean(refreshed.body.refresh_token) && refreshed.body.refresh_token !== session.refresh_token,
    `${label}: refresh yields a NEW refresh token`,
  );
  const claims = jwtClaims(refreshed.body.access_token);
  check(claims.sub === identity.id, `${label}: refreshed sub is still the canonical id`);
  check(claims.aal === expectedAal, `${label}: refreshed session retains ${expectedAal}`);
  return refreshed.body;
}

// ---------------------------------------------------------------------------
// TOTP helpers (admin cleanup keeps reruns deterministic).
// ---------------------------------------------------------------------------

/** Fail-closed factor cleanup (RETURN-3 area 5): the listing must
 * succeed, every deletion must succeed, and a final readback must prove
 * zero factors remain before any enrollment begins. */
async function adminCleanFactors(identity) {
  const { problems, deleted } = await cleanAllFactors(admin, identity);
  for (const problem of problems) {
    check(false, `${identity.email}: factor cleanup — ${problem}`);
  }
  return check(
    problems.length === 0,
    `${identity.email}: factor-clean before enrollment (${deleted} deleted, readback zero)`,
  );
}

async function enrollAndVerifyTotp(identity, session, label) {
  const access = session.access_token;
  const enroll = await auth(
    '/factors',
    { method: 'POST', body: JSON.stringify({ factor_type: 'totp', friendly_name: 'e2e' }) },
    access,
  );
  if (
    !check(
      enroll.status === 200 && Boolean(enroll.body?.totp?.secret),
      `${label}: TOTP enrollment returns a secret`,
    )
  ) {
    return null;
  }
  const factorId = enroll.body.id;
  const secret = enroll.body.totp.secret;
  const challenge = await auth(`/factors/${factorId}/challenge`, { method: 'POST' }, access);
  const verify = await auth(
    `/factors/${factorId}/verify`,
    {
      method: 'POST',
      body: JSON.stringify({ challenge_id: challenge.body?.id, code: totpCode(secret) }),
    },
    access,
  );
  if (
    !check(
      verify.status === 200 && Boolean(verify.body?.access_token),
      `${label}: TOTP verify succeeds`,
    )
  ) {
    return null;
  }
  const claims = jwtClaims(verify.body.access_token);
  check(claims.aal === 'aal2', `${label}: verified session is AAL2`);
  check(claims.sub === identity.id, `${label}: AAL2 sub is still the canonical id`);
  return { session: verify.body, factorId, secret };
}

// ---------------------------------------------------------------------------
// Scope expectations derived from the canonical seed definitions.
// ---------------------------------------------------------------------------

const CASES = {
  a1: 'eeeeeeee-0000-4000-8000-0000000000a1',
  b1: 'eeeeeeee-0000-4000-8000-0000000000b1',
  b2: 'eeeeeeee-0000-4000-8000-0000000000b2',
};
const ATTENTION = {
  a1: 'ffffffff-0000-4000-8000-0000000000a1',
  b1: 'ffffffff-0000-4000-8000-0000000000b1',
};
const NEXT_ACTIONS = {
  a1: 'ffffffff-1111-4000-8000-0000000000a1',
  b1: 'ffffffff-1111-4000-8000-0000000000b1',
};
/** Exact AAL2 reach per scope set, covering ALL SIX protected tables
 * (RETURN-3 area 6). The B-side attention/next-action rows exist
 * specifically so the missing ids here are real negatives. */
const REACH = {
  aOnly: {
    environments: [SCOPE.environmentId],
    clients: [SCOPE.clientA],
    entities: [SCOPE.entityA1],
    cases: [CASES.a1],
    case_attention_items: [ATTENTION.a1],
    case_next_actions: [NEXT_ACTIONS.a1],
  },
  aAndB1: {
    environments: [SCOPE.environmentId],
    clients: [SCOPE.clientA, SCOPE.clientB],
    entities: [SCOPE.entityA1, SCOPE.entityB1],
    cases: [CASES.a1, CASES.b1],
    case_attention_items: [ATTENTION.a1, ATTENTION.b1],
    case_next_actions: [NEXT_ACTIONS.a1, NEXT_ACTIONS.b1],
  },
};
const PROTECTED_TABLES = [
  'environments',
  'clients',
  'entities',
  'cases',
  'case_attention_items',
  'case_next_actions',
];

function idsOf(rows) {
  return new Set((rows ?? []).map((row) => row.id));
}
function sameSet(actual, expected) {
  return actual.size === expected.length && expected.every((id) => actual.has(id));
}

/** AAL1 for a user holding any staff membership: zero rows from all six
 * protected tables; exactly the own membership rows (area 4). */
async function assertStaffAal1(identity, session) {
  for (const table of PROTECTED_TABLES) {
    const result = await rest(`/${table}?select=id`, session.access_token);
    check(
      result.status === 200 && Array.isArray(result.body) && result.body.length === 0,
      `${identity.email} AAL1: zero rows from ${table}`,
    );
  }
  const memberships = await rest(
    '/memberships?select=id,user_id,environment_id,client_id,entity_id,role',
    session.access_token,
  );
  const rows = memberships.body ?? [];
  // Complete canonical tuples (RETURN-3 area 6): environment, client,
  // entity, role, AND canonical user id — from the identity definition.
  const tupleOf = (row) =>
    [row.user_id, row.environment_id, row.client_id, row.entity_id, row.role].join(':');
  const expectedTuples = identity.memberships
    .map(([clientKey, entityKey, role]) =>
      [identity.id, SCOPE.environmentId, SCOPE[clientKey], SCOPE[entityKey], role].join(':'),
    )
    .sort();
  const actualTuples = rows.map(tupleOf).sort();
  check(
    memberships.status === 200 && JSON.stringify(actualTuples) === JSON.stringify(expectedTuples),
    `${identity.email} AAL1: membership rows are exactly the canonical tuples (${expectedTuples.length})`,
  );
}

/** Exact ID sets across ALL SIX protected tables with the given token. */
async function assertExactReach(identity, accessToken, reach, label) {
  for (const table of PROTECTED_TABLES) {
    const result = await rest(`/${table}?select=id`, accessToken);
    check(
      result.status === 200 && sameSet(idsOf(result.body), reach[table]),
      `${identity.email} ${label}: ${table} ids are exactly {${reach[table].join(', ')}}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Run.
// ---------------------------------------------------------------------------

const byEmail = new Map(SYNTHETIC_IDENTITIES.map((identity) => [identity.email, identity]));
const sessions = new Map();

// 1. Every seeded account signs in; JWT sub === canonical definition.
for (const identity of SYNTHETIC_IDENTITIES) {
  const session = await signInWithOtp(identity);
  if (session) sessions.set(identity.email, session);
}

// 2. Repeated OTP for the same user: the SECOND request must produce a
//    new message (snapshot semantics) whose token verifies.
{
  const identity = byEmail.get('client.owner@example.invalid');
  await sleep(1100); // respect auth.email.max_frequency = 1s
  const again = await signInWithOtp(identity);
  check(Boolean(again), `${identity.email}: repeated OTP request yields a fresh working code`);
}

// 3. Unknown email: no sign-in, no account creation.
{
  const strangerEmail = 'stranger.unknown@example.invalid';
  const stranger = await auth('/otp', {
    method: 'POST',
    body: JSON.stringify({ email: strangerEmail, create_user: false }),
  });
  check(stranger.status >= 400, 'unknown email is rejected for OTP');
  let found = false;
  for (let page = 1; page <= 10; page++) {
    const listing = await admin(`/admin/users?page=${page}&per_page=100`);
    const users = listing.body?.users ?? [];
    if (users.some((u) => (u.email ?? '').toLowerCase() === strangerEmail)) found = true;
    if (users.length < 100) break;
  }
  check(!found, 'unknown email did not create an account');
}

// 4. Full staff path (preparer.pat): enroll, AAL2, MANDATORY refresh, and
//    protected reads with the REFRESHED token; then repeat login against
//    the existing factor discovered via GET /factors.
{
  const identity = byEmail.get('preparer.pat@example.invalid');
  await adminCleanFactors(identity);
  const aal1 = await signInWithOtp(identity);
  if (aal1) {
    await assertStaffAal1(identity, aal1);
    const enrolled = await enrollAndVerifyTotp(identity, aal1, `${identity.email} enroll`);
    if (enrolled) {
      const refreshed = await mandatoryRefresh(
        enrolled.session,
        identity,
        'aal2',
        `${identity.email} AAL2`,
      );
      if (refreshed) {
        await assertExactReach(
          identity,
          refreshed.access_token,
          REACH.aAndB1,
          'AAL2 (refreshed token)',
        );
      }
      // Repeat login: fresh OTP; the verified factor is discovered from
      // GET /user (the documented factor listing for a session), never
      // remembered from enrollment.
      const again = await signInWithOtp(identity);
      if (again) {
        const user = await auth('/user', {}, again.access_token);
        const verified = (user.body?.factors ?? []).find(
          (f) => f.factor_type === 'totp' && f.status === 'verified',
        );
        check(Boolean(verified), `${identity.email}: repeat login finds the verified factor`);
        if (verified) {
          const challenge = await auth(
            `/factors/${verified.id}/challenge`,
            { method: 'POST' },
            again.access_token,
          );
          const verify = await auth(
            `/factors/${verified.id}/verify`,
            {
              method: 'POST',
              body: JSON.stringify({
                challenge_id: challenge.body?.id,
                code: totpCode(enrolled.secret),
              }),
            },
            again.access_token,
          );
          const repeatAal =
            verify.status === 200 && verify.body?.access_token
              ? jwtClaims(verify.body.access_token).aal
              : null;
          check(
            repeatAal === 'aal2',
            `${identity.email}: repeat login reaches AAL2 against the existing factor`,
          );
        }
      }
    }
  }
}

// 5. Mixed-role users with real JWTs (area 4): AAL1 zero-rows across all
//    six protected tables + exact own memberships; AAL2 exact reach and
//    zero wrong-scope rows — all via the refreshed token.
{
  const identity = byEmail.get('mixed.cross@example.invalid');
  await adminCleanFactors(identity);
  const aal1 = await signInWithOtp(identity);
  if (aal1) {
    await assertStaffAal1(identity, aal1);
    const enrolled = await enrollAndVerifyTotp(identity, aal1, `${identity.email} enroll`);
    if (enrolled) {
      const refreshed = await mandatoryRefresh(
        enrolled.session,
        identity,
        'aal2',
        `${identity.email} AAL2`,
      );
      if (refreshed) {
        const token = refreshed.access_token;
        await assertExactReach(identity, token, REACH.aAndB1, 'AAL2');
        const wrongEntity = await rest(`/cases?select=id&entity_id=eq.${SCOPE.entityB2}`, token);
        check(
          wrongEntity.status === 200 && (wrongEntity.body ?? []).length === 0,
          `${identity.email} AAL2: zero rows for the unrelated entity B2`,
        );
        const unrelatedEntity = await rest(`/entities?select=id&id=eq.${SCOPE.entityB2}`, token);
        check(
          unrelatedEntity.status === 200 && (unrelatedEntity.body ?? []).length === 0,
          `${identity.email} AAL2: entity B2 itself stays invisible`,
        );
      }
    }
  }
}
{
  const identity = byEmail.get('mixed.same@example.invalid');
  await adminCleanFactors(identity);
  const aal1 = await signInWithOtp(identity);
  if (aal1) {
    await assertStaffAal1(identity, aal1);
    const enrolled = await enrollAndVerifyTotp(identity, aal1, `${identity.email} enroll`);
    if (enrolled) {
      const refreshed = await mandatoryRefresh(
        enrolled.session,
        identity,
        'aal2',
        `${identity.email} AAL2`,
      );
      if (refreshed) {
        const token = refreshed.access_token;
        await assertExactReach(identity, token, REACH.aOnly, 'AAL2');
        const wrongClient = await rest(`/clients?select=id&id=eq.${SCOPE.clientB}`, token);
        check(
          wrongClient.status === 200 && (wrongClient.body ?? []).length === 0,
          `${identity.email} AAL2: zero rows for the unrelated client B`,
        );
        const wrongEntityCases = await rest(
          `/cases?select=id&entity_id=eq.${SCOPE.entityB1}`,
          token,
        );
        check(
          wrongEntityCases.status === 200 && (wrongEntityCases.body ?? []).length === 0,
          `${identity.email} AAL2: zero case rows for the unrelated entity B1`,
        );
      }
    }
  }
}

// 6. A pure client user's AAL1 refresh also satisfies the refresh
//    contract (sub retained, aal1 retained) — refresh is not AAL2-only.
{
  const identity = byEmail.get('client.owner@example.invalid');
  const session = sessions.get(identity.email);
  if (session) {
    await mandatoryRefresh(session, identity, 'aal1', `${identity.email} AAL1`);
  }
}

console.log(`e2e-local-auth: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
