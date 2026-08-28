#!/usr/bin/env node
/**
 * local-supabase — pinned-CLI orchestration for the local stack.
 *
 * Invokes the exact supabase CLI (dev dependency, via npx --no-install)
 * with stdout/stderr captured, never streamed. Parses only the loopback
 * API URL and the public client key, redacts known credential shapes from
 * any surfaced error text, and writes an ignored, mode-0600 .env.local.
 * A legacy JWT-shaped ANON_KEY is accepted only for a loopback URL in the
 * development variant; candidate/release configuration rejects it
 * (scripts/candidate-config-check.mjs). The service-role value is passed
 * only in memory to the local seed subprocess environment — never written,
 * printed, bundled, screenshotted, or fixtured.
 *
 * Requires a Docker-compatible container engine. Where images cannot be
 * pulled, scripts/db-local.mjs provides the database evidence lane.
 */
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export function isLoopback(url) {
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

const REDACTIONS = [
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}/g, // JWT
  /sb_secret_[A-Za-z0-9_-]+/g,
  /sb_publishable_[A-Za-z0-9_-]+/g,
  /-----BEGIN[^-]*-----[\s\S]*?-----END[^-]*-----/g,
];

export function redactSecrets(text) {
  let out = text;
  for (const pattern of REDACTIONS) {
    out = out.replace(pattern, '[redacted]');
  }
  return out;
}

/** Parse `supabase status -o json` output into the two public values the
 * app may hold, classifying the key. Everything else is ignored. */
export function parseStatus(jsonText) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return { error: 'status output was not JSON' };
  }
  const url = data.API_URL ?? data.api_url;
  if (typeof url !== 'string' || url.length === 0) {
    return { error: 'status output did not contain an API URL' };
  }
  if (!isLoopback(url)) {
    return { error: 'refusing a non-loopback API URL for local development' };
  }
  const publishable = data.PUBLISHABLE_KEY ?? data.publishable_key;
  if (typeof publishable === 'string' && publishable.startsWith('sb_publishable_')) {
    return { url, clientKey: publishable, keyKind: 'publishable' };
  }
  const anon = data.ANON_KEY ?? data.anon_key;
  if (typeof anon === 'string' && anon.startsWith('eyJ')) {
    // Legacy anon key: permitted only because the URL is loopback and this
    // script only ever configures the development variant.
    return { url, clientKey: anon, keyKind: 'legacy-anon' };
  }
  return { error: 'status output did not contain a usable public client key' };
}

export function buildEnvLocal(url, clientKey) {
  return `EXPO_PUBLIC_SUPABASE_URL=${url}\nEXPO_PUBLIC_SUPABASE_CLIENT_KEY=${clientKey}\n`;
}

function runCli(args) {
  // Captured, never streamed: CLI output can contain credentials.
  //
  // `shell` on Windows is required, not a convenience: npm ships `npx`
  // there as a `.cmd` batch wrapper, and CreateProcess cannot execute a
  // batch file directly — without it every invocation dies at spawn with
  // ENOENT before the CLI runs at all (found on the first Windows
  // bring-up, 2026-08-28). Safe here because every argument this file
  // passes to runCli is a hardcoded literal.
  return spawnSync('npx', ['--no-install', 'supabase', ...args], {
    cwd: appRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    shell: isWindows,
  });
}

/** Printable output of a spawnSync result. A process that never launched
 * has no streams at all — stdout/stderr are undefined and the reason
 * lives in result.error — and interpolating those directly surfaced the
 * literal text "undefined" in place of the failure (same bring-up). */
export function describeRun(result) {
  return [result?.stdout, result?.stderr, result?.error?.message]
    .filter((part) => typeof part === 'string' && part.trim() !== '')
    .join('\n')
    .trim();
}

function fail(message, output) {
  if (output) console.error(redactSecrets(output));
  console.error(`local-supabase: ${message}`);
  process.exit(1);
}

