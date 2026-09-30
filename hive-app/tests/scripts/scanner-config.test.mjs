/** WO-015: the runner's configuration is refused on anything off, and
 * the shared pipeline judges the declaration before any engine. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  declarationProblem,
  describeOutcome,
  judgeObject,
  sha256Hex,
  verdictFromDetection,
} from '../../scripts/lib/scan-pipeline.mjs';
import {
  DEFAULTS,
  describeScannerConfig,
  isLoopbackUrl,
  resolveScannerConfig,
} from '../../scripts/lib/scanner-config.mjs';
import { loadHostedManifest } from '../../scripts/lib/hosted-targets.mjs';

const manifest = loadHostedManifest();
const SECRET = 'sb_secret_0123456789abcdefghijklmnopqrstuv';
const LEGACY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature';

test('a loopback stack is accepted with any issued key and the local defaults', () => {
  const config = resolveScannerConfig(
    { HIVE_SCANNER_SUPABASE_URL: 'http://127.0.0.1:54321', HIVE_SCANNER_SECRET_KEY: LEGACY },
    null,
  );
  assert.equal(config.loopback, true);
  assert.equal(config.targetName, 'loopback');
  assert.equal(config.url, 'http://127.0.0.1:54321');
  assert.equal(config.gatewayKey, LEGACY);
  assert.equal(config.clamdHost, DEFAULTS.clamdHost);
  assert.equal(config.clamdPort, DEFAULTS.clamdPort);
  assert.equal(config.once, false);
  assert.equal(config.intervalMs, DEFAULTS.intervalMs);
  assert.ok(isLoopbackUrl('http://localhost:54321'));
  assert.ok(!isLoopbackUrl('https://zhdvmllscjyepwucbtzq.supabase.co'));
  assert.ok(!isLoopbackUrl('nonsense'));
});

test('a hosted project is accepted only by its exact origin from the manifest, over https, with the secret key shape', () => {
  const staging = manifest.targets.staging.origin;
  const config = resolveScannerConfig(
    {
      HIVE_SCANNER_SUPABASE_URL: staging,
      HIVE_SCANNER_SECRET_KEY: SECRET,
      HIVE_SCANNER_CLAMD_HOST: 'clamd',
      HIVE_SCANNER_ONCE: '1',
      HIVE_SCANNER_BATCH: '5',
    },
    manifest,
  );
  assert.equal(config.targetName, 'staging');
  assert.equal(config.loopback, false);
  assert.equal(config.gatewayKey, SECRET);
  assert.equal(config.clamdHost, 'clamd');
  assert.equal(config.once, true);
  assert.equal(config.batch, 5);
  const refusals = [
    [
      { HIVE_SCANNER_SUPABASE_URL: staging, HIVE_SCANNER_SECRET_KEY: LEGACY },
      /legacy service-role token is refused/,
    ],
    [
      { HIVE_SCANNER_SUPABASE_URL: `${staging}/rest/v1`, HIVE_SCANNER_SECRET_KEY: SECRET },
      /exact origin/,
    ],
    [
      {
        HIVE_SCANNER_SUPABASE_URL: staging.replace('https:', 'http:'),
        HIVE_SCANNER_SECRET_KEY: SECRET,
      },
      /https only/,
    ],
    [
      { HIVE_SCANNER_SUPABASE_URL: 'https://example.invalid', HIVE_SCANNER_SECRET_KEY: SECRET },
      /exact origin/,
    ],
    [{ HIVE_SCANNER_SUPABASE_URL: staging, HIVE_SCANNER_SECRET_KEY: '' }, /SECRET_KEY is required/],
    [{ HIVE_SCANNER_SUPABASE_URL: '', HIVE_SCANNER_SECRET_KEY: SECRET }, /URL is required/],
    [{ HIVE_SCANNER_SUPABASE_URL: 'not a url', HIVE_SCANNER_SECRET_KEY: SECRET }, /not a URL/],
    [
      {
        HIVE_SCANNER_SUPABASE_URL: staging,
        HIVE_SCANNER_SECRET_KEY: SECRET,
        HIVE_SCANNER_CLAMD_PORT: '70000',
      },
      /CLAMD_PORT/,
    ],
    [
      {
        HIVE_SCANNER_SUPABASE_URL: staging,
        HIVE_SCANNER_SECRET_KEY: SECRET,
        HIVE_SCANNER_INTERVAL_MS: '10',
      },
      /INTERVAL_MS/,
    ],
    [
      {
        HIVE_SCANNER_SUPABASE_URL: staging,
        HIVE_SCANNER_SECRET_KEY: SECRET,
        HIVE_SCANNER_CLAMD_HOST: 'a b',
      },
      /CLAMD_HOST/,
    ],
  ];
  for (const [env, expected] of refusals) {
    assert.throws(() => resolveScannerConfig(env, manifest), expected, JSON.stringify(env));
  }
  // Without a manifest no hosted origin is known at all.
  assert.throws(
    () =>
      resolveScannerConfig(
        { HIVE_SCANNER_SUPABASE_URL: staging, HIVE_SCANNER_SECRET_KEY: SECRET },
        null,
      ),
    /exact origin/,
  );
});

test('the printable description carries no key', () => {
  const config = resolveScannerConfig(
    {
      HIVE_SCANNER_SUPABASE_URL: manifest.targets.production.origin,
      HIVE_SCANNER_SECRET_KEY: SECRET,
    },
    manifest,
  );
  const line = describeScannerConfig(config);
  assert.ok(line.includes('production'));
  assert.ok(!line.includes(SECRET));
  assert.ok(!line.includes(SECRET.slice(10, 20)));
});

test('the pipeline judges the declaration first and the engine last, and never accepts a failure', async () => {
  const bytes = new TextEncoder().encode('%PDF-1.4\n% synthetic (Synthetic)\n%%EOF\n');
  const declared = { declaredByteSize: bytes.byteLength, declaredDigest: sha256Hex(bytes) };
  assert.equal(declarationProblem({ bytes, ...declared }), null);
  assert.deepEqual(declarationProblem({ bytes: bytes.subarray(1), ...declared }), {
    verdict: 'rejected',
    reason: 'size_mismatch',
  });
  const flipped = Uint8Array.from(bytes);
  flipped[3] ^= 1;
  assert.deepEqual(declarationProblem({ bytes: flipped, ...declared }), {
    verdict: 'rejected',
    reason: 'digest_mismatch',
  });
  assert.deepEqual(declarationProblem({ bytes: null, ...declared }), {
    verdict: 'rejected',
    reason: 'scan_failed',
  });
  assert.deepEqual(verdictFromDetection({ status: 'clean' }), {
    verdict: 'accepted',
    reason: null,
  });
  assert.deepEqual(
    verdictFromDetection({ status: 'infected', signature: 'Eicar-Test-Signature' }),
    {
      verdict: 'rejected',
      reason: 'malware_detected',
      detail: 'Eicar-Test-Signature',
    },
  );
  assert.equal(verdictFromDetection({ status: 'error', message: 'x' }).reason, 'scan_failed');
  assert.equal(verdictFromDetection(undefined).reason, 'scan_failed');
  // An engine is never asked about a dishonest declaration.
  let asked = 0;
  const detect = async () => {
    asked += 1;
    return { status: 'clean' };
  };
  assert.equal(
    (await judgeObject({ bytes: flipped, ...declared, detect })).reason,
    'digest_mismatch',
  );
  assert.equal(asked, 0);
  assert.equal((await judgeObject({ bytes, ...declared, detect })).verdict, 'accepted');
  assert.equal(asked, 1);
  assert.equal(
    describeOutcome('ClamAV', 'u-1', {
      verdict: 'rejected',
      reason: 'malware_detected',
      detail: 'Sig.Name',
    }),
    'ClamAV: u-1 -> rejected (malware_detected) [Sig.Name]',
  );
  assert.equal(
    describeOutcome('ClamAV', 'u-2', { verdict: 'accepted', reason: null }),
    'ClamAV: u-2 -> accepted',
  );
  assert.equal(
    describeOutcome('ClamAV', 'u-3', {
      verdict: 'rejected',
      reason: 'scan_failed',
      detail: 'the message',
    }),
    'ClamAV: u-3 -> rejected (scan_failed)',
  );
});
