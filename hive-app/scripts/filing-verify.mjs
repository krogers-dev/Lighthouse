#!/usr/bin/env node
/**
 * filing-verify — the synthetic permanent-record adapter's read-only
 * check of every recorded filing receipt (WO-006).
 *
 *   node scripts/local-supabase.mjs verify-filings          # every RECORDED receipt
 *   node scripts/local-supabase.mjs verify-filings a1       # the seeded case's only
 *
 * Runs only against the loopback stack, with the privileged bearer handed
 * to it in memory by scripts/local-supabase.mjs (never printed, never
 * persisted). Speaks to the database only through the server-role
 * adapter interface (public.verify_filing_receipt). The adapter is
 * HiveSyntheticDrive, named on every receipt it settles; no live Drive is
 * read, and nothing is ever written to any record. Output is receipt ids
 * and outcomes; never a path or a digest.
 */
import process from 'node:process';

import { verifyFilingReceipts } from './lib/filing-verify.mjs';
import { resolveLedgerTarget } from './lib/ledger-sync.mjs';

const url = process.env.HIVE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.HIVE_LOCAL_SERVICE_KEY;
const gatewayKey = process.env.HIVE_LOCAL_GATEWAY_KEY ?? serviceKey;
const caseKey = process.env.HIVE_VERIFY_CASE ?? '';

if (!url || !serviceKey) {
  console.error(
    'filing-verify: run through `node scripts/local-supabase.mjs verify-filings [caseKey]`',
  );
  process.exit(1);
}

let caseId = null;
if (caseKey !== '') {
  const target = resolveLedgerTarget(caseKey);
  if (target.problem) {
    console.error(`filing-verify: ${target.problem}`);
    process.exit(1);
  }
  caseId = target.caseId;
}

const result = await verifyFilingReceipts({ url, serviceKey, gatewayKey, caseId });
if (!result.ok) {
  for (const problem of result.problems) console.error(`  - ${problem}`);
  console.error('filing-verify: the verification did not complete');
  process.exit(1);
}
for (const entry of result.results) {
  console.log(
    `filing-verify: ${entry.receiptId} -> ${entry.status} (${entry.found ? 'object found' : 'object not found'})`,
  );
}
console.log(
  `filing-verify: ${result.results.length} receipt(s) checked by ${result.adapter}; nothing written to any record`,
);
