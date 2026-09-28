#!/usr/bin/env node
/**
 * case-reset — checked, loopback-only reset of one seeded case's review
 * workflow (WO-005).
 *
 *   node scripts/local-supabase.mjs reset-case a1
 *
 * The review lanes freeze, review, and approve the seeded case; this puts
 * it back so a flow, the harness, or the bridge can run again on the same
 * stack. Fail-closed: the target must be a seeded case named in
 * scripts/lib/case-reset.mjs; approvals, verdicts, and packages are
 * removed, the case returns to its seeded status, the workflow's trail
 * entries are removed, and a readback must show the seeded status with no
 * package. Audit receipts are append-only and stay. Loopback URLs only;
 * the privileged bearer arrives in memory and is never printed.
 */
import process from 'node:process';

import { performCaseReset } from './lib/case-reset.mjs';

const url = process.env.HIVE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.HIVE_LOCAL_SERVICE_KEY;
const gatewayKey = process.env.HIVE_LOCAL_GATEWAY_KEY ?? serviceKey;
const caseKey = process.env.HIVE_RESET_CASE ?? '';

if (!url || !serviceKey) {
  console.error('case-reset: run through `node scripts/local-supabase.mjs reset-case <caseKey>`');
  process.exit(1);
}
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname)) {
  console.error('case-reset: refusing a non-loopback URL');
  process.exit(1);
}

const result = await performCaseReset({ url, serviceKey, gatewayKey, caseKey });
if (!result.ok) {
  for (const problem of result.problems) console.error(`  - ${problem}`);
  console.error('case-reset: the reset did not complete');
  process.exit(1);
}
console.log(
  `case-reset: ${result.key} is back to its seeded status with no package (version ${result.version})`,
);
