#!/usr/bin/env node
/**
 * bundle:inspect — exported-bundle inspection.
 *
 * Walks the Expo export (dist/) and fails on: private keys, Supabase
 * secret/service-role keys, JWT secrets, OAuth credentials, and — outside
 * the development profile — loopback endpoints, legacy anon keys, and
 * development identifiers. Binary payloads (Hermes .hbc bundles, assets)
 * are scanned through printable-string extraction, so the bytecode that
 * actually ships is covered, not just the web text bundle (independent
 * review P1-2).
 *
 * Approved-value contract, enforced in every profile:
 * - any publishable-shaped key found must equal the approved client key;
 * - any *.supabase.co endpoint must match the approved URL;
 * - loopback endpoints must match the approved URL, and only in the
 *   development profile.
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

/** Well-known constants inside vendored libraries that are present in every
 * bundle regardless of configuration. Each entry is an exact string with a
 * documented origin; nothing pattern-shaped is ever allowed wholesale. */
export const KNOWN_LIBRARY_CONSTANTS = [
  // @supabase/auth-js GoTrueClient default placeholder URL; the client is
  // always constructed with the validated environment URL, never this.
  'http://localhost:9999',
  // react-native Libraries/Core/Devtools/getDevServer.js fallback constant,
  // present in every React Native bundle.
  'http://localhost:8081',
  // expo-router build/head/url.js default origin constant.
  'http://localhost:3000',
];

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

/** Printable-ASCII runs from a binary payload (Hermes string tables keep
 * inlined literals intact, so extraction recovers them). */
export function extractPrintableStrings(buffer, minLength = 6) {
  const text = buffer.toString('latin1');
  const runs = text.match(new RegExp(`[\\x20-\\x7e]{${minLength},}`, 'g'));
  return runs ?? [];
}

