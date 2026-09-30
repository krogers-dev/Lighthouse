import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createHmac } from 'node:crypto';

import {
  CLI_DEFAULT_LOCAL_JWT_SECRET,
  buildEnvLocal,
  chooseServiceBearer,
  describeRun,
  isLoopback,
  mintServiceRoleJwt,
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

// ---- the service bearer PostgREST can actually read ----
// Found at the seed's first membership insert against the CLI stack
// (2026-08-28): the new-style sb_secret key satisfies Kong and GoTrue,
// but PostgREST reads roles from a JWT — an unparseable bearer demotes
// the request to anon, whose table grants this schema deliberately
// strips, so full service authority answered 403. The bearer must be a
// service_role JWT: the stack's legacy one when issued, else minted.

test('mintServiceRoleJwt produces a verifiable HS256 service_role JWT', () => {
  const token = mintServiceRoleJwt('test-secret-0123456789-0123456789', 1_700_000_000);
  const [header, payload, signature] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), {
    alg: 'HS256',
    typ: 'JWT',
  });
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  assert.equal(claims.role, 'service_role');
  assert.equal(claims.iss, 'supabase');
  assert.equal(claims.exp, claims.iat + 3600);
  const expected = createHmac('sha256', 'test-secret-0123456789-0123456789')
    .update(`${header}.${payload}`)
    .digest('base64url');
  assert.equal(signature, expected);
});

test('a legacy service_role JWT from status is used as-is', () => {
  const legacy = ['eyJhbGciOiJIUzI1NiJ9', 'eyJyb2xlIjoic2VydmljZV9yb2xlIn0', 'sig'].join('.');
  const chosen = chooseServiceBearer({ SERVICE_ROLE_KEY: legacy }, 1_700_000_000);
  assert.equal(chosen.bearer, legacy);
  assert.match(chosen.source, /legacy/);
});

test('NEGATIVE: an sb_secret key is never used as the bearer', () => {
  // The exact desktop failure: SECRET_KEY exists, no legacy JWT. The
  // bearer must come out minted, not be the secret passed through.
  const secretKey = 'sb_' + 'secret_syntheticsynthetic';
  const chosen = chooseServiceBearer(
    { SECRET_KEY: secretKey, JWT_SECRET: 'stack-secret-0123456789-0123456789' },
    1_700_000_000,
  );
  assert.notEqual(chosen.bearer, secretKey);
  assert.equal(chosen.bearer.split('.').length, 3);
  assert.match(chosen.source, /minted from the JWT secret in supabase status/);
});

test('with no status secret the CLI default local secret signs the minted JWT', () => {
  const chosen = chooseServiceBearer({}, 1_700_000_000);
  assert.equal(chosen.bearer, mintServiceRoleJwt(CLI_DEFAULT_LOCAL_JWT_SECRET, 1_700_000_000));
  assert.match(chosen.source, /CLI default local JWT secret/);
});
