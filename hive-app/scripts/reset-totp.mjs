#!/usr/bin/env node
/**
 * reset-totp — checked, loopback-only factor reset for one synthetic QA
 * account (RETURN-3 area 5). Run before the Maestro enrollment flow so
 * enrollment is repeatable after previous successful and failed runs:
 *
 *   node scripts/local-supabase.mjs reset-totp reviewer.rae@example.invalid
 *
 * Fail-closed contract (scripts/lib/admin-factors.mjs): the factor
 * listing must succeed, every deletion must succeed, and a final
 * readback must prove zero factors remain — anything else exits 1.
 * Loopback URLs and synthetic example.invalid identities only; the
 * privileged key arrives in memory from local-supabase.mjs and is never
 * printed or persisted. (`seed-local` does NOT clear factors — this
 * command is the only factor reset.)
 */
import process from 'node:process';

import { cleanAllFactors } from './lib/admin-factors.mjs';
import { SYNTHETIC_IDENTITIES } from './lib/synthetic-identities.mjs';

const url = process.env.HIVE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.HIVE_LOCAL_SERVICE_KEY;
const email = (process.env.HIVE_RESET_TOTP_EMAIL ?? '').trim().toLowerCase();

if (!url || !serviceKey) {
  console.error('reset-totp: run through `node scripts/local-supabase.mjs reset-totp <email>`');
  process.exit(1);
}
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname)) {
  console.error('reset-totp: refusing a non-loopback URL');
  process.exit(1);
}
const identity = SYNTHETIC_IDENTITIES.find((entry) => entry.email === email);
if (!identity) {
  console.error(
    `reset-totp: ${email || '(no email given)'} is not a canonical synthetic identity — only example.invalid QA accounts can be reset`,
  );
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

const { problems, deleted } = await cleanAllFactors(adminRequest, identity);
if (problems.length > 0) {
  for (const problem of problems) console.error(`reset-totp: FAIL ${problem}`);
  process.exit(1);
}
console.log(
  `reset-totp: ${identity.email} is factor-clean (${deleted} deleted, readback verified zero)`,
);
