#!/usr/bin/env node
/**
 * scanner-proof — the ClamAV lane proven end to end on the loopback
 * stack (WO-015).
 *
 *   node scripts/local-supabase.mjs prove-scanner
 *
 * With clamd listening on 127.0.0.1:3310 (the pinned image in
 * deploy/scanner/docker-compose.yml, or `docker run` of the same image)
 * and the seeded stack up: client.owner signs in exactly as the screens
 * do and uploads two documents through the reviewed path — a clean
 * synthetic PDF and the EICAR test file, the industry's harmless
 * detection standard, declared honestly as text — then the runner is run
 * for one pass as the deployment would run it, and the outcome is read
 * back: the clean document ACCEPTED and the test file REJECTED as
 * malware, each receipt naming ClamAV and its signature version, the
 * trail telling the client, the runner's output free of names and
 * digests; then the sweep empties the rejected object from quarantine.
 * A second pass finds nothing waiting. Finally the runner is pointed at
 * a port nothing listens on with a third document waiting: nothing is
 * begun, the document stays QUARANTINED, and the pass reports 3.
 *
 * Loopback only; synthetic identities only; the privileged bearer in
 * memory from scripts/local-supabase.mjs. Prints ids and outcomes only.
 */
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { signInClientOtp } from './lib/client-session.mjs';
import { SCOPE } from './lib/synthetic-identities.mjs';
import { REQUESTS } from './lib/synthetic-documents.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.HIVE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.HIVE_LOCAL_SERVICE_KEY;
const gatewayKey = process.env.HIVE_LOCAL_GATEWAY_KEY ?? serviceKey;
const clientKey = process.env.HIVE_LOCAL_CLIENT_KEY;
const mailpitUrl = process.env.HIVE_LOCAL_MAILPIT_URL ?? 'http://127.0.0.1:54324';
const clamdHost = process.env.HIVE_SCANNER_CLAMD_HOST ?? '127.0.0.1';
const clamdPort = process.env.HIVE_SCANNER_CLAMD_PORT ?? '3310';

if (!url || !serviceKey || !clientKey) {
  console.error('scanner-proof: run through `node scripts/local-supabase.mjs prove-scanner`');
  process.exit(1);
}
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname)) {
  console.error('scanner-proof: refusing a non-loopback URL');
  process.exit(1);
}

let passed = 0;
let failed = 0;
function check(condition, label) {
  if (condition) {
    passed += 1;
    console.log(`ok - ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL - ${label}`);
  }
  return Boolean(condition);
}

