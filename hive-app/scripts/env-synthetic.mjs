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
if (approvedOrigins.length !== 1) {
  console.error(
    'env:synthetic ENGINE FAILURE: the development profile must approve exactly one origin',
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
  `EXPO_PUBLIC_SUPABASE_URL=${approvedOrigins[0]}`,
  `EXPO_PUBLIC_SUPABASE_CLIENT_KEY=${syntheticKey}`,
  '',
].join('\n');
writeFileSync(target, content, { mode: 0o600 });
console.log(
  `env:synthetic: wrote SYNTHETIC nonfunctional configuration to .env.local (origin ${approvedOrigins[0]}, publishable-shaped synthetic key, mode 0600)`,
);
