#!/usr/bin/env node
/**
 * scanner-runner — the ClamAV quarantine scanner (WO-015).
 *
 * The approved malware scanner, run as a PULLER next to a clamd daemon
 * on a private network: it lists the documents waiting in quarantine
 * through the server-role scan interface, streams each object's bytes to
 * clamd, and records the verdict through the same interface. Nothing
 * listens; no inbound endpoint exists; the one secret it holds is the
 * project's secret key, in its environment, never printed.
 *
 *   HIVE_SCANNER_SUPABASE_URL       the project origin (a loopback stack, or one of
 *                                   the two projects in security/hosted-targets.json)
 *   HIVE_SCANNER_SECRET_KEY         the project secret key (sb_secret_…; a loopback
 *                                   stack's issued bearer is accepted there alone)
 *   HIVE_SCANNER_GATEWAY_KEY        loopback only: the issued key Kong wants as apikey
 *   HIVE_SCANNER_CLAMD_HOST/PORT    clamd (default 127.0.0.1:3310)
 *   HIVE_SCANNER_INTERVAL_MS        the pause between passes (default 30000)
 *   HIVE_SCANNER_ONCE=1             one pass, then exit (the lanes and the proof)
 *   HIVE_SCANNER_BATCH              documents per pass (default 20)
 *
 * A pass: clamd's VERSION is read first (its engine and signature
 * versions go on every receipt of the pass); if clamd does not answer,
 * nothing is begun and the pass ends — an outage holds documents in
 * quarantine, it never rejects them. Each waiting document (QUARANTINED,
 * or VALIDATING from a pass that died) is moved to VALIDATING, fetched,
 * compared against what the phone declared, streamed to clamd, and
 * recorded: clean is accepted, a detection is `malware_detected`, an
 * object that cannot be fetched or that clamd cannot judge is
 * `scan_failed`. If clamd stops answering mid-pass the document stays
 * VALIDATING for the next pass. Output is ids, outcomes, and signature
 * names only: never a document name, a digest, or a byte of content.
 *
 * Exit codes for one pass: 0 every waiting document recorded; 2 the
 * configuration was refused; 3 clamd did not answer; 4 a document was
 * left for the next pass or the interface refused a call.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { SCANNER_NAME, scanBytes, version as clamdVersion } from './lib/clamav.mjs';
import { HOSTED_MANIFEST_PATH, loadHostedManifest } from './lib/hosted-targets.mjs';
import { declarationProblem, describeOutcome, verdictFromDetection } from './lib/scan-pipeline.mjs';
import { describeScannerConfig, resolveScannerConfig } from './lib/scanner-config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The manifest next to this script's tree when the runner is deployed
 * with it; a loopback stack needs none. */
function manifestIfPresent() {
  const candidates = [
    HOSTED_MANIFEST_PATH,
    path.join(here, '..', 'security', 'hosted-targets.json'),
  ];
  for (const file of candidates) {
    if (existsSync(file)) return loadHostedManifest(file);
  }
  return null;
}

let config;
try {
  config = resolveScannerConfig(process.env, manifestIfPresent());
} catch (error) {
  console.error(`scanner-runner: ${error.message}`);
  process.exit(2);
}
console.log(describeScannerConfig(config));

const headers = {
  apikey: config.gatewayKey,
  Authorization: `Bearer ${config.secretKey}`,
  'Content-Type': 'application/json',
};

async function rest(pathname, options = {}) {
  const response = await fetch(`${config.url}/rest/v1${pathname}`, {
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

async function downloadObject(bucket, objectPath) {
  const response = await fetch(`${config.url}/storage/v1/object/${bucket}/${objectPath}`, {
    headers: { apikey: config.gatewayKey, Authorization: `Bearer ${config.secretKey}` },
  });
  if (!response.ok) return null;
  return new Uint8Array(await response.arrayBuffer());
}

const clamd = { host: config.clamdHost, port: config.clamdPort };

/** One pass over the waiting documents. Returns the exit code the pass
 * earns; the loop keeps going regardless. */
async function pass() {
  let engine;
  try {
    engine = await clamdVersion(clamd);
  } catch (error) {
    console.error(`scanner-runner: clamd did not answer, nothing begun (${error.message})`);
    return 3;
  }
  const listing = await rest(
    `/document_uploads?status=in.(QUARANTINED,VALIDATING)&select=id,storage_bucket,storage_path,byte_size,client_digest&order=created_at&limit=${config.batch}`,
  );
  if (!listing.ok) {
    console.error(`scanner-runner: listing the quarantine failed with status ${listing.status}`);
    return 4;
  }
  const rows = listing.body ?? [];
  let accepted = 0;
  let rejected = 0;
  let deferred = 0;
  let refused = 0;
  for (const row of rows) {
    const begun = await rpc('begin_document_scan', { p_upload_id: row.id });
    if (!begun.ok) {
      console.error(
        `scanner-runner: begin_document_scan refused ${row.id} (status ${begun.status})`,
      );
      refused += 1;
      continue;
    }
    const bytes = await downloadObject(row.storage_bucket, row.storage_path);
    let outcome = declarationProblem({
      bytes,
      declaredByteSize: Number(row.byte_size),
      declaredDigest: row.client_digest,
    });
    if (outcome === null) {
      let detection;
      try {
        detection = await scanBytes({ ...clamd, bytes, timeoutMs: config.scanTimeoutMs });
      } catch (error) {
        // clamd went away mid-pass: not a verdict. The document stays
        // VALIDATING and the next pass takes it again.
        console.error(`scanner-runner: ${row.id} left for the next pass (${error.message})`);
        deferred += 1;
        continue;
      }
      outcome = verdictFromDetection(detection);
    }
    const recorded = await rpc('record_document_scan', {
      p_upload_id: row.id,
      p_verdict: outcome.verdict,
      p_reason: outcome.reason,
      p_scanner: SCANNER_NAME,
      p_scanner_version: engine.label,
    });
    if (!recorded.ok) {
      console.error(
        `scanner-runner: record_document_scan refused ${row.id} (status ${recorded.status})`,
      );
      refused += 1;
      continue;
    }
    if (outcome.verdict === 'accepted') accepted += 1;
    else rejected += 1;
    console.log(describeOutcome(SCANNER_NAME, row.id, outcome));
  }
  console.log(
    `scanner-runner: ${engine.label}; ${rows.length} waiting, ${accepted} accepted, ${rejected} not accepted, ${deferred} deferred, ${refused} refused`,
  );
  return deferred + refused === 0 ? 0 : 4;
}

if (config.once) {
  process.exit(await pass());
}

// The long-running shape: pass, pause, pass. A signal ends the loop
// between documents; a document in flight completes or is deferred.
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true;
    console.log(`scanner-runner: ${signal}, finishing the current pass`);
  });
}
while (!stopping) {
  await pass();
  await new Promise((resolve) => setTimeout(resolve, config.intervalMs));
}
process.exit(0);
