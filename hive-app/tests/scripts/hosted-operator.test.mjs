import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  HOSTED_MANIFEST_PATH,
  confirmationError,
  isInsideDirectory,
  isSecretKeyShape,
  loadHostedManifest,
  manifestProblems,
  originMatches,
  proofAllowed,
  redactKeys,
  resolveHostedTarget,
  reviewCodeFileFor,
  selectProjectKeys,
} from '../../scripts/lib/hosted-targets.mjs';
import { changeRefusal, resolveOperatorContext } from '../../scripts/lib/operator-context.mjs';
import { loadReviewCode } from '../../scripts/lib/review-code.mjs';
import { REVIEW_TENANT } from '../../scripts/lib/review-tenant.mjs';
import {
  keptMinAppVersion,
  readServiceState,
  setServiceState,
} from '../../scripts/lib/service-state.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = loadHostedManifest();
const staging = manifest.targets.staging;
const production = manifest.targets.production;

// Key-shaped fixtures are assembled at run time so that no literal in this
// file has the shape of a credential.
const tail = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p';
const fakeSecret = 'sb_' + 'secret_' + tail;
const fakePublishable = 'sb_' + 'publishable_' + tail;
const fakeLegacy = ['eyJhbGciOiJIUzI1NiJ9', 'eyJyb2xlIjoic2VydmljZV9yb2xlIn0', 'c2lnbmF0dXJl'].join(
  '.',
);

function cliJson(entries) {
  return JSON.stringify(entries);
}

// ---------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------

test('the manifest names exactly staging and production and holds nothing key-shaped', () => {
  assert.deepEqual(Object.keys(manifest.targets).sort(), ['production', 'staging']);
  assert.deepEqual(manifestProblems(manifest), []);
  const raw = readFileSync(HOSTED_MANIFEST_PATH, 'utf8');
  assert.ok(!raw.includes('sb_' + 'secret_'));
  assert.ok(!raw.includes('sb_' + 'publishable_'));
  assert.ok(!/eyJ[A-Za-z0-9_-]{6,}\./.test(raw));
});

test('the manifest agrees with the Supabase config and the approved release origin', () => {
  const config = readFileSync(path.join(appRoot, 'supabase', 'config.toml'), 'utf8');
  const refOf = (name) =>
    new RegExp(`\\[remotes\\.${name}\\]\\s*\\r?\\nproject_id = "([a-z]{20})"`).exec(config)?.[1];
  assert.equal(staging.projectRef, refOf('staging'));
  assert.equal(production.projectRef, refOf('production'));
  const approved = JSON.parse(
    readFileSync(path.join(appRoot, 'security', 'approved-config.json'), 'utf8'),
  );
  assert.deepEqual(approved.profiles.release.approvedOrigins, [production.origin]);
  assert.notEqual(staging.projectRef, production.projectRef);
});

test('the review address on a hosted project is a Honeybee mailbox, never the synthetic one', () => {
  for (const target of [staging, production]) {
    assert.match(target.reviewEmail, /@myhbcfo\.com$/);
    assert.notEqual(target.reviewEmail, REVIEW_TENANT.identity.email);
  }
});

