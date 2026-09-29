#!/usr/bin/env node
/**
 * service-state — the service kill switch (WO-007).
 *
 *   node scripts/local-supabase.mjs service-status
 *   node scripts/local-supabase.mjs pause-service [maintenance|incident]
 *   node scripts/local-supabase.mjs resume-service
 *
 * Runs only against the loopback stack, with the privileged bearer handed
 * to it in memory by scripts/local-supabase.mjs (never printed, never
 * persisted). Speaks to the database only through the server-role switch
 * (public.set_service_state) and the public status read. Pausing removes
 * nothing: every client and staff read returns zero rows and every
 * transition is refused until the service is resumed; source records and
 * audit history stand exactly as they were.
 */
import process from 'node:process';

import { readServiceState, setServiceState } from './lib/service-state.mjs';

const url = process.env.HIVE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.HIVE_LOCAL_SERVICE_KEY;
const gatewayKey = process.env.HIVE_LOCAL_GATEWAY_KEY ?? serviceKey;
const mode = process.env.HIVE_SERVICE_MODE ?? '';
const reason = process.env.HIVE_SERVICE_REASON ?? '';
const minAppVersion = process.env.HIVE_SERVICE_MIN_VERSION ?? '0.0.0';

if (!url || !serviceKey) {
  console.error(
    'service-state: run through `node scripts/local-supabase.mjs service-status|pause-service|resume-service`',
  );
  process.exit(1);
}

function print(status) {
  console.log(
    `service-state: ${status.state} (reason ${status.reason_code}, minimum app version ${status.min_app_version}, status version ${status.version})`,
  );
}

let result;
if (mode === 'read') {
  result = await readServiceState({ url, serviceKey, gatewayKey });
} else if (mode === 'pause') {
  result = await setServiceState({
    url,
    serviceKey,
    gatewayKey,
    state: 'paused',
    reasonCode: reason === '' ? 'maintenance' : reason,
    minAppVersion,
  });
} else if (mode === 'resume') {
  result = await setServiceState({
    url,
    serviceKey,
    gatewayKey,
    state: 'open',
    reasonCode: 'none',
    minAppVersion,
  });
} else {
  console.error('service-state: HIVE_SERVICE_MODE must be read, pause, or resume');
  process.exit(1);
}
if (!result.ok) {
  for (const problem of result.problems) console.error(`  - ${problem}`);
  console.error('service-state: the switch was not applied');
  process.exit(1);
}
print(result.status);