/** Which origin .env.local gets. The running stack always reports
 * loopback (readStatus refuses anything else). An Android emulator
 * reaches that same stack as 10.0.2.2 — the host's loopback from inside
 * the emulator — a different spelling of the same destination, not a
 * different destination. The spelling still has to come from the
 * approved-config manifest: an origin this script assembled itself would
 * not be an approved one, and config:check would reject it. The port has
 * to match the running stack's, or the written config would name a stack
 * that is not there. */
export function selectWrittenOrigin(statusUrl, approvedOrigins, wantsEmulatorHost) {
  if (!wantsEmulatorHost) return { origin: statusUrl };
  const statusPort = new URL(statusUrl).port;
  const match = (approvedOrigins ?? []).find((origin) => {
    try {
      const parsed = new URL(origin);
      return parsed.hostname === '10.0.2.2' && parsed.port === statusPort;
    } catch {
      return false;
    }
  });
  if (match === undefined) {
    return {
      error: `no approved development origin uses 10.0.2.2 on port ${statusPort} — the Android emulator cannot reach the stack without one (security/approved-config.json)`,
    };
  }
  return { origin: match };
}

function readApprovedDevelopmentOrigins() {
  const manifest = JSON.parse(
    readFileSync(path.join(appRoot, 'security', 'approved-config.json'), 'utf8'),
  );
  return manifest?.profiles?.development?.approvedOrigins ?? [];
}

function readStatus() {
  const status = runCli(['status', '-o', 'json']);
  if (status.status !== 0) {
    fail('supabase status failed', describeRun(status));
  }
  const parsed = parseStatus(status.stdout);
  if (parsed.error) {
    fail(parsed.error);
  }
  return { parsed, raw: status.stdout };
}

function up(wantsEmulatorHost) {
  const start = runCli(['start']);
  if (start.status !== 0) {
    fail(
      'supabase start failed — see the output above (if images cannot be pulled, scripts/db-local.mjs provides the fallback database lane)',
      describeRun(start),
    );
  }
  const { parsed } = readStatus();
  const written = selectWrittenOrigin(
    parsed.url,
    readApprovedDevelopmentOrigins(),
    wantsEmulatorHost,
  );
  if (written.error) {
    fail(written.error);
  }
  const envPath = path.join(appRoot, '.env.local');
  writeFileSync(envPath, buildEnvLocal(written.origin, parsed.clientKey));
  chmodSync(envPath, 0o600);
  console.log(`local-supabase: wrote .env.local (${parsed.keyKind} key, origin ${written.origin})`);
}

/** The Supabase CLI's fixed default JWT secret for LOCAL stacks — public
 * knowledge, not a credential, and only ever used after readStatus has
 * refused any non-loopback URL. */
export const CLI_DEFAULT_LOCAL_JWT_SECRET =
  'super-secret-jwt-token-with-at-least-32-characters-long';

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

/** Mint a service_role JWT signed with the local stack's JWT secret. */
export function mintServiceRoleJwt(secret, nowSeconds) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      role: 'service_role',
      iss: 'supabase',
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

/** The privileged BEARER for GoTrue admin and PostgREST.
 *
 * Kong's `apikey` gate and PostgREST's `Authorization` role source have
 * different requirements, found the expensive way on the desktop
 * (2026-08-28): the new-style sb_secret key satisfies Kong and GoTrue,
 * but PostgREST reads roles from a JWT — an unparseable bearer demotes
 * the request to anon, whose grants this schema deliberately strips, so
 * the seed's membership insert answered 403 with full service authority
 * in hand. A legacy service_role JWT is used when the stack still issues
 * one; otherwise one is MINTED from the stack's JWT secret (from status,
 * else the CLI's fixed local default). */