const serverHeaders = {
  apikey: gatewayKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

async function asServer(pathname) {
  const response = await fetch(`${url}/rest/v1${pathname}`, { headers: serverHeaders });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function rpcAs(token, name, args) {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: clientKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function storagePut(objectPath, bytes, contentType, token) {
  const response = await fetch(`${url}/storage/v1/object/hive-quarantine/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: clientKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType,
      'x-upsert': 'false',
    },
    body: bytes,
  });
  return response.status;
}

/** The EICAR standard test file: 68 printable bytes every scanner
 * detects and no scanner treats as anything but a test. Assembled at run
 * time so the repository carries no line a desktop scanner would flag. */
function eicarBytes() {
  const head = ['X5O!P%@AP[4', 'PZX54(P^)7CC)7}$EICAR-STAND'].join('\\');
  const tail = 'ARD-ANTIVIRUS-TEST-FILE!$H+H*';
  return Buffer.from(`${head}${tail}`, 'latin1');
}

function cleanPdfBytes() {
  return Buffer.from(
    `%PDF-1.4\n% HIVE scanner proof, clean synthetic document (Synthetic) ${Date.now()}\n%%EOF\n`,
    'latin1',
  );
}

/** Reserve, transfer, and complete one document as the client, exactly
 * as the screens do. Returns the upload id. */
async function upload(token, { name, mime, bytes }) {
  const digest = createHash('sha256').update(bytes).digest('hex');
  const request = await asServer(`/requests?select=version&id=eq.${REQUESTS.a1Open}`);
  const requestVersion = request.body?.[0]?.version;
  if (!Number.isInteger(requestVersion)) throw new Error('the seeded open request was not found');
  const reserved = await rpcAs(token, 'begin_document_upload', {
    p_environment_id: SCOPE.environmentId,
    p_client_id: SCOPE.clientA,
    p_entity_id: SCOPE.entityA1,
    p_request_id: REQUESTS.a1Open,
    p_request_version: requestVersion,
    p_idempotency_key: randomUUID(),
    p_display_name: name,
    p_mime_type: mime,
    p_byte_size: bytes.length,
    p_client_digest: digest,
  });
  if (reserved.status !== 200) {
    throw new Error(
      `begin_document_upload refused (${reserved.status}): ${reserved.body?.message ?? ''}`,
    );
  }
  const put = await storagePut(reserved.body.storage_path, bytes, mime, token);
  if (put !== 200) throw new Error(`the transfer was refused (${put})`);
  const completed = await rpcAs(token, 'complete_document_upload', {
    p_upload_id: reserved.body.upload_id,
  });
  if (completed.status !== 200 || completed.body?.status !== 'QUARANTINED') {
    throw new Error(`complete_document_upload did not quarantine (${completed.status})`);
  }
  return reserved.body.upload_id;
}

function runner(extraEnv = {}) {
  const result = spawnSync(
    process.execPath,
    [path.join(appRoot, 'scripts', 'scanner-runner.mjs')],
    {
      cwd: appRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        HIVE_SCANNER_SUPABASE_URL: url,
        HIVE_SCANNER_SECRET_KEY: serviceKey,
        HIVE_SCANNER_GATEWAY_KEY: gatewayKey,
        HIVE_SCANNER_CLAMD_HOST: clamdHost,
        HIVE_SCANNER_CLAMD_PORT: clamdPort,
        HIVE_SCANNER_ONCE: '1',
        ...extraEnv,
      },
      timeout: 300_000,
    },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output);
  return { status: result.status, output };
}

async function statusOf(uploadId) {
  const row = await asServer(
    `/document_uploads?select=id,status,rejection_reason&id=eq.${uploadId}`,
  );
  return row.body?.[0] ?? null;
}

async function receiptOf(uploadId) {
  const rows = await asServer(
    `/audit_receipts?select=action,details&object_ref=eq.upload:${uploadId}&action=in.(document.checked,document.not_accepted)`,
  );
  return rows.body?.[0] ?? null;
}

// ---- the client uploads two documents ----
const client = await signInClientOtp({
  url,
  clientKey,
  mailpitUrl,
  email: 'client.owner@example.invalid',
});
const clean = cleanPdfBytes();
const cleanId = await upload(client.accessToken, {
  name: 'scanner proof, clean (Synthetic).pdf',
  mime: 'application/pdf',
  bytes: clean,
});
const eicar = eicarBytes();
const eicarId = await upload(client.accessToken, {
  name: 'scanner proof, test file (Synthetic).csv',
  mime: 'text/csv',
  bytes: eicar,
});
check(
  (await statusOf(cleanId))?.status === 'QUARANTINED' &&
    (await statusOf(eicarId))?.status === 'QUARANTINED',
  'client.owner: two documents received into quarantine (a clean PDF and the EICAR test file)',
);

// ---- one pass of the runner as the deployment would run it ----
const first = runner();
check(first.status === 0, 'the runner recorded every waiting document in one pass (exit 0)');
const cleanRow = await statusOf(cleanId);
const eicarRow = await statusOf(eicarId);
check(cleanRow?.status === 'ACCEPTED', 'ClamAV: the clean document is ACCEPTED');
check(
  eicarRow?.status === 'REJECTED' && eicarRow.rejection_reason === 'malware_detected',
  'ClamAV: the EICAR test file is REJECTED as malware_detected',
);
const cleanReceipt = await receiptOf(cleanId);
const eicarReceipt = await receiptOf(eicarId);
const version = cleanReceipt?.details?.scanner_version ?? '';
check(
  cleanReceipt?.action === 'document.checked' &&
    cleanReceipt.details?.scanner === 'ClamAV' &&
    /^ClamAV \d+\.\d+/.test(version) &&
    /signatures \d+/.test(version),
  `server: the acceptance receipt names ClamAV with its engine and signature version (${version})`,
);
check(
  eicarReceipt?.action === 'document.not_accepted' &&
    eicarReceipt.details?.scanner === 'ClamAV' &&
    eicarReceipt.details?.reason === 'malware_detected' &&
    eicarReceipt.details?.scanner_version === version,
  'server: the rejection receipt names ClamAV, the reason, and the same signature version',
);
const trail = await asServer(
  `/activity_events?select=event_kind,actor_role&case_id=eq.eeeeeeee-0000-4000-8000-0000000000a1&event_kind=in.(document.checked,document.not_accepted)&order=occurred_at.desc&limit=2`,
);
const kinds = (trail.body ?? []).map((event) => `${event.event_kind}:${event.actor_role}`).sort();
check(
  JSON.stringify(kinds) ===
    JSON.stringify(['document.checked:system', 'document.not_accepted:system']),
  'the trail tells the client of one check and one refusal, by the system',
);
check(
  !first.output.includes('scanner proof') &&
    !first.output.includes('Synthetic') &&
    !/[0-9a-f]{64}/.test(first.output) &&
    !first.output.includes(serviceKey),
  'the runner printed no document name, no digest, no key',
);
check(
  /EICAR/i.test(first.output) && first.output.includes(`${eicarId} -> rejected (malware_detected)`),
  'the runner named the detection by its signature and the document by its id',
);

// ---- the sweep empties quarantine of what was judged ----
const sweep = spawnSync(process.execPath, [path.join(appRoot, 'scripts', 'quarantine-scan.mjs')], {
  cwd: appRoot,
  encoding: 'utf8',
  env: { ...process.env, HIVE_QUARANTINE_MODE: 'sweep' },
  timeout: 120_000,
});
process.stdout.write(`${sweep.stdout ?? ''}${sweep.stderr ?? ''}`);
const eicarObject = await fetch(
  `${url}/storage/v1/object/hive-quarantine/${(await asServer(`/document_uploads?select=storage_path&id=eq.${eicarId}`)).body?.[0]?.storage_path}`,
  { headers: { apikey: gatewayKey, Authorization: `Bearer ${serviceKey}` } },
);
check(
  sweep.status === 0 && eicarObject.status >= 400,
  'the sweep removed the rejected object from quarantine (the server cannot fetch it)',
);

// ---- a second pass finds nothing waiting ----
const second = runner();
check(
  second.status === 0 && /0 waiting, 0 accepted, 0 not accepted/.test(second.output),
  'a second pass finds nothing waiting and records nothing',
);

// ---- an outage holds, never rejects ----
const heldId = await upload(client.accessToken, {
  name: 'scanner proof, held (Synthetic).pdf',
  mime: 'application/pdf',
  bytes: cleanPdfBytes(),
});
const outage = runner({ HIVE_SCANNER_CLAMD_PORT: '3319' });
const heldRow = await statusOf(heldId);
check(
  outage.status === 3 && heldRow?.status === 'QUARANTINED' && /nothing begun/.test(outage.output),
  'with clamd unreachable the runner begins nothing (exit 3) and the document stays QUARANTINED',
);
const recovered = runner();
check(
  recovered.status === 0 && (await statusOf(heldId))?.status === 'ACCEPTED',
  'once clamd answers again the held document is scanned and accepted',
);

// ---- configuration refusals, as processes ----
const legacyShapedHosted = runner({
  HIVE_SCANNER_SUPABASE_URL: 'https://zhdvmllscjyepwucbtzq.supabase.co',
  HIVE_SCANNER_SECRET_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.not.a.key',
});
check(
  legacyShapedHosted.status === 2 &&
    /legacy service-role token is refused/.test(legacyShapedHosted.output),
  'a hosted origin with a legacy-shaped key is refused before anything is reached (exit 2)',
);
const strangeOrigin = runner({
  HIVE_SCANNER_SUPABASE_URL: 'https://example.invalid',
  HIVE_SCANNER_SECRET_KEY: 'sb_secret_000000000000000000000000000000',
});
check(
  strangeOrigin.status === 2 && /not the exact origin of a project/.test(strangeOrigin.output),
  'an origin outside security/hosted-targets.json is refused (exit 2)',
);

console.log(`scanner-proof: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
