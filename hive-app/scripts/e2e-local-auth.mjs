#!/usr/bin/env node
/**
 * e2e-local-auth — black-box proof of the executable auth path (P0-1/P0-2).
 *
 * Runs only against the full local Supabase stack (Docker lane), after
 * `local-supabase.mjs up` and `seed`. Everything is exercised from the
 * outside — GoTrue REST, Mailpit REST, PostgREST — never through app code:
 *
 *   1. For every login-capable synthetic account: request an email OTP
 *      (shouldCreateUser=false), pull the message from Mailpit, extract the
 *      six-digit token from the body (no link is ever followed), verify it,
 *      and assert the JWT `sub` equals the seeded user id and the session
 *      is AAL1.
 *   2. Negative: an unknown email cannot sign in or create an account.
 *   3. TOTP: enroll a factor for a staff account, compute RFC 6238 codes
 *      locally, challenge+verify to AAL2, then prove repeat login works
 *      against the existing factor.
 *   4. Token refresh: exchange the refresh token and use the new access
 *      token.
 *   5. Direct PostgREST RLS negatives with real JWTs: staff at AAL1 reads
 *      zero protected rows (own membership rows only); AAL2 reads exactly
 *      the membership-covered rows.
 *
 * Usage: HIVE_LOCAL_SUPABASE_URL=… HIVE_LOCAL_SERVICE_KEY=… \
 *        HIVE_LOCAL_CLIENT_KEY=… node scripts/e2e-local-auth.mjs
 * (local-supabase.mjs e2e wires these from `supabase status` in memory.)
 */
import process from 'node:process';

import { SYNTHETIC_IDENTITIES } from './lib/synthetic-identities.mjs';
import { totpCode } from './lib/totp.mjs';

const url = process.env.HIVE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.HIVE_LOCAL_SERVICE_KEY;
const clientKey = process.env.HIVE_LOCAL_CLIENT_KEY;
const mailpitUrl = process.env.HIVE_LOCAL_MAILPIT_URL ?? 'http://127.0.0.1:54324';

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

