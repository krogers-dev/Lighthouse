import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildEnvLocal,
  describeRun,
  isLoopback,
  parseStatus,
  redactSecrets,
  selectWrittenOrigin,
} from '../../scripts/local-supabase.mjs';

const legacyAnon = ['eyJsyntheticA1', 'eyJsyntheticB2', 'sigsigsig'].join('.');
const sbSecret = 'sb_' + 'secret_syntheticsynthetic';

test('parseStatus prefers the publishable key', () => {
  const parsed = parseStatus(
    JSON.stringify({
      API_URL: 'http://127.0.0.1:54321',
      PUBLISHABLE_KEY: 'sb_publishable_syntheticsynthetic',
      ANON_KEY: legacyAnon,
    }),
  );
  assert.equal(parsed.keyKind, 'publishable');
  assert.equal(parsed.url, 'http://127.0.0.1:54321');
});

test('parseStatus permits a legacy anon key only as loopback development', () => {
  const parsed = parseStatus(
    JSON.stringify({ API_URL: 'http://127.0.0.1:54321', ANON_KEY: legacyAnon }),
  );
  assert.equal(parsed.keyKind, 'legacy-anon');
});

test('parseStatus refuses a non-loopback URL', () => {
  const parsed = parseStatus(
    JSON.stringify({ API_URL: 'https://example-project.supabase.co', ANON_KEY: legacyAnon }),
  );
  assert.ok(parsed.error?.includes('non-loopback'));
});

test('parseStatus reports unusable output without leaking it', () => {
  assert.ok(parseStatus('not json').error);
  assert.ok(parseStatus(JSON.stringify({ API_URL: 'http://127.0.0.1:54321' })).error);
});

test('redactSecrets strips credential shapes from surfaced errors', () => {
  const noisy = `failed: token ${legacyAnon} and ${sbSecret} while starting`;
  const clean = redactSecrets(noisy);
  assert.ok(!clean.includes('syntheticA1'));
  assert.ok(!clean.includes('syntheticsynthetic'));
  assert.ok(clean.includes('[redacted]'));
});

test('buildEnvLocal writes exactly the two public variables', () => {
  const text = buildEnvLocal('http://127.0.0.1:54321', 'sb_publishable_synthetic');
  assert.equal(
    text,
    'EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nEXPO_PUBLIC_SUPABASE_CLIENT_KEY=sb_publishable_synthetic\n',
  );
});

test('isLoopback', () => {
  assert.equal(isLoopback('http://127.0.0.1:54321'), true);
  assert.equal(isLoopback('http://localhost:54321'), true);
  assert.equal(isLoopback('https://example-project.supabase.co'), false);
});

// ---- spawn results a person can read ----
// The first Windows bring-up printed literally "undefined\nundefined"
// in place of the failure: `npx` never launched (a `.cmd` cannot be
// CreateProcess'd directly), so the result had no streams at all and the
// reason lived only in result.error.

test('describeRun surfaces the spawn error of a process that never launched', () => {
  const described = describeRun({
    status: null,
    stdout: undefined,
    stderr: undefined,
    error: new Error('spawnSync npx ENOENT'),
  });
  assert.equal(described, 'spawnSync npx ENOENT');
});

test('describeRun joins real streams and drops empty ones', () => {
  assert.equal(describeRun({ stdout: 'pulled images\n', stderr: '' }), 'pulled images');
  assert.equal(describeRun({ stdout: 'out', stderr: 'err' }), 'out\nerr');
});

test('NEGATIVE: describeRun never renders the word undefined for absent streams', () => {
  for (const result of [{}, { stdout: undefined, stderr: undefined }, null, undefined]) {
    assert.ok(!describeRun(result).includes('undefined'), JSON.stringify(result ?? null));
  }
});

// ---- the origin .env.local gets ----
// Same bring-up, second find: `up` wrote the real key with 127.0.0.1 and
// env:synthetic wrote 10.0.2.2 with a deliberately nonfunctional key, so
// no ordering of the two produced a config an emulator could sign in
// with. `up --android-emulator` writes real key + manifest origin.

const APPROVED = ['http://127.0.0.1:54321', 'http://10.0.2.2:54321'];

test('without the emulator flag the status URL is written unchanged', () => {
  const written = selectWrittenOrigin('http://127.0.0.1:54321', APPROVED, false);
  assert.deepEqual(written, { origin: 'http://127.0.0.1:54321' });
});

test('the emulator flag selects the manifest 10.0.2.2 origin, never an assembled one', () => {
  const written = selectWrittenOrigin('http://127.0.0.1:54321', APPROVED, true);
  assert.deepEqual(written, { origin: 'http://10.0.2.2:54321' });
  assert.ok(APPROVED.includes(written.origin));
});

test('NEGATIVE: no approved 10.0.2.2 origin is an error, not an invented origin', () => {
  const written = selectWrittenOrigin('http://127.0.0.1:54321', ['http://127.0.0.1:54321'], true);
  assert.ok(written.error?.includes('10.0.2.2'));
  assert.equal(written.origin, undefined);
});

test('NEGATIVE: a manifest origin on the wrong port cannot be written', () => {
  // A 10.0.2.2 entry for another port names a stack that is not running;
  // writing it would produce the exact can't-connect the flag exists to
  // prevent.
  const written = selectWrittenOrigin('http://127.0.0.1:54321', ['http://10.0.2.2:9999'], true);
  assert.ok(written.error?.includes('54321'));
});