const PUBLISHABLE_SHAPE = /sb_publishable_[A-Za-z0-9_-]{10,}/g;
const SUPABASE_ENDPOINT = /https?:\/\/[A-Za-z0-9.-]+\.supabase\.(?:co|red)[^\s"'`]*/g;

function findingAt(pattern, filePath, text, index, snippet) {
  return {
    pattern,
    file: filePath,
    line: text.slice(0, index).split('\n').length,
    snippet,
  };
}

/** The approved public URL/client key are the only such values allowed. */
export function checkApprovedValues(text, filePath, approved) {
  const findings = [];
  let match;
  PUBLISHABLE_SHAPE.lastIndex = 0;
  while ((match = PUBLISHABLE_SHAPE.exec(text)) !== null) {
    if (!approved.clientKey || match[0] !== approved.clientKey) {
      findings.push(
        findingAt(
          'unapproved-publishable-key',
          filePath,
          text,
          match.index,
          '[publishable-shaped key differing from the approved client key]',
        ),
      );
    }
  }
  SUPABASE_ENDPOINT.lastIndex = 0;
  while ((match = SUPABASE_ENDPOINT.exec(text)) !== null) {
    if (!approved.url || !match[0].startsWith(approved.url)) {
      findings.push(
        findingAt(
          'unapproved-supabase-endpoint',
          filePath,
          text,
          match.index,
          '[supabase endpoint differing from the approved URL]',
        ),
      );
    }
  }
  return findings;
}

/** Which release-only patterns apply per profile (RETURN-3 area 7):
 *  - development: none (the dev export legitimately carries loopback
 *    endpoints and development identifiers);
 *  - candidate: the AUTHORIZED SYNTHETIC candidate lane — a real
 *    production-mode export built WITHOUT production identifiers or
 *    credentials, so dev-config values are expected; what it must prove
 *    is the absence of the dev-only QA hook (qa-hook-marker);
 *  - release (and anything unknown): every release-only pattern. */
export function patternsForProfile(profile) {
  if (profile === 'development') return [];
  if (profile === 'candidate') {
    return RELEASE_ONLY_PATTERNS.filter((pattern) => pattern.name === 'qa-hook-marker');
  }
  return RELEASE_ONLY_PATTERNS;
}

export function inspectContent(rawText, filePath, profile, approved) {
  let text = rawText;
  for (const constant of KNOWN_LIBRARY_CONSTANTS) {
    text = text.split(constant).join('[known-library-default]');
  }
  const findings = scanText(text, SECRET_PATTERNS, filePath).filter(
    (f) => f.pattern !== 'generic-secret-env',
  );
  findings.push(...checkApprovedValues(text, filePath, approved));
  findings.push(...scanText(text, patternsForProfile(profile), filePath));
  if (profile !== 'release') {
    // Development and the synthetic candidate legitimately carry loopback
    // endpoints — but only the approved one. Any OTHER loopback endpoint
    // is still a finding in every profile.
    const urlPattern = /https?:\/\/(?:127\.0\.0\.1|localhost|10\.0\.2\.2)(?::\d+)?/g;
    let match;
    while ((match = urlPattern.exec(text)) !== null) {
      if (approved.url && match[0].startsWith(approved.url)) continue;
      findings.push(
        findingAt(
          'unapproved-loopback-endpoint',
          filePath,
          text,
          match.index,
          approved.url
            ? '[loopback endpoint differing from the approved URL]'
            : '[loopback endpoint with no approved configuration]',
        ),
      );
    }
  }
  return findings;
}

/** Binary payloads: extract printable strings and run the same checks.
 *
 * Bytecode string tables store adjacent entries with no separator, so an
 * extracted run can fuse a vendored detector prefix (supabase-js ships the
 * literals `sb_publishable_`/`sb_secret_` for its own key-format checks)
 * with an unrelated neighboring string. A real key always carries a long
 * tail, so in binary mode a key prefix without at least 20 key characters
 * behind it is recognized as such a constant; anything key-length still
 * fails the gate. */
export function inspectBinary(buffer, filePath, profile, approved) {
  let text = extractPrintableStrings(buffer).join('\n');
  text = text
    // Caret-anchored occurrences are regex pattern sources (the app's own
    // env validation ships /^sb_secret_/ etc.); a real key is never
    // preceded by a caret.
    .replace(/\^sb_secret_/g, '[app-pattern-source]')
    .replace(/\^sb_publishable_/g, '[app-pattern-source]')
    // Bare detector prefixes without a key-length tail (supabase-js ships
    // them for its own key-format checks; adjacency can fuse them with a
    // short unrelated neighbor).
    .replace(/sb_secret_(?![A-Za-z0-9_-]{20})/g, '[library-detector-prefix]')
    .replace(/sb_publishable_(?![A-Za-z0-9_-]{20})/g, '[library-detector-prefix]');
  return inspectContent(text, filePath, profile, approved).map((f) => ({
    ...f,
    // Line numbers are meaningless across extracted runs.
    line: 0,
  }));
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
    // Release inspection needs the approved production configuration
    // (identifiers, endpoints) that does not exist yet: explicit HOLD.
    // The executable non-development lane is --profile candidate.
    console.error(
      'bundle:inspect: HOLD — release-profile inspection requires approved public configuration; run --profile candidate for the authorized synthetic lane (exit 3)',
    );
    process.exit(3);
  }
  if (profile !== 'development' && profile !== 'candidate') {
    console.error(`bundle:inspect: unknown profile ${JSON.stringify(profile)}`);
    process.exit(2);
  }
  const distDir = process.env.HIVE_BUNDLE_DIST ?? path.join(appRoot, 'dist');
  let files;
  try {
    files = collectFiles(distDir);
  } catch {
    console.error('bundle:inspect: no export found at ' + distDir + ' — run expo export first');
    process.exit(2);
  }
  if (files.length === 0) {
    // Nothing scanned proves nothing: refuse to short-circuit to success.
    console.error(`bundle:inspect ENGINE FAILURE: zero files found under ${distDir}`);
    process.exit(2);
  }
  const approved = loadApproved();
  const findings = [];
  let textCount = 0;
  let binaryCount = 0;
  for (const file of files) {
    const buffer = readFileSync(file);
    const relative = path.relative(appRoot, file);
    if (looksBinary(buffer)) {
      binaryCount += 1;
      findings.push(...inspectBinary(buffer, relative, profile, approved));
    } else {
      textCount += 1;
      findings.push(...inspectContent(buffer.toString('utf8'), relative, profile, approved));
    }
  }
  console.log(
    `bundle:inspect: ${textCount} text and ${binaryCount} binary files scanned in ${path.relative(appRoot, distDir) || distDir} (${profile} profile)`,
  );
  if (profile === 'candidate') {
    console.log(
      'bundle:inspect: candidate lane — synthetic candidate carries development config by design; enforcing zero QA-hook markers across all scanned output',
    );
  }
  if (findings.length > 0) {
    for (const f of findings) console.error(`FAIL ${f.file}:${f.line} ${f.pattern}`);
    console.error('bundle:inspect FAILED');
    process.exit(1);
  }
  console.log('bundle:inspect OK');
}
