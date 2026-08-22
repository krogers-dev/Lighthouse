/** Integration tests for the ATOMIC candidate export lane (RETURN-4
 * P1-3), driven by a PATH-injected fake `npx` standing in for the pinned
 * expo CLI. Proves: config failures stop the lane before any export;
 * export failure, missing platform output, and sub-floor payloads all
 * fail; inspection runs over exactly the fresh directory this run
 * created (a planted marker in THAT output fails; preplanted/stale
 * output elsewhere can never be what passes); and the QA-enabled
 * positive control is preserved. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lane = path.join(appRoot, 'scripts', 'candidate-export.mjs');
const MARKER = ['HIVE_QA', 'CORRUPT_HOOK'].join('_');

const SYNTHETIC_ENV = {
  EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  EXPO_PUBLIC_SUPABASE_CLIENT_KEY: 'sb_publishable_' + 'synthetic0123456789',
};

const FAKE_METADATA = JSON.stringify({
  version: 0,
  bundler: 'metro',
  fileMetadata: {
    ios: { bundle: '_expo/static/js/ios/entry-fake.hbc', assets: [] },
    android: { bundle: '_expo/static/js/android/entry-fake.hbc', assets: [] },
  },
});

/** Install a fake `npx` into a fresh PATH dir; returns { pathDir, sentinel }.
 * The body receives $OUT (the --output-dir argument) and $SENTINEL. */
function makeFakeNpx(body) {
  const pathDir = mkdtempSync(path.join(tmpdir(), 'hive-fakenpx-'));
  const sentinel = path.join(pathDir, 'npx-was-invoked');
  const script = [
    '#!/bin/bash',
    'set -e',
    `SENTINEL='${sentinel}'`,
    'touch "$SENTINEL"',
    'OUT="${@: -1}"',
    body,
    '',
  ].join('\n');
  writeFileSync(path.join(pathDir, 'npx'), script);
  chmodSync(path.join(pathDir, 'npx'), 0o755);
  return { pathDir, sentinel };
}

/** The "well-behaved" fake: writes a full synthetic export, planting the
 * QA marker only when EXPO_PUBLIC_QA_HOOKS=1 — mimicking the real Metro
 * stub-redirect behavior. */
const GOOD_BODY = [
  'mkdir -p "$OUT/_expo/static/js/ios" "$OUT/_expo/static/js/android" "$OUT/_expo/static/js/web"',
  'head -c 8192 /dev/zero > "$OUT/_expo/static/js/ios/entry-fake.hbc"',
  'head -c 8192 /dev/zero > "$OUT/_expo/static/js/android/entry-fake.hbc"',
  `{ printf 'var hive_web_bundle=1;'; head -c 8192 /dev/zero | tr '\\0' 'x'; } > "$OUT/_expo/static/js/web/entry-fake.js"`,
  `printf '<html>hive</html>' > "$OUT/index.html"`,
  `printf '%s' '${FAKE_METADATA}' > "$OUT/metadata.json"`,
  'if [ "$EXPO_PUBLIC_QA_HOOKS" = "1" ]; then',
  `  printf '%s' 'var qa="${MARKER}";' >> "$OUT/_expo/static/js/web/entry-fake.js"`,
  'fi',
].join('\n');

function runLane(pathDir, extraArgs = [], envOverrides = {}) {
  const recordPath = path.join(mkdtempSync(path.join(tmpdir(), 'hive-record-')), 'record.json');
  const result = spawnSync(process.execPath, [lane, '--record', recordPath, ...extraArgs], {
    cwd: appRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...SYNTHETIC_ENV,
      PATH: `${pathDir}:${process.env.PATH}`,
      ...envOverrides,
    },
    maxBuffer: 64 * 1024 * 1024,
  });
  return { result, recordPath };
}

test('NEGATIVE: missing configuration stops the lane BEFORE any export runs', () => {
  const { pathDir, sentinel } = makeFakeNpx(GOOD_BODY);
  const { result } = runLane(pathDir, [], {
    EXPO_PUBLIC_SUPABASE_URL: '',
    EXPO_PUBLIC_SUPABASE_CLIENT_KEY: '',
  });
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /approved configuration/);
  assert.match(result.stderr, /nothing was exported/);
  assert.ok(!existsSync(sentinel), 'npx must never have been invoked');
});

test('NEGATIVE: a failing export fails the lane', () => {
  const { pathDir } = makeFakeNpx('exit 1');
  const { result } = runLane(pathDir);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /expo export exited 1/);
});