test('NEGATIVE: a manifest with a wrong origin, a foreign or synthetic review address, a missing or extra target, or a key is refused', () => {
  const clone = () => JSON.parse(JSON.stringify(manifest));

  const wrongOrigin = clone();
  wrongOrigin.targets.staging.origin = 'https://abcdefghijklmnopqrst.supabase.co';
  assert.ok(manifestProblems(wrongOrigin).some((problem) => /origin/.test(problem)));

  const cleartext = clone();
  cleartext.targets.staging.origin = `http://${staging.projectRef}.supabase.co`;
  assert.ok(manifestProblems(cleartext).some((problem) => /origin/.test(problem)));

  const foreign = clone();
  foreign.targets.production.reviewEmail = 'review@gmail.com';
  assert.ok(manifestProblems(foreign).some((problem) => /review address/.test(problem)));

  const synthetic = clone();
  synthetic.targets.production.reviewEmail = REVIEW_TENANT.identity.email;
  assert.ok(manifestProblems(synthetic).some((problem) => /review address/.test(problem)));

  const missing = clone();
  delete missing.targets.production;
  assert.ok(manifestProblems(missing).some((problem) => /production/.test(problem)));

  const extra = clone();
  extra.targets.elsewhere = { ...staging };
  assert.ok(manifestProblems(extra).some((problem) => /elsewhere/.test(problem)));

  const badRef = clone();
  badRef.targets.staging.projectRef = 'Not-A-Ref';
  assert.ok(manifestProblems(badRef).some((problem) => /project ref/.test(problem)));

  const sameProject = clone();
  sameProject.targets.staging.projectRef = production.projectRef;
  sameProject.targets.staging.origin = production.origin;
  assert.ok(manifestProblems(sameProject).some((problem) => /same project/.test(problem)));

  const keyed = clone();
  keyed.targets.staging.notes = `kept here by mistake: ${fakeSecret}`;
  assert.ok(manifestProblems(keyed).some((problem) => /key-shaped/.test(problem)));
  assert.ok(!manifestProblems(keyed).join(' ').includes(tail));

  assert.ok(manifestProblems(null).length > 0);
  assert.ok(manifestProblems({}).length > 0);
});

// ---------------------------------------------------------------------------
// Targets, origins, confirmation
// ---------------------------------------------------------------------------

test('resolveHostedTarget knows only the two listed names, spelled exactly', () => {
  assert.equal(resolveHostedTarget(manifest, 'staging').target.projectRef, staging.projectRef);
  assert.equal(
    resolveHostedTarget(manifest, 'production').target.projectRef,
    production.projectRef,
  );
  for (const name of [
    'Staging',
    'prod',
    '',
    ' production',
    '__proto__',
    'constructor',
    'toString',
  ]) {
    const resolved = resolveHostedTarget(manifest, name);
    assert.ok(resolved.error, `"${name}" must not resolve`);
    assert.equal(resolved.target, undefined);
  }
  assert.ok(resolveHostedTarget(manifest, undefined).error);
});

test('originMatches compares the parsed origin exactly', () => {
  assert.equal(originMatches(staging.origin, staging), true);
  assert.equal(originMatches(`${staging.origin}/`, staging), true);
  const refused = [
    `http://${staging.projectRef}.supabase.co`,
    `${staging.origin}:8443`,
    `https://user@${staging.projectRef}.supabase.co`,
    `https://${staging.projectRef}.supabase.co.attacker.example`,
    `https://attacker.example/${staging.projectRef}.supabase.co`,
    `https://attacker.example/?next=${staging.origin}`,
    `${staging.origin}/rest/v1`,
    `${staging.origin}?x=1`,
    `${staging.origin}#fragment`,
    production.origin,
    'http://127.0.0.1:54321',
    'not a url',
    '',
    undefined,
  ];
  for (const candidate of refused) {
    assert.equal(originMatches(candidate, staging), false, `${candidate} must not match staging`);
  }
});

test('changing production needs the project ref repeated; reading it does not; staging does not', () => {
  assert.equal(confirmationError('production', production, 'review-window-status', ''), null);
  for (const command of [
    'seed-review',
    'retire-review',
    'open-review-window',
    'close-review-window',
    'sweep-review-window',
    'check-review-sign-in',
  ]) {
    assert.match(confirmationError('production', production, command, ''), /--confirm/);
    assert.match(
      confirmationError('production', production, command, staging.projectRef),
      /--confirm/,
    );
    assert.match(confirmationError('production', production, command, 'production'), /--confirm/);
    assert.equal(confirmationError('production', production, command, production.projectRef), null);
    assert.equal(confirmationError('staging', staging, command, ''), null);
  }
});

test('NEGATIVE: an unknown command is never treated as a read', () => {
  assert.ok(confirmationError('production', production, 'drop-everything', ''));
  assert.ok(confirmationError('staging', staging, 'drop-everything', ''));
});

