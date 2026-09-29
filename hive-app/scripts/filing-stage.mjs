#!/usr/bin/env node
/**
 * filing-stage — record the seeded case's filing receipts for a device
 * flow (WO-006), exactly as intake would: a real sign-in to AAL2 through
 * the stack's public surfaces and the reviewed server function, never a
 * privileged write to a workflow table.
 *
 *   node scripts/local-supabase.mjs stage-filing a1
 *
 * Needs the case APPROVED (`stage-case a1 approved`). intake.beth records
 * two receipts: the checked July statement at the synthetic Drive file
 * that holds its bytes, and the checked November statement at the
 * synthetic file that holds other bytes, so `verify-filings` then settles
 * one VERIFIED and one MISMATCH and the screen shows both. HIVE writes
 * nothing to Drive; the receipts say where a person filed by hand.
 * Loopback only; synthetic identities only.
 */
import process from 'node:process';

import { signInStaffAal2 } from './lib/staff-session.mjs';
import { SYNTHETIC_DRIVE_FILES, SYNTHETIC_DRIVE_FOLDER } from './lib/synthetic-drive.mjs';
import { SCOPE } from './lib/synthetic-identities.mjs';
import { CASE_REALMS } from './lib/synthetic-ledger.mjs';

const url = process.env.HIVE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.HIVE_LOCAL_SERVICE_KEY;
const gatewayKey = process.env.HIVE_LOCAL_GATEWAY_KEY ?? serviceKey;
const clientKey = process.env.HIVE_LOCAL_CLIENT_KEY;
const mailpitUrl = process.env.HIVE_LOCAL_MAILPIT_URL ?? 'http://127.0.0.1:54324';
const caseKey = process.env.HIVE_STAGE_CASE ?? '';

if (!url || !serviceKey || !clientKey) {
  console.error(
    'filing-stage: run through `node scripts/local-supabase.mjs stage-filing <caseKey>`',
  );
  process.exit(1);
}
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname)) {
  console.error('filing-stage: refusing a non-loopback URL');
  process.exit(1);
}
const target = CASE_REALMS[caseKey];
if (!target) {
  console.error(
    `filing-stage: unknown case key ${JSON.stringify(caseKey)}; one of: ${Object.keys(CASE_REALMS).join(', ')}`,
  );
  process.exit(1);
}

/** What intake files, by hand, and where: the two synthetic files whose
 * documents the approved package covers. */
const FILINGS = [
  {
    fileId: 'drv-synthetic-0001',
    documentId: SYNTHETIC_DRIVE_FILES['drv-synthetic-0001'].documentId,
  },
  {
    fileId: 'drv-synthetic-wrong',
    documentId: SYNTHETIC_DRIVE_FILES['drv-synthetic-0002'].documentId,
  },
];

function fail(message) {
  console.error(`filing-stage: ${message}`);
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

const intake = await signInStaffAal2({
  url,
  clientKey,
  serviceKey,
  gatewayKey,
  mailpitUrl,
  email: 'intake.beth@example.invalid',
});
const row = await rest(
  `/cases?select=id,status,version&id=eq.${target.caseId}`,
  intake.accessToken,
);
if (row.status !== 200 || !row.body?.[0]) fail(`the case could not be read (${row.status})`);
const current = row.body[0];
if (current.status !== 'APPROVED') {
  fail(`the case is ${current.status}, not APPROVED; run stage-case ${caseKey} approved first`);
}

for (const filing of FILINGS) {
  const filed = await rpc(
    'record_filing_receipt',
    {
      p_environment_id: SCOPE.environmentId,
      p_client_id: SCOPE.clientA,
      p_entity_id: SCOPE.entityA1,
      p_case_id: target.caseId,
      p_case_version: current.version,
      p_document_id: filing.documentId,
      p_drive_file_id: filing.fileId,
      p_drive_path: SYNTHETIC_DRIVE_FOLDER,
      p_idempotency_key: crypto.randomUUID(),
    },
    intake.accessToken,
  );
  if (filed.status === 400 && filed.body?.message === 'receipt_exists') {
    console.log(`filing-stage: ${filing.fileId} already has its receipt`);
    continue;
  }
  if (filed.status !== 200) {
    fail(
      `record_filing_receipt answered ${filed.status} for ${filing.fileId}: ${JSON.stringify(filed.body?.message ?? '')}`,
    );
  }
  console.log(
    `filing-stage: ${filing.fileId} -> receipt ${filed.body.receipt_id} (${filed.body.status})`,
  );
}
console.log(
  `filing-stage: ${caseKey} receipts recorded by intake at AAL2; run verify-filings to settle them`,
);