test('NEGATIVE: an export that writes NOTHING fails — stale/preplanted output elsewhere can never stand in', () => {
  // The repo's own dist/ is populated from a prior real export; the lane
  // must still fail because inspection only ever sees the fresh mkdtemp
  // directory this run created, which stayed empty.
  const { pathDir, sentinel } = makeFakeNpx(': # writes nothing');
  const { result } = runLane(pathDir);
  assert.ok(existsSync(sentinel), 'the fake export ran');
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /metadata\.json is missing/);
});

test('NEGATIVE: sub-floor payloads fail platform verification', () => {
  const tinyBody = [
    'mkdir -p "$OUT/_expo/static/js/ios" "$OUT/_expo/static/js/android" "$OUT/_expo/static/js/web"',
    `printf 'tiny' > "$OUT/_expo/static/js/ios/entry-fake.hbc"`,
    `printf 'tiny' > "$OUT/_expo/static/js/android/entry-fake.hbc"`,
    `printf 'tiny' > "$OUT/_expo/static/js/web/entry-fake.js"`,
    `printf 'x' > "$OUT/index.html"`,
    `printf '%s' '${FAKE_METADATA}' > "$OUT/metadata.json"`,
  ].join('\n');
  const { pathDir } = makeFakeNpx(tinyBody);
  const { result } = runLane(pathDir);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /below the 4096-byte payload floor/);
});

test('NEGATIVE: a missing platform in metadata fails without hardcoded counts', () => {
  const noAndroid = JSON.stringify({
    version: 0,
    bundler: 'metro',
    fileMetadata: { ios: { bundle: '_expo/static/js/ios/entry-fake.hbc', assets: [] } },
  });
  const body = [
    'mkdir -p "$OUT/_expo/static/js/ios" "$OUT/_expo/static/js/web"',
    'head -c 8192 /dev/zero > "$OUT/_expo/static/js/ios/entry-fake.hbc"',
    `{ printf 'var w=1;'; head -c 8192 /dev/zero | tr '\\0' 'x'; } > "$OUT/_expo/static/js/web/entry-fake.js"`,
    `printf '<html></html>' > "$OUT/index.html"`,
    `printf '%s' '${noAndroid}' > "$OUT/metadata.json"`,
  ].join('\n');
  const { pathDir } = makeFakeNpx(body);
  const { result } = runLane(pathDir);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /names no android bundle/);
});

test('a clean export passes; the run record binds command, tools, commit, config digest, and output manifest', () => {
  const { pathDir } = makeFakeNpx(GOOD_BODY);
  const { result, recordPath } = runLane(pathDir);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /qaHooks disabled/);
  assert.match(result.stdout, /NOT a functional build/);
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  assert.match(record.command, /^npx --no-install expo export --platform all --output-dir /);
  assert.ok(record.outputDir.includes('hive-candidate-'), 'fresh private directory');
  assert.equal(record.qaHooks, 'disabled');
  assert.equal(record.profile, 'candidate');
  assert.match(record.toolVersions.node, /^v22\./);
  assert.match(record.toolVersions.expo, /^57\./);
  assert.match(record.sourceCommit.sha, /^[0-9a-f]{40}$/);
  assert.match(record.configManifest.sha256, /^[0-9a-f]{64}$/);
  assert.ok(record.configManifest.files.includes('security/approved-config.json'));
  assert.ok(record.fileCount >= 5);
  assert.ok(record.outputManifest.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
  assert.match(record.lane, /NOT a functional build/);
});

test("NEGATIVE: a planted QA marker in THIS run's output fails the lane (inspection reads the fresh dir)", () => {
  const planted = GOOD_BODY.replace('if [ "$EXPO_PUBLIC_QA_HOOKS" = "1" ]; then', 'if true; then');
  const { pathDir } = makeFakeNpx(planted);
  const { result } = runLane(pathDir);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /qa-hook-marker/);
});

test('the QA-enabled positive control still exists and PASSES only when inspection rejects the export', () => {
  const { pathDir } = makeFakeNpx(GOOD_BODY);
  const control = runLane(pathDir, ['--qa-control']);
  assert.equal(control.result.status, 0, `${control.result.stdout}\n${control.result.stderr}`);
  assert.match(control.result.stdout, /QA CONTROL OK/);
  assert.match(control.result.stdout, /POSITIVE CONTROL/);
  const record = JSON.parse(readFileSync(control.recordPath, 'utf8'));
  assert.equal(record.qaHooks, 'enabled (positive control)');
  // A control whose detector saw nothing must FAIL: strip the conditional
  // marker so the "QA-enabled" export comes out clean.
  const inert = GOOD_BODY.replace('if [ "$EXPO_PUBLIC_QA_HOOKS" = "1" ]; then', 'if false; then');
  const broken = runLane(makeFakeNpx(inert).pathDir, ['--qa-control']);
  assert.equal(broken.result.status, 1);
  assert.match(broken.result.stderr, /QA CONTROL FAILED/);
});
