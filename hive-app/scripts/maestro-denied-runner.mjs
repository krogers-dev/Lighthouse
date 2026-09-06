#!/usr/bin/env node
/**
 * maestro:denied — the ONE supported entry point for the revoked-membership
 * flow on a machine with a device lane (find 21).
 *
 * `read-surfaces-denied.yaml` proves that authorization is enforced by
 * RLS, never by the UI: with the requests list on screen, the signed-in
 * synthetic account's membership on the selected entity is revoked
 * server-side, and the refresh must show the access changed with no stale
 * row surviving. The revoke has to land between "list on screen" and the
 * refresh tap, and Maestro's only mid-flow hook is a GraalJS runScript
 * with `http` — driven by hand, the delete landed after the refresh went
 * out and the stale state never appeared (find 21). This runner makes the
 * synchronization point executable and fail-closed:
 *
 *  - serves a loopback, single-use revoke endpoint IN-PROCESS (a
 *    membership row is not a secret, so unlike the TOTP secret it needs no
 *    separate process to die with; and one process means no helper-death
 *    fail-open) that only ever revokes this run's canonical target;
 *  - holds the privileged bearer in its own memory, resolved and PROVED
 *    against PostgREST before anything touches the device;
 *  - runs sign-in then the flow, each bounded by a watchdog that kills the
 *    whole Maestro process tree on expiry (find 36's shape, from
 *    scripts/lib/bounded-spawn.mjs), with default-location leak detection
 *    around every flow;
 *  - RESTORES the membership on every exit path — success, failure,
 *    watchdog, SIGINT/SIGTERM — through the seed's own idempotent upsert
 *    (scripts/membership-restore.mjs), verified by readback, so the seeded
 *    matrix is never left short; a hand-killed run recovers with
 *        node scripts/local-supabase.mjs restore-membership <email> <entityKey>
 *
 * Synthetic example.invalid identities and loopback services only. The
 * flow names only an account label and an entity key; no credential ever
 * reaches a flow, a CLI argument, a URL, or a file.
 *
 * EXECUTION IS HOLD in the build container (no device, simulator, stack,
 * or Maestro binary): this script is authored and unit-tested here, and
 * runs on the QA machine after the PM passes this candidate for that lane.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { killTree, runBounded } from './lib/bounded-spawn.mjs';
import {
  helperPort,
  isLoopbackAddress,
  parseRevokeRequest,
  readbackPath,
  resolveRevokeTarget,
  revokePath,
  verifyRevoked,
} from './lib/membership-revoke.mjs';
import { resolveServiceCredentials } from './local-supabase.mjs';
import {
  CLEANUP_STEP_TIMEOUT_MS,
  DEFAULT_MAESTRO_TESTS,
  PROBE_TIMEOUT_MS,
  RUN_ROOT_PREFIX,
  detectDefaultLocationLeak,
  flowTimeoutMs,
  isStaleRunRoot,
  lookupMaestroCommand,
  maestroArgs,
  maestroCommand,
  outputFlagProblems,
  pinnedMaestroProblems,
  snapshotDefaultLocation,
} from './maestro-enroll-runner.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The run's one canonical target: the client account the flow signs in
 * as, on the workspace it selects. Never taken from an argument. */
export const TARGET_EMAIL = 'client.owner@example.invalid';
export const TARGET_ENTITY = 'entityA1';

/** sign-in.yaml already signs in as TARGET_EMAIL; the flow then resumes
 * that session, so the lane is self-contained. Sequential by construction. */
export const SEQUENCE = ['sign-in.yaml', 'read-surfaces-denied.yaml'];

/** Maestro `-e` makes a value a GraalJS global for every script in the
 * flow; the flag must precede the flow file. This is how the flow learns
 * the endpoint's actual port without a shared constant. */
export function flowArgsWithEnv(flowFile, dirs, env) {
  const base = maestroArgs(flowFile, dirs);
  const flowPath = base.pop();
  const flags = Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
  return [...base, ...flags, flowPath];
}

