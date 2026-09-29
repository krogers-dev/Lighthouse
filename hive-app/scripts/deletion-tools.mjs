#!/usr/bin/env node
/**
 * deletion-tools — the account-deletion lane tooling (WO-007).
 *
 *   node scripts/local-supabase.mjs request-deletion <synthetic-email>
 *   node scripts/local-supabase.mjs reset-deletion <synthetic-email>
 *   node scripts/local-supabase.mjs complete-deletion <synthetic-email>
 *
 * request   Signs the person in for real and asks for their account to be
 *           deleted AS them, through the same function the screen calls:
 *           the first step of the completion drill.
 *
 * reset     Signs the person in for real (their sign-in code) and, if they
 *           hold an open deletion request, withdraws it AS them through
 *           the same function the screen calls. No privileged write; the
 *           request rows are kept (they are records), only their state
 *           moves. The recovery after a device flow or a lane left a
 *           request open.
 *
 * complete  The operator's completion: the server role completes the
 *           open request (one audit receipt per scope held, the
 *           memberships removed, the request marked), then the auth user
 *           is removed through the platform's admin API, and a readback
 *           proves the account gone, the request kept with a null user
 *           and a pseudonymous subject, and every record the person made
 *           still present. Synthetic identities only; `seed` puts the
 *           identity back afterwards.
 *
 * Loopback only; the privileged bearer arrives in memory and is never
 * printed. Output is ids and outcomes.
 */
import process from 'node:process';

import { signInClientOtp } from './lib/client-session.mjs';
import { identityFor } from './lib/staff-session.mjs';

const url = process.env.HIVE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.HIVE_LOCAL_SERVICE_KEY;
const gatewayKey = process.env.HIVE_LOCAL_GATEWAY_KEY ?? serviceKey;
const clientKey = process.env.HIVE_LOCAL_CLIENT_KEY;
const mailpitUrl = process.env.HIVE_LOCAL_MAILPIT_URL ?? 'http://127.0.0.1:54324';
const mode = process.env.HIVE_DELETION_MODE ?? '';
const email = process.env.HIVE_DELETION_EMAIL ?? '';

if (!url || !serviceKey || !clientKey) {
  console.error(
    'deletion-tools: run through `node scripts/local-supabase.mjs request-deletion|reset-deletion|complete-deletion <email>`',
  );
  process.exit(1);
}
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname)) {
  console.error('deletion-tools: refusing a non-loopback URL');
  process.exit(1);
}
if (!email.endsWith('@example.invalid')) {
  console.error('deletion-tools: synthetic identities only (example.invalid)');
  process.exit(1);
}

function fail(message) {
  console.error(`deletion-tools: ${message}`);
  process.exit(1);
}

