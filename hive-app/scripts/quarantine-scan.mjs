#!/usr/bin/env node
/**
 * quarantine-scan — the local quarantine tooling (WO-003).
 *
 *   node scripts/local-supabase.mjs scan-quarantine     # scan every QUARANTINED document
 *   node scripts/local-supabase.mjs sweep-uploads       # expire stale rows, empty settled objects
 *
 * Runs only against the loopback stack, with the privileged bearer handed
 * to it in memory by scripts/local-supabase.mjs (never printed, never
 * persisted). Speaks to the database only through the privileged scan
 * interface (public.begin_document_scan, public.record_document_scan,
 * public.expire_stale_document_uploads: executable by the server role
 * alone) and to the storage service through its API, as the platform
 * requires (a direct DELETE on storage rows is refused by the service).
 *
 *   scan   For each QUARANTINED row: move it to VALIDATING, download the
 *          object, run HiveSyntheticScanner (size, digest, marker), record
 *          the verdict. A row whose object cannot be fetched is recorded
 *          as scan_failed, not skipped: a document nobody can check is
 *          not accepted by default.
 *   sweep  Expire every stale transfer or over-retention document through
 *          the server function, then remove the storage objects of every
 *          REJECTED or EXPIRED row: quarantine holds nothing it has judged.
 *
 * Output is ids and outcomes only. No name, digest, or byte of content
 * is ever printed.
 */
import process from 'node:process';

import { describeOutcome, scanVerdict } from './lib/synthetic-scanner.mjs';

const url = process.env.HIVE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.HIVE_LOCAL_SERVICE_KEY;
// Kong's apikey gate wants an ISSUED key; the bearer carries the role.
const gatewayKey = process.env.HIVE_LOCAL_GATEWAY_KEY ?? serviceKey;
const mode = process.env.HIVE_QUARANTINE_MODE ?? '';

if (!url || !serviceKey) {
  console.error(
    'quarantine-scan: run through `node scripts/local-supabase.mjs scan-quarantine|sweep-uploads`',
  );
  process.exit(1);
}
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname)) {
  console.error('quarantine-scan: refusing a non-loopback URL');
  process.exit(1);
}
if (mode !== 'scan' && mode !== 'sweep') {
  console.error('quarantine-scan: HIVE_QUARANTINE_MODE must be scan or sweep');
  process.exit(1);
}

const headers = {
  apikey: gatewayKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

async function rest(pathname, options = {}) {
  const response = await fetch(`${url}/rest/v1${pathname}`, {
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

async function rpc(name, args) {
  return rest(`/rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
}

/** The object's bytes through the storage API, or null when it is not
 * there (the "cannot be checked" case the scan records as scan_failed). */
async function downloadObject(bucket, path) {
  const response = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
    headers: { apikey: gatewayKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!response.ok) return null;
  return new Uint8Array(await response.arrayBuffer());
}

async function removeObjects(bucket, paths) {
  if (paths.length === 0) return { ok: true, removed: 0 };
  const response = await fetch(`${url}/storage/v1/object/${bucket}`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ prefixes: paths }),
  });
  const body = await response.json().catch(() => []);
  return {
    ok: response.ok,
    removed: Array.isArray(body) ? body.length : 0,
    status: response.status,
  };
}

function fail(message) {
  console.error(`quarantine-scan: ${message}`);
  process.exit(1);
}

async function scan() {
  const listing = await rest(
    '/document_uploads?status=eq.QUARANTINED&select=id,storage_bucket,storage_path,byte_size,client_digest&order=created_at',
  );
  if (!listing.ok) fail(`listing quarantined documents failed with status ${listing.status}`);
  const rows = listing.body ?? [];
  let accepted = 0;
  let rejected = 0;
  for (const row of rows) {
    const begun = await rpc('begin_document_scan', { p_upload_id: row.id });
    if (!begun.ok) {
      fail(`begin_document_scan refused ${row.id} with status ${begun.status}`);
    }
    const bytes = await downloadObject(row.storage_bucket, row.storage_path);
    const outcome = scanVerdict({
      bytes,
      declaredByteSize: Number(row.byte_size),
      declaredDigest: row.client_digest,
    });
    const recorded = await rpc('record_document_scan', {
      p_upload_id: row.id,
      p_verdict: outcome.verdict,
      p_reason: outcome.reason,
    });
    if (!recorded.ok) {
      fail(`record_document_scan refused ${row.id} with status ${recorded.status}`);
    }
    if (outcome.verdict === 'accepted') accepted += 1;
    else rejected += 1;
    console.log(describeOutcome(row.id, outcome));
  }
  console.log(
    `quarantine-scan: ${rows.length} scanned, ${accepted} accepted, ${rejected} not accepted`,
  );
}

async function sweep() {
  const expired = await rpc('expire_stale_document_uploads', {});
  if (!expired.ok) fail(`expire_stale_document_uploads failed with status ${expired.status}`);
  const settled = await rest(
    '/document_uploads?status=in.(REJECTED,EXPIRED)&select=storage_bucket,storage_path',
  );
  if (!settled.ok) fail(`listing settled documents failed with status ${settled.status}`);
  const byBucket = new Map();
  for (const row of settled.body ?? []) {
    const paths = byBucket.get(row.storage_bucket) ?? [];
    paths.push(row.storage_path);
    byBucket.set(row.storage_bucket, paths);
  }
  let removed = 0;
  for (const [bucket, paths] of byBucket) {
    const result = await removeObjects(bucket, paths);
    if (!result.ok) fail(`removing objects from ${bucket} failed with status ${result.status}`);
    removed += result.removed;
  }
  console.log(
    `quarantine-scan: ${expired.body ?? 0} expired; ${removed} settled object(s) removed from quarantine`,
  );
}

if (mode === 'scan') await scan();
else await sweep();