test('NEGATIVE: the manifest cannot relax production', () => {
  const relaxed = { ...production, confirmChanges: false, allowProof: true };
  assert.match(confirmationError('production', relaxed, 'seed-review', ''), /--confirm/);
  assert.equal(proofAllowed('production', relaxed), false);
});

test('the proof runs where the manifest allows it and never on production', () => {
  assert.equal(proofAllowed('staging', staging), true);
  assert.equal(proofAllowed('production', production), false);
  assert.equal(proofAllowed('staging', { ...staging, allowProof: false }), false);
});

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

test('selectProjectKeys takes the secret and the publishable key and nothing else', () => {
  const chosen = selectProjectKeys(
    cliJson([
      { name: 'anon', type: 'legacy', api_key: fakeLegacy },
      { name: 'service_role', type: 'legacy', api_key: fakeLegacy },
      { name: 'default', type: 'publishable', api_key: fakePublishable },
      { name: 'default', type: 'secret', api_key: fakeSecret },
    ]),
  );
  assert.equal(chosen.error, undefined);
  assert.equal(chosen.secretKey, fakeSecret);
  assert.equal(chosen.clientKey, fakePublishable);
  assert.deepEqual(Object.keys(chosen).sort(), ['clientKey', 'secretKey']);
});

test('selectProjectKeys prefers the key named default when there are several', () => {
  const other = 'sb_' + 'secret_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k';
  const chosen = selectProjectKeys(
    cliJson([
      { name: 'other', type: 'secret', api_key: other },
      { name: 'default', type: 'secret', api_key: fakeSecret },
      { name: 'default', type: 'publishable', api_key: fakePublishable },
    ]),
  );
  assert.equal(chosen.secretKey, fakeSecret);
});

test('NEGATIVE: a masked, missing, or legacy secret is refused without echoing anything', () => {
  const masked = selectProjectKeys(
    cliJson([
      { name: 'default', type: 'publishable', api_key: fakePublishable },
      { name: 'default', type: 'secret', api_key: 'sb_' + 'secret_AbCdE·················' },
    ]),
  );
  assert.ok(masked.error);
  assert.equal(masked.secretKey, undefined);

  const legacyOnly = selectProjectKeys(
    cliJson([
      { name: 'service_role', type: 'legacy', api_key: fakeLegacy },
      { name: 'default', type: 'publishable', api_key: fakePublishable },
    ]),
  );
  assert.ok(legacyOnly.error);
  assert.ok(!legacyOnly.error.includes('eyJ'));

  const noPublishable = selectProjectKeys(
    cliJson([{ name: 'default', type: 'secret', api_key: fakeSecret }]),
  );
  assert.ok(noPublishable.error);
  assert.ok(!noPublishable.error.includes(tail));

  const junk = selectProjectKeys(`unexpected output carrying ${fakeSecret}`);
  assert.ok(junk.error);
  assert.ok(!junk.error.includes(tail));

  assert.ok(selectProjectKeys(cliJson({ not: 'an array' })).error);
  assert.ok(selectProjectKeys('').error);
});

test('isSecretKeyShape admits only the new secret key', () => {
  assert.equal(isSecretKeyShape(fakeSecret), true);
  assert.equal(isSecretKeyShape(fakePublishable), false);
  assert.equal(isSecretKeyShape(fakeLegacy), false);
  assert.equal(isSecretKeyShape('sb_' + 'secret_short'), false);
  assert.equal(isSecretKeyShape(`${fakeSecret} trailing`), false);
  assert.equal(isSecretKeyShape(''), false);
  assert.equal(isSecretKeyShape(undefined), false);
});

test('redactKeys strips every key shape from surfaced text', () => {
  const noisy = `failed with ${fakeSecret}, ${fakePublishable} and ${fakeLegacy} in the output`;
  const clean = redactKeys(noisy);
  assert.ok(!clean.includes(tail));
  assert.ok(!clean.includes('eyJhbGciOiJIUzI1NiJ9'));
  assert.ok(clean.includes('[redacted]'));
  assert.equal(redactKeys('nothing to hide'), 'nothing to hide');
});

