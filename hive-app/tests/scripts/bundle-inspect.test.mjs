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

test('the QA-hook marker is flagged in non-development profiles only (RETURN-2)', async () => {
  const { inspectContent } = await import('../../scripts/bundle-inspect.mjs');
  const approved = { url: 'https://approved.supabase.co', clientKey: 'sb_publishable_synthetic' };
  const marker = ['HIVE_QA', 'CORRUPT_HOOK'].join('_');
  const dev = inspectContent(`var x="${marker}"`, 'bundle.js', 'development', approved);
  assert.ok(!dev.some((f) => f.pattern === 'qa-hook-marker'));
  const candidate = inspectContent(`var x="${marker}"`, 'bundle.js', 'candidate', approved);
  assert.ok(candidate.some((f) => f.pattern === 'qa-hook-marker'));
});

// ---- RETURN-4 P1-4: fingerprinted vendor constants, app-owned uses ----

test('vendor constants over their recorded budget are findings, not silently deleted', async () => {
  const { applyVendorConstantBudget, inspectContent } =
    await import('../../scripts/bundle-inspect.mjs');
  const withinBudget = "a='http://localhost:9999'; b='http://localhost:9999';";
  const within = applyVendorConstantBudget(withinBudget, 'dist/b.js');
  assert.deepEqual(within.findings, []);
  assert.ok(!within.text.includes('http://localhost:9999'));
  const overBudget = withinBudget + " c='http://localhost:9999';";
  const over = applyVendorConstantBudget(overBudget, 'dist/b.js');
  assert.ok(over.findings.some((f) => f.pattern === 'vendor-constant-count-exceeded'));
  // Over-budget occurrences stay in the text so the endpoint checks see them.
  assert.ok(over.text.includes('http://localhost:9999'));
  const findings = inspectContent(overBudget, 'dist/b.js', 'development', approved);
  const patterns = findings.map((f) => f.pattern);
  assert.ok(patterns.includes('vendor-constant-count-exceeded'));
  assert.ok(patterns.includes('unapproved-loopback-endpoint'));
});

test('NEGATIVE: app-owned sources may never use the vendored constants', async () => {
  const { checkAppOwnedConstants } = await import('../../scripts/bundle-inspect.mjs');
  const files = {
    'src/lib/supabase.ts': 'createClient(validatedEnv.url, validatedEnv.clientKey)',
    'src/dev/sneaky.ts': "const FALLBACK = 'http://localhost:9999';",
  };
  const failures = checkAppOwnedConstants(Object.keys(files), (f) => files[f] ?? null);
  assert.equal(failures.length, 1);
  assert.ok(failures[0].includes('src/dev/sneaky.ts'));
  assert.ok(failures[0].includes('http://localhost:9999'));
  const clean = checkAppOwnedConstants(['src/lib/supabase.ts'], (f) => files[f] ?? null);
  assert.deepEqual(clean, []);
});

// ---- RETURN-4 P1-4: approved-config manifest resolution ----

const MANIFEST = {
  profiles: {
    development: {
      approvedOrigins: ['http://127.0.0.1:54321'],
      clientKeyPolicy: 'publishable-shape',
    },
    candidate: {
      approvedOrigins: ['http://127.0.0.1:54321'],
      clientKeyPolicy: 'publishable-shape',
    },
    release: { approvedOrigins: [], clientKeyPolicy: 'exact', clientKey: null },
  },
};

test('a complete manifest-matching configuration resolves', async () => {
  const { resolveApprovedConfig } = await import('../../scripts/bundle-inspect.mjs');
  const resolved = resolveApprovedConfig(
    'development',
    {
      EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      EXPO_PUBLIC_SUPABASE_CLIENT_KEY: 'sb_publishable_synthetic0123',
    },
    MANIFEST,
  );
  assert.deepEqual(resolved.problems, []);
  assert.equal(resolved.url, 'http://127.0.0.1:54321');
});

