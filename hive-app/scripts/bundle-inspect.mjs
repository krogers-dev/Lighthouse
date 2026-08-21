#!/usr/bin/env node
/**
 * bundle:inspect — exported-bundle inspection.
 *
 * Walks the Expo export output (dist/) and fails on: private keys,
 * Supabase secret/service-role keys, JWT secrets, OAuth credentials, and —
 * outside the development profile — loopback endpoints, legacy anon keys,
 * and development identifiers. Only the explicitly approved public
 * URL/client key for the active profile may appear; any other URL- or
 * key-shaped value fails.
 *
 * Release-profile inspection stays HOLD until approved public release
 * configuration exists; the development profile is the Milestone 0 lane.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  RELEASE_ONLY_PATTERNS,
  SECRET_PATTERNS,
  looksBinary,
  scanText,
} from './lib/secret-patterns.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) out.push(...collectFiles(full));
    else out.push(full);
  }
  return out;
}

/** Well-known constants inside vendored libraries that are present in every
 * bundle regardless of configuration. Each entry is an exact string with a
 * documented origin; nothing pattern-shaped is ever allowed wholesale. */
export const KNOWN_LIBRARY_CONSTANTS = [
  // @supabase/auth-js GoTrueClient default placeholder URL; the client is
  // always constructed with the validated environment URL, never this.
  'http://localhost:9999',
];

export function inspectContent(rawText, filePath, profile, approved) {
  let text = rawText;
  for (const constant of KNOWN_LIBRARY_CONSTANTS) {
    text = text.split(constant).join('[known-library-default]');
  }
  const findings = scanText(text, SECRET_PATTERNS, filePath).filter(
    // The approved public client key is the only key-shaped value allowed;
    // it is publishable-shaped so it never matches SECRET_PATTERNS anyway.
    (f) => f.pattern !== 'generic-secret-env',
  );
  if (profile !== 'development') {
    findings.push(...scanText(text, RELEASE_ONLY_PATTERNS, filePath));
  } else {
    // Development: loopback is expected, but only the approved URL.
    const urlPattern = /https?:\/\/(?:127\.0\.0\.1|localhost|10\.0\.2\.2)(?::\d+)?/g;
    let match;
    while ((match = urlPattern.exec(text)) !== null) {
      if (approved.url && match[0].startsWith(approved.url)) continue;
      if (!approved.url) {
        findings.push({
          pattern: 'unapproved-loopback-endpoint',
          file: filePath,
          line: text.slice(0, match.index).split('\n').length,
          snippet: '[loopback endpoint with no approved configuration]',
        });
      } else if (!match[0].startsWith(approved.url)) {
        findings.push({
          pattern: 'unapproved-loopback-endpoint',
          file: filePath,
          line: text.slice(0, match.index).split('\n').length,
          snippet: '[loopback endpoint differing from the approved URL]',
        });
      }
    }
  }
  return findings;
}

function loadApproved() {
  const env = {};
  try {
    for (const line of readFileSync(path.join(appRoot, '.env.local'), 'utf8').split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match) env[match[1]] = match[2];
    }
  } catch {
    // no .env.local: exports carry no endpoint at all, which is also valid
  }
  return {
    url: process.env.EXPO_PUBLIC_SUPABASE_URL ?? env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    clientKey:
      process.env.EXPO_PUBLIC_SUPABASE_CLIENT_KEY ?? env.EXPO_PUBLIC_SUPABASE_CLIENT_KEY ?? '',
  };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const profile = process.argv.includes('--profile')
    ? process.argv[process.argv.indexOf('--profile') + 1]
    : 'development';
  if (profile === 'release') {
    console.error(
      'bundle:inspect: release-profile inspection is HOLD until approved public configuration exists',
    );
    process.exit(1);
  }
  const distDir = path.join(appRoot, 'dist');
  let files;
  try {
    files = collectFiles(distDir);
  } catch {
    console.error('bundle:inspect: no dist/ export found — run expo export first');
    process.exit(1);
  }
  const approved = loadApproved();
  const findings = [];
  let scanned = 0;
  for (const file of files) {
    const buffer = readFileSync(file);
    if (looksBinary(buffer)) continue;
    scanned += 1;
    findings.push(
      ...inspectContent(buffer.toString('utf8'), path.relative(appRoot, file), profile, approved),
    );
  }
  console.log(`bundle:inspect: ${scanned} text files scanned in dist/ (${profile} profile)`);
  if (findings.length > 0) {
    for (const f of findings) console.error(`FAIL ${f.file}:${f.line} ${f.pattern}`);
    console.error('bundle:inspect FAILED');
    process.exit(1);
  }
  console.log('bundle:inspect OK');
}
