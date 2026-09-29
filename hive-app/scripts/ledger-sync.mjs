#!/usr/bin/env node
/**
 * ledger-sync — record the synthetic ledger's references for a seeded
 * case (WO-006).
 *
 *   node scripts/local-supabase.mjs sync-ledger a1
 *
 * Runs only against the loopback stack, with the privileged bearer handed
 * to it in memory by scripts/local-supabase.mjs (never printed, never
 * persisted). Speaks to the database only through the server-role
 * adapter interface (public.record_ledger_reference). The adapter is
 * HiveSyntheticLedger, named on every row it records; no live ledger is
 * read (integrations are HOLD). Output is object identifiers, reference
 * ids, and outcomes; never a value.
 */
import process from 'node:process';

import { syncLedgerReferences } from './lib/ledger-sync.mjs';

const url = process.env.HIVE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.HIVE_LOCAL_SERVICE_KEY;
const gatewayKey = process.env.HIVE_LOCAL_GATEWAY_KEY ?? serviceKey;
const caseKey = process.env.HIVE_SYNC_CASE ?? '';

if (!url || !serviceKey) {
  console.error('ledger-sync: run through `node scripts/local-supabase.mjs sync-ledger <caseKey>`');
  process.exit(1);
}

const result = await syncLedgerReferences({ url, serviceKey, gatewayKey, caseKey });
if (!result.ok) {
  for (const problem of result.problems) console.error(`  - ${problem}`);
  console.error('ledger-sync: the sync did not complete');
  process.exit(1);
}
for (const entry of result.results) {
  console.log(
    `ledger-sync: ${entry.objectType} ${entry.objectId}@${entry.objectVersion} -> ${entry.referenceId} (${
      entry.replayed ? 'already on record' : 'recorded'
    })`,
  );
}
console.log(
  `ledger-sync: ${result.key} carries ${result.results.length} reference(s) read by ${result.adapter}`,
);
