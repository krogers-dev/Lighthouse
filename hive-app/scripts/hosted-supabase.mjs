#!/usr/bin/env node
/**
 * hosted-supabase — the operator's commands against a hosted project
 * (WO-011). The counterpart of local-supabase.mjs for the review tooling
 * and the kill switch.
 *
 *   node scripts/hosted-supabase.mjs <staging|production> review-window-status
 *   node scripts/hosted-supabase.mjs <target> seed-review
 *   node scripts/hosted-supabase.mjs <target> open-review-window [hours]
 *   node scripts/hosted-supabase.mjs <target> check-review-sign-in
 *   node scripts/hosted-supabase.mjs <target> close-review-window
 *   node scripts/hosted-supabase.mjs <target> sweep-review-window
 *   node scripts/hosted-supabase.mjs <target> retire-review
 *   node scripts/hosted-supabase.mjs staging prove-review
 *   node scripts/hosted-supabase.mjs <target> service-status
 *   node scripts/hosted-supabase.mjs <target> pause-service [maintenance|incident]
 *   node scripts/hosted-supabase.mjs <target> resume-service
 *   node scripts/hosted-supabase.mjs <target> onboard-entity "<client name>" "<entity name>"
 *   node scripts/hosted-supabase.mjs <target> invite <address> <role> <entity id>
 *   node scripts/hosted-supabase.mjs <target> revoke-access <address> <role> <entity id>
 *   node scripts/hosted-supabase.mjs <target> list-entities
 *   node scripts/hosted-supabase.mjs <target> list-access <entity id>
 *
 * A change on production needs its project ref repeated:
 *   node scripts/hosted-supabase.mjs production seed-review --confirm <project-ref>
 *
 * The target is one of the two projects in security/hosted-targets.json;
 * nothing else is reachable. The project's secret key is read from the
 * Supabase CLI under the operator's own login (`projects api-keys
 * --reveal`), held in this process's memory, handed to one child process
 * through its environment, and never written, printed, or logged: the
 * CLI's output is captured and the child's output is shown only after
 * every key shape has been stripped from it. The custody is therefore the
 * CLI login on the operator's machine, and nothing in the repository.
 *
 * Every refusal (unknown target, unknown command, a change on production
 * without the ref, the proof on production, hours out of range, a reason
 * outside the list, a code file inside the repository, a malformed
 * address, role, name, or id) happens before the key is asked for.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  CHANGE_COMMANDS,
  PROOF_COMMAND,
  READ_COMMANDS,
  confirmationError,
  loadHostedManifest,
  proofAllowed,
  redactKeys,
  resolveHostedTarget,
  reviewCodeFileFor,
  selectProjectKeys,
} from './lib/hosted-targets.mjs';
import { onboardingRulesFor, parseOnboardingCommand } from './lib/onboarding.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';

const USAGE =
  'usage: hosted-supabase.mjs <staging|production> <review-window-status|seed-review|open-review-window [hours]|check-review-sign-in|close-review-window|sweep-review-window|retire-review|prove-review|service-status|pause-service [maintenance|incident]|resume-service|onboard-entity "<client>" "<entity>"|invite <address> <role> <entity id>|revoke-access <address> <role> <entity id>|list-entities|list-access <entity id>> [--confirm <project-ref>]';

function fail(message, output) {
  if (output) console.error(redactKeys(output));
  console.error(`hosted-supabase: ${message}`);
  process.exit(1);
}

/** Splits `--confirm <ref>` from the positional arguments. */
export function parseArguments(argv) {
  const positional = [];
  let confirm = '';
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--confirm') {
      confirm = argv[index + 1] ?? '';
      index += 1;
    } else {
      positional.push(argv[index]);
    }
  }
  const [targetName, command, ...rest] = positional;
  return { targetName, command, rest, confirm };
}

/** The tool and its mode for each command. */
const ONBOARDING_COMMANDS = new Set([
  'onboard-entity',
  'invite',
  'revoke-access',
  'list-entities',
  'list-access',
]);

function childFor(command, hours, codeFile, reason, rest) {
  if (ONBOARDING_COMMANDS.has(command)) {
    return {
      script: 'onboarding.mjs',
      env: { HIVE_ONBOARD_COMMAND: command, HIVE_ONBOARD_ARGS: JSON.stringify(rest) },
    };
  }
  switch (command) {
    case 'service-status':
      return { script: 'service-state.mjs', env: { HIVE_SERVICE_MODE: 'read' } };
    case 'pause-service':
      return {
        script: 'service-state.mjs',
        env: { HIVE_SERVICE_MODE: 'pause', HIVE_SERVICE_REASON: reason },
      };
    case 'resume-service':
      return { script: 'service-state.mjs', env: { HIVE_SERVICE_MODE: 'resume' } };
    case 'quarantine-status':
      return { script: 'quarantine-scan.mjs', env: { HIVE_QUARANTINE_MODE: 'status' } };
    case 'sweep-uploads':
      return { script: 'quarantine-scan.mjs', env: { HIVE_QUARANTINE_MODE: 'sweep' } };
    case 'review-window-status':
      return { script: 'review-window.mjs', env: { HIVE_REVIEW_WINDOW_MODE: 'status' } };
    case 'open-review-window':
      return {
        script: 'review-window.mjs',
        env: {
          HIVE_REVIEW_WINDOW_MODE: 'open',
          HIVE_REVIEW_WINDOW_HOURS: String(hours),
          HIVE_REVIEW_CODE_FILE: codeFile,
        },
      };
    case 'check-review-sign-in':
      return {
        script: 'review-window.mjs',
        env: { HIVE_REVIEW_WINDOW_MODE: 'check', HIVE_REVIEW_CODE_FILE: codeFile },
      };
    case 'close-review-window':
      return { script: 'review-window.mjs', env: { HIVE_REVIEW_WINDOW_MODE: 'close' } };
    case 'sweep-review-window':
      return { script: 'review-window.mjs', env: { HIVE_REVIEW_WINDOW_MODE: 'sweep' } };
    case 'seed-review':
      return { script: 'seed-review-tenant.mjs', env: { HIVE_REVIEW_MODE: 'seed' } };
    case 'retire-review':
      return { script: 'seed-review-tenant.mjs', env: { HIVE_REVIEW_MODE: 'retire' } };
    default:
      return { script: 'hosted-review-proof.mjs', env: {} };
  }
}