test('NEGATIVE: missing or partial configuration fails — it never silently passes', async () => {
  const { resolveApprovedConfig } = await import('../../scripts/bundle-inspect.mjs');
  const missingBoth = resolveApprovedConfig('development', {}, MANIFEST);
  assert.ok(missingBoth.problems.some((p) => p.includes('EXPO_PUBLIC_SUPABASE_URL is missing')));
  assert.ok(
    missingBoth.problems.some((p) => p.includes('EXPO_PUBLIC_SUPABASE_CLIENT_KEY is missing')),
  );
  const missingKey = resolveApprovedConfig(
    'development',
    { EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' },
    MANIFEST,
  );
  assert.ok(missingKey.problems.some((p) => p.includes('CLIENT_KEY is missing')));
  const missingUrl = resolveApprovedConfig(
    'development',
    { EXPO_PUBLIC_SUPABASE_CLIENT_KEY: 'sb_publishable_synthetic0123' },
    MANIFEST,
  );
  assert.ok(missingUrl.problems.some((p) => p.includes('SUPABASE_URL is missing')));
});

test('NEGATIVE: unapproved custom hosts and suffix-host attacks fail against the manifest', async () => {
  const { resolveApprovedConfig } = await import('../../scripts/bundle-inspect.mjs');
  const key = { EXPO_PUBLIC_SUPABASE_CLIENT_KEY: 'sb_publishable_synthetic0123' };
  const custom = resolveApprovedConfig(
    'development',
    { EXPO_PUBLIC_SUPABASE_URL: 'https://supabase.mycustomdomain.example', ...key },
    MANIFEST,
  );
  assert.ok(custom.problems.some((p) => p.includes('not an exact approved origin')));
  const hostedManifest = {
    profiles: {
      development: {
        approvedOrigins: ['https://example-project.supabase.co'],
        clientKeyPolicy: 'publishable-shape',
      },
    },
  };
  const suffix = resolveApprovedConfig(
    'development',
    { EXPO_PUBLIC_SUPABASE_URL: 'https://example-project.supabase.co.evil.example', ...key },
    hostedManifest,
  );
  assert.ok(suffix.problems.some((p) => p.includes('not an exact approved origin')));
  const exact = resolveApprovedConfig(
    'development',
    { EXPO_PUBLIC_SUPABASE_URL: 'https://example-project.supabase.co', ...key },
    hostedManifest,
  );
  assert.deepEqual(exact.problems, []);
});

test('NEGATIVE: the release profile resolves nothing until origins are approved (HOLD)', async () => {
  const { resolveApprovedConfig } = await import('../../scripts/bundle-inspect.mjs');
  const release = resolveApprovedConfig(
    'release',
    {
      EXPO_PUBLIC_SUPABASE_URL: 'https://example-project.supabase.co',
      EXPO_PUBLIC_SUPABASE_CLIENT_KEY: 'sb_publishable_synthetic0123',
    },
    MANIFEST,
  );
  assert.ok(release.problems.some((p) => p.includes('no approved origins')));
  assert.ok(release.problems.some((p) => p.includes('exact key')));
  const unknown = resolveApprovedConfig('staging', {}, MANIFEST);
  assert.ok(unknown.problems.some((p) => p.includes('no approved-config manifest entry')));
});

test('NEGATIVE: a non-publishable-shaped client key fails shape policy', async () => {
  const { resolveApprovedConfig } = await import('../../scripts/bundle-inspect.mjs');
  const jwtKey = ['eyJsyntheticA1', 'eyJsyntheticB2', 'sigsigsig'].join('.');
  const bad = resolveApprovedConfig(
    'development',
    {
      EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      EXPO_PUBLIC_SUPABASE_CLIENT_KEY: jwtKey,
    },
    MANIFEST,
  );
  assert.ok(bad.problems.some((p) => p.includes('not publishable-shaped')));
});