async function rest(pathname, bearer, apikey = clientKey, options = {}) {
  const response = await fetch(`${url}/rest/v1${pathname}`, {
    ...options,
    headers: {
      apikey,
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}

if (mode === 'request') {
  const person = await signInClientOtp({ url, clientKey, mailpitUrl, email });
  const requested = await rest('/rpc/request_account_deletion', person.accessToken, clientKey, {
    method: 'POST',
    body: JSON.stringify({ p_idempotency_key: crypto.randomUUID() }),
  });
  if (requested.status === 400 && requested.body?.message === 'already_requested') {
    console.log(`deletion-tools: ${email} already holds an open deletion request`);
    process.exit(0);
  }
  if (!requested.ok || requested.body?.status !== 'REQUESTED') {
    fail(`request_account_deletion answered ${requested.status}`);
  }
  console.log(
    `deletion-tools: ${email} asked for deletion, request ${requested.body.request_id} (REQUESTED)`,
  );
  process.exit(0);
}

if (mode === 'reset') {
  const person = await signInClientOtp({ url, clientKey, mailpitUrl, email });
  const open = await rest(
    '/account_deletion_requests?select=id,status&status=eq.REQUESTED',
    person.accessToken,
  );
  if (!open.ok) fail(`the person's requests could not be read (${open.status})`);
  if ((open.body ?? []).length === 0) {
    console.log(`deletion-tools: ${email} holds no open deletion request; nothing to withdraw`);
    process.exit(0);
  }
  const withdrawn = await rest('/rpc/withdraw_account_deletion', person.accessToken, clientKey, {
    method: 'POST',
    body: JSON.stringify({ p_idempotency_key: crypto.randomUUID() }),
  });
  if (!withdrawn.ok || withdrawn.body?.status !== 'WITHDRAWN') {
    fail(`withdraw_account_deletion answered ${withdrawn.status}`);
  }
  console.log(`deletion-tools: ${email} withdrew request ${withdrawn.body.request_id} (WITHDRAWN)`);
  process.exit(0);
}

if (mode === 'complete') {
  const identity = identityFor(email);
  const before = await rest(
    `/audit_receipts?select=id&actor_user_id=eq.${identity.id}`,
    serviceKey,
    gatewayKey,
  );
  const records = await rest(
    `/document_uploads?select=id&created_by=eq.${identity.id}`,
    serviceKey,
    gatewayKey,
  );
  const completed = await rest('/rpc/complete_account_deletion', serviceKey, gatewayKey, {
    method: 'POST',
    body: JSON.stringify({ p_user_id: identity.id }),
  });
  if (!completed.ok || completed.body?.status !== 'COMPLETED') {
    fail(
      `complete_account_deletion answered ${completed.status}${
        typeof completed.body?.message === 'string' ? ` (${completed.body.message})` : ''
      }`,
    );
  }
  console.log(
    `deletion-tools: request ${completed.body.request_id} COMPLETED, ${completed.body.memberships_removed} membership(s) removed`,
  );
  const removed = await fetch(`${url}/auth/v1/admin/users/${identity.id}`, {
    method: 'DELETE',
    headers: { apikey: gatewayKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!removed.ok) fail(`the admin API refused to remove the auth user (${removed.status})`);
  const gone = await fetch(`${url}/auth/v1/admin/users/${identity.id}`, {
    headers: { apikey: gatewayKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (gone.status !== 404) fail(`the auth user still answers (${gone.status})`);
  const kept = await rest(
    `/account_deletion_requests?select=id,status,user_id,subject_ref&id=eq.${completed.body.request_id}`,
    serviceKey,
    gatewayKey,
  );
  const row = kept.body?.[0];
  if (
    !row ||
    row.status !== 'COMPLETED' ||
    row.user_id !== null ||
    row.subject_ref !== `user:${identity.id}`
  ) {
    fail('the request record did not survive the account as expected');
  }
  const memberships = await rest(
    `/memberships?select=id&user_id=eq.${identity.id}`,
    serviceKey,
    gatewayKey,
  );
  if ((memberships.body ?? []).length !== 0) fail('memberships remain');
  const after = await rest(
    `/audit_receipts?select=id&actor_user_id=eq.${identity.id}`,
    serviceKey,
    gatewayKey,
  );
  const recordsAfter = await rest(
    `/document_uploads?select=id&created_by=eq.${identity.id}`,
    serviceKey,
    gatewayKey,
  );
  if ((after.body ?? []).length < (before.body ?? []).length) fail('audit receipts were lost');
  if ((recordsAfter.body ?? []).length !== (records.body ?? []).length) {
    fail('records the person made were lost');
  }
  console.log(
    `deletion-tools: ${email} removed; request kept as record (user null, subject pseudonymous); ${(after.body ?? []).length} audit receipt(s) and ${(recordsAfter.body ?? []).length} document record(s) stand. Run \`seed\` to restore the synthetic identity.`,
  );
  process.exit(0);
}

console.error('deletion-tools: HIVE_DELETION_MODE must be request, reset, or complete');
process.exit(1);
