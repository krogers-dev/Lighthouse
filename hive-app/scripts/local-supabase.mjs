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
import { chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  return spawnSync('npx', ['--no-install', 'supabase', ...args], {
    cwd: appRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function fail(message, output) {
  if (output) console.error(redactSecrets(output));
  console.error(`local-supabase: ${message}`);
  process.exit(1);
}

function readStatus() {
  const status = runCli(['status', '-o', 'json']);
  if (status.status !== 0) {
    fail('supabase status failed', `${status.stdout}\n${status.stderr}`);
  }
  const parsed = parseStatus(status.stdout);
  if (parsed.error) {
    fail(parsed.error);
  }
  return { parsed, raw: status.stdout };
}

function up() {
  const start = runCli(['start']);
  if (start.status !== 0) {
    fail(
      'supabase start failed (a Docker-compatible engine with registry access is required; use scripts/db-local.mjs for the fallback database lane)',
      `${start.stdout}\n${start.stderr}`,
    );
  }
  const { parsed } = readStatus();
  const envPath = path.join(appRoot, '.env.local');
  writeFileSync(envPath, buildEnvLocal(parsed.url, parsed.clientKey));
  chmodSync(envPath, 0o600);
  console.log(`local-supabase: wrote .env.local (${parsed.keyKind} key, loopback URL)`);
}

function runHarness(scriptName) {
  const { parsed, raw } = readStatus();
  const data = JSON.parse(raw);
  const serviceKey = data.SERVICE_ROLE_KEY ?? data.service_role_key ?? data.SECRET_KEY;
  if (typeof serviceKey !== 'string' || serviceKey.length === 0) {
    fail('no service key available from supabase status');
  }
  // In memory only, to the child process; never written or printed.
  const child = spawnSync('node', [path.join(appRoot, 'scripts', scriptName)], {
    cwd: appRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'inherit', 'pipe'],
    env: {
      ...process.env,
      HIVE_LOCAL_SUPABASE_URL: parsed.url,
      HIVE_LOCAL_SERVICE_KEY: serviceKey,
      HIVE_LOCAL_CLIENT_KEY: parsed.clientKey,
    },
  });
  if (child.status !== 0) {
    fail(`${scriptName} failed`, redactSecrets(child.stderr ?? ''));
  }
}

function seed() {
  runHarness('seed-local.mjs');
}

/** Black-box auth executability proof (P0-1/P0-2): OTP by emailed token,
 * unknown-email negative, TOTP enrollment, refresh, PostgREST negatives. */
function e2e() {
  runHarness('e2e-local-auth.mjs');
}

function stop() {
  const result = runCli(['stop']);
  if (result.status !== 0) {
    fail('supabase stop failed', `${result.stdout}\n${result.stderr}`);
  }
  console.log('local-supabase: stopped');
}

const command = process.argv[2];
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  switch (command) {
    case 'up':
      up();
      break;
    case 'status': {
      const { parsed } = readStatus();
      console.log(`API URL: ${parsed.url} (${parsed.keyKind} key present)`);
      break;
    }
    case 'seed':
      seed();
      break;
    case 'e2e':
      e2e();
      break;
    case 'stop':
      stop();
      break;
    default:
      fail('usage: local-supabase.mjs <up|status|seed|e2e|stop>');
  }
}
