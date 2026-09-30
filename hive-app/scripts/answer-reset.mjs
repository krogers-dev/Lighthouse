#!/usr/bin/env node
/**
 * answer-reset — checked, loopback-only reset of one seeded request's
 * answer (WO-004).
 *
 *   node scripts/local-supabase.mjs reset-answer a1Question
 *
 * The answer flows settle the seeded November question, and a request is
 * answered once; this puts it back so a flow, the harness, or the bridge
 * can run again on the same stack. Fail-closed: the target must be a
 * seeded OPEN request named in scripts/lib/answer-reset.mjs; the answer
 * row is deleted (citations cascade), the request returns to OPEN, the
 * "request answered" trail entries the submissions added are removed
 * (never the seeded one), and a readback must show OPEN with no answer.
 * Audit receipts are append-only and stay. Loopback URLs only; the
 * privileged bearer arrives in memory and is never printed or persisted.
 */
import process from 'node:process';

import { performAnswerReset } from './lib/answer-reset.mjs';

const url = process.env.HIVE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.HIVE_LOCAL_SERVICE_KEY;
const gatewayKey = process.env.HIVE_LOCAL_GATEWAY_KEY ?? serviceKey;
const requestKey = process.env.HIVE_RESET_ANSWER_REQUEST ?? '';

if (!url || !serviceKey) {
  console.error(
    'answer-reset: run through `node scripts/local-supabase.mjs reset-answer <requestKey>`',
  );
  process.exit(1);
}
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname)) {
  console.error('answer-reset: refusing a non-loopback URL');
  process.exit(1);
}

const result = await performAnswerReset({ url, serviceKey, gatewayKey, requestKey });
if (!result.ok) {
  for (const problem of result.problems) console.error(`  - ${problem}`);
  console.error('answer-reset: the reset did not complete');
  process.exit(1);
}
console.log(`answer-reset: ${result.key} is OPEN again with no answer (version ${result.version})`);