// ---------------------------------------------------------------------------
// The context the child tools resolve
// ---------------------------------------------------------------------------

test('a hosted target resolves with its approved origin, the key for both headers, and its review address', () => {
  const context = resolveOperatorContext(
    {
      HIVE_HOSTED_TARGET: 'staging',
      HIVE_HOSTED_SUPABASE_URL: staging.origin,
      HIVE_HOSTED_SECRET_KEY: fakeSecret,
      HIVE_HOSTED_CLIENT_KEY: fakePublishable,
    },
    manifest,
  );
  assert.equal(context.error, undefined);
  assert.equal(context.kind, 'hosted');
  assert.equal(context.name, 'staging');
  assert.equal(context.url, staging.origin);
  assert.equal(context.serviceKey, fakeSecret);
  assert.equal(context.gatewayKey, fakeSecret);
  assert.equal(context.clientKey, fakePublishable);
  assert.equal(context.reviewEmail, staging.reviewEmail);
});

test('NEGATIVE: a hosted target is refused on any other origin, without a key, or with a key of another shape', () => {
  const base = {
    HIVE_HOSTED_TARGET: 'staging',
    HIVE_HOSTED_SUPABASE_URL: staging.origin,
    HIVE_HOSTED_SECRET_KEY: fakeSecret,
  };
  const refusals = [
    { ...base, HIVE_HOSTED_TARGET: 'elsewhere' },
    { ...base, HIVE_HOSTED_SUPABASE_URL: production.origin },
    { ...base, HIVE_HOSTED_SUPABASE_URL: 'https://attacker.example' },
    { ...base, HIVE_HOSTED_SUPABASE_URL: 'http://127.0.0.1:54321' },
    { ...base, HIVE_HOSTED_SUPABASE_URL: undefined },
    { ...base, HIVE_HOSTED_SECRET_KEY: undefined },
    { ...base, HIVE_HOSTED_SECRET_KEY: fakeLegacy },
    { ...base, HIVE_HOSTED_SECRET_KEY: fakePublishable },
  ];
  for (const env of refusals) {
    const context = resolveOperatorContext(env, manifest);
    assert.ok(context.error, JSON.stringify(Object.keys(env)));
    assert.equal(context.serviceKey, undefined);
    assert.ok(!context.error.includes(tail));
  }
});

test('NEGATIVE: a hosted target never borrows the local stack variables', () => {
  const context = resolveOperatorContext(
    {
      HIVE_HOSTED_TARGET: 'production',
      HIVE_LOCAL_SUPABASE_URL: 'http://127.0.0.1:54321',
      HIVE_LOCAL_SERVICE_KEY: fakeLegacy,
    },
    manifest,
  );
  assert.ok(context.error);
  assert.equal(context.url, undefined);
});

test('without a hosted target the loopback rules stand as they were', () => {
  const local = resolveOperatorContext(
    {
      HIVE_LOCAL_SUPABASE_URL: 'http://127.0.0.1:54321',
      HIVE_LOCAL_SERVICE_KEY: fakeLegacy,
      HIVE_LOCAL_GATEWAY_KEY: fakeSecret,
      HIVE_LOCAL_CLIENT_KEY: fakePublishable,
    },
    manifest,
  );
  assert.equal(local.error, undefined);
  assert.equal(local.kind, 'loopback');
  assert.equal(local.serviceKey, fakeLegacy);
  assert.equal(local.gatewayKey, fakeSecret);
  assert.equal(local.reviewEmail, REVIEW_TENANT.identity.email);
  assert.equal(changeRefusal(local, 'seed-review'), null);

  const fallbackGateway = resolveOperatorContext(
    { HIVE_LOCAL_SUPABASE_URL: 'http://localhost:54321', HIVE_LOCAL_SERVICE_KEY: fakeLegacy },
    manifest,
  );
  assert.equal(fallbackGateway.gatewayKey, fakeLegacy);

  assert.match(
    resolveOperatorContext(
      { HIVE_LOCAL_SUPABASE_URL: staging.origin, HIVE_LOCAL_SERVICE_KEY: fakeSecret },
      manifest,
    ).error,
    /non-loopback/,
  );
  assert.ok(resolveOperatorContext({}, manifest).error);
  assert.ok(
    resolveOperatorContext({ HIVE_LOCAL_SUPABASE_URL: 'http://127.0.0.1:54321' }, manifest).error,
  );
});