async function admin(pathname) {
  const response = await fetch(`${url}/auth/v1${pathname}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
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

async function fetchOtpFromMailpit(email) {
  // Poll: mail delivery is asynchronous.
  for (let attempt = 0; attempt < 20; attempt++) {
    const search = await fetch(
      `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=1`,
    );
    const data = await search.json().catch(() => ({}));
    const id = data?.messages?.[0]?.ID;
    if (id) {
      const message = await fetch(`${mailpitUrl}/api/v1/message/${id}`);
      const full = await message.json().catch(() => ({}));
      const body = `${full.Text ?? ''}\n${full.HTML ?? ''}`;
      const token = /\b(\d{6})\b/.exec(body)?.[1];
      if (token) return token;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

async function signInWithOtp(email) {
  const request = await auth('/otp', {
    method: 'POST',
    body: JSON.stringify({ email, create_user: false }),
  });
  check(request.status === 200, `${email}: OTP request accepted`);
  const token = await fetchOtpFromMailpit(email);
  check(token !== null, `${email}: six-digit token found in Mailpit (no link followed)`);
  if (!token) return null;
  const verify = await auth('/verify', {
    method: 'POST',
    body: JSON.stringify({ type: 'email', email, token }),
  });
  check(verify.status === 200 && verify.body.access_token, `${email}: token verified to a session`);
  return verify.body;
}

const seededByEmail = new Map();
for (let page = 1; page <= 10; page++) {
  const listing = await admin(`/admin/users?page=${page}&per_page=100`);
  for (const user of listing.body?.users ?? []) {
    if (user.email) seededByEmail.set(user.email.toLowerCase(), user);
  }
  if ((listing.body?.users ?? []).length < 100) break;
}

// 1. Every login-capable account signs in with a code and the JWT subject
//    matches the seeded id.
for (const identity of SYNTHETIC_IDENTITIES) {
  const seeded = seededByEmail.get(identity.email.toLowerCase());
  check(Boolean(seeded), `${identity.email}: exists in GoTrue after seeding`);
  if (!seeded) continue;
  const session = await signInWithOtp(identity.email);
  if (!session) continue;
  const claims = jwtClaims(session.access_token);
  check(claims.sub === seeded.id, `${identity.email}: JWT sub equals seeded user id`);
  check((claims.aal ?? 'aal1') === 'aal1', `${identity.email}: first factor yields AAL1`);
  identity.session = session;
}

// 2. Unknown email: no sign-in, no account creation.
const strangerEmail = 'stranger.unknown@example.invalid';
const stranger = await auth('/otp', {
  method: 'POST',
  body: JSON.stringify({ email: strangerEmail, create_user: false }),
});
check(stranger.status >= 400, 'unknown email is rejected for OTP');
const strangerCheck = await admin(`/admin/users?page=1&per_page=100`);
check(
  !(strangerCheck.body?.users ?? []).some((u) => (u.email ?? '').toLowerCase() === strangerEmail),
  'unknown email did not create an account',
);

// 3. TOTP enrollment for a staff account, then repeat login with the factor.
const staff = SYNTHETIC_IDENTITIES.find((i) => i.email === 'preparer.pat@example.invalid');
if (staff?.session) {
  const access = staff.session.access_token;
  const enroll = await auth(
    '/factors',
    { method: 'POST', body: JSON.stringify({ factor_type: 'totp', friendly_name: 'e2e' }) },
    access,
  );
  check(
    enroll.status === 200 && enroll.body?.totp?.secret,
    'staff TOTP enrollment returns a secret',
  );
  const factorId = enroll.body?.id;
  const secret = enroll.body?.totp?.secret;
  if (factorId && secret) {
    const challenge = await auth(`/factors/${factorId}/challenge`, { method: 'POST' }, access);
    const verifyMfa = await auth(
      `/factors/${factorId}/verify`,
      {
        method: 'POST',
        body: JSON.stringify({ challenge_id: challenge.body?.id, code: totpCode(secret) }),
      },
      access,
    );
    check(verifyMfa.status === 200 && verifyMfa.body?.access_token, 'TOTP verify succeeds');
    const aal2Claims = verifyMfa.body?.access_token ? jwtClaims(verifyMfa.body.access_token) : {};
    check(aal2Claims.aal === 'aal2', 'verified session is AAL2');
    staff.aal2Session = verifyMfa.body;

    // Repeat login against the existing factor: fresh OTP, then verify again.
    const repeat = await signInWithOtp(staff.email);
    if (repeat) {
      const repeatChallenge = await auth(
        `/factors/${factorId}/challenge`,
        { method: 'POST' },
        repeat.access_token,
      );
      const repeatVerify = await auth(
        `/factors/${factorId}/verify`,
        {
          method: 'POST',
          body: JSON.stringify({ challenge_id: repeatChallenge.body?.id, code: totpCode(secret) }),
        },
        repeat.access_token,
      );
      check(repeatVerify.status === 200, 'repeat login verifies against the existing factor');
    }

    // 4. Token refresh on the AAL2 session.
    if (staff.aal2Session?.refresh_token) {
      const refreshed = await auth('/token?grant_type=refresh_token', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: staff.aal2Session.refresh_token }),
      });
      check(refreshed.status === 200 && refreshed.body?.access_token, 'refresh token exchanges');
      if (refreshed.body?.access_token) {
        staff.aal2Session = refreshed.body;
      }
    }

    // 5. Direct PostgREST RLS: AAL1 staff sees zero protected rows (own
    //    memberships only); AAL2 sees membership-covered rows.
    const aal1 = await signInWithOtp(staff.email);
    if (aal1) {
      const casesAal1 = await rest('/cases?select=id', aal1.access_token);
      check(
        casesAal1.status === 200 && Array.isArray(casesAal1.body) && casesAal1.body.length === 0,
        'direct PostgREST: staff at AAL1 reads zero cases',
      );
      const membershipsAal1 = await rest('/memberships?select=id', aal1.access_token);
      check(
        membershipsAal1.status === 200 && (membershipsAal1.body ?? []).length === 2,
        'direct PostgREST: staff at AAL1 still reads exactly their own membership rows',
      );
    }
    if (staff.aal2Session?.access_token) {
      const casesAal2 = await rest('/cases?select=id', staff.aal2Session.access_token);
      check(
        casesAal2.status === 200 && (casesAal2.body ?? []).length === 2,
        'direct PostgREST: staff at AAL2 reads exactly the membership-covered cases',
      );
    }
  }
} else {
  check(false, 'staff session available for TOTP enrollment');
}

console.log(`e2e-local-auth: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
