#!/usr/bin/env node
/**
 * seed-local — server-side synthetic identity harness for the full local
 * Supabase stack (P0-2; hardened by the second RETURN directive, area 1).
 *
 * Every synthetic identity has one fixed canonical Auth UUID
 * (scripts/lib/synthetic-identities.mjs). This harness:
 *   1. creates each user through the GoTrue Admin API SUPPLYING that id;
 *   2. verifies the exact canonical UUID, normalized email, confirmation
 *      state, exactly one email identity, that identity's user_id and
 *      email (scripts/lib/auth-verify.mjs) — never accepting any status
 *      code alone;
 *   3. fails hard if an existing user holds the right email under a
 *      non-canonical UUID (the seed never adopts foreign ids);
 *   4. if the stack rejects fixed-ID provisioning, stops and prints the
 *      exact status and response body for the report — the acceptance
 *      criterion is never weakened. (Supported alternative to report:
 *      complete SQL provisioning of auth.users + auth.identities under
 *      the canonical id, then Admin-API verification through this same
 *      verifier.)
 *   5. inserts the membership matrix bound to the canonical ids.
 *
 * Runs only against a loopback URL; receives its privileged key in memory
 * from scripts/local-supabase.mjs and never prints or persists it. The
 * black-box proof that each account can sign in (JWT `sub` compared to
 * the canonical definition) lives in scripts/e2e-local-auth.mjs.
 */
import process from 'node:process';

import { verifyCanonicalUser } from './lib/auth-verify.mjs';
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
  const text = await response.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { ok: response.ok, status: response.status, body, text };
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

function failVerification(email, problems) {
  console.error(`seed-local: verification FAILED for ${email}:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

let created = 0;
let existing = 0;

for (const identity of SYNTHETIC_IDENTITIES) {
  const createResult = await adminRequest('/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      id: identity.id,
      email: identity.email,
      email_confirm: true,
    }),
  });
  if (createResult.ok) {
    const problems = verifyCanonicalUser(createResult.body, identity);
    if (problems.length > 0) {
      // Includes the case where the stack silently IGNORED the supplied
      // id: the created user then fails the exact-UUID check. Report the
      // exact response for the PM per the directive.
      console.error(
        `seed-local: created user for ${identity.email} failed canonical verification.`,
      );
      console.error(`  exact response (status ${createResult.status}): ${createResult.text}`);
      console.error(
        '  If the id was rejected or ignored, fixed-ID provisioning may be unsupported by this stack version — report the response above verbatim. Supported alternative: complete SQL provisioning of auth.users + auth.identities under the canonical id, then re-run this harness (it verifies through the Admin API either way).',
      );
      failVerification(identity.email, problems);
    }
    created += 1;
    continue;
  }
  // Any non-ok status — 422 or otherwise — is proven, never assumed.
  const byEmail = await listUsersByEmail();
  const found = byEmail.get(identity.email.toLowerCase());
  if (!found) {
    console.error(
      `seed-local: creating ${identity.email} with the canonical id failed and no user with that email exists.`,
    );
    console.error(`  exact response (status ${createResult.status}): ${createResult.text}`);
    console.error(
      '  If this response rejects the supplied id, fixed-ID provisioning may be unsupported by this stack version — report it verbatim; supported alternative: complete SQL provisioning of auth.users + auth.identities under the canonical id, then re-run this harness.',
    );
    process.exit(1);
  }
  const problems = verifyCanonicalUser(found, identity);
  if (problems.length > 0) {
    if (found.id !== identity.id) {
      console.error(
        `seed-local: existing user for ${identity.email} holds NON-CANONICAL id ${found.id} (expected ${identity.id}).`,
      );
      console.error(
        '  The seed never adopts foreign ids. Reset the local stack (db reset) or remove that user, then re-run.',
      );
    }
    failVerification(identity.email, problems);
  }
  existing += 1;
}

// Memberships bound to the canonical ids (all users above verified to
// carry exactly those ids), idempotent on the natural key.
const rows = membershipRows();
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

// Read-back: the effective matrix must match exactly, row for row.
const check = await restRequest(
  '/memberships?select=user_id,environment_id,client_id,entity_id,role',
  { method: 'GET' },
);
if (!check.ok) {
  console.error(`seed-local: membership read-back failed with status ${check.status}`);
  process.exit(1);
}
const effective = JSON.parse(check.text);
if (effective.length !== rows.length) {
  console.error(
    `seed-local: membership matrix mismatch — expected ${rows.length}, found ${effective.length}`,
  );
  process.exit(1);
}
const keyOf = (r) => [r.user_id, r.environment_id, r.client_id, r.entity_id, r.role].join(':');
const effectiveKeys = new Set(effective.map(keyOf));
const missing = rows.filter((r) => !effectiveKeys.has(keyOf(r)));
if (missing.length > 0) {
  console.error(`seed-local: ${missing.length} expected membership rows are missing after upsert`);
  for (const row of missing) console.error(`  - ${keyOf(row)}`);
  process.exit(1);
}

console.log(
  `seed-local: ${created} created, ${existing} verified existing, ${rows.length} memberships in place, all ids canonical`,
);