test('a change on production is refused in the child too unless the ref was repeated', () => {
  const env = {
    HIVE_HOSTED_TARGET: 'production',
    HIVE_HOSTED_SUPABASE_URL: production.origin,
    HIVE_HOSTED_SECRET_KEY: fakeSecret,
  };
  const unconfirmed = resolveOperatorContext(env, manifest);
  assert.equal(unconfirmed.error, undefined);
  assert.match(changeRefusal(unconfirmed, 'open-review-window'), /--confirm/);
  assert.equal(changeRefusal(unconfirmed, 'review-window-status'), null);
  const confirmed = resolveOperatorContext(
    { ...env, HIVE_HOSTED_CONFIRM: production.projectRef },
    manifest,
  );
  assert.equal(changeRefusal(confirmed, 'open-review-window'), null);
});

// ---------------------------------------------------------------------------
// The review code file
// ---------------------------------------------------------------------------

test('the review code file defaults to the approvals folder, one per target, outside the repository', () => {
  const home = path.join(os.tmpdir(), 'hive-operator-home');
  const forStaging = reviewCodeFileFor('staging', { USERPROFILE: home }, appRoot);
  const forProduction = reviewCodeFileFor('production', { HOME: home }, appRoot);
  assert.equal(forStaging.file, path.join(home, 'HIVE-approvals', 'review-code-staging.txt'));
  assert.equal(forProduction.file, path.join(home, 'HIVE-approvals', 'review-code-production.txt'));
  assert.notEqual(forStaging.file, forProduction.file);
});

test('NEGATIVE: a review code file inside the repository, or with no home to default to, is refused', () => {
  const inside = reviewCodeFileFor(
    'staging',
    { HIVE_REVIEW_CODE_FILE: path.join(appRoot, 'security', 'review-code.txt') },
    appRoot,
  );
  assert.match(inside.error, /inside the repository/);
  const sibling = reviewCodeFileFor(
    'staging',
    { HIVE_REVIEW_CODE_FILE: path.join(appRoot, '..', 'docs', 'review-code.txt') },
    appRoot,
  );
  assert.match(sibling.error, /inside the repository/);
  assert.ok(reviewCodeFileFor('staging', {}, appRoot).error);
  const explicit = path.join(os.tmpdir(), 'hive-operator-home', 'elsewhere', 'code.txt');
  assert.equal(
    reviewCodeFileFor('staging', { HIVE_REVIEW_CODE_FILE: explicit }, appRoot).file,
    explicit,
  );
});

test('isInsideDirectory is about containment, not string prefixes', () => {
  const base = path.join(os.tmpdir(), 'hive-repo');
  assert.equal(isInsideDirectory(path.join(base, 'a', 'b.txt'), base), true);
  assert.equal(isInsideDirectory(base, base), true);
  assert.equal(isInsideDirectory(path.join(`${base}-other`, 'b.txt'), base), false);
  assert.equal(isInsideDirectory(path.join(base, '..', 'b.txt'), base), false);
});