/** The project's keys, from the CLI under the operator's login. Captured,
 * never streamed: this output contains the secret key. `shell` on Windows
 * because npm ships npx there as a batch wrapper; safe, since the only
 * variable argument is a project ref the manifest check has already held
 * to twenty lowercase letters. */
function fetchProjectKeys(projectRef) {
  const result = spawnSync(
    'npx',
    [
      '--no-install',
      'supabase',
      'projects',
      'api-keys',
      '--project-ref',
      projectRef,
      '--reveal',
      '-o',
      'json',
    ],
    {
      cwd: appRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
      shell: isWindows,
    },
  );
  if (result.status !== 0) {
    fail(
      'the Supabase CLI could not read the project keys (is the CLI signed in as the project owner? `npx supabase login`)',
      [result.stderr, result.error?.message].filter(Boolean).join('\n'),
    );
  }
  const keys = selectProjectKeys(result.stdout);
  if (keys.error) fail(keys.error);
  return keys;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const { targetName, command, rest, confirm } = parseArguments(process.argv.slice(2));
  if (!targetName || !command) fail(USAGE);

  let manifest;
  try {
    manifest = loadHostedManifest();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const resolved = resolveHostedTarget(manifest, targetName);
  if (resolved.error) fail(resolved.error);
  const { name, target } = resolved;

  if (!READ_COMMANDS.has(command) && !CHANGE_COMMANDS.has(command) && command !== PROOF_COMMAND) {
    fail(USAGE);
  }
  if (command === PROOF_COMMAND && !proofAllowed(name, target)) {
    fail(
      name === 'production'
        ? 'prove-review never runs on production: it sets passwords and opens and closes windows'
        : `prove-review is not allowed on ${name} by security/hosted-targets.json`,
    );
  }
  if (ONBOARDING_COMMANDS.has(command)) {
    // What is wrong with the request itself is said first, in words, and
    // is refused whatever was confirmed.
    const parsed = parseOnboardingCommand(
      command,
      rest,
      onboardingRulesFor({ kind: 'hosted', target }),
    );
    if (parsed.problems.length > 0) fail(parsed.problems.join('; '));
  }
  const refusal = confirmationError(name, target, command, confirm);
  if (refusal) fail(refusal);

  let hours = 24;
  let codeFile = '';
  if (command === 'open-review-window') {
    if (rest[0] !== undefined) hours = Number(rest[0]);
    if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
      fail('hours must be a whole number from 1 to 168');
    }
    const chosen = reviewCodeFileFor(name, process.env);
    if (chosen.error) fail(chosen.error);
    codeFile = chosen.file;
  }
  let reason = 'maintenance';
  if (command === 'pause-service') {
    if (rest[0] !== undefined) reason = rest[0];
    if (reason !== 'maintenance' && reason !== 'incident') {
      fail('the reason for a pause is maintenance or incident');
    }
  }
  if (command === 'check-review-sign-in') {
    const chosen = reviewCodeFileFor(name, process.env);
    if (chosen.error) fail(chosen.error);
    codeFile = chosen.file;
  }

  // Only now is the key asked for. Memory only, from here to the child.
  const keys = fetchProjectKeys(target.projectRef);
  // The review commands are probed first, so a refused key or a missing
  // migration reads as that and not as a failure deep in a tool. The
  // switch is not: in an incident it must depend on nothing but itself.
  // Onboarding reports its own refusals.
  const isReview = command.includes('review');
  const probe = !isReview
    ? { ok: true, status: 200 }
    : await fetch(`${target.origin}/rest/v1/rpc/review_window_status`, {
        method: 'POST',
        headers: {
          apikey: keys.secretKey,
          Authorization: `Bearer ${keys.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      }).catch(() => null);
  if (!probe || !probe.ok) {
    fail(
      `${name} did not accept the secret key for the review functions (${
        probe ? `status ${probe.status}` : 'no answer'
      }); are the review migrations on this project?`,
    );
  }

  const child = childFor(command, hours, codeFile, reason, rest);
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([variable]) => !variable.startsWith('HIVE_LOCAL_') && !variable.startsWith('HIVE_HOSTED_'),
    ),
  );
  const run = spawnSync(process.execPath, [path.join(appRoot, 'scripts', child.script)], {
    cwd: appRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...inherited,
      HIVE_HOSTED_TARGET: name,
      HIVE_HOSTED_SUPABASE_URL: target.origin,
      HIVE_HOSTED_SECRET_KEY: keys.secretKey,
      HIVE_HOSTED_CLIENT_KEY: keys.clientKey,
      HIVE_HOSTED_CONFIRM: confirm,
      ...child.env,
    },
  });
  if (run.stdout) process.stdout.write(redactKeys(run.stdout));
  if (run.stderr) process.stderr.write(redactKeys(run.stderr));
  if (run.status !== 0) {
    fail(`${command} on ${name} failed${run.error ? ` (${redactKeys(run.error.message)})` : ''}`);
  }
}
