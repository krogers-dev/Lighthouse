#!/usr/bin/env node
/**
 * secrets:scan — the secret gate.
 *
 * 1. Proves itself first with runtime-built synthetic canaries (a scanner
 *    that cannot see the canary fails the gate).
 * 2. Scans every tracked text file with the repo pattern engine
 *    (scripts/lib/secret-patterns.mjs).
 * 3. Scans every blob in Git history — a secret committed and then removed
 *    still fails until rotated and rewritten.
 * 4. Runs secretlint (pinned dev dependency; integrity-verified by the npm
 *    lockfile) with the recommended preset over tracked files.
 * 5. Verifies `.env.local` is not tracked and `.env.example` carries names
 *    only.
 *
 * Findings honor the explicit allowlist in
 * security/secret-scan-allowlist.json (path + pattern + reason).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { SECRET_PATTERNS, isAllowed, looksBinary, scanText } from './lib/secret-patterns.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: appRoot,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  });
}

function selfTest() {
  // Canaries are assembled at runtime so this file never contains a
  // secret-shaped literal itself.
  const canaries = [
    ['supabase-secret-key', 'sb_' + 'secret_' + 'canary0123456789'],
    ['private-key-block', ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ')],
    ['jwt-shaped-token', ['eyJcanary1', 'eyJcanary2', 'canarysig3'].join('.')],
    ['aws-access-key-id', 'AKIA' + 'CANARY0123456789'],
    ['service-role-assignment', 'service_role_key = "' + 'canaryvalue123"'],
  ];
  for (const [expected, text] of canaries) {
    const found = scanText(text, SECRET_PATTERNS, '<canary>');
    if (!found.some((f) => f.pattern === expected)) {
      console.error(`secrets:scan SELF-TEST FAILED: pattern ${expected} missed its canary`);
      process.exit(2);
    }
  }
}

function loadAllowlist() {
  const file = JSON.parse(
    readFileSync(path.join(appRoot, 'security', 'secret-scan-allowlist.json'), 'utf8'),
  );
  return file.entries ?? [];
}

const TEXT_EXTENSIONS_SKIP = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ttf', '.otf', '.ico', '.pdf', '.zip', '.jar']);

function scanTrackedFiles(allowlist) {
  const findings = [];
  const files = git(['ls-files']).split('\n').filter(Boolean);
  for (const file of files) {
    if (TEXT_EXTENSIONS_SKIP.has(path.extname(file).toLowerCase())) continue;
    const buffer = readFileSync(path.join(appRoot, file));
    if (looksBinary(buffer)) continue;
    for (const finding of scanText(buffer.toString('utf8'), SECRET_PATTERNS, file)) {
      if (!isAllowed(finding, allowlist)) findings.push(finding);
    }
  }
  return { findings, fileCount: files.length };
}

function scanHistory(allowlist) {
  const findings = [];
  const objects = git(['rev-list', '--objects', '--all'])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const spaceIndex = line.indexOf(' ');
      return spaceIndex === -1
        ? { oid: line, path: '' }
        : { oid: line.slice(0, spaceIndex), path: line.slice(spaceIndex + 1) };
    })
    .filter((o) => o.path && !o.path.endsWith('/'));
  const seen = new Set();
  let blobCount = 0;
  for (const object of objects) {
    if (seen.has(object.oid)) continue;
    seen.add(object.oid);
    if (TEXT_EXTENSIONS_SKIP.has(path.extname(object.path).toLowerCase())) continue;
    let type;
    try {
      type = git(['cat-file', '-t', object.oid]).trim();
    } catch {
      continue;
    }
    if (type !== 'blob') continue;
    blobCount += 1;
    const content = execFileSync('git', ['cat-file', 'blob', object.oid], {
      cwd: appRoot,
      maxBuffer: 256 * 1024 * 1024,
    });
    if (looksBinary(content)) continue;
    for (const finding of scanText(
      content.toString('utf8'),
      SECRET_PATTERNS,
      `history:${object.oid.slice(0, 12)}:${object.path}`,
    )) {
      const withBlob = { ...finding, blob: object.oid };
      if (!isAllowed(withBlob, allowlist)) findings.push(finding);
    }
  }
  return { findings, blobCount };
}

function runSecretlint() {
  const result = spawnSync(
    'npx',
    ['--no-install', 'secretlint', '--secretlintrc', '.secretlintrc.json', '**/*'],
    { cwd: appRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  // Exit 0: clean. Exit 1: findings. Anything else: engine failure.
  if (result.status !== 0 && result.status !== 1) {
    console.error(result.stderr || result.stdout);
    console.error('secrets:scan: secretlint engine failed to run');
    process.exit(2);
  }
  return { clean: result.status === 0, output: result.stdout };
}

function checkEnvFiles() {
  const problems = [];
  const tracked = git(['ls-files']).split('\n').filter(Boolean);
  if (tracked.some((f) => f === '.env.local' || f.endsWith('/.env.local'))) {
    problems.push('.env.local is tracked by Git — it must never be committed');
  }
  const example = readFileSync(path.join(appRoot, '.env.example'), 'utf8');
  for (const line of example.split('\n')) {
    if (line.trim() === '' || line.startsWith('#')) continue;
    if (!/^[A-Z0-9_]+=$/.test(line.trim())) {
      problems.push(`.env.example must contain names only; offending line ${line.split('=')[0]}=…`);
    }
  }
  return problems;
}

selfTest();
const allowlist = loadAllowlist();
const tracked = scanTrackedFiles(allowlist);
const history = scanHistory(allowlist);
const secretlint = runSecretlint();
const envProblems = checkEnvFiles();

console.log(
  `secrets:scan: self-test ok; ${tracked.fileCount} tracked files scanned; ${history.blobCount} history blobs scanned; secretlint ${secretlint.clean ? 'clean' : 'FINDINGS'}`,
);

let failed = false;
for (const finding of tracked.findings) {
  failed = true;
  console.error(`FAIL tracked ${finding.file}:${finding.line} ${finding.pattern}`);
}
for (const finding of history.findings) {
  failed = true;
  console.error(`FAIL ${finding.file} ${finding.pattern} (rotate the credential; history rewrite alone is insufficient)`);
}
if (!secretlint.clean) {
  failed = true;
  console.error(secretlint.output);
}
for (const problem of envProblems) {
  failed = true;
  console.error(`FAIL ${problem}`);
}

if (failed) {
  console.error('secrets:scan FAILED');
  process.exit(1);
}
console.log('secrets:scan OK');
