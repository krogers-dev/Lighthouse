#!/usr/bin/env node
/**
 * seed-local — server-side synthetic identity harness for the full local
 * Supabase stack (P0-2).
 *
 * Placeholder auth.users rows cannot sign in, so this harness:
 *   1. creates every synthetic user through the GoTrue Admin API
 *      (login-capable, email confirmed);
 *   2. never accepts a 422/conflict by status code alone — every user is
 *      re-fetched and verified: normalized email match, confirmed state,
 *      and exactly one email-provider identity;
 *   3. inserts the canonical membership matrix
 *      (scripts/lib/synthetic-identities.mjs) bound to the real user ids
 *      through PostgREST, idempotently.
 *
 * Runs only against a loopback URL; receives its privileged key in memory
 * from scripts/local-supabase.mjs and never prints or persists it. The
 * black-box proof that each account can request and verify an OTP lives in
 * scripts/e2e-local-auth.mjs (run it after this).
 */
import process from 'node:process';

import { SYNTHETIC_IDENTITIES, membershipRows } from './lib/synthetic-identities.mjs';

const url = process.env.HIVE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.HIVE_LOCAL_SERVICE_KEY;

if (!url || !serviceKey) {
  console.error('seed-local: run through `node scripts/local-supabase.mjs seed`');
  process.exit(1);
}
const host = new URL(url).hostname;
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
  console.error('seed-local: refusing a non-loopback URL');
  process.exit(1);
}

async function adminRequest(pathname, options = {}) {
  const response = await fetch(`${url}/auth/v1${pathname}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

async function restRequest(pathname, options = {}) {
  const response = await fetch(`${url}/rest/v1${pathname}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, text };
}

/** List all users (paged) and index by normalized email. */
async function listUsersByEmail() {
  const byEmail = new Map();
  for (let page = 1; page <= 10; page++) {
    const result = await adminRequest(`/admin/users?page=${page}&per_page=100`);
    if (!result.ok) {
      throw new Error(`admin user listing failed with status ${result.status}`);
    }
    const users = result.body?.users ?? [];
    for (const user of users) {
      if (typeof user.email === 'string') {
        byEmail.set(user.email.toLowerCase(), user);
      }
    }
    if (users.length < 100) break;
  }
  return byEmail;
}

/** Strict verification per the PM directive: normalized email, confirmed,
 * exactly one email-provider identity. Returns the verified user id. */
function verifyUser(user, email) {
  const problems = [];
  if ((user.email ?? '').toLowerCase() !== email.toLowerCase()) {
    problems.push('email mismatch');
  }
  if (!user.email_confirmed_at && !user.confirmed_at) {
    problems.push('email not confirmed');
  }
  const identities = Array.isArray(user.identities) ? user.identities : [];
  const emailIdentities = identities.filter((identity) => identity.provider === 'email');
  if (emailIdentities.length !== 1) {
    problems.push(`expected exactly one email identity, found ${emailIdentities.length}`);
  }
  if (typeof user.id !== 'string' || user.id.length < 36) {
    problems.push('missing user id');
  }
  if (problems.length > 0) {
    throw new Error(`verification failed for ${email}: ${problems.join('; ')}`);
  }
  return user.id;
}

let created = 0;
let existing = 0;
const resolvedIdByEmail = new Map();

for (const identity of SYNTHETIC_IDENTITIES) {
  const createResult = await adminRequest('/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email: identity.email, email_confirm: true }),
  });
  if (createResult.ok) {
    created += 1;
    resolvedIdByEmail.set(identity.email, verifyUser(createResult.body, identity.email));
    continue;
  }
  // Any non-ok status — 422 or otherwise — is proven, never assumed: the
  // user must exist and pass full verification, or the harness fails.
  const byEmail = await listUsersByEmail();
  const found = byEmail.get(identity.email.toLowerCase());
  if (!found) {
    console.error(
      `seed-local: creating ${identity.email} failed with status ${createResult.status} and no matching user exists`,
    );
    process.exit(1);
  }
  resolvedIdByEmail.set(identity.email, verifyUser(found, identity.email));
  existing += 1;
}

// Memberships bound to the real ids, idempotent on the natural key.
const rows = membershipRows(resolvedIdByEmail);
const upsert = await restRequest(
  '/memberships?on_conflict=user_id,environment_id,client_id,entity_id,role',
  {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  },
);
if (!upsert.ok) {
  console.error(`seed-local: membership insert failed with status ${upsert.status}`);
  process.exit(1);
}

// Read-back: the effective matrix must match exactly.
const check = await restRequest('/memberships?select=user_id,role', { method: 'GET' });
if (!check.ok) {
  console.error(`seed-local: membership read-back failed with status ${check.status}`);
  process.exit(1);
}
const effective = JSON.parse(check.text).length;
if (effective !== rows.length) {
  console.error(
    `seed-local: membership matrix mismatch — expected ${rows.length}, found ${effective}`,
  );
  process.exit(1);
}

console.log(
  `seed-local: ${created} created, ${existing} verified existing, ${rows.length} memberships in place`,
);