function privateDir(parent, name) {
  const dir = path.join(parent, name);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  if (!existsSync(path.join(appRoot, '.maestro'))) {
    console.error('maestro:denied ENGINE FAILURE: .maestro/ is missing');
    process.exit(2);
  }
  const flowTimeout = flowTimeoutMs(process.env);
  if (!Number.isFinite(flowTimeout)) {
    console.error(
      'maestro:denied ENGINE FAILURE: HIVE_MAESTRO_FLOW_TIMEOUT_MS must be a positive integer of milliseconds',
    );
    process.exit(2);
  }
  const port = helperPort(process.env);
  if (!Number.isFinite(port)) {
    console.error(
      'maestro:denied ENGINE FAILURE: HIVE_REVOKE_HELPER_PORT must be a port number between 1 and 65535',
    );
    process.exit(2);
  }
  const target = resolveRevokeTarget(TARGET_EMAIL, TARGET_ENTITY);
  if (target.problem) {
    console.error(`maestro:denied ENGINE FAILURE: ${target.problem}`);
    process.exit(2);
  }

  let inFlight = null;
  function runMaestro(args, { timeoutMs, label, inheritOutput = false }) {
    const cmd = maestroCommand(args);
    return runBounded(cmd.command, cmd.args, {
      cwd: appRoot,
      env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: 'true' },
      timeoutMs,
      label,
      inheritOutput,
      onStart: (child) => {
        inFlight = child;
      },
    }).then((result) => {
      inFlight = null;
      return result;
    });
  }

  /** True when something already listens on 127.0.0.1:port. Inconclusive
   * (no answer within 2s) counts as in use: fail closed. */
  function portInUse(candidate) {
    return new Promise((resolve) => {
      const socket = connect({ host: '127.0.0.1', port: candidate });
      let done = false;
      const finish = (busy) => {
        if (done) return;
        done = true;
        socket.destroy();
        resolve(busy);
      };
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.setTimeout(2000, () => finish(true));
    });
  }

  // The CLI must exist, be the pinned one, and support confinement —
  // the same three gates as the enrollment runner.
  const lookup = lookupMaestroCommand();
  const maestroBin = spawnSync(lookup.command, lookup.args, {
    encoding: 'utf8',
    timeout: PROBE_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  if (maestroBin.status !== 0) {
    console.error(
      'maestro:denied HOLD — the Maestro CLI is not installed here. This runner executes on the QA machine with the device lane; the build container has no device, simulator, or Maestro binary (exit 3)',
    );
    process.exit(3);
  }
  let toolchainRecord;
  try {
    toolchainRecord = JSON.parse(
      readFileSync(path.join(appRoot, 'security', 'hardware-toolchain.json'), 'utf8'),
    );
  } catch {
    console.error(
      'maestro:denied ENGINE FAILURE: security/hardware-toolchain.json is missing or unreadable',
    );
    process.exit(2);
  }
  const version = await runMaestro(['--version'], {
    timeoutMs: PROBE_TIMEOUT_MS,
    label: 'maestro --version',
  });
  if (version.timedOut) {
    console.error(
      `maestro:denied HOLD — \`maestro --version\` gave no answer within ${PROBE_TIMEOUT_MS}ms and its process tree was killed (exit 3)`,
    );
    process.exit(3);
  }
  const pinProblems = pinnedMaestroProblems(toolchainRecord, version.stdout);
  if (pinProblems.length > 0) {
    for (const problem of pinProblems) console.error(`HOLD ${problem}`);
    console.error(
      'maestro:denied HOLD — the Maestro CLI pin is incomplete or does not match the installed binary (exit 3)',
    );
    process.exit(3);
  }
  const help = await runMaestro(['test', '--help'], {
    timeoutMs: PROBE_TIMEOUT_MS,
    label: 'maestro test --help',
  });
  if (help.timedOut) {
    console.error(
      `maestro:denied HOLD — \`maestro test --help\` gave no answer within ${PROBE_TIMEOUT_MS}ms and its process tree was killed (exit 3)`,
    );
    process.exit(3);
  }
  const flagProblems = outputFlagProblems(`${help.stdout}${help.stderr}`);
  if (flagProblems.length > 0) {
    for (const problem of flagProblems) console.error(`FAIL ${problem}`);
    console.error(
      'maestro:denied FAILED — refusing to run a flow whose screenshots cannot be confined',
    );
    process.exit(1);
  }

  // The privileged credential is resolved and PROVED against PostgREST
  // before anything touches the device (exits 1 with the reason if the
  // stack is down or the secret is refused). Memory only, this process.
  const creds = await resolveServiceCredentials();

  // A previous run's endpoint still listening is a HOLD: that run may
  // still hold a revoked membership it never restored.
  if (await portInUse(port)) {
    console.error(
      `maestro:denied HOLD — 127.0.0.1:${port} is already in use, most likely a previous maestro:denied run still alive. End it, run \`node scripts/local-supabase.mjs restore-membership ${target.email} ${target.entityKey}\` to be sure the seeded membership is back, then rerun (exit 3)`,
    );
    process.exit(3);
  }

  // Sweep run roots a hand-killed run left behind, loudly; then a private
  // run root, 0700 on POSIX (Windows %TEMP% is already user-ACL'd).
  for (const entry of readdirSync(tmpdir())) {
    if (!isStaleRunRoot(entry)) continue;
    const stale = path.join(tmpdir(), entry);
    try {
      rmSync(stale, { recursive: true, force: true });
    } catch {
      // fall through to the existence check
    }
    if (existsSync(stale)) {
      console.error(
        `maestro:denied: stale run root ${stale} could not be removed — remove it manually`,
      );
    } else {
      console.log(`maestro:denied: removed stale run root from a previous run (${stale})`);
    }
  }
  const runRoot = mkdtempSync(path.join(tmpdir(), RUN_ROOT_PREFIX));
  if (process.platform !== 'win32') execFileSync('chmod', ['700', runRoot]);
  const debugDir = privateDir(runRoot, 'debug');
  const testOutputDir = privateDir(runRoot, 'artifacts');

  let revoked = false;
  let cleanedUp = false;
  let server = null;

  /** Sync on purpose: this runs from cleanup inside process.on('exit').
   * Restore is idempotent (the seed's ignore-duplicates upsert), so it
   * runs on EVERY exit path — a revoke that was in flight when the run
   * died must never leave the seeded matrix short. */
  function restoreMembership(reason) {
    const result = spawnSync(
      process.execPath,
      [path.join(appRoot, 'scripts', 'membership-restore.mjs')],
      {
        cwd: appRoot,
        stdio: ['ignore', 'inherit', 'inherit'],
        timeout: CLEANUP_STEP_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        env: {
          ...process.env,
          HIVE_LOCAL_SUPABASE_URL: creds.url,
          HIVE_LOCAL_SERVICE_KEY: creds.bearer,
          HIVE_LOCAL_GATEWAY_KEY: creds.gatewayKey,
          HIVE_RESTORE_EMAIL: target.email,
          HIVE_RESTORE_ENTITY: target.entityKey,
        },
      },
    );
    if (result.status === 0) {
      console.log(`maestro:denied: membership restored and verified (${reason})`);
      return;
    }
    const timedOut = result.error && result.error.code === 'ETIMEDOUT';
    console.error(
      `maestro:denied: MEMBERSHIP RESTORE FAILED (${reason})${timedOut ? ` — timed out after ${CLEANUP_STEP_TIMEOUT_MS}ms` : ''} — run \`node scripts/local-supabase.mjs restore-membership ${target.email} ${target.entityKey}\` by hand (or \`seed\`) before the next device flow`,
    );
  }

  function cleanup(reason) {
    if (cleanedUp) return;
    cleanedUp = true;
    // 0. A Maestro invocation still in flight holds the device and open
    //    handles under the run root.
    killTree(inFlight);
    // 1. Put the seeded membership back, verified, on every path.
    restoreMembership(reason);
    // 2. Stop answering revokes.
    server?.close();
    // 3. Scrub the artifact tree, verified.
    rmSync(runRoot, { recursive: true, force: true });
    if (existsSync(runRoot)) {
      console.error(`maestro:denied: FAILED TO SCRUB ${runRoot} — remove it manually`);
    } else {
      console.log(`maestro:denied: artifact tree scrubbed (${runRoot} removed and verified gone)`);
    }
  }

  process.on('exit', () => cleanup('process exit'));
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      console.error(`maestro:denied: received ${signal} — cleaning up`);
      cleanup(signal);
      process.exit(1);
    });
  }

  function fail(message) {
    console.error(`maestro:denied FAILED — ${message}`);
    process.exit(1);
  }

  async function rest(pathname, options = {}) {
    const response = await fetch(`${creds.url}/rest/v1${pathname}`, {
      ...options,
      headers: {
        apikey: creds.gatewayKey,
        Authorization: `Bearer ${creds.bearer}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { ok: response.ok, status: response.status, json };
  }

  function answer(response, status, payload) {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  }

  // The loopback, single-use revoke endpoint. Loopback callers only; the
  // request must name exactly this run's target; the second call is
  // refused; the revoke is readback-verified before it is reported.
  server = createServer((request, response) => {
    if (!isLoopbackAddress(request.socket.remoteAddress ?? '')) {
      answer(response, 403, { error: 'loopback callers only' });
      return;
    }
    if (request.method !== 'POST' || request.url !== '/revoke') {
      answer(response, 404, { error: 'unknown path' });
      return;
    }
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 4096) request.destroy();
    });
    request.on('end', async () => {
      const parsed = parseRevokeRequest(body, target);
      if (parsed.problem) {
        answer(response, 400, { error: parsed.problem });
        return;
      }
      if (revoked) {
        answer(response, 409, { error: 'already revoked in this run' });
        return;
      }
      // Flagged BEFORE the delete goes out: if the run dies mid-request,
      // cleanup still restores.
      revoked = true;
      try {
        const deleted = await rest(revokePath(target), {
          method: 'DELETE',
          headers: { Prefer: 'return=representation' },
        });
        if (!deleted.ok) {
          answer(response, 502, { error: `PostgREST delete answered ${deleted.status}` });
          return;
        }
        const readback = await rest(readbackPath(target), { method: 'GET' });
        const problems = readback.ok
          ? verifyRevoked(readback.json)
          : [`revoke readback answered ${readback.status}`];
        if (problems.length > 0) {
          answer(response, 502, { error: problems.join('; ') });
          return;
        }
        const count = Array.isArray(deleted.json) ? deleted.json.length : 0;
        console.log(
          `maestro:denied: membership revoked mid-flow (${count} row(s) deleted); readback verified zero`,
        );
        answer(response, 200, { ok: true, revoked: count });
      } catch (error) {
        answer(response, 502, { error: `revoke failed: ${error.message}` });
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  console.log(
    `maestro:denied: revoke endpoint on http://127.0.0.1:${port} (loopback only; single-use; target ${target.email} on ${target.entityKey})`,
  );

  /** Run one flow, sequentially, with leak detection and the watchdog. */
  async function runFlow(flowFile) {
    const before = snapshotDefaultLocation();
    const args = flowArgsWithEnv(
      flowFile,
      { debugDir, testOutputDir },
      { REVOKE_HELPER_URL: `http://127.0.0.1:${port}` },
    );
    console.log(
      `maestro:denied: running ${flowFile} (sequential; artifacts confined to ${runRoot}; watchdog ${flowTimeout}ms)`,
    );
    const result = await runMaestro(args, {
      timeoutMs: flowTimeout,
      label: flowFile,
      inheritOutput: true,
    });
    const leaks = detectDefaultLocationLeak(before, snapshotDefaultLocation());
    return { status: result.status, timedOut: result.timedOut, leaks };
  }

  for (const flowFile of SEQUENCE) {
    const outcome = await runFlow(flowFile);
    if (outcome.leaks.length > 0) {
      for (const leak of outcome.leaks) console.error(`FAIL ${leak}`);
      fail(`${flowFile} leaked artifacts into ${DEFAULT_MAESTRO_TESTS}`);
    }
    if (outcome.timedOut) {
      fail(
        `${flowFile} hit the ${flowTimeout}ms watchdog; its process tree was killed and cleanup ran — if the flow legitimately needs longer, set HIVE_MAESTRO_FLOW_TIMEOUT_MS`,
      );
    }
    if (outcome.status !== 0) {
      fail(`${flowFile} exited ${outcome.status}`);
    }
  }
  if (!revoked) {
    fail(
      'the flow completed without ever calling the revoke endpoint — its runScript step is missing or pointed elsewhere, so nothing was proven',
    );
  }

  console.log(
    'maestro:denied OK — signed in, requests listed, membership revoked MID-FLOW, refresh showed the access change with no stale row; membership restored and verified by cleanup, artifacts confined and removed',
  );
}
