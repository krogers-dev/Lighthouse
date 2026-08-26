#!/usr/bin/env node
/**
 * env:synthetic — write a SYNTHETIC local configuration (.env.local).
 *
 * RETURN-4 P1-4 made every configuration gate fail closed: missing or
 * partial configuration is a failure, never a silent pass. This helper
 * provisions the expressly synthetic, nonfunctional development
 * configuration for container/CI lanes with no operator-provided
 * `.env.local`: the manifest-approved loopback origin
 * (security/approved-config.json) and a publishable-SHAPED synthetic key.
 *
 * The values are clearly synthetic, carry no credential material, and the
 * file is written mode 0600 and is gitignored. Lanes built on them are
 * labeled synthetic — never reported as a functional build.
 *
 * Refuses to overwrite an existing .env.local without --force so a real
 * operator configuration is never clobbered silently.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(appRoot, '.env.local');

const manifest = JSON.parse(
  readFileSync(path.join(appRoot, 'security', 'approved-config.json'), 'utf8'),
);
const approvedOrigins = manifest?.profiles?.development?.approvedOrigins ?? [];
if (approvedOrigins.length === 0) {
  console.error('env:synthetic ENGINE FAILURE: the development profile approves no origin');
  process.exit(2);
}

/** Which loopback name to write.
 *
 * An Android emulator cannot reach the host as 127.0.0.1 — that address
 * is the emulator itself. The host's loopback is 10.0.2.2 from inside it.
 * Both name the SAME local stack, so this is a spelling choice, not a
 * different destination, and both are approved for development only.
 *
 * The origin is still taken from the manifest rather than built here: a
 * host this script invented would not be an approved origin, and
 * config:check would reject it — correctly. */
const wantsEmulatorHost = process.argv.includes('--android-emulator');
const EMULATOR_HOST = '10.0.2.2';
const selectedOrigin = wantsEmulatorHost
  ? approvedOrigins.find((origin) => new URL(origin).hostname === EMULATOR_HOST)
  : approvedOrigins.find((origin) => new URL(origin).hostname !== EMULATOR_HOST);

if (selectedOrigin === undefined) {
  console.error(
    wantsEmulatorHost
      ? `env:synthetic ENGINE FAILURE: no approved development origin uses ${EMULATOR_HOST}; the Android emulator cannot reach the host stack without one`
      : 'env:synthetic ENGINE FAILURE: no approved non-emulator development origin',
  );
  process.exit(2);
}

if (existsSync(target) && !process.argv.includes('--force')) {
  console.error(
    'env:synthetic: .env.local already exists — refusing to overwrite (pass --force to replace it with the synthetic configuration)',
  );
  process.exit(1);
}

// Publishable-SHAPED but expressly synthetic: this is not a credential.
const syntheticKey = 'sb_publishable_' + 'hive_synthetic_local_0123456789';
const content = [
  '# SYNTHETIC local configuration written by npm run env:synthetic.',
  '# Nonfunctional stand-in values for gate/export lanes only — not a',
  '# credential, not a functional backend configuration. Gitignored.',
  `EXPO_PUBLIC_SUPABASE_URL=${selectedOrigin}`,
  `EXPO_PUBLIC_SUPABASE_CLIENT_KEY=${syntheticKey}`,
  '',
].join('\n');
writeFileSync(target, content, { mode: 0o600 });
console.log(
  `env:synthetic: wrote SYNTHETIC nonfunctional configuration to .env.local (origin ${selectedOrigin}, publishable-shaped synthetic key, mode 0600)`,
);