test('loadReviewCode reads the code and never creates one', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hive-review-check-'));
  try {
    const file = path.join(dir, 'code.txt');
    assert.throws(() => loadReviewCode(file), /no review code/);
    assert.throws(() => loadReviewCode(''), /names no file/);
    writeFileSync(file, 'abc');
    assert.throws(() => loadReviewCode(file), /twelve to twenty digits/);
    writeFileSync(file, '1234567890123456' + String.fromCharCode(10));
    assert.equal(loadReviewCode(file), '1234567890123456');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The kill switch through the same mode
// ---------------------------------------------------------------------------

test('reading the service state needs nothing; pausing or resuming production needs the ref', () => {
  assert.equal(confirmationError('production', production, 'service-status', ''), null);
  for (const command of ['pause-service', 'resume-service']) {
    assert.match(confirmationError('production', production, command, ''), /--confirm/);
    assert.equal(confirmationError('production', production, command, production.projectRef), null);
    assert.equal(confirmationError('staging', staging, command, ''), null);
  }
});

test('the switch reaches a hosted project only on the origin it was approved for', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          state: 'paused',
          reason_code: 'incident',
          min_app_version: '1.2.3',
          version: 4,
        }),
    };
  };
  const base = { url: staging.origin, serviceKey: fakeSecret, gatewayKey: fakeSecret, fetchImpl };

  const bare = await setServiceState({ ...base, state: 'paused', reasonCode: 'incident' });
  assert.equal(bare.ok, false);
  assert.match(bare.problems[0], /non-loopback/);

  const elsewhere = await setServiceState({
    ...base,
    approvedOrigin: production.origin,
    state: 'paused',
    reasonCode: 'incident',
  });
  assert.equal(elsewhere.ok, false);
  assert.match(elsewhere.problems[0], /approved origin/);

  const readElsewhere = await readServiceState({ ...base, approvedOrigin: production.origin });
  assert.equal(readElsewhere.ok, false);
  assert.equal(calls.length, 0, 'refused inputs never reach the server');

  const paused = await setServiceState({
    ...base,
    approvedOrigin: staging.origin,
    state: 'paused',
    reasonCode: 'incident',
    minAppVersion: '1.2.3',
    idempotencyKey: 'k-hosted',
  });
  assert.equal(paused.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${staging.origin}/rest/v1/rpc/set_service_state`);
  assert.equal(calls[0].headers.apikey, fakeSecret);
  assert.deepEqual(calls[0].body, {
    p_state: 'paused',
    p_reason_code: 'incident',
    p_min_app_version: '1.2.3',
    p_idempotency_key: 'k-hosted',
  });
  const read = await readServiceState({ ...base, approvedOrigin: staging.origin });
  assert.equal(read.ok, true);
  assert.equal(read.status.min_app_version, '1.2.3');
});

test('a pause or a resume keeps the minimum app version unless the operator names another', () => {
  assert.equal(keptMinAppVersion(undefined, { min_app_version: '1.4.0' }), '1.4.0');
  assert.equal(keptMinAppVersion('', { min_app_version: '1.4.0' }), '1.4.0');
  assert.equal(keptMinAppVersion('2.0.0', { min_app_version: '1.4.0' }), '2.0.0');
  assert.equal(keptMinAppVersion(undefined, null), '0.0.0');
  assert.equal(keptMinAppVersion(undefined, { min_app_version: 'garbage' }), '0.0.0');
});

// ---------------------------------------------------------------------------
// The tools themselves: every refusal happens before the network
// ---------------------------------------------------------------------------

const noNetwork = './tests/scripts/helpers/no-network.mjs';

function run(script, args, env) {
  const cleaned = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith('HIVE_HOSTED_') && !name.startsWith('HIVE_LOCAL_'),
    ),
  );
  return spawnSync(
    process.execPath,
    ['--import', noNetwork, path.join('scripts', script), ...args],
    {
      cwd: appRoot,
      encoding: 'utf8',
      env: { ...cleaned, ...env },
      timeout: 30_000,
    },
  );
}

test('CLI NEGATIVE: the runner refuses an unknown target, an unknown command, and no arguments', () => {
  const none = run('hosted-supabase.mjs', [], {});
  assert.equal(none.status, 1);
  assert.match(none.stderr, /usage/);
  const unknownTarget = run('hosted-supabase.mjs', ['elsewhere', 'review-window-status'], {});
  assert.equal(unknownTarget.status, 1);
  assert.match(unknownTarget.stderr, /not a hosted target/);
  const unknownCommand = run('hosted-supabase.mjs', ['staging', 'drop-everything'], {});
  assert.equal(unknownCommand.status, 1);
  assert.match(unknownCommand.stderr, /usage/);
});

test('CLI NEGATIVE: the runner refuses a change on production without the ref, before it asks for any key', () => {
  for (const command of [
    'seed-review',
    'open-review-window',
    'close-review-window',
    'retire-review',
    'check-review-sign-in',
  ]) {
    const refused = run('hosted-supabase.mjs', ['production', command], {});
    assert.equal(refused.status, 1, command);
    assert.match(refused.stderr, /--confirm/);
    assert.ok(!/api-keys|supabase projects/.test(refused.stderr));
  }
  const wrongRef = run(
    'hosted-supabase.mjs',
    ['production', 'seed-review', '--confirm', staging.projectRef],
    {},
  );
  assert.equal(wrongRef.status, 1);
  assert.match(wrongRef.stderr, /--confirm/);
});

test('CLI NEGATIVE: the proof is refused on production even with the ref repeated', () => {
  const refused = run(
    'hosted-supabase.mjs',
    ['production', 'prove-review', '--confirm', production.projectRef],
    {},
  );
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /never runs on production/);
});

test('CLI NEGATIVE: the runner refuses hours that are not a whole number from 1 to 168', () => {
  for (const hours of ['0', '169', '1.5', 'soon']) {
    const refused = run('hosted-supabase.mjs', ['staging', 'open-review-window', hours], {});
    assert.equal(refused.status, 1, hours);
    assert.match(refused.stderr, /hours/);
  }
});

test('CLI NEGATIVE: the seed tool refuses a hosted target on the wrong origin and a bare hosted URL', () => {
  const wrongOrigin = run('seed-review-tenant.mjs', [], {
    HIVE_HOSTED_TARGET: 'staging',
    HIVE_HOSTED_SUPABASE_URL: production.origin,
    HIVE_HOSTED_SECRET_KEY: fakeSecret,
    HIVE_REVIEW_MODE: 'seed',
  });
  assert.equal(wrongOrigin.status, 1);
  assert.match(wrongOrigin.stderr, /approved origin/);
  const bare = run('seed-review-tenant.mjs', [], {
    HIVE_LOCAL_SUPABASE_URL: staging.origin,
    HIVE_LOCAL_SERVICE_KEY: fakeSecret,
    HIVE_REVIEW_MODE: 'seed',
  });
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /non-loopback/);
});

test('CLI NEGATIVE: the seed and window tools refuse a change on production without the ref', () => {
  const env = {
    HIVE_HOSTED_TARGET: 'production',
    HIVE_HOSTED_SUPABASE_URL: production.origin,
    HIVE_HOSTED_SECRET_KEY: fakeSecret,
  };
  const seed = run('seed-review-tenant.mjs', [], { ...env, HIVE_REVIEW_MODE: 'seed' });
  assert.equal(seed.status, 1);
  assert.match(seed.stderr, /--confirm/);
  const retire = run('seed-review-tenant.mjs', [], { ...env, HIVE_REVIEW_MODE: 'retire' });
  assert.equal(retire.status, 1);
  assert.match(retire.stderr, /--confirm/);
  for (const mode of ['open', 'close', 'sweep']) {
    const refused = run('review-window.mjs', [], {
      ...env,
      HIVE_REVIEW_WINDOW_MODE: mode,
      HIVE_REVIEW_CODE_FILE: path.join(os.tmpdir(), 'hive-operator-home', 'never-written.txt'),
    });
    assert.equal(refused.status, 1, mode);
    assert.match(refused.stderr, /--confirm/);
  }
});

test('CLI NEGATIVE: the window tool refuses a code file inside the repository for a hosted target', () => {
  const refused = run('review-window.mjs', [], {
    HIVE_HOSTED_TARGET: 'staging',
    HIVE_HOSTED_SUPABASE_URL: staging.origin,
    HIVE_HOSTED_SECRET_KEY: fakeSecret,
    HIVE_REVIEW_WINDOW_MODE: 'open',
    HIVE_REVIEW_CODE_FILE: path.join(appRoot, 'review-code.txt'),
  });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /inside the repository/);
});

test('CLI NEGATIVE: the proof tool refuses the local lane and production', () => {
  const local = run('hosted-review-proof.mjs', [], {
    HIVE_LOCAL_SUPABASE_URL: 'http://127.0.0.1:54321',
    HIVE_LOCAL_SERVICE_KEY: fakeLegacy,
  });
  assert.equal(local.status, 1);
  assert.match(local.stderr, /hosted/);
  const onProduction = run('hosted-review-proof.mjs', [], {
    HIVE_HOSTED_TARGET: 'production',
    HIVE_HOSTED_SUPABASE_URL: production.origin,
    HIVE_HOSTED_SECRET_KEY: fakeSecret,
    HIVE_HOSTED_CLIENT_KEY: fakePublishable,
    HIVE_HOSTED_CONFIRM: production.projectRef,
  });
  assert.equal(onProduction.status, 1);
  assert.match(onProduction.stderr, /never runs on production/);
});

test('CLI NEGATIVE: the sign-in check refuses when there is no code file, before the network', () => {
  const refused = run('review-window.mjs', [], {
    HIVE_HOSTED_TARGET: 'staging',
    HIVE_HOSTED_SUPABASE_URL: staging.origin,
    HIVE_HOSTED_SECRET_KEY: fakeSecret,
    HIVE_HOSTED_CLIENT_KEY: fakePublishable,
    HIVE_REVIEW_WINDOW_MODE: 'check',
    HIVE_REVIEW_CODE_FILE: path.join(os.tmpdir(), 'hive-operator-home', 'no-such-code.txt'),
  });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /no review code/);
  const noClientKey = run('review-window.mjs', [], {
    HIVE_HOSTED_TARGET: 'staging',
    HIVE_HOSTED_SUPABASE_URL: staging.origin,
    HIVE_HOSTED_SECRET_KEY: fakeSecret,
    HIVE_REVIEW_WINDOW_MODE: 'check',
    HIVE_REVIEW_CODE_FILE: path.join(os.tmpdir(), 'hive-operator-home', 'no-such-code.txt'),
  });
  assert.equal(noClientKey.status, 1);
  assert.match(noClientKey.stderr, /publishable/);
});

test('CLI NEGATIVE: the kill switch on production is refused without the ref, and a reason outside the list is refused', () => {
  for (const args of [
    ['production', 'pause-service', 'incident'],
    ['production', 'resume-service'],
  ]) {
    const refused = run('hosted-supabase.mjs', args, {});
    assert.equal(refused.status, 1, args.join(' '));
    assert.match(refused.stderr, /--confirm/);
  }
  const badReason = run('hosted-supabase.mjs', ['staging', 'pause-service', 'meltdown'], {});
  assert.equal(badReason.status, 1);
  assert.match(badReason.stderr, /maintenance or incident/);
  const env = {
    HIVE_HOSTED_TARGET: 'production',
    HIVE_HOSTED_SUPABASE_URL: production.origin,
    HIVE_HOSTED_SECRET_KEY: fakeSecret,
  };
  for (const mode of ['pause', 'resume']) {
    const child = run('service-state.mjs', [], { ...env, HIVE_SERVICE_MODE: mode });
    assert.equal(child.status, 1, mode);
    assert.match(child.stderr, /--confirm/);
  }
  const wrongOrigin = run('service-state.mjs', [], {
    HIVE_HOSTED_TARGET: 'staging',
    HIVE_HOSTED_SUPABASE_URL: production.origin,
    HIVE_HOSTED_SECRET_KEY: fakeSecret,
    HIVE_SERVICE_MODE: 'read',
  });
  assert.equal(wrongOrigin.status, 1);
  assert.match(wrongOrigin.stderr, /approved origin/);
});
