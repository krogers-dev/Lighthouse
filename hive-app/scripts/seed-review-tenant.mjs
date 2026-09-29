#!/usr/bin/env node
/**
 * seed-review-tenant — the store review tenant (WO-008, option A).
 *
 *   node scripts/local-supabase.mjs seed-review     # create or verify it
 *   node scripts/local-supabase.mjs retire-review   # end its access
 *
 * seed    Upserts the dedicated review environment, its one client and
 *         entity, one case with an attention item, a next action, two
 *         open requests, and its trail; creates the one review identity
 *         (a client user, canonical id, example.invalid) through the Auth
 *         Admin API with its membership; registers it with the server as
 *         THE review identity. Never part of the main seed, so the
 *         harness's exact-reach proofs are untouched. Idempotent.
 *
 * retire  Closes any open review window, replaces the review identity's
 *         password with an unknown value, unregisters it, and removes its
 *         membership: no sign-in of any kind remains possible. The
 *         synthetic rows stay (they are inert without access) so the next
 *         seed is a verify, not a rebuild.
 *
 * Loopback only; the privileged bearer arrives in memory and is never
 * printed; nothing here prints a code.
 */
import { randomBytes } from 'node:crypto';
import process from 'node:process';

import { REVIEW_TENANT, reviewTenantRows } from './lib/review-tenant.mjs';

const url = process.env.HIVE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.HIVE_LOCAL_SERVICE_KEY;
const gatewayKey = process.env.HIVE_LOCAL_GATEWAY_KEY ?? serviceKey;
const mode = process.env.HIVE_REVIEW_MODE ?? '';

if (!url || !serviceKey) {
  console.error(
    'seed-review-tenant: run through `node scripts/local-supabase.mjs seed-review|retire-review`',
  );
  process.exit(1);
}
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname)) {
  console.error('seed-review-tenant: refusing a non-loopback URL');
  process.exit(1);
}

const headers = {
  apikey: gatewayKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

async function call(pathname, options = {}) {
  const response = await fetch(`${url}${pathname}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { ok: response.ok, status: response.status, body };
}

function fail(message) {
  console.error(`seed-review-tenant: ${message}`);
  process.exit(1);
}

const t = REVIEW_TENANT;

async function ensureIdentity() {
  const existing = await call(`/auth/v1/admin/users/${t.identity.id}`);
  if (existing.status === 200 && existing.body?.email === t.identity.email) return 'verified';
  const created = await call('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ id: t.identity.id, email: t.identity.email, email_confirm: true }),
  });
  if (!created.ok || created.body?.id !== t.identity.id) {
    fail(`the review identity could not be created under its canonical id (${created.status})`);
  }
  return 'created';
}

if (mode === 'seed') {
  // Insert or skip: the rows are fixed, and an update would touch the
  // immutable scope columns of a row that already exists.
  for (const { table, rows } of reviewTenantRows()) {
    const result = await call(`/rest/v1/${table}?on_conflict=id`, {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    });
    if (!result.ok)
      fail(`${table} upsert answered ${result.status}: ${JSON.stringify(result.body)}`);
  }
  const identity = await ensureIdentity();
  const membership = await call(
    '/rest/v1/memberships?on_conflict=user_id,environment_id,client_id,entity_id,role',
    {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify([
        {
          user_id: t.identity.id,
          environment_id: t.environmentId,
          client_id: t.clientId,
          entity_id: t.entityId,
          role: 'client_user',
        },
      ]),
    },
  );
  if (!membership.ok) fail(`the review membership upsert answered ${membership.status}`);
  const registered = await call('/rest/v1/rpc/register_review_identity', {
    method: 'POST',
    body: JSON.stringify({
      p_user_id: t.identity.id,
      p_environment_id: t.environmentId,
      p_client_id: t.clientId,
      p_entity_id: t.entityId,
    }),
  });
  if (!registered.ok || registered.body?.registered !== true) {
    fail(`register_review_identity answered ${registered.status}`);
  }
  const readback = await call(`/rest/v1/cases?select=id&environment_id=eq.${t.environmentId}`);
  if (!readback.ok || (readback.body ?? []).length !== 1) fail('the review case did not read back');
  console.log(
    `seed-review-tenant: review environment in place (1 client, 1 entity, 1 case, 2 requests); identity ${identity}; registered as the review identity`,
  );
  process.exit(0);
}

if (mode === 'retire') {
  const closed = await call('/rest/v1/rpc/close_review_window', {
    method: 'POST',
    body: JSON.stringify({ p_idempotency_key: crypto.randomUUID() }),
  });
  const windowNote = closed.ok
    ? 'window closed'
    : closed.body?.message === 'no_open_window'
      ? 'no open window'
      : `close answered ${closed.status}`;
  const scrambled = await call(`/auth/v1/admin/users/${t.identity.id}`, {
    method: 'PUT',
    body: JSON.stringify({ password: randomBytes(24).toString('base64url') }),
  });
  if (scrambled.status !== 200 && scrambled.status !== 404) {
    fail(`the review identity's password could not be replaced (${scrambled.status})`);
  }
  const unregistered = await call('/rest/v1/rpc/unregister_review_identity', {
    method: 'POST',
    body: JSON.stringify({ p_user_id: t.identity.id }),
  });
  if (!unregistered.ok) fail(`unregister_review_identity answered ${unregistered.status}`);
  const removed = await call(`/rest/v1/memberships?user_id=eq.${t.identity.id}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
  if (!removed.ok) fail(`the review membership could not be removed (${removed.status})`);
  console.log(
    `seed-review-tenant: retired (${windowNote}; password replaced with an unknown value; identity unregistered; membership removed)`,
  );
  process.exit(0);
}

console.error('seed-review-tenant: HIVE_REVIEW_MODE must be seed or retire');
process.exit(1);
