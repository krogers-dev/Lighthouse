#!/usr/bin/env node
/**
 * hosted-review-proof — the review tenant's black-box path against a
 * hosted rehearsal project (WO-011).
 *
 *   node scripts/hosted-supabase.mjs staging prove-review
 *
 * The same path the local harness runs (scripts/lib/review-tenant-path.mjs,
 * fallback mode, since no hosted plan below Teams runs the hook), as real
 * requests against the hosted project: the tenant seeded through the
 * operator mode; a code useless without a window; a window opened and the
 * code set; the review identity signed in through the public sign-in
 * endpoint with the publishable key, reading exactly the review
 * environment and none of the project's other clients; a second identity
 * with a password of its own refused; expiry by the sweep and a close on
 * request, each ending the code and the session; the trail; retirement.
 * Then what only a hosted run can show: the operator mode leaves the
 * project with no window, no registered review identity, no membership
 * for it, and no trace of the proof's second identity.
 *
 * It sets passwords and opens and closes windows, so it never runs on
 * production and refuses to start while a window is open. It requests no
 * sign-in code, so no email is sent. The second identity is a throwaway
 * on example.invalid, created and deleted here.
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isPublishableKeyShape, loadHostedManifest, proofAllowed } from './lib/hosted-targets.mjs';
import { resolveOperatorContext } from './lib/operator-context.mjs';
import { assertReviewTenantPath } from './lib/review-tenant-path.mjs';
import { REVIEW_TENANT } from './lib/review-tenant.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error(`hosted-review-proof: ${message}`);
  process.exit(1);
}

const context = resolveOperatorContext(process.env, loadHostedManifest());
if (context.error) fail(context.error);
if (context.kind !== 'hosted') {
  fail(
    'this proof is for a hosted target; the local lane has the harness (local-supabase.mjs e2e)',
  );
}
if (!proofAllowed(context.name, context.target)) {
  fail(
    context.name === 'production'
      ? 'the proof never runs on production: it sets passwords and opens and closes windows'
      : `the proof is not allowed on ${context.name} by security/hosted-targets.json`,
  );
}
if (!isPublishableKeyShape(context.clientKey)) {
  fail('no publishable key was handed over; run through scripts/hosted-supabase.mjs');
}

const { url, serviceKey, gatewayKey, clientKey, reviewEmail, name } = context;
const server = {
  apikey: gatewayKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

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

async function serverCall(pathname, options = {}) {
  const response = await fetch(`${url}${pathname}`, {
    ...options,
    headers: { ...server, ...options.headers },
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/** The app's own read: the publishable key and the signed-in token. */
async function rest(pathname, accessToken) {
  const response = await fetch(`${url}/rest/v1${pathname}`, {
    headers: { apikey: clientKey, Authorization: `Bearer ${accessToken}` },
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

const tool = (mode) =>
  spawnSync(process.execPath, [path.join(appRoot, 'scripts', 'seed-review-tenant.mjs')], {
    cwd: appRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HIVE_REVIEW_MODE: mode },
  }).status === 0;

// Never end somebody's real window.
const before = await serverCall('/rest/v1/rpc/review_window_status', {
  method: 'POST',
  body: '{}',
});
if (before.status !== 200) fail(`review_window_status answered ${before.status}`);
if (before.body?.open === true) {
  fail(`a review window is open on ${name}; the proof would end it. Close it first.`);
}
console.log(
  `hosted-review-proof [${name}]: starting with ${before.body?.review_identities ?? 0} registered review identity and no open window; the review address is ${reviewEmail}`,
);

const throwawayEmail = `hive.proof.${randomUUID()}@example.invalid`;
const createdOther = await serverCall('/auth/v1/admin/users', {
  method: 'POST',
  body: JSON.stringify({ email: throwawayEmail, email_confirm: true }),
});
const otherId = typeof createdOther.body?.id === 'string' ? createdOther.body.id : '';
if (
  !check(
    createdOther.status === 200 && otherId !== '',
    `hosted: a throwaway second identity is created for the negative (${createdOther.status})`,
  )
) {
  console.error(`hosted-review-proof [${name}]: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

let pathError = null;
try {
  await assertReviewTenantPath({
    rest,
    check,
    uuidV4: randomUUID,
    url,
    clientKey,
    serviceKey,
    gatewayKey,
    seedReview: async () => tool('seed'),
    retireReview: async () => tool('retire'),
    hookMode: false,
    reviewEmail,
    otherIdentity: { id: otherId, email: throwawayEmail, label: 'a second identity' },
  });
} catch (error) {
  pathError = error;
  // Whatever happened, leave no way in behind.
  tool('retire');
}
check(pathError === null, 'hosted: the path ran to its end without an error');

// What only a hosted run can show: the operator mode leaves nothing open.
const after = await serverCall('/rest/v1/rpc/review_window_status', { method: 'POST', body: '{}' });
check(
  after.status === 200 && after.body?.open === false && after.body?.review_identities === 0,
  'hosted: afterwards no window is open and no review identity is registered',
);
const memberships = await serverCall(
  `/rest/v1/memberships?select=role&user_id=eq.${REVIEW_TENANT.identity.id}`,
);
check(
  memberships.status === 200 && (memberships.body ?? []).length === 0,
  'hosted: the retired review identity holds no membership',
);
const identity = await serverCall(`/auth/v1/admin/users/${REVIEW_TENANT.identity.id}`);
check(
  identity.status === 200 && identity.body?.email === reviewEmail,
  'hosted: the review identity exists under its canonical id with the review address',
);
const removedOther = await serverCall(`/auth/v1/admin/users/${otherId}`, { method: 'DELETE' });
const goneOther = await serverCall(`/auth/v1/admin/users/${otherId}`);
check(
  removedOther.status === 200 && goneOther.status === 404,
  `hosted: the throwaway second identity is deleted (${removedOther.status}, then ${goneOther.status})`,
);

console.log(`hosted-review-proof [${name}]: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
