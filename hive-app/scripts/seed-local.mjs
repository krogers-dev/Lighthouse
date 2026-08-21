#!/usr/bin/env node
/**
 * seed-local — server-side synthetic user harness for the local stack.
 *
 * Creates the synthetic authorized users through the GoTrue admin API so
 * email OTP and TOTP enrollment behave exactly as production would. Runs
 * only against a loopback URL; receives its privileged key in memory from
 * scripts/local-supabase.mjs and never prints or persists it. Domain rows
 * come from supabase/seed.sql via `supabase db reset`.
 */
import process from 'node:process';

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

const SYNTHETIC_USERS = [
  { id: 'cccccccc-0000-4000-8000-000000000001', email: 'client.owner@example.invalid' },
  { id: 'cccccccc-0000-4000-8000-000000000002', email: 'intake.beth@example.invalid' },
  { id: 'cccccccc-0000-4000-8000-000000000003', email: 'preparer.pat@example.invalid' },
  { id: 'cccccccc-0000-4000-8000-000000000004', email: 'reviewer.rae@example.invalid' },
  { id: 'cccccccc-0000-4000-8000-000000000005', email: 'approver.avery@example.invalid' },
  { id: 'cccccccc-0000-4000-8000-000000000006', email: 'client.second@example.invalid' },
  { id: 'cccccccc-0000-4000-8000-000000000007', email: 'nomember.norman@example.invalid' },
];

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

let created = 0;
let existing = 0;
for (const user of SYNTHETIC_USERS) {
  const result = await adminRequest('/admin/users', {
    method: 'POST',
    body: JSON.stringify({ id: user.id, email: user.email, email_confirm: true }),
  });
  if (result.ok) {
    created += 1;
  } else if (
    result.status === 422 ||
    /already.*(registered|exists)/i.test(String(result.body?.msg ?? result.body?.message ?? ''))
  ) {
    existing += 1;
  } else {
    console.error(`seed-local: creating ${user.email} failed with status ${result.status}`);
    process.exit(1);
  }
}
console.log(`seed-local: ${created} created, ${existing} already present`);
