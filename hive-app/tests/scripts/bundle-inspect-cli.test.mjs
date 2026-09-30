/** CLI integration tests for the bundle inspector's candidate lane
 * (RETURN-3 area 7): inspection must actually read the export, must fail
 * on a planted QA-hook marker (text AND binary), and must refuse to
 * short-circuit to success when there is nothing to scan. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const inspector = path.join(appRoot, 'scripts', 'bundle-inspect.mjs');
const MARKER = ['HIVE_QA', 'CORRUPT_HOOK'].join('_');

function makeDist(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'hive-dist-'));
  const bundles = path.join(dir, '_expo');
  mkdirSync(bundles, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(bundles, name), content);
  }
  return dir;
}

/** RETURN-4 P1-4: inspection now requires COMPLETE approved
 * configuration; the harness injects the manifest-matching synthetic
 * values (security/approved-config.json development/candidate profile). */
const SYNTHETIC_ENV = {
  EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  EXPO_PUBLIC_SUPABASE_CLIENT_KEY: 'sb_publishable_' + 'synthetic0123456789',
};

function runInspect(profile, distDir, envOverrides = SYNTHETIC_ENV) {
  return spawnSync('node', [inspector, '--profile', profile], {
    encoding: 'utf8',
    env: { ...process.env, ...envOverrides, HIVE_BUNDLE_DIST: distDir },
  });
}

test('candidate lane scans a clean production-mode export and passes', () => {
  const dist = makeDist({
    'bundle.js': 'var release=true;var honest="production-mode bundle content";',
  });
  const result = runInspect('candidate', dist);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /1 text and 0 binary files scanned/);
  assert.match(result.stdout, /candidate lane/);
});

test('candidate lane FAILS on a planted QA-hook marker in a text bundle', () => {
  const dist = makeDist({ 'bundle.js': `var leak="${MARKER}";` });
  const result = runInspect('candidate', dist);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /qa-hook-marker/);
});

test('candidate lane FAILS on a planted QA-hook marker inside a BINARY payload', () => {
  const binary = Buffer.concat([
    Buffer.from([0, 1, 2, 3, 0, 0]),
    Buffer.from(`junk${MARKER}junk`, 'latin1'),
    Buffer.from([0, 0, 7, 8]),
  ]);
  const dist = makeDist({ 'bundle.hbc': binary });
  const result = runInspect('candidate', dist);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /0 text and 1 binary files scanned/);
  assert.match(result.stderr, /qa-hook-marker/);
});

test('development profile does not enforce the marker (dev builds may carry the hook)', () => {
  const dist = makeDist({ 'bundle.js': `var hook="${MARKER}";` });
  const result = runInspect('development', dist);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('CANNOT SHORT-CIRCUIT: an empty export is an engine failure, never success', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hive-dist-empty-'));
  const result = runInspect('candidate', dir);
  assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /zero files/i);
});

test('a missing export directory is an engine failure', () => {
  const result = runInspect('candidate', path.join(tmpdir(), 'does-not-exist-hive'));
  assert.equal(result.status, 2);
});

test('release profile is an explicit HOLD (exit 3), not silent success', () => {
  const dist = makeDist({ 'bundle.js': 'var x=1;' });
  const result = runInspect('release', dist);
  assert.equal(result.status, 3, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /HOLD/);
});

test('unknown profiles are rejected', () => {
  const dist = makeDist({ 'bundle.js': 'var x=1;' });
  const result = runInspect('production', dist);
  assert.equal(result.status, 2);
});

test('NEGATIVE: missing configuration FAILS inspection — it never silently passes (RETURN-4)', () => {
  const dist = makeDist({ 'bundle.js': 'var x=1;' });
  const result = runInspect('candidate', dist, {
    EXPO_PUBLIC_SUPABASE_URL: '',
    EXPO_PUBLIC_SUPABASE_CLIENT_KEY: '',
  });
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /configuration incomplete/);
  assert.match(result.stderr, /approved configuration/);
});

test('NEGATIVE: a suffix-host URL is rejected against the approved-config manifest (RETURN-4)', () => {
  const dist = makeDist({ 'bundle.js': 'var x=1;' });
  const result = runInspect('candidate', dist, {
    ...SYNTHETIC_ENV,
    EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1.evil.example:54321',
  });
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /not an exact approved origin/);
});
