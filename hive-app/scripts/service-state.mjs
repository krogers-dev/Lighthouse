#!/usr/bin/env node
/**
 * service-state — the service kill switch (WO-007).
 *
 *   node scripts/local-supabase.mjs service-status
 *   node scripts/local-supabase.mjs pause-service [maintenance|incident]
 *   node scripts/local-supabase.mjs resume-service
 *   node scripts/hosted-supabase.mjs <staging|production> <the same three commands>
 *
 * Runs against the loopback stack, or against one of the two hosted
 * projects named in security/hosted-targets.json (WO-011):
 * scripts/lib/operator-context.mjs decides, and a pause or a resume on
 * production needs its project ref repeated. The privileged key is handed
 * over in memory by the runner (never printed, never persisted). Speaks to
 * the database only through the server-role switch
 * (public.set_service_state) and the public status read. Pausing removes
 * nothing: every client and staff read returns zero rows and every
 * transition is refused until the service is resumed; source records and
 * audit history stand exactly as they were.
 *
 * A pause or a resume keeps the minimum app version the service already
 * holds unless HIVE_SERVICE_MIN_VERSION names another, so flipping the
 * switch never lowers a floor an incident raised.
 */
import process from 'node:process';

import { loadHostedManifest } from './lib/hosted-targets.mjs';
import { changeRefusal, resolveOperatorContext } from './lib/operator-context.mjs';
import { keptMinAppVersion, readServiceState, setServiceState } from './lib/service-state.mjs';

const COMMANDS = { read: 'service-status', pause: 'pause-service', resume: 'resume-service' };

function fail(message) {
  console.error(`service-state: ${message}`);
  process.exit(1);
}

const mode = process.env.HIVE_SERVICE_MODE ?? '';
if (!Object.hasOwn(COMMANDS, mode)) fail('HIVE_SERVICE_MODE must be read, pause, or resume');

const context = resolveOperatorContext(process.env, loadHostedManifest());
if (context.error) fail(context.error);
const refusal = changeRefusal(context, COMMANDS[mode]);
if (refusal) fail(refusal);

const reason = process.env.HIVE_SERVICE_REASON ?? '';
const where = context.kind === 'hosted' ? ` [${context.name}]` : '';
const target = {
  url: context.url,
  serviceKey: context.serviceKey,
  gatewayKey: context.gatewayKey,
  ...(context.kind === 'hosted' ? { approvedOrigin: context.target.origin } : {}),
};

function print(status) {
  console.log(
    `service-state${where}: ${status.state} (reason ${status.reason_code}, minimum app version ${status.min_app_version}, status version ${status.version})`,
  );
}

let result = await readServiceState(target);
if (mode !== 'read' && result.ok) {
  const minAppVersion = keptMinAppVersion(process.env.HIVE_SERVICE_MIN_VERSION, result.status);
  result =
    mode === 'pause'
      ? await setServiceState({
          ...target,
          state: 'paused',
          reasonCode: reason === '' ? 'maintenance' : reason,
          minAppVersion,
        })
      : await setServiceState({ ...target, state: 'open', reasonCode: 'none', minAppVersion });
}
if (!result.ok) {
  for (const problem of result.problems) console.error(`  - ${problem}`);
  fail(mode === 'read' ? 'the status could not be read' : 'the switch was not applied');
}
print(result.status);
