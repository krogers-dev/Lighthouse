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
 * History findings honor only the hardened blob-scoped exception list in
 * security/secret-scan-allowlist.json: full 40-character object id, exact
 * path, pattern, exact expected occurrence count, owner, reason, approval,
 * expiry, and retest. Unused (orphaned), duplicate, malformed, and expired
 * entries fail the gate; tracked files are never allowlisted (P2-10).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  SECRET_PATTERNS,
  looksBinary,
  reconcileHistoryAllowlist,
  scanText,
  validateAllowlist,
} from './lib/secret-patterns.mjs';

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

const TEXT_EXTENSIONS_SKIP = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ttf',
  '.otf',
  '.ico',
  '.pdf',
  '.zip',
  '.jar',
]);

function scanTrackedFiles() {
  // Tracked files have NO allowlist: a secret-shaped match in a current
  // file always fails — fix the file, never except it (P2-10).
  const findings = [];
  const files = git(['ls-files']).split('\n').filter(Boolean);
  for (const file of files) {
    if (TEXT_EXTENSIONS_SKIP.has(path.extname(file).toLowerCase())) continue;
    const buffer = readFileSync(path.join(appRoot, file));
    if (looksBinary(buffer)) continue;
    findings.push(...scanText(buffer.toString('utf8'), SECRET_PATTERNS, file));
  }
  return { findings, fileCount: files.length };
}

function scanHistory() {
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
      // Raw findings carry the full blob id and exact recorded path; the
      // hardened allowlist reconciliation happens after the whole scan.
      findings.push({ ...finding, blob: object.oid, blobPath: object.path });
    }
  }
  return { findings, blobCount };
}

function runSecretlint() {
  // Invoked through the node binary directly: npm/npx exit 1 for their own
  // bootstrap failures (e.g. devEngines mismatch), which must never be
  // mistaken for findings (independent review P2-6).
  const secretlintBin = path.join(appRoot, 'node_modules', 'secretlint', 'bin', 'secretlint.js');
  if (!existsSync(secretlintBin)) {
    console.error('secrets:scan: secretlint is not installed (run npm ci)');
    process.exit(2);
  }
  const result = spawnSync(
    process.execPath,
    [secretlintBin, '--secretlintrc', '.secretlintrc.json', '**/*'],
    { cwd: appRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  // Exit 0: clean. Exit 1 with output: findings. Anything else, or exit 1
  // with no findings output: engine failure.
  if (result.status !== 0 && result.status !== 1) {
    console.error(result.stderr || result.stdout);
    console.error('secrets:scan: secretlint engine failed to run');
    process.exit(2);
  }
  if (result.status === 1 && !(result.stdout ?? '').trim()) {
    console.error(result.stderr || '');
    console.error('secrets:scan: secretlint exited with findings status but produced no report');
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
const todayIso = new Date().toISOString().slice(0, 10);
const allowlistProblems = validateAllowlist(allowlist, todayIso);
// Fail closed: a malformed allowlist covers nothing.
const effectiveAllowlist = allowlistProblems.length === 0 ? allowlist : [];
const tracked = scanTrackedFiles();
const history = scanHistory();
const reconciled = reconcileHistoryAllowlist(history.findings, effectiveAllowlist);
const secretlint = runSecretlint();
const envProblems = checkEnvFiles();

console.log(
  `secrets:scan: self-test ok; ${tracked.fileCount} tracked files scanned; ${history.blobCount} history blobs scanned; ${effectiveAllowlist.length} history exceptions reconciled; secretlint ${secretlint.clean ? 'clean' : 'FINDINGS'}`,
);

let failed = false;
for (const problem of allowlistProblems) {
  failed = true;
  console.error(`FAIL allowlist ${problem}`);
}
for (const finding of tracked.findings) {
  failed = true;
  console.error(`FAIL tracked ${finding.file}:${finding.line} ${finding.pattern}`);
}
for (const finding of reconciled.uncovered) {
  failed = true;
  console.error(
    `FAIL ${finding.file} ${finding.pattern} (rotate the credential; history rewrite alone is insufficient)`,
  );
}
for (const problem of reconciled.problems) {
  failed = true;
  console.error(`FAIL ${problem}`);
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
