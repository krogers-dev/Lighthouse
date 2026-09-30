#!/usr/bin/env node
/**
 * quarantine-scan — the local quarantine tooling (WO-003).
 *
 *   node scripts/local-supabase.mjs scan-quarantine     # scan every QUARANTINED document (synthetic)
 *   node scripts/local-supabase.mjs sweep-uploads       # expire stale rows, empty settled objects
 *   node scripts/local-supabase.mjs quarantine-status   # counts by status, nothing else
 *   node scripts/hosted-supabase.mjs <staging|production> quarantine-status
 *   node scripts/hosted-supabase.mjs <staging|production> sweep-uploads [--confirm <ref>]
 *
 * The stack it speaks to is decided by scripts/lib/operator-context.mjs
 * (WO-011): the loopback stack handed over by scripts/local-supabase.mjs,
 * or one of the two hosted projects handed over by
 * scripts/hosted-supabase.mjs, with the privileged bearer in memory
 * (never printed, never persisted). Speaks to the database only through
 * the privileged scan interface (public.begin_document_scan,
 * public.record_document_scan, public.expire_stale_document_uploads:
 * executable by the server role alone) and to the storage service
 * through its API, as the platform requires (a direct DELETE on storage
 * rows is refused by the service).
 *
 *   scan    LOOPBACK ONLY. For each QUARANTINED row: move it to
 *           VALIDATING, download the object, run HiveSyntheticScanner
 *           (size, digest, marker), record the verdict. A row whose object
 *           cannot be fetched is recorded as scan_failed, not skipped: a
 *           document nobody can check is not accepted by default. The
 *           approved scanner is the ClamAV runner (scripts/scanner-runner.mjs,
 *           WO-015); this stand-in never runs against a hosted project.
 *   sweep   Expire every stale transfer or over-retention document through
 *           the server function, then remove the storage objects of every
 *           REJECTED or EXPIRED row: quarantine holds nothing it has judged.
 *   status  How many documents stand in each status, and the receipts'
 *           scanner names of the last seven days: counts and names only.
 *
 * Output is ids, counts, and outcomes only. No name, digest, or byte of
 * content is ever printed.
 */
import process from 'node:process';

import { loadHostedManifest } from './lib/hosted-targets.mjs';
import { changeRefusal, resolveOperatorContext } from './lib/operator-context.mjs';
import {
  SCANNER_NAME,
  SCANNER_VERSION,
  describeOutcome,
  scanVerdict,
} from './lib/synthetic-scanner.mjs';

const mode = process.env.HIVE_QUARANTINE_MODE ?? '';
if (!['scan', 'sweep', 'status'].includes(mode)) {
  console.error('quarantine-scan: HIVE_QUARANTINE_MODE must be scan, sweep, or status');
  process.exit(1);
}
const context = resolveOperatorContext(process.env, loadHostedManifest());
if (context.error) {
  console.error(`quarantine-scan: ${context.error}`);
  process.exit(1);
}
if (mode === 'scan' && context.kind !== 'loopback') {
  console.error(
    'quarantine-scan: the synthetic scan runs on the loopback stack alone; a hosted project is scanned by the ClamAV runner (docs/release/scanner-deployment.md)',
  );
  process.exit(1);
}
if (mode === 'sweep') {
  const refusal = changeRefusal(context, 'sweep-uploads');
  if (refusal) {
    console.error(`quarantine-scan: ${refusal}`);
    process.exit(1);
  }
}
const { url, serviceKey, gatewayKey } = context;
const where = context.kind === 'hosted' ? ` [${context.name}]` : '';

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
  console.error(`quarantine-scan${where}: ${message}`);
  process.exit(1);
}

/** Counts by status and the scanners named on the week's receipts:
 * numbers and names, never a document. */
async function status() {
  const rows = await rest('/document_uploads?select=status');
  if (!rows.ok) fail(`listing documents failed with status ${rows.status}`);
  const counts = {};
  for (const row of rows.body ?? []) counts[row.status] = (counts[row.status] ?? 0) + 1;
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const receipts = await rest(
    `/audit_receipts?select=details&action=in.(document.checked,document.not_accepted)&occurred_at=gte.${since}`,
  );
  if (!receipts.ok) fail(`listing receipts failed with status ${receipts.status}`);
  const scanners = {};
  for (const receipt of receipts.body ?? []) {
    const name = receipt.details?.scanner ?? '(unnamed)';
    scanners[name] = (scanners[name] ?? 0) + 1;
  }
  const statuses = ['UPLOADING', 'QUARANTINED', 'VALIDATING', 'ACCEPTED', 'REJECTED', 'EXPIRED'];
  console.log(
    `quarantine-scan${where}: ${statuses.map((name) => `${name} ${counts[name] ?? 0}`).join(', ')}`,
  );
  const named = Object.entries(scanners)
    .sort()
    .map(([name, count]) => `${name} ${count}`)
    .join(', ');
  console.log(
    `quarantine-scan${where}: verdicts in the last seven days by scanner: ${named || 'none'}`,
  );
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
      p_scanner: SCANNER_NAME,
      p_scanner_version: SCANNER_VERSION,
    });
    if (!recorded.ok) {
      fail(`record_document_scan refused ${row.id} with status ${recorded.status}`);
    }
    if (outcome.verdict === 'accepted') accepted += 1;
    else rejected += 1;
    console.log(describeOutcome(row.id, outcome));
  }
  console.log(
    `quarantine-scan${where}: ${rows.length} scanned, ${accepted} accepted, ${rejected} not accepted`,
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
    `quarantine-scan${where}: ${expired.body ?? 0} expired; ${removed} settled object(s) removed from quarantine`,
  );
}

if (mode === 'scan') await scan();
else if (mode === 'sweep') await sweep();
else await status();
