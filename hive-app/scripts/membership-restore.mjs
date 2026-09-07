#!/usr/bin/env node
/**
 * membership-restore — checked, loopback-only restore of one synthetic
 * account's seeded membership rows on one entity (find 21).
 *
 *   node scripts/local-supabase.mjs restore-membership client.owner@example.invalid entityA1
 *
 * The maestro:denied runner revokes that membership MID-FLOW to prove RLS
 * denies the read surfaces, and calls this harness from its cleanup on
 * every exit path so the seeded matrix is never left short. It is also
 * the manual recovery after a run that was killed from outside.
 *
 * Fail-closed contract: the target must be a canonical synthetic identity
 * holding a seeded membership on the named entity; the restore goes
 * through the seed's own idempotent upsert on the natural key (existing
 * rows untouched, missing ones re-inserted, never an UPDATE); and a final
 * readback must match the seed definition exactly — anything else exits 1.
 * Loopback URLs only; the privileged bearer arrives in memory from the
 * caller and is never printed or persisted.
 */
import process from 'node:process';

import {
  RESTORE_PATH,
  RESTORE_PREFER,
  readbackPath,
  resolveRevokeTarget,
  verifyRestored,
} from './lib/membership-revoke.mjs';

const url = process.env.HIVE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.HIVE_LOCAL_SERVICE_KEY;
// Kong's apikey gate wants an ISSUED key; the service bearer carries the
// role (a JWT — PostgREST demotes any unparseable bearer to anon).
const gatewayKey = process.env.HIVE_LOCAL_GATEWAY_KEY ?? serviceKey;
const email = process.env.HIVE_RESTORE_EMAIL ?? '';
const entityKey = process.env.HIVE_RESTORE_ENTITY ?? '';

if (!url || !serviceKey) {
  console.error(
    'membership-restore: run through `node scripts/local-supabase.mjs restore-membership <email> <entityKey>`',
  );
  process.exit(1);
}
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname)) {
  console.error('membership-restore: refusing a non-loopback URL');
  process.exit(1);
}
const target = resolveRevokeTarget(email, entityKey);
if (target.problem) {
  console.error(`membership-restore: ${target.problem}`);
  process.exit(1);
}

async function restRequest(pathname, options = {}) {
  const response = await fetch(`${url}/rest/v1${pathname}`, {
    ...options,
    headers: {
      apikey: gatewayKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, text };
}

const upsert = await restRequest(RESTORE_PATH, {
  method: 'POST',
  headers: { Prefer: RESTORE_PREFER },
  body: JSON.stringify(target.expected),
});
if (!upsert.ok) {
  console.error(`membership-restore: upsert failed with status ${upsert.status}`);
  process.exit(1);
}
const readback = await restRequest(readbackPath(target), { method: 'GET' });
if (!readback.ok) {
  console.error(`membership-restore: readback failed with status ${readback.status}`);
  process.exit(1);
}
let rows;
try {
  rows = JSON.parse(readback.text);
} catch {
  console.error('membership-restore: readback was not JSON');
  process.exit(1);
}
const problems = verifyRestored(target.expected, rows);
if (problems.length > 0) {
  for (const problem of problems) console.error(`membership-restore: FAIL ${problem}`);
  process.exit(1);
}
console.log(
  `membership-restore: ${target.email} on ${target.entityKey} restored (${target.expected.length} seeded row(s) present, readback verified)`,
);
