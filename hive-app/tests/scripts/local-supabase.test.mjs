import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildEnvLocal,
  isLoopback,
  parseStatus,
  redactSecrets,
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
