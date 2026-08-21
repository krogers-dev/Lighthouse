import assert from 'node:assert/strict';
import { test } from 'node:test';

import { inspectContent } from '../../scripts/bundle-inspect.mjs';

const approved = { url: 'http://127.0.0.1:54321', clientKey: 'sb_publishable_synthetic' };
const sbSecret = 'sb_' + 'secret_syntheticsynthetic';
const jwt = ['eyJsyntheticA1', 'eyJsyntheticB2', 'sigsigsig'].join('.');

test('flags secret material in any profile', () => {
  const findings = inspectContent(
    `var k = "${sbSecret}";`,
    'dist/bundle.js',
    'development',
    approved,
  );
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
  const lib = "const c = 'http://localhost:9999'; // gotrue default";
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

test('binary payloads are scanned via string extraction (review P1-2)', async () => {
  const { extractPrintableStrings, inspectBinary } =
    await import('../../scripts/bundle-inspect.mjs');
  const secret = 'sb_' + 'secret_bytecodeembeddedvalue0123';
  const buffer = Buffer.concat([
    Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0x00, 0x00]), // hbc-like magic + NULs
    Buffer.from(secret, 'latin1'),
    Buffer.from([0x00, 0x00]),
    Buffer.from('https://foreign-project.supabase.co/rest', 'latin1'),
    Buffer.from([0x00]),
  ]);
  const strings = extractPrintableStrings(buffer);
  assert.ok(strings.some((s) => s.includes('bytecodeembedded')));
  const findings = inspectBinary(buffer, 'dist/entry.hbc', 'development', approved);
  const patterns = findings.map((f) => f.pattern);
  assert.ok(patterns.includes('supabase-secret-key'));
  assert.ok(patterns.includes('unapproved-supabase-endpoint'));
});

test('publishable keys must equal the approved client key', async () => {
  const { inspectContent: inspect } = await import('../../scripts/bundle-inspect.mjs');
  const ok = inspect('key: "sb_publishable_synthetic"', 'dist/b.js', 'development', {
    url: 'http://127.0.0.1:54321',
    clientKey: 'sb_publishable_synthetic',
  });
  assert.deepEqual(ok, []);
  const bad = inspect('key: "sb_publishable_otherotherother"', 'dist/b.js', 'development', {
    url: 'http://127.0.0.1:54321',
    clientKey: 'sb_publishable_synthetic',
  });
  assert.ok(bad.some((f) => f.pattern === 'unapproved-publishable-key'));
});

test('supabase endpoints must match the approved URL', async () => {
  const { inspectContent: inspect } = await import('../../scripts/bundle-inspect.mjs');
  const approvedHosted = {
    url: 'https://example-project.supabase.co',
    clientKey: 'sb_publishable_synthetic',
  };
  const ok = inspect(
    'fetch("https://example-project.supabase.co/rest/v1/cases")',
    'dist/b.js',
    'development',
    approvedHosted,
  );
  assert.deepEqual(ok, []);
  const bad = inspect(
    'fetch("https://other-project.supabase.co/rest/v1/cases")',
    'dist/b.js',
    'development',
    approvedHosted,
  );
  assert.ok(bad.some((f) => f.pattern === 'unapproved-supabase-endpoint'));
});

test('binary mode: vendored detector prefixes pass, key-length tails still fail', async () => {
  const { inspectBinary } = await import('../../scripts/bundle-inspect.mjs');
  const prefix = 'sb_' + 'secret_';
  // Detector prefix fused with a short unrelated neighbor (supabase-js constant).
  const fused = Buffer.concat([
    Buffer.from([0x00, 0x01]),
    Buffer.from(prefix + 'readerType#F8E4E6', 'latin1'),
    Buffer.from([0x00]),
  ]);
  assert.deepEqual(
    inspectBinary(fused, 'dist/entry.hbc', 'development', approved).map((f) => f.pattern),
    [],
  );
  // A real-shaped key (long tail) still fails.
  const real = Buffer.concat([
    Buffer.from([0x00, 0x01]),
    Buffer.from(prefix + 'abcdefghijklmnopqrstuvwxyz0123', 'latin1'),
    Buffer.from([0x00]),
  ]);
  assert.ok(
    inspectBinary(real, 'dist/entry.hbc', 'development', approved).some(
      (f) => f.pattern === 'supabase-secret-key',
    ),
  );
});

test('binary mode: caret-anchored pattern sources are recognized (regex shipping in the app)', async () => {
  const { inspectBinary } = await import('../../scripts/bundle-inspect.mjs');
  const patternSource = '^sb_' + 'secret__decoratedExtraDataKey__REACT_DEVTOOLS';
  const buffer = Buffer.concat([
    Buffer.from([0x00]),
    Buffer.from('boardEventsAreUnreliable' + patternSource, 'latin1'),
    Buffer.from([0x00]),
  ]);
  assert.deepEqual(
    inspectBinary(buffer, 'dist/entry.hbc', 'development', approved).map((f) => f.pattern),
    [],
  );
});
