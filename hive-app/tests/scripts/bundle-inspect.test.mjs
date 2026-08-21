import assert from 'node:assert/strict';
import { test } from 'node:test';

import { inspectContent } from '../../scripts/bundle-inspect.mjs';

const approved = { url: 'http://127.0.0.1:54321', clientKey: 'sb_publishable_synthetic' };
const sbSecret = 'sb_' + 'secret_syntheticsynthetic';
const jwt = ['eyJsyntheticA1', 'eyJsyntheticB2', 'sigsigsig'].join('.');

test('flags secret material in any profile', () => {
  const findings = inspectContent(`var k = "${sbSecret}";`, 'dist/bundle.js', 'development', approved);
  assert.ok(findings.some((f) => f.pattern === 'supabase-secret-key'));
});

test('development allows only the approved loopback URL', () => {
  const ok = inspectContent(
    'fetch("http://127.0.0.1:54321/rest/v1/cases")',
    'dist/bundle.js',
    'development',
    approved,
  );
  assert.deepEqual(ok, []);
  const other = inspectContent(
    'fetch("http://127.0.0.1:9999/other")',
    'dist/bundle.js',
    'development',
    approved,
  );
  assert.ok(other.some((f) => f.pattern === 'unapproved-loopback-endpoint'));
});

test('a legacy anon key in a bundle is jwt-shaped and flagged', () => {
  const findings = inspectContent(`var k="${jwt}"`, 'dist/bundle.js', 'development', approved);
  assert.ok(findings.some((f) => f.pattern === 'jwt-shaped-token'));
});

test('non-development profiles reject loopback and development identifiers', () => {
  const findings = inspectContent(
    'http://127.0.0.1:54321 com.myhbcfo.hive.development',
    'dist/bundle.js',
    'release',
    approved,
  );
  const patterns = findings.map((f) => f.pattern);
  assert.ok(patterns.includes('loopback-endpoint'));
  assert.ok(patterns.includes('development-identifier'));
});

test('the gotrue-js default placeholder is recognized; other loopbacks still flag', () => {
  const lib = 'const c = \'http://localhost:9999\'; // gotrue default';
  assert.deepEqual(inspectContent(lib, 'dist/bundle.js', 'development', approved), []);
  assert.deepEqual(inspectContent(lib, 'dist/bundle.js', 'release', approved), []);
  const other = inspectContent(
    'fetch("http://localhost:8080/x")',
    'dist/bundle.js',
    'development',
    approved,
  );
  assert.ok(other.length > 0);
});
