#!/usr/bin/env node
/**
 * case-stage — move the seeded case to a workflow state for a device flow
 * (WO-005), exactly as the staff would: real sign-ins to AAL2 through the
 * stack's public surfaces and the reviewed server functions, never a
 * privileged write to a workflow table.
 *
 *   node scripts/local-supabase.mjs stage-case a1 ready-for-review
 *   node scripts/local-supabase.mjs stage-case a1 in-review
 *   node scripts/local-supabase.mjs stage-case a1 approval-pending
 *   node scripts/local-supabase.mjs stage-case a1 approved
 *
 * Starts from the seeded status (run `reset-case a1` first when the case
 * has moved). preparer.pat freezes the package; reviewer.rae starts the
 * review and, for approval-pending, records PASS; for approved,
 * approver.avery then approves the exact package. The TOTP factors these
 * sign-ins enroll stay enrolled; `reset-totp <email>` removes them, and
 * the enrollment runner does so itself for reviewer.rae. Loopback only;
 * synthetic identities only.
 */
import process from 'node:process';

import { RESETTABLE_CASES } from './lib/case-reset.mjs';
import { signInStaffAal2 } from './lib/staff-session.mjs';
import { SCOPE } from './lib/synthetic-identities.mjs';

const url = process.env.HIVE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.HIVE_LOCAL_SERVICE_KEY;
const gatewayKey = process.env.HIVE_LOCAL_GATEWAY_KEY ?? serviceKey;
const clientKey = process.env.HIVE_LOCAL_CLIENT_KEY;
const mailpitUrl = process.env.HIVE_LOCAL_MAILPIT_URL ?? 'http://127.0.0.1:54324';
const caseKey = process.env.HIVE_STAGE_CASE ?? '';
const wanted = process.env.HIVE_STAGE_STATE ?? '';

const STATES = ['ready-for-review', 'in-review', 'approval-pending', 'approved'];

if (!url || !serviceKey || !clientKey) {
  console.error(
    'case-stage: run through `node scripts/local-supabase.mjs stage-case <caseKey> <state>`',
  );
  process.exit(1);
}
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname)) {
  console.error('case-stage: refusing a non-loopback URL');
  process.exit(1);
}
const target = RESETTABLE_CASES[caseKey];
if (!target) {
  console.error(
    `case-stage: unknown case key ${JSON.stringify(caseKey)}; one of: ${Object.keys(RESETTABLE_CASES).join(', ')}`,
  );
  process.exit(1);
}
if (!STATES.includes(wanted)) {
  console.error(
    `case-stage: unknown state ${JSON.stringify(wanted)}; one of: ${STATES.join(', ')}`,
  );
  process.exit(1);
}

function fail(message) {
  console.error(`case-stage: ${message}`);
  process.exit(1);
}

async function rest(pathname, accessToken) {
  const response = await fetch(`${url}/rest/v1${pathname}`, {
    headers: { apikey: clientKey, Authorization: `Bearer ${accessToken}` },
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function rpc(name, args, accessToken) {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: clientKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

function uuidV4() {
  return crypto.randomUUID();
}

const scopeArgs = {
  p_environment_id: SCOPE.environmentId,
  p_client_id: SCOPE.clientA,
  p_entity_id: SCOPE.entityA1,
  p_case_id: target.caseId,
};

async function caseVersion(accessToken) {
  const row = await rest(`/cases?select=id,status,version&id=eq.${target.caseId}`, accessToken);
  if (row.status !== 200 || !row.body?.[0]) fail(`the case could not be read (${row.status})`);
  return row.body[0];
}

const preparer = await signInStaffAal2({
  url,
  clientKey,
  serviceKey,
  gatewayKey,
  mailpitUrl,
  email: 'preparer.pat@example.invalid',
});
let current = await caseVersion(preparer.accessToken);
if (current.status !== target.seededStatus) {
  fail(
    `the case is ${current.status}, not ${target.seededStatus}; run reset-case ${caseKey} first`,
  );
}
const frozen = await rpc(
  'freeze_case_package',
  { ...scopeArgs, p_case_version: current.version, p_idempotency_key: uuidV4() },
  preparer.accessToken,
);
if (frozen.status !== 200)
  fail(
    `freeze_case_package answered ${frozen.status}: ${JSON.stringify(frozen.body?.message ?? '')}`,
  );
console.log(
  `case-stage: ${caseKey} frozen as package ${frozen.body.package_number} (READY_FOR_REVIEW)`,
);

if (wanted !== 'ready-for-review') {
  const reviewer = await signInStaffAal2({
    url,
    clientKey,
    serviceKey,
    gatewayKey,
    mailpitUrl,
    email: 'reviewer.rae@example.invalid',
  });
  current = await caseVersion(reviewer.accessToken);
  const started = await rpc(
    'start_case_review',
    { ...scopeArgs, p_case_version: current.version, p_idempotency_key: uuidV4() },
    reviewer.accessToken,
  );
  if (started.status !== 200)
    fail(
      `start_case_review answered ${started.status}: ${JSON.stringify(started.body?.message ?? '')}`,
    );
  console.log(`case-stage: ${caseKey} review started (IN_REVIEW)`);
  if (wanted === 'approval-pending' || wanted === 'approved') {
    current = await caseVersion(reviewer.accessToken);
    const passed = await rpc(
      'record_case_verdict',
      {
        ...scopeArgs,
        p_case_version: current.version,
        p_verdict: 'PASS',
        p_note: 'Staged for the device lane (Synthetic).',
        p_idempotency_key: uuidV4(),
      },
      reviewer.accessToken,
    );
    if (passed.status !== 200)
      fail(
        `record_case_verdict answered ${passed.status}: ${JSON.stringify(passed.body?.message ?? '')}`,
      );
    console.log(`case-stage: ${caseKey} passed review (APPROVAL_PENDING)`);
  }
  if (wanted === 'approved') {
    const approver = await signInStaffAal2({
      url,
      clientKey,
      serviceKey,
      gatewayKey,
      mailpitUrl,
      email: 'approver.avery@example.invalid',
    });
    current = await caseVersion(approver.accessToken);
    const packages = await rest(
      `/case_review_packages?select=id,manifest_digest&case_id=eq.${target.caseId}&superseded_at=is.null`,
      approver.accessToken,
    );
    const pkg = packages.body?.[0];
    if (packages.status !== 200 || !pkg)
      fail(`the current package could not be read (${packages.status})`);
    const approved = await rpc(
      'approve_case_package',
      {
        ...scopeArgs,
        p_case_version: current.version,
        p_package_id: pkg.id,
        p_package_digest: pkg.manifest_digest,
        p_destination: 'hive-record',
        p_idempotency_key: uuidV4(),
      },
      approver.accessToken,
    );
    if (approved.status !== 200)
      fail(
        `approve_case_package answered ${approved.status}: ${JSON.stringify(approved.body?.message ?? '')}`,
      );
    console.log(`case-stage: ${caseKey} approved, bound to the exact package (APPROVED)`);
  }
}