export function chooseServiceBearer(data, nowSeconds) {
  const legacy = data?.SERVICE_ROLE_KEY ?? data?.service_role_key;
  if (typeof legacy === 'string' && legacy.startsWith('eyJ')) {
    return { bearer: legacy, source: 'legacy service_role JWT from supabase status' };
  }
  const statusSecret = data?.JWT_SECRET ?? data?.jwt_secret;
  const secret =
    typeof statusSecret === 'string' && statusSecret.length > 0
      ? statusSecret
      : CLI_DEFAULT_LOCAL_JWT_SECRET;
  return {
    bearer: mintServiceRoleJwt(secret, nowSeconds),
    source:
      secret === CLI_DEFAULT_LOCAL_JWT_SECRET
        ? 'service_role JWT minted from the CLI default local JWT secret'
        : 'service_role JWT minted from the JWT secret in supabase status',
  };
}

async function runHarness(scriptName, extraEnv = {}) {
  const { parsed, raw } = readStatus();
  const data = JSON.parse(raw);
  // The apikey header only has to get past Kong; the bearer carries the
  // role. Prefer the issued secret key, else the legacy JWT, else the
  // public client key (role still comes from the bearer).
  const gatewayKey =
    data.SECRET_KEY ?? data.secret_key ?? data.SERVICE_ROLE_KEY ?? parsed.clientKey;
  const { bearer, source } = chooseServiceBearer(data, Math.floor(Date.now() / 1000));
  // Prove the credential BEFORE any harness runs: a wrong secret would
  // otherwise surface as a confusing 401/403 deep inside a harness.
  const probe = await fetch(`${parsed.url}/rest/v1/memberships?select=user_id&limit=1`, {
    headers: { apikey: gatewayKey, Authorization: `Bearer ${bearer}` },
  });
  if (!probe.ok) {
    fail(
      `the service credential was refused by PostgREST (status ${probe.status}; ${source}). ` +
        'If this stack uses a custom JWT secret, supabase status must expose it.',
    );
  }
  // In memory only, to the child process; never written or printed.
  const child = spawnSync('node', [path.join(appRoot, 'scripts', scriptName)], {
    cwd: appRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'inherit', 'pipe'],
    env: {
      ...process.env,
      HIVE_LOCAL_SUPABASE_URL: parsed.url,
      HIVE_LOCAL_SERVICE_KEY: bearer,
      HIVE_LOCAL_GATEWAY_KEY: gatewayKey,
      HIVE_LOCAL_CLIENT_KEY: parsed.clientKey,
      ...extraEnv,
    },
  });
  if (child.status !== 0) {
    fail(`${scriptName} failed`, redactSecrets(child.stderr ?? ''));
  }
}

async function seed() {
  await runHarness('seed-local.mjs');
}

/** Black-box auth executability proof (P0-1/P0-2): OTP by emailed token,
 * unknown-email negative, TOTP enrollment, refresh, PostgREST negatives. */
async function e2e() {
  await runHarness('e2e-local-auth.mjs');
}

/** Checked loopback factor reset for one synthetic account — the
 * pre-step for a repeatable Maestro enrollment flow (RETURN-3 area 5). */
async function resetTotp(email) {
  if (!email) {
    fail('usage: local-supabase.mjs reset-totp <synthetic-email>');
  }
  await runHarness('reset-totp.mjs', { HIVE_RESET_TOTP_EMAIL: email });
}

function stop() {
  const result = runCli(['stop']);
  if (result.status !== 0) {
    fail('supabase stop failed', describeRun(result));
  }
  console.log('local-supabase: stopped');
}

const command = process.argv[2];
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  switch (command) {
    case 'up':
      up(process.argv.includes('--android-emulator'));
      break;
    case 'status': {
      const { parsed } = readStatus();
      console.log(`API URL: ${parsed.url} (${parsed.keyKind} key present)`);
      break;
    }
    case 'seed':
      await seed();
      break;
    case 'e2e':
      await e2e();
      break;
    case 'reset-totp':
      await resetTotp(process.argv[3]);
      break;
    case 'stop':
      stop();
      break;
    default:
      fail('usage: local-supabase.mjs <up [--android-emulator]|status|seed|e2e|reset-totp|stop>');
  }
}
